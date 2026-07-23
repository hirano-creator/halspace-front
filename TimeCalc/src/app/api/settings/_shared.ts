// /api/settings/* の各Route Handlerが共有するロジック

import { prisma } from "@/lib/db";

/** フォームの companyId を取り出し、実在確認をして返す（空文字は共通設定 = null） */
export async function resolveCompanyId(formData: FormData): Promise<string | null | "invalid"> {
  const companyId = String(formData.get("companyId") ?? "").trim() || null;
  if (!companyId) return null;
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  return company ? companyId : "invalid";
}
