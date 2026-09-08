import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { formatJstDate } from "@/lib/utils/time";
import type { CustomerSuggestion } from "@/app/(app)/visits/types";

/** 来店登録の顧客選択で使う軽量な検索。名前・カナ・電話・顧客番号で引く */
export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const digits = q.replace(/\D/g, "");

  const rows = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { nameKana: { contains: q } },
              { nickname: { contains: q } },
              { code: { contains: q.toUpperCase() } },
              ...(digits ? [{ phoneDigits: { contains: digits } }] : []),
            ],
          }
        : {}),
    },
    // 検索語がないときは、最近来た人を出す（多くの場合それで足りる）
    orderBy: q ? [{ lastVisitAt: "desc" }] : [{ lastVisitAt: "desc" }],
    take: 12,
    select: { id: true, code: true, name: true, phone: true, visitCount: true, lastVisitAt: true },
  });

  const customers: CustomerSuggestion[] = rows.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    phone: c.phone,
    visitCount: c.visitCount,
    lastVisitLabel: c.lastVisitAt ? formatJstDate(c.lastVisitAt) : null,
  }));

  return NextResponse.json({ customers });
}
