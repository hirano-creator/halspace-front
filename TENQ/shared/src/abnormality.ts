import type { Action } from './permissions';

/**
 * 異常の状態と遷移（docs/requirements.md F-6）。
 * 発生 → 未対応（担当・期限が決まった）→ 対応中 → 是正完了 → 再確認 → 承認・完了
 * 再確認で直っていなければ対応中に差し戻す。ここに書いた遷移以外は API が拒否する。
 *
 * 2026-10-31 に画面を簡単にし、ふだんは「異常あり → 直した（resolve）」の 1 ステップだけを使う（requirements §10 Q-5）。
 * 直した人と別の人による確認はしない（オーナー決定）。上の 6 段階の遷移は過去の記録と互換のために残す。
 */

export const ABNORMALITY_STATUSES = ['reported', 'assigned', 'in_progress', 'corrected', 'verified', 'closed'] as const;
export type AbnormalityStatus = (typeof ABNORMALITY_STATUSES)[number];

export const ABNORMALITY_STATUS_LABELS: Record<AbnormalityStatus, string> = {
  reported: '発生',
  assigned: '未対応',
  in_progress: '対応中',
  corrected: '是正完了',
  verified: '再確認済み',
  closed: '承認・完了',
};

export const SEVERITIES = ['low', 'medium', 'high'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABELS: Record<Severity, { label: string; hint: string }> = {
  low: { label: '低', hint: '使用は続けられる。次の保全で直せばよい' },
  medium: { label: '中', hint: '早めの対応が必要。悪化しないか様子を見る' },
  high: { label: '高', hint: 'けが・故障・品質不良につながるおそれがある' },
};

export const ABNORMALITY_ACTIONS = ['assign', 'start', 'correct', 'verify', 'reject', 'approve', 'resolve'] as const;
export type AbnormalityAction = (typeof ABNORMALITY_ACTIONS)[number];

export const ABNORMALITY_TRANSITIONS: Record<AbnormalityAction, { from: readonly AbnormalityStatus[]; to: AbnormalityStatus; permission: Action; label: string }> = {
  assign:  { from: ['reported', 'assigned', 'in_progress'], to: 'assigned', permission: 'abnormality.assign', label: '担当・期限を決める' },
  start:   { from: ['assigned'], to: 'in_progress', permission: 'abnormality.fix', label: '対応を始める' },
  correct: { from: ['in_progress'], to: 'corrected', permission: 'abnormality.fix', label: '是正を記録する' },
  verify:  { from: ['corrected'], to: 'verified', permission: 'abnormality.verify', label: '再確認した（直っている）' },
  reject:  { from: ['corrected'], to: 'in_progress', permission: 'abnormality.verify', label: '差し戻す（直っていない）' },
  approve: { from: ['verified'], to: 'closed', permission: 'abnormality.approve', label: '承認して完了' },
  resolve: { from: ['reported', 'assigned', 'in_progress', 'corrected', 'verified'], to: 'closed', permission: 'abnormality.resolve', label: '直した' },
};

/** 担当を付け直したとき、対応中のものは対応中のまま（assign の to は「未対応」だが、進行中を戻さない） */
export function nextStatus(action: AbnormalityAction, from: AbnormalityStatus): AbnormalityStatus | null {
  const t = ABNORMALITY_TRANSITIONS[action];
  if (!t.from.includes(from)) return null;
  if (action === 'assign' && from === 'in_progress') return 'in_progress';
  return t.to;
}

/** まだ手を付けていない（担当が決まっていない・着手していない） */
export const OPEN_UNHANDLED: readonly AbnormalityStatus[] = ['reported', 'assigned'];
/** 対応が終わっていない（期限超過の判定対象） */
export const OPEN_UNRESOLVED: readonly AbnormalityStatus[] = ['reported', 'assigned', 'in_progress'];

/** 期限超過か（期限は工場のタイムゾーンでの日付。期限日の当日はまだ超過ではない） */
export function isOverdue(status: AbnormalityStatus, dueDate: string | null, today: string): boolean {
  return !!dueDate && OPEN_UNRESOLVED.includes(status) && dueDate < today;
}
