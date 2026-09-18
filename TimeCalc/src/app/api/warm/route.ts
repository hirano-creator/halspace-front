// 旧ウォームアップ用エンドポイント（Netlify/Neon 時代の名残）。
// 外形監視や手元の確認コマンドが今もこのパスを叩くため、/api/health と同じ内容を返す別名として残す。
// 新しく参照する側は /api/health を使うこと。

import { GET as healthGet } from "../health/route";

export const dynamic = "force-dynamic";

export async function GET() {
  return healthGet();
}
