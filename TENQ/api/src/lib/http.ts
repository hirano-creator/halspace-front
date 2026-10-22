/** API のエラー。onError で JSON の { message, errors? } に変換して返す */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 415 | 422 | 429 | 502,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const unauthorized = () => new HttpError(401, 'ログインしてください。');
export const forbidden = (m = 'この操作を行う権限がありません。') => new HttpError(403, m);
/** スコープ外の ID も 404（存在を知らせない） */
export const notFound = (m = '見つかりません。') => new HttpError(404, m);
export const conflict = (m = 'ほかの人が先に更新しました。画面を読み込み直してから、もう一度操作してください。') => new HttpError(409, m);

/** 入力値の検証。エラーはまとめて 422 で返す */
export class Validator {
  private readonly errors: Record<string, string> = {};
  constructor(private readonly body: Record<string, unknown>) {}

  /** 文字列。空文字は undefined（任意）または必須エラーとして扱う */
  str(key: string, opts: { required?: boolean; max?: number; label: string }): string | undefined {
    const v = this.body[key];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      if (opts.required) this.errors[key] = `${opts.label}を入力してください。`;
      return undefined;
    }
    if (typeof v !== 'string') { this.errors[key] = `${opts.label}の形式が正しくありません。`; return undefined; }
    const s = v.trim();
    if (opts.max !== undefined && s.length > opts.max) { this.errors[key] = `${opts.label}は${opts.max}文字以内にしてください。`; return undefined; }
    return s;
  }

  /** null を明示して空にできる文字列（編集で「消す」ため） */
  nullableStr(key: string, opts: { max?: number; label: string }): string | null | undefined {
    if (!(key in this.body)) return undefined;
    if (this.body[key] === null || this.body[key] === '') return null;
    return this.str(key, { ...opts, required: false }) ?? null;
  }

  oneOf<T extends string>(key: string, values: readonly T[], opts: { required?: boolean; label: string }): T | undefined {
    const v = this.body[key];
    if (v === undefined || v === null || v === '') {
      if (opts.required) this.errors[key] = `${opts.label}を選んでください。`;
      return undefined;
    }
    if (typeof v !== 'string' || !values.includes(v as T)) { this.errors[key] = `${opts.label}の値が正しくありません。`; return undefined; }
    return v as T;
  }

  int(key: string, opts: { required?: boolean; min?: number; max?: number; label: string }): number | undefined {
    const v = this.body[key];
    if (v === undefined || v === null || v === '') {
      if (opts.required) this.errors[key] = `${opts.label}を入力してください。`;
      return undefined;
    }
    if (typeof v !== 'number' || !Number.isInteger(v)) { this.errors[key] = `${opts.label}は整数で入力してください。`; return undefined; }
    if ((opts.min !== undefined && v < opts.min) || (opts.max !== undefined && v > opts.max)) {
      this.errors[key] = `${opts.label}の値が範囲外です。`;
      return undefined;
    }
    return v;
  }

  strArray(key: string, opts: { max: number; label: string }): string[] | undefined {
    const v = this.body[key];
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.length > opts.max || v.some((x) => typeof x !== 'string' || x.length > 64)) {
      this.errors[key] = `${opts.label}の形式が正しくありません。`;
      return undefined;
    }
    return [...new Set(v as string[])];
  }

  /** 楽観ロック用の version（更新系では必須） */
  version(): number {
    return this.int('version', { required: true, min: 1, label: 'version' }) ?? 0;
  }

  /** 個別の検証で見つけたエラーを足す（重複・存在しない参照など） */
  fail(key: string, message: string): void {
    this.errors[key] ??= message;
  }

  done(): void {
    if (Object.keys(this.errors).length) throw new HttpError(422, '入力内容を確認してください。', { errors: this.errors });
  }
}

/** JSON 本体を読む。オブジェクト以外・壊れた JSON は 400 */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get('Content-Type') ?? '';
  if (!type.includes('application/json')) throw new HttpError(415, 'Content-Type は application/json にしてください。');
  try {
    const body: unknown = await req.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch { /* 下で 400 */ }
  throw new HttpError(400, 'リクエストの形式が正しくありません。');
}
