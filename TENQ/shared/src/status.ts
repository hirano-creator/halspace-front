/**
 * PC のエリア別カード一覧で使う設備の状態（docs/requirements.md F-7）。
 * 判定は API 側でこの関数を使って行い、画面は結果を表示するだけにする。
 */

export const BOARD_STATUSES = ['late', 'ng', 'doing', 'todo', 'ok', 'stop'] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

/** 色だけに頼らず、文字（とアイコン）を必ず一緒に出す */
export const BOARD_STATUS_LABELS: Record<BoardStatus, { label: string; short: string }> = {
  late:  { label: '遅れ（未点検）', short: '遅れ' },
  ng:    { label: '異常あり',       short: '異常' },
  doing: { label: '点検中',         short: '点検中' },
  todo:  { label: '未点検',         short: '未点検' },
  ok:    { label: '完了・正常',     short: '正常' },
  stop:  { label: '停止中',         short: '停止中' },
};

export type EquipmentStatus = 'active' | 'stopped' | 'retired';
export type InspectionStatus = 'in_progress' | 'completed' | 'voided';

export interface BoardInput {
  equipmentStatus: EquipmentStatus;
  /** 今日の点検期間の有効な点検（voided は除いて渡す） */
  inspection: { status: Exclude<InspectionStatus, 'voided'>; overallResult: 'ok' | 'ng' | null } | null;
  /** 今日が点検日か（稼働曜日でない日は daily の対象外） */
  isDue: boolean;
  /** 「遅れ」と判定する時刻を過ぎたか */
  isPastDeadline: boolean;
}

/** 停止・廃止と対象外の日は stop として扱い、未点検に数えない */
export function boardStatus(x: BoardInput): BoardStatus {
  if (x.equipmentStatus !== 'active') return 'stop';
  if (x.inspection?.status === 'completed') return x.inspection.overallResult === 'ng' ? 'ng' : 'ok';
  if (x.inspection?.status === 'in_progress') return 'doing';
  if (!x.isDue) return 'stop';
  return x.isPastDeadline ? 'late' : 'todo';
}
