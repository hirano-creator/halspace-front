// ウォームアップ用エンドポイント
// 定期的に叩くことで Netlify 関数のコールドスタートと
// Neon（無料枠）の自動休止を防ぎ、初回アクセスの数秒待ちをなくす。
// 秘密情報は一切返さないため認証は不要。

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  // DBまで起こすのは JST 8:00〜17:59 のみ。
  // Neon無料枠（月100 CU時間）を超えないよう、それ以外の時間帯は
  // 関数コンテナだけ温めてDBは自動休止に任せる（初回クリックが+1秒程度になる）。
  const jstHour = (new Date().getUTCHours() + 9) % 24;
  if (jstHour < 8 || jstHour >= 18) {
    return Response.json({ ok: true, dbMs: null });
  }

  // dbMs で「接続再利用が効いているか」を外から診断できるようにしておく
  // （再利用時は数十ms未満、毎回再接続だと1秒前後になる＝リージョン不一致のサイン）
  const started = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const dbMs = Date.now() - started;
  return Response.json({ ok: true, dbMs });
}
