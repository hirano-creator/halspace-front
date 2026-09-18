// パスワードの受け入れ条件（クライアント・サーバー共用）
// bcrypt を含む password.ts をクライアントバンドルに引き込まないよう、純粋な判定だけ分離している。

/** 本人・管理者が設定するパスワードの最低文字数（フォームとAPIの両方でこれを使う） */
export const PASSWORD_MIN_LENGTH = 8;

/** 初期パスワードのままのユーザーを他のAPIから弾くときのエラーコード（api-guard.ts が返し、api-fetch.ts が見る） */
export const PASSWORD_CHANGE_REQUIRED_CODE = "PASSWORD_CHANGE_REQUIRED";
/** 本人のパスワード変更画面のパス */
export const PASSWORD_CHANGE_PATH = "/password";

/** 新しいパスワードとして受け付けられるか。問題があればエラー文、なければ null */
export function validateNewPassword(plain: string): string | null {
  if (plain.length < PASSWORD_MIN_LENGTH) {
    return `パスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください`;
  }
  if (plain.length > 128) return "パスワードが長すぎます";
  return null;
}
