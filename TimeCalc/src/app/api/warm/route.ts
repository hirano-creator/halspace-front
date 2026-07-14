// ウォームアップ用エンドポイント
// 定期的に叩くことで Netlify 関数のコールドスタートと
// Neon（無料枠）の自動休止を防ぎ、初回アクセスの数秒待ちをなくす。
// 秘密情報は一切返さないため認証は不要。

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  // dbMs で「接続再利用が効いているか」を外から診断できるようにしておく
  // （再利用時は数百ms未満、毎回再接続だと1秒前後になる）
  const started = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const dbMs = Date.now() - started;
  return Response.json({ ok: true, dbMs });
}
