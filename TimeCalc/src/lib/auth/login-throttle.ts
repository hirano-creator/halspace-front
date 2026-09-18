// ログイン試行の制限（総当たり対策）
//
// 社員番号は連番で推測しやすく、100人規模になると「誰かのアカウントに当たるまで試す」攻撃が
// 現実的になる。識別子（社員番号/メール）ごとと接続元IPごとの2軸で失敗回数を数え、
// 上限を超えたら一定時間ロックする。
//
// 記録はプロセス内メモリ（Map）。本番は Railway の1インスタンスなのでこれで足りる。
// レプリカを増やしてインスタンスをまたぐようになったら、DBテーブルか Redis に置き換えること。
// 再起動でリセットされるのは許容（攻撃者の連続試行は再起動をまたいでも遅くなる）。

export interface ThrottleRule {
  /** この回数の失敗でロックする */
  maxFailures: number;
  /** 失敗を数える窓・ロックの長さ（ms） */
  windowMs: number;
}

/** 識別子ごと: 15分に5回失敗で15分ロック。本人の打ち間違いで困らない程度に緩く、総当たりには十分きつい */
export const IDENTIFIER_RULE: ThrottleRule = { maxFailures: 5, windowMs: 15 * 60 * 1000 };
/** 接続元IPごと: 15分に30回失敗でロック。同じ拠点から複数人が同時に間違えても掛からない程度 */
export const IP_RULE: ThrottleRule = { maxFailures: 30, windowMs: 15 * 60 * 1000 };

interface Entry {
  failures: number;
  /** 窓の開始時刻。窓を過ぎたら数え直す */
  windowStart: number;
  /** ロック中ならその解除時刻 */
  lockedUntil: number | null;
}

/** メモリが際限なく増えないよう、期限切れの記録をこの件数を超えたときに掃除する */
const SWEEP_THRESHOLD = 10_000;

export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly rule: ThrottleRule,
    private readonly now: () => number = Date.now,
  ) {}

  /** ロック中なら残り秒数、そうでなければ null */
  lockedFor(key: string): number | null {
    const entry = this.entries.get(key);
    if (!entry?.lockedUntil) return null;
    const remaining = entry.lockedUntil - this.now();
    if (remaining <= 0) {
      this.entries.delete(key);
      return null;
    }
    return Math.ceil(remaining / 1000);
  }

  /** 失敗を記録し、上限に達したらロックする。戻り値はロックされたかどうか */
  recordFailure(key: string): boolean {
    const now = this.now();
    if (this.entries.size >= SWEEP_THRESHOLD) this.sweep(now);

    const entry = this.entries.get(key);
    if (!entry || now - entry.windowStart > this.rule.windowMs) {
      this.entries.set(key, { failures: 1, windowStart: now, lockedUntil: null });
      return false;
    }
    entry.failures += 1;
    if (entry.failures >= this.rule.maxFailures) {
      entry.lockedUntil = now + this.rule.windowMs;
      return true;
    }
    return false;
  }

  /** 成功したら失敗の記録を消す（ロック中の成功はそもそも起きない＝先に lockedFor で弾く） */
  recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.entries) {
      const expired = entry.lockedUntil
        ? entry.lockedUntil <= now
        : now - entry.windowStart > this.rule.windowMs;
      if (expired) this.entries.delete(key);
    }
  }
}

/**
 * 接続元IPを求める。Cloudflare 中継経由なら cf-connecting-ip、Railway 直なら x-forwarded-for の先頭。
 * どちらも無ければ "unknown"（全員まとめて1つの枠になるが、識別子側の制限は独立して効く）
 */
export function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

// 本番で使う共有インスタンス。`next dev` のHMRで増殖しないよう globalThis に退避する
const globalForThrottle = globalThis as unknown as {
  __timecalcLoginThrottle?: { byIdentifier: LoginThrottle; byIp: LoginThrottle };
};

export const loginThrottle =
  globalForThrottle.__timecalcLoginThrottle ??
  (globalForThrottle.__timecalcLoginThrottle = {
    byIdentifier: new LoginThrottle(IDENTIFIER_RULE),
    byIp: new LoginThrottle(IP_RULE),
  });
