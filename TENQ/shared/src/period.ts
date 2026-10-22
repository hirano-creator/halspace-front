/**
 * 点検期間と日付の計算。保存は UTC、点検日・期限は工場のタイムゾーンで決める。
 * 画面と API で計算がずれないよう、ここ以外で日付の境目を計算しない。
 */

export type Frequency = 'daily' | 'weekly' | 'monthly';

interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function parts(at: Date, timeZone: string): LocalParts {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(at)) p[x.type] = x.value;
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), weekday: WEEKDAY[p.weekday ?? ''] ?? 0,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 工場のタイムゾーンでの日付（YYYY-MM-DD） */
export function localDate(at: Date, timeZone: string): string {
  const p = parts(at, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** 工場のタイムゾーンでの日時（YYYY-MM-DD HH:MM）。CSV・帳票の表示用 */
export function localDateTime(at: Date, timeZone: string): string {
  const p = parts(at, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** ISO 8601 の週番号（月曜始まり、1月4日を含む週が第1週） */
export function isoWeek(year: number, month: number, day: number): { year: number; week: number } {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const y = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return { year: y, week };
}

/** 点検期間のキー。daily: 2026-10-22 / weekly: 2026-W43 / monthly: 2026-10 */
export function periodKey(frequency: Frequency, at: Date, timeZone: string): string {
  const p = parts(at, timeZone);
  switch (frequency) {
    case 'daily': return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    case 'weekly': { const w = isoWeek(p.year, p.month, p.day); return `${w.year}-W${pad(w.week)}`; }
    case 'monthly': return `${p.year}-${pad(p.month)}`;
  }
}

/** 稼働曜日か。workingDays は "1,2,3,4,5"（ISO: 1=月〜7=日） */
export function isWorkingDay(at: Date, timeZone: string, workingDays: string): boolean {
  const days = workingDays.split(',').map(s => Number(s.trim()));
  return days.includes(parts(at, timeZone).weekday);
}

/** 工場のタイムゾーンで、指定時刻（HH:MM）を過ぎているか */
export function isPastLocalTime(at: Date, timeZone: string, hhmm: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return false;
  const p = parts(at, timeZone);
  return p.hour * 60 + p.minute >= Number(m[1]) * 60 + Number(m[2]);
}
