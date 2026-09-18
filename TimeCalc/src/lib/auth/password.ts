// パスワードのハッシュ化・検証（bcrypt）

import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export { PASSWORD_MIN_LENGTH, validateNewPassword } from "./password-policy";

/**
 * 存在しないユーザーへのログイン試行で応答時間を揃えるためのダミーハッシュ。
 * ユーザーが見つからないときに bcrypt を飛ばすと応答が明らかに速くなり、
 * 「その社員番号が存在するか」が外から分かってしまう。中身は捨て値のハッシュで、何にも一致しない。
 */
const DUMMY_HASH = "$2b$10$KrOI4Cw1ahjFdMs/wIEaf.1SGfTMy5k1AjuUucmHEl4P67t7gLnfy";

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** ユーザー不在時に verifyPassword と同じだけ時間を使う（結果は常に false） */
export async function burnPasswordCheck(plain: string): Promise<false> {
  await bcrypt.compare(plain, DUMMY_HASH);
  return false;
}
