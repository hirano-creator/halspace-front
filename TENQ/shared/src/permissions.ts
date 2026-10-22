/**
 * TENQ の権限表（docs/requirements.md §3-2 と一致させること）。
 *
 * API の can() と画面の表示制御の両方がこの1か所を見る。
 * 画面で隠すのは補助で、許可・拒否を最終的に決めるのは API 側の can()。
 */

export const ROLES = ['worker', 'equipment_staff', 'factory_manager', 'system_admin'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  worker: '一般社員',
  equipment_staff: '設備担当者',
  factory_manager: '工場長',
  system_admin: 'システム管理者',
};

/**
 * 条件付き（△）の中身。
 * - managedEquipment: 担当設備（equipment.manager_user_id が本人）
 * - ownInProgress:    自分が点検者の「点検中」
 * - assignedToMe:     異常の対応担当者が本人
 * - notFixer:         是正処置を記録した人以外（自分で直して自分で確認しない）
 * - ownDevice:        自分の端末
 */
export type Condition = 'managedEquipment' | 'ownInProgress' | 'assignedToMe' | 'notFixer' | 'ownDevice';
export type Grant = boolean | Condition;

export const ACTIONS = [
  'inspection.perform',
  'inspection.viewOwn',
  'inspection.viewFactory',
  'inspection.correct',
  'inspection.void',
  'abnormality.report',
  'abnormality.assign',
  'abnormality.fix',
  'abnormality.verify',
  'abnormality.approve',
  'equipment.view',
  'equipment.edit',
  'equipment.stop',
  'equipment.retire',
  'qr.issue',
  'template.edit',
  'layout.edit',
  'board.view',
  'export',
  'audit.view',
  'users.manage',
  'settings.manage',
  'device.revoke',
] as const;
export type Action = (typeof ACTIONS)[number];

type Row = Record<Role, Grant>;
const row = (worker: Grant, equipment_staff: Grant, factory_manager: Grant, system_admin: Grant): Row =>
  ({ worker, equipment_staff, factory_manager, system_admin });

export const PERMISSIONS: Record<Action, Row> = {
  'inspection.perform':     row(true, true, true, true),
  'inspection.viewOwn':     row(true, true, true, true),
  'inspection.viewFactory': row(true, true, true, true),
  'inspection.correct':     row(false, 'managedEquipment', true, true),
  'inspection.void':        row('ownInProgress', true, true, true),
  'abnormality.report':     row(true, true, true, true),
  'abnormality.assign':     row(false, 'managedEquipment', true, true),
  'abnormality.fix':        row(false, 'assignedToMe', true, true),
  'abnormality.verify':     row(false, 'notFixer', 'notFixer', 'notFixer'),
  'abnormality.approve':    row(false, false, true, false),
  'equipment.view':         row(true, true, true, true),
  'equipment.edit':         row(false, 'managedEquipment', true, true),
  'equipment.stop':         row(false, 'managedEquipment', true, true),
  'equipment.retire':       row(false, false, true, true),
  'qr.issue':               row(false, true, true, true),
  'template.edit':          row(false, false, true, true),
  'layout.edit':            row(false, false, true, true),
  'board.view':             row(true, true, true, true),
  'export':                 row(false, true, true, true),
  'audit.view':             row(false, false, true, true),
  'users.manage':           row(false, false, false, true),
  'settings.manage':        row(false, false, false, true),
  'device.revoke':          row('ownDevice', 'ownDevice', 'ownDevice', true),
};

export interface Actor {
  id: string;
  role: Role | null;
  /** 所属工場。system_admin は会社内の全工場として扱う */
  factoryIds: readonly string[];
}

/** 判定に使う対象の情報。操作ごとに必要なものだけ渡す */
export interface Target {
  factoryId?: string;
  equipmentManagerId?: string | null;
  inspectorId?: string;
  inspectionStatus?: string;
  assigneeId?: string | null;
  /** その異常の是正処置を記録した人 */
  fixerIds?: readonly string[];
  deviceOwnerId?: string;
}

/**
 * 操作できるかを返す。
 * 所属工場の外にある対象は、ロールに関係なく不可（system_admin を除く）。
 * 会社の範囲は SQL のスコープ関数で絞る前提で、ここでは見ない。
 */
export function can(actor: Actor, action: Action, target: Target = {}): boolean {
  if (!actor.role) return false;
  if (target.factoryId !== undefined && actor.role !== 'system_admin' && !actor.factoryIds.includes(target.factoryId)) {
    return false;
  }
  const grant = PERMISSIONS[action][actor.role];
  if (typeof grant === 'boolean') return grant;
  switch (grant) {
    case 'managedEquipment': return target.equipmentManagerId === actor.id;
    case 'ownInProgress':    return target.inspectorId === actor.id && target.inspectionStatus === 'in_progress';
    case 'assignedToMe':     return target.assigneeId === actor.id;
    case 'notFixer':         return target.fixerIds !== undefined && !target.fixerIds.includes(actor.id);
    case 'ownDevice':        return target.deviceOwnerId === actor.id;
  }
}
