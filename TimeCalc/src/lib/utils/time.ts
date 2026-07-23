// 時刻・日付の共通ユーティリティ

/**
 * "HH:mm" 形式の時刻を 0時からの経過分に変換する。
 * "8:00" のような1桁時、"8:19:25 JST" のような秒・タイムゾーン付き
 * （Squareエクスポート形式）にも対応。不正な形式は null を返す。
 */
export function timeToMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s+[A-Za-z]+)?$/.exec(time.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 47 || minutes > 59) return null; // 日跨ぎ表記(例: 25:00)は47:59まで許容
  return hours * 60 + minutes;
}

/** 経過分を "HH:mm" 形式に変換する */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 分数を "X時間Y分" の表示用文字列に変換する */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
}

/** 分数を "HH:MM" 形式（例: 72:30）に変換する。CSV出力用 */
export function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/**
 * 様々な日付表記を "YYYY-MM-DD" に正規化する。
 * 対応形式: "2026-07-01" / "2026/07/01" / "2026/7/1" / "20260701"
 * 不正な形式は null を返す。
 */
export function normalizeDate(input: string): string | null {
  const s = input.trim();
  let y: number, mo: number, d: number;
  let m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(s);
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" から "MM-DD" を取り出す */
export function monthDayOf(date: string): string {
  return date.slice(5);
}

/**
 * 日付("YYYY-MM-DD")が月日範囲("MM-DD"〜"MM-DD")に含まれるか判定する。
 * 年跨ぎの範囲（例: 11-01〜03-31）にも対応する。
 */
export function isInMonthDayRange(date: string, start: string, end: string): boolean {
  const md = monthDayOf(date);
  if (start <= end) {
    return md >= start && md <= end;
  }
  // 年跨ぎ（例: 11-01〜03-31）
  return md >= start || md <= end;
}

/** "YYYY-MM" の月の日数を返す */
export function daysInMonth(yearMonth: string): number {
  const [y, m] = yearMonth.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

// アプリのタイムゾーンは日本時間(JST)固定。
// Cloudflare Workers のように TZ 環境変数が効かず常に UTC で動く実行環境でも
// 打刻時刻・日付が9時間ずれないよう、現在時刻は明示的に JST で解釈する。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 絶対時刻を JST へ平行移動した Date を返す（getUTC* 系メソッドで JST の
 * 年・月・日・時・分が読める）。引数省略で現在時刻。
 * DB の createdAt など UTC 保存の Date を JST 表示する用途にも使える。
 */
export function toJst(d: Date = new Date()): Date {
  return new Date(d.getTime() + JST_OFFSET_MS);
}

/** 今日の日付を "YYYY-MM-DD"（JST）で返す */
export function todayString(): string {
  const now = toJst();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

/** 今月を "YYYY-MM"（JST）で返す */
export function currentYearMonth(): string {
  return todayString().slice(0, 7);
}

/** 現在時刻を "HH:mm"（JST）で返す */
export function nowTimeString(): string {
  const now = toJst();
  return `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
}

/** Date を "YYYY-MM-DD" に変換する（ローカル時刻） */
function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 給与期間（締め日区切り）の開始日・終了日を返す。
 * 「YYYY-MM月度」= 前月の締め日翌日 〜 当月の締め日。
 * 締め日が月の日数を超える場合は月末に丸める（31指定＝暦月扱い）。
 *
 * 例: periodRange("2026-06", 25) → { start: "2026-05-26", end: "2026-06-25" }
 */
export function periodRange(
  yearMonth: string,
  closingDay: number,
): { start: string; end: string } {
  const [y, m] = yearMonth.split("-").map(Number);
  const endDay = Math.min(closingDay, new Date(y, m, 0).getDate());
  const end = new Date(y, m - 1, endDay);
  const prevMonthDays = new Date(y, m - 1, 0).getDate();
  const prevClamped = Math.min(closingDay, prevMonthDays);
  // 前月の締め日の翌日が開始
  const start = new Date(y, m - 2, prevClamped + 1);
  return { start: toDateString(start), end: toDateString(end) };
}

/**
 * 指定日が属する給与期間の「YYYY-MM」ラベルを返す。
 * 締め日を過ぎていたら翌月度になる（例: 締め25日で7/26 → "2026-08"）。
 */
export function periodOfDate(date: string, closingDay: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const clamped = Math.min(closingDay, new Date(y, m, 0).getDate());
  if (d <= clamped) return `${y}-${String(m).padStart(2, "0")}`;
  const next = new Date(y, m, 1); // 翌月1日
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

/** 今日が属する給与期間の "YYYY-MM" を返す */
export function currentPeriod(closingDay: number): string {
  return periodOfDate(todayString(), closingDay);
}

/** 期間の表示用文字列（例: "5/26〜6/25"）を返す */
export function formatPeriodRange(range: { start: string; end: string }): string {
  const f = (date: string) => {
    const [, m, d] = date.split("-").map(Number);
    return `${m}/${d}`;
  };
  return `${f(range.start)}〜${f(range.end)}`;
}

/** 期間内の日付（"YYYY-MM-DD"）を開始日から終了日まで順に列挙する */
export function datesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(start + "T00:00:00");
  const last = new Date(end + "T00:00:00");
  while (cursor <= last) {
    dates.push(toDateString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}
