export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  APP_ENV: 'dev' | 'production';
  /** 認証に使う halspace-api（Space.app）のベース URL */
  HALSPACE_API: string;
  /** CORS を許可する画面のオリジン（カンマ区切り） */
  ALLOWED_ORIGINS: string;
  /**
   * 開発用の簡易ログイン（"dev-<hs_user_id>" のトークンを受け付ける）。
   * APP_ENV が dev のときだけ有効。本番の設定には書かない。
   */
  DEV_AUTH_STUB?: string;
  /** 簡易ログインで運営者として扱う hs_user_id（カンマ区切り。開発専用） */
  DEV_OPERATOR_IDS?: string;
}
