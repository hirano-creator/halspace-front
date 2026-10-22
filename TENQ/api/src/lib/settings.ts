/** 会社ごとのシステム設定（system_settings）。未設定のキーは既定値 */
export const SETTING_DEFAULTS = {
  retention_years: 5,
  late_threshold: '09:00',
  device_login_days: 30,
  board_refresh_seconds: 30,
  photo_max_count: 10,
  reauth_hours: 12,
  qr_base_url: 'https://space-apps.pages.dev/TENQ/q/',
  high_severity_message: '危険度「高」です。設備の使用を止め、責任者に連絡してください。最終的な判断は会社の安全管理ルールに従ってください。',
} as const;

export type Settings = { -readonly [K in keyof typeof SETTING_DEFAULTS]: (typeof SETTING_DEFAULTS)[K] extends number ? number : string };

export async function loadSettings(db: D1Database, companyId: number): Promise<Settings> {
  const { results } = await db.prepare('SELECT key, value_json FROM system_settings WHERE company_id = ?').bind(companyId).all<{ key: string; value_json: string }>();
  const s: Settings = { ...SETTING_DEFAULTS };
  for (const r of results) {
    if (r.key in s) (s as Record<string, unknown>)[r.key] = JSON.parse(r.value_json);
  }
  return s;
}
