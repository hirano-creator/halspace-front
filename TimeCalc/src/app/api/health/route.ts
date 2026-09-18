// ヘルスチェック用エンドポイント（Railway の healthcheckPath、外形監視）
//
// DB まで疎通を確認して返す。DB に届かなければ 503 なので、Railway はデプロイ直後の
// 「migrate deploy 中」や DB 障害時に新コンテナへトラフィックを切り替えない。
// 秘密情報は一切返さないため認証は不要。
//
// serverTime: 打刻の記録に使う時刻（固定+9時間で計算しているのでコンテナのTZに依らずJST）。
// dbMs: 接続プールが効いていれば数十ms未満、毎回再接続なら1秒前後（リージョン不一致のサイン）。

import { prisma } from "@/lib/db";
import { nowTimeString } from "@/lib/utils/time";

export const dynamic = "force-dynamic";

export async function GET() {
  const serverTime = nowTimeString();
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    console.error("[health] db check failed:", e);
    return Response.json({ ok: false, dbMs: null, serverTime }, { status: 503 });
  }
  return Response.json({ ok: true, dbMs: Date.now() - started, serverTime });
}
