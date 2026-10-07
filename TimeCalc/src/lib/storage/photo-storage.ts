// 打刻写真（スマホ忘れ打刻で撮影した顔写真）の保存先
//
// 本番は Cloudflare R2（S3互換API）。環境変数はDBバックアップ（scripts/backup-db.sh）と共通の
// R2_ACCOUNT_ID / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY。
// 写真は撮影から90日で消す。削除は R2 バケットのライフサイクルルール（prefix "clock-photos/"）に任せ、
// アプリ側も PHOTO_RETENTION_DAYS を過ぎた写真は配信しない（ルール未設定でも見えなくなるように）。
//
// R2 が未設定の開発環境（next dev）では、プロジェクト直下の .local-uploads/ に保存して画面の確認ができるようにする。
// 本番ビルド（NODE_ENV=production）でローカル保存を使うのは PHOTO_STORAGE_LOCAL=1 を明示したときだけ
// （ローカルの next start での検証用。Railway でコンテナのディスクに保存すると再デプロイで消えるため）。
// それ以外で R2 が未設定なら isPhotoStorageReady() が false になり、機能ごと無効になる。

import { AwsClient } from "aws4fetch";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const PHOTO_PREFIX = "clock-photos/";
export const PHOTO_RETENTION_DAYS = 90;
/** 受け付ける写真の上限。クライアントは長辺480pxのJPEGに縮小して送る（通常は数十KB） */
export const MAX_PHOTO_BYTES = 300 * 1024;

interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function r2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { accountId, bucket, accessKeyId, secretAccessKey };
}

const LOCAL_DIR = path.join(process.cwd(), ".local-uploads");

function storesOnLocalDisk(): boolean {
  if (r2Config() !== null) return false;
  return process.env.NODE_ENV !== "production" || process.env.PHOTO_STORAGE_LOCAL === "1";
}

/** 写真を保存できる状態か（＝スマホ忘れ打刻を有効にできるか） */
export function isPhotoStorageReady(): boolean {
  return r2Config() !== null || storesOnLocalDisk();
}

function objectUrl(cfg: R2Config, key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${encoded}`;
}

let client: AwsClient | null = null;
function r2Client(cfg: R2Config): AwsClient {
  client ??= new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  return client;
}

/** キーがこのモジュールの管理範囲内か（ローカル保存時のパス外への書き込み防止も兼ねる） */
function assertKey(key: string): void {
  if (!/^clock-photos\/\d{4}-\d{2}\/[A-Za-z0-9_-]+\.jpg$/.test(key)) {
    throw new Error(`不正な写真キーです: ${key}`);
  }
}

/** 打刻IDと撮影日（YYYY-MM-DD）から保存キーを作る */
export function photoKeyFor(clockEventId: string, date: string): string {
  return `${PHOTO_PREFIX}${date.slice(0, 7)}/${clockEventId}.jpg`;
}

export async function putPhoto(key: string, bytes: Uint8Array): Promise<void> {
  assertKey(key);
  if (storesOnLocalDisk()) {
    const file = path.join(LOCAL_DIR, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    return;
  }
  const cfg = r2Config();
  if (!cfg) throw new Error("写真の保存先（R2）が設定されていません");
  const res = await r2Client(cfg).fetch(objectUrl(cfg, key), {
    method: "PUT",
    body: bytes as BodyInit,
    headers: { "Content-Type": "image/jpeg" },
  });
  if (!res.ok) throw new Error(`R2への保存に失敗しました（HTTP ${res.status}）`);
}

/** 写真を読み出す。存在しなければ null */
export async function getPhoto(key: string): Promise<Uint8Array | null> {
  assertKey(key);
  if (storesOnLocalDisk()) {
    try {
      return new Uint8Array(await readFile(path.join(LOCAL_DIR, key)));
    } catch {
      return null;
    }
  }
  const cfg = r2Config();
  if (!cfg) return null;
  const res = await r2Client(cfg).fetch(objectUrl(cfg, key), { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2からの読み出しに失敗しました（HTTP ${res.status}）`);
  return new Uint8Array(await res.arrayBuffer());
}

/** 写真を削除する。失敗しても例外にしない（最終的にはライフサイクルルールで消える） */
export async function deletePhoto(key: string): Promise<void> {
  try {
    assertKey(key);
    if (storesOnLocalDisk()) {
      await rm(path.join(LOCAL_DIR, key), { force: true });
      return;
    }
    const cfg = r2Config();
    if (!cfg) return;
    await r2Client(cfg).fetch(objectUrl(cfg, key), { method: "DELETE" });
  } catch (e) {
    console.error("写真の削除に失敗しました:", e);
  }
}

/** 撮影から保存期間を過ぎているか */
export function isPhotoExpired(takenAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - takenAt.getTime() > PHOTO_RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

/** JPEG（先頭が FF D8 FF）かどうか */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
