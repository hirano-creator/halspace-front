// 日付・時刻（JST 固定）
//
// ★重要: Cloudflare Workers は常に UTC で動き、TZ 環境変数は効かない。
// 「今日の来店」「今月の売上」の境界を各所で new Date() から組み立てると、
// 日本時間の朝 9 時より前の記録が前日に計上されるといった形で静かに数字が狂う。
// 日付を扱う処理は必ずこのファイルの関数を通すこと。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** UTC の Date を「JST の壁時計」に平行移動する。以後 getUTC* 系で読む */
export function toJst(date: Date = new Date()): Date {
  return new Date(date.getTime() + JST_OFFSET_MS);
}

/** JST の日付境界（その日の 0:00 JST）を UTC の Date として返す */
export function startOfJstDay(date: Date = new Date()): Date {
  const jst = toJst(date);
  return new Date(
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - JST_OFFSET_MS,
  );
}

/** JST の翌日 0:00 を UTC の Date として返す（範囲検索の上限に使う） */
export function endOfJstDay(date: Date = new Date()): Date {
  return new Date(startOfJstDay(date).getTime() + 24 * 60 * 60 * 1000);
}

/** JST の月初 0:00 */
export function startOfJstMonth(date: Date = new Date()): Date {
  const jst = toJst(date);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1) - JST_OFFSET_MS);
}

/** JST の翌月初 0:00 */
export function endOfJstMonth(date: Date = new Date()): Date {
  const jst = toJst(date);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + 1, 1) - JST_OFFSET_MS);
}

/** JST の「今日」の範囲 [start, end) */
export function jstDayRange(date: Date = new Date()): { start: Date; end: Date } {
  return { start: startOfJstDay(date), end: endOfJstDay(date) };
}

/** JST の「今月」の範囲 [start, end) */
export function jstMonthRange(date: Date = new Date()): { start: Date; end: Date } {
  return { start: startOfJstMonth(date), end: endOfJstMonth(date) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-08-31" */
export function formatJstDate(date: Date): string {
  const jst = toJst(date);
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}`;
}

/** "14:20" */
export function formatJstTime(date: Date): string {
  const jst = toJst(date);
  return `${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
}

/** "2026-08-31 14:20" */
export function formatJstDateTime(date: Date): string {
  return `${formatJstDate(date)} ${formatJstTime(date)}`;
}

/** "8/31(日)" のような表示用の短い日付 */
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
export function formatJstShort(date: Date): string {
  const jst = toJst(date);
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}(${WEEKDAYS[jst.getUTCDay()]})`;
}

/** "2026年8月31日（日）" */
export function formatJstLong(date: Date): string {
  const jst = toJst(date);
  return `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日（${WEEKDAYS[jst.getUTCDay()]}）`;
}

/** "2026-08-31" や "2026-08-31T05:00" を JST として解釈し UTC の Date にする */
export function parseJstDateTime(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0));
  const date = new Date(ms - JST_OFFSET_MS);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** datetime-local 入力の初期値（JST の現在時刻）"2026-08-31T14:20" */
export function nowForDateTimeInput(date: Date = new Date()): string {
  return `${formatJstDate(date)}T${formatJstTime(date)}`;
}

/** 生年月日から年齢を求める（JST の今日基準）。不明なら null */
export function calcAge(birthday: Date | null | undefined, now: Date = new Date()): number | null {
  if (!birthday) return null;
  const b = toJst(birthday);
  const t = toJst(now);
  let age = t.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthday =
    t.getUTCMonth() < b.getUTCMonth() ||
    (t.getUTCMonth() === b.getUTCMonth() && t.getUTCDate() < b.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** 年齢を年代コード（"20S" 等）に変換する。分析で匿名来店の年代と揃えるため */
export function ageToGroup(age: number | null): string {
  if (age === null) return "UNKNOWN";
  if (age < 20) return "10S";
  if (age < 30) return "20S";
  if (age < 40) return "30S";
  if (age < 50) return "40S";
  if (age < 60) return "50S";
  return "60S";
}
