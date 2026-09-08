import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { calcAge } from "@/lib/utils/time";
import {
  findDuplicateCandidates,
  nextCustomerCode,
  parseCustomerForm,
} from "./_shared";
import type { CustomerListResponse } from "@/app/(app)/customers/types";

const PER_PAGE = 30;

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const gender = url.searchParams.get("gender") ?? "";
  const tagId = url.searchParams.get("tagId") ?? "";
  const rank = url.searchParams.get("rank") ?? "";
  const purchased = url.searchParams.get("purchased") ?? "";
  const school = url.searchParams.get("school") ?? "";
  const sort = url.searchParams.get("sort") ?? "lastVisit";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);

  // SQLite は mode:"insensitive" が使えないため、メールは小文字化した列で照合する
  const digits = q.replace(/\D/g, "");
  const where = {
    deletedAt: null,
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { nameKana: { contains: q } },
            { nickname: { contains: q } },
            { code: { contains: q.toUpperCase() } },
            ...(digits ? [{ phoneDigits: { contains: digits } }] : []),
            { emailLower: { contains: q.toLowerCase() } },
          ],
        }
      : {}),
    ...(gender ? { gender } : {}),
    ...(rank ? { rank } : {}),
    ...(tagId ? { tags: { some: { tagId } } } : {}),
    ...(purchased === "yes" ? { purchaseCount: { gt: 0 } } : {}),
    ...(purchased === "no" ? { purchaseCount: 0 } : {}),
    ...(school === "yes" ? { schoolCount: { gt: 0 } } : {}),
    ...(school === "no" ? { schoolCount: 0 } : {}),
  };

  const orderBy =
    sort === "purchaseTotal"
      ? [{ purchaseTotal: "desc" as const }]
      : sort === "visitCount"
        ? [{ visitCount: "desc" as const }]
        : sort === "name"
          ? [{ nameKana: "asc" as const }, { name: "asc" as const }]
          : [{ lastVisitAt: "desc" as const }, { createdAt: "desc" as const }];

  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy,
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: { tags: { include: { tag: { select: { id: true, name: true, color: true } } } } },
    }),
  ]);

  const body: CustomerListResponse = {
    total,
    page,
    perPage: PER_PAGE,
    customers: rows.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      nameKana: c.nameKana,
      gender: c.gender,
      age: calcAge(c.birthday),
      prefecture: c.prefecture,
      rank: c.rank,
      phone: c.phone,
      visitCount: c.visitCount,
      lastVisitAt: c.lastVisitAt ? c.lastVisitAt.toISOString() : null,
      purchaseTotal: c.purchaseTotal,
      purchaseCount: c.purchaseCount,
      schoolCount: c.schoolCount,
      tags: c.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
    })),
  };

  return NextResponse.json(body);
}

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const input = parseCustomerForm(form);
  if (typeof input === "string") {
    return NextResponse.json({ error: input }, { status: 400 });
  }

  // 重複候補があれば、確認していない限り登録しない（自動統合はしない）
  const skipDuplicateCheck = form.get("confirmDuplicate") === "1";
  if (!skipDuplicateCheck) {
    const candidates = await findDuplicateCandidates(input.phoneDigits, input.emailLower);
    if (candidates.length > 0) {
      return NextResponse.json({ duplicates: candidates }, { status: 409 });
    }
  }

  const code = await nextCustomerCode();
  const customer = await prisma.customer.create({
    data: {
      code,
      name: input.name,
      nameKana: input.nameKana,
      nickname: input.nickname,
      gender: input.gender,
      birthday: input.birthday,
      phone: input.phone,
      phoneDigits: input.phoneDigits,
      email: input.email,
      emailLower: input.emailLower,
      prefecture: input.prefecture,
      city: input.city,
      addressLine: input.addressLine,
      lineId: input.lineId,
      instagram: input.instagram,
      rank: input.rank,
      note: input.note,
      createdById: auth.user.id,
      tags: { create: input.tagIds.map((tagId) => ({ tagId })) },
      surfProfile: { create: input.surf },
    },
    select: { id: true, code: true, name: true },
  });

  return NextResponse.json({ customer });
}
