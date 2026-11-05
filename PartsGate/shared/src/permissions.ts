/**
 * 権限表（docs/security.md §3）。API の判定（can）と画面の出し分けは、どちらもこの 1 か所だけを見る。
 * 判定は API が正。画面の出し分けは補助。
 */

/** PARTS GATE 内のロール。アカウント本体は Space.app にある */
export const ROLES = ['admin', 'general'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: '管理者',
  general: '一般',
};

export const ACTIONS = [
  'scan',              // バーコード読み取り
  'orders.view',       // 注文・読み取り履歴・未確認一覧・ダッシュボード
  'import',            // CSV 取込・取込履歴
  'master.view',       // 担当者・置場・納品先の一覧（担当者選択・置場名の表示に使う）
  'master.edit',       // 担当者・置場・納品先の登録・編集・利用停止
  'users.manage',      // PARTS GATE ユーザーのロール変更・利用停止
  'scan.correct',      // 読み取りの取消・要確認の解決
  'analytics.view',    // データ分析
  'export',            // CSV 出力
  'audit.view',        // 監査ログ
  'settings.manage',   // システム設定（照合ルール・CSV 列の対応）
  'companies.manage',  // 企業管理（HaLSpace の運営者だけ）
] as const;
export type Action = (typeof ACTIONS)[number];

export interface Actor {
  role: Role;
  /** HaLSpace の運営者（Space.app の is_operator）。企業管理だけに使う */
  operator: boolean;
}

const GENERAL: readonly Action[] = ['scan', 'orders.view', 'master.view'];
const ADMIN: readonly Action[] = [
  ...GENERAL, 'import', 'master.edit', 'users.manage', 'scan.correct', 'analytics.view', 'export', 'audit.view', 'settings.manage',
];

export function can(actor: Actor, action: Action): boolean {
  if (action === 'companies.manage') return actor.operator;
  return (actor.role === 'admin' ? ADMIN : GENERAL).includes(action);
}
