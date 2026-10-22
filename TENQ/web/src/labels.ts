/** 画面に出す日本語の表記 */

export const EQUIPMENT_STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: '稼働', cls: 'st-ok' },
  stopped: { label: '停止中', cls: 'st-stop' },
  retired: { label: '廃止', cls: 'st-todo' },
};

export const FREQUENCY: Record<string, string> = { daily: '毎日（稼働日）', weekly: '毎週', monthly: '毎月' };

export const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];

export function workingDaysText(v: string): string {
  return v.split(',').map((d) => WEEKDAYS[Number(d) - 1] ?? '').join('・');
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
