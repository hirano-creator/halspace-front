// パスワード変更画面とAPI（/api/my/password）で共有する型

export interface PasswordChangeState {
  error: string | null;
  success?: boolean;
}
