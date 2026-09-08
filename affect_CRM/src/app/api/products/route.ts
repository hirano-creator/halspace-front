import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission, requireApiUser } from "@/lib/auth/api-guard";
import { trimOrNull } from "@/lib/normalize";
import type { ProductListResponse } from "@/app/(app)/products/types";

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";

  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        ...(q ? { OR: [{ name: { contains: q } }, { brand: { contains: q } }] } : {}),
      },
      orderBy: [{ categoryId: "asc" }, { name: "asc" }],
      take: 200,
      include: { category: { select: { id: true, name: true } } },
    }),
    prisma.productCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const body: ProductListResponse = {
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      price: p.price,
      categoryId: p.category?.id ?? null,
      categoryName: p.category?.name ?? null,
    })),
    categories,
  };

  return NextResponse.json(body);
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "master.edit");
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const parsed = parseProductForm(form);
  if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });

  const product = await prisma.product.create({ data: parsed, select: { id: true } });
  return NextResponse.json({ product });
}

export function parseProductForm(form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  if (!name) return "商品名を入力してください";

  const priceRaw = trimOrNull(form.get("price"));
  let price: number | null = null;
  if (priceRaw !== null) {
    const n = Number(priceRaw);
    if (!Number.isFinite(n) || n < 0) return "価格は 0 以上の数字で入力してください";
    price = Math.round(n);
  }

  return {
    name,
    brand: trimOrNull(form.get("brand")),
    price,
    categoryId: trimOrNull(form.get("categoryId")),
  };
}
