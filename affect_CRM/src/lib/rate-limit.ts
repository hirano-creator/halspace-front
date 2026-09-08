// レート制限
//
// Workers はリクエストごとに別 isolate になり得るため、メモリ上のカウントは効かない。
// D1 の RateLimit テーブルに試行を記録して数える。

import { prisma } from "@/lib/db";

/** リクエスト元 IP。Cloudflare が付けるヘッダーを使う（ローカルでは unknown） */
export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

/**
 * 試行を 1 回記録し、上限を超えていないか返す。
 * @returns true = まだ許可してよい / false = 上限を超えた
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMs);

  const count = await prisma.rateLimit.count({ where: { key, createdAt: { gte: since } } });
  if (count >= limit) return false;

  await prisma.rateLimit.create({ data: { key } });
  // 古い記録は溜め込まない（D1 の書き込み枠を無駄にしない）
  await prisma.rateLimit.deleteMany({ where: { createdAt: { lt: since } } });
  return true;
}

/** 記録だけする（成功／失敗を後から判断したい場合に使う） */
export async function recordAttempt(key: string): Promise<void> {
  await prisma.rateLimit.create({ data: { key } });
}

/** 指定キーの記録を消す（ログイン成功時など、正常な利用でリセットする） */
export async function clearRateLimit(key: string): Promise<void> {
  await prisma.rateLimit.deleteMany({ where: { key } });
}

/** 現在の試行回数だけ数える（記録は増やさない） */
export async function countAttempts(key: string, windowMs: number): Promise<number> {
  return prisma.rateLimit.count({
    where: { key, createdAt: { gte: new Date(Date.now() - windowMs) } },
  });
}
