export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  APP_ENV: 'dev' | 'production';
  /** 認証に使う halspace-api（Space.app）のベース URL */
  HALSPACE_API: string;
  /** CORS を許可する画面のオリジン（カンマ区切り） */
  ALLOWED_ORIGINS: string;
}
