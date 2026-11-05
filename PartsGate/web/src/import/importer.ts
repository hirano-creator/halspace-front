/**
 * CSV 取込の処理（画面側。docs/csv-import.md §1）。画面の部品から切り離してある。
 *  readFile   : ファイルを読み、文字コード判定・解析・列の対応・1 行ごとの検証をする（DB には何もしない）
 *  preview    : 登録済みの明細を 500 件ずつ照会し、行ごとの区分（新規・更新・変更なし・要確認・エラー）を決める
 *  register   : 元ファイルを送って取込回を作り、200 行ずつ送って確定する
 * 区分の判定は shared の classify を使う（API も同じ関数で判定し直す）。
 */
import {
  IMPORT_CHUNK, IMPORT_FIELDS, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, LOOKUP_CHUNK, MISUMI_PROFILE,
  classify, decodeCsv, looksBinary, mapRow, normalizeItem, parseCsv, resolveHeader, rowHash,
  type CsvEncoding, type ExistingItem, type ImportItem, type ImportKind, type RawItem,
} from '@partsgate/shared';
import { apiGet, apiSend, apiUploadRaw, type Page } from '../api/client';

export interface ParsedRow {
  raw: RawItem;
  item: ImportItem | null;
  hash: string | null;
  /** 読んだ時点でのエラー（形式・同じファイル内の重複） */
  errors: string[];
}

export interface ParsedFile {
  name: string;
  size: number;
  bytes: Uint8Array;
  sha256: string;
  encoding: CsvEncoding;
  columnCount: number;
  rows: ParsedRow[];
  /** ミスミ納期の一覧（多い順） */
  vrds: { date: string; count: number }[];
}

export class ImportFileError extends Error {}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function readFile(file: File): Promise<ParsedFile> {
  if (!/\.csv$/i.test(file.name)) throw new ImportFileError('CSV ファイル（.csv）を選んでください。');
  if (file.size === 0) throw new ImportFileError('ファイルが空です。');
  if (file.size > IMPORT_MAX_BYTES) throw new ImportFileError('ファイルが大きすぎます（10MB まで）。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (looksBinary(bytes)) throw new ImportFileError('CSV ではないファイルです。Excel の場合は「CSV」で保存し直してください。');
  const decoded = decodeCsv(bytes);
  if (!decoded) throw new ImportFileError('文字コードを判定できませんでした。Shift-JIS か UTF-8 で保存した CSV を選んでください。');
  const table = parseCsv(decoded.text);
  const header = table[0];
  if (!header || table.length < 2) throw new ImportFileError('取り込む行がありません（見出しの行だけのファイルです）。');
  if (table.length - 1 > IMPORT_MAX_ROWS) throw new ImportFileError(`行が多すぎます（${IMPORT_MAX_ROWS.toLocaleString()} 行まで）。ファイルを分けてください。`);
  const { index, missing } = resolveHeader(header, MISUMI_PROFILE);
  if (missing.length) throw new ImportFileError(`必要な列がありません: ${missing.join('、')}。ミスミの出荷指示 CSV か確かめてください。`);

  const rows: ParsedRow[] = [];
  const seenGlobal = new Set<string>();
  const seenBarcode = new Map<string, string>();
  for (let i = 1; i < table.length; i++) {
    const raw = mapRow(table[i]!, index, i + 1); // 行番号はファイルの行（見出しが 1 行目）
    const { item, errors } = normalizeItem(raw);
    if (item) {
      const owner = seenBarcode.get(item.barcode_global_no);
      if (seenGlobal.has(item.global_no) || (owner && owner !== item.global_no)) {
        rows.push({ raw, item: null, hash: null, errors: ['同じファイルの中で、グローバル番号またはバーコード用グローバル番号が重複しています'] });
        continue;
      }
      seenGlobal.add(item.global_no);
      seenBarcode.set(item.barcode_global_no, item.global_no);
    }
    rows.push({ raw, item, hash: item ? await rowHash(item) : null, errors });
  }
  const vrdCount = new Map<string, number>();
  for (const r of rows) if (r.item?.vrd) vrdCount.set(r.item.vrd, (vrdCount.get(r.item.vrd) ?? 0) + 1);
  return {
    name: file.name, size: file.size, bytes, sha256: await sha256Hex(bytes), encoding: decoded.encoding, columnCount: header.length, rows,
    vrds: [...vrdCount.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => b.count - a.count),
  };
}

export interface PreviewRow {
  line_no: number;
  global_no: string | null;
  kind: ImportKind;
  message: string | null;
  item: ImportItem | null;
  diff: [string, unknown, unknown][];
}

export interface UnknownDestination { customer_code: string; code: string; name: string; customer_name: string | null; rows: number }

export interface Preview {
  rows: PreviewRow[];
  counts: Record<ImportKind, number>;
  unknownDestinations: UnknownDestination[];
  /** 置場マスターにない置場（行数の多い順） */
  unknownLocations: { code: string; rows: number }[];
  /** 同じファイルを取り込んだことがある */
  duplicateOf: { id: number; committed_at: string; created_by_name: string | null } | null;
}

interface LookupResponse {
  items: (ExistingItem & Record<string, unknown>)[];
  barcode_owners: { barcode_global_no: string; global_no: string }[];
  destinations: { customer_code: string; code: string }[];
  locations: string[];
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function preview(file: ParsedFile): Promise<Preview> {
  const valid = file.rows.filter((r) => r.item) as (ParsedRow & { item: ImportItem; hash: string })[];
  const existing = new Map<string, ExistingItem & Record<string, unknown>>();
  const barcodeOwner = new Map<string, string>();
  const knownDest = new Set<string>();
  let locations = new Set<string>();

  const pairs = [...new Map(valid.map((r) => [`${r.item.customer_code}\t${r.item.destination_code}`, [r.item.customer_code, r.item.destination_code]])).values()];
  const n = Math.max(Math.ceil(valid.length / LOOKUP_CHUNK), Math.ceil(pairs.length / LOOKUP_CHUNK), 1);
  for (let i = 0; i < n; i++) {
    const part = valid.slice(i * LOOKUP_CHUNK, (i + 1) * LOOKUP_CHUNK);
    const r = await apiSend<LookupResponse>('POST', '/imports/lookup', {
      global_nos: part.map((x) => x.item.global_no),
      barcodes: part.map((x) => x.item.barcode_global_no),
      destinations: pairs.slice(i * LOOKUP_CHUNK, (i + 1) * LOOKUP_CHUNK),
    });
    for (const it of r.items) existing.set(it.global_no, it);
    for (const b of r.barcode_owners) barcodeOwner.set(b.barcode_global_no, b.global_no);
    for (const d of r.destinations) knownDest.add(`${d.customer_code}\t${d.code}`);
    locations = new Set(r.locations);
  }

  const rows: PreviewRow[] = [];
  const unknownDest = new Map<string, UnknownDestination>();
  const unknownLoc = new Map<string, number>();
  for (const r of file.rows) {
    if (!r.item || !r.hash) {
      rows.push({ line_no: r.raw.line_no, global_no: r.raw.global_no ?? null, kind: 'error', message: r.errors.join(' / '), item: null, diff: [] });
      continue;
    }
    const ex = existing.get(r.item.global_no);
    const { kind, message } = classify(r.item, r.hash, ex, barcodeOwner.get(r.item.barcode_global_no), locations);
    const diff: PreviewRow['diff'] = [];
    if (ex && (kind === 'updated' || kind === 'review')) {
      for (const f of IMPORT_FIELDS) if ((ex[f] ?? null) !== (r.item[f] ?? null)) diff.push([f, ex[f] ?? null, r.item[f] ?? null]);
    }
    rows.push({ line_no: r.item.line_no, global_no: r.item.global_no, kind, message, item: r.item, diff });
    if (!locations.has(r.item.location_code)) unknownLoc.set(r.item.location_code, (unknownLoc.get(r.item.location_code) ?? 0) + 1);
    const key = `${r.item.customer_code}\t${r.item.destination_code}`;
    if ((kind === 'new' || kind === 'updated') && !knownDest.has(key)) {
      const d = unknownDest.get(key) ?? { customer_code: r.item.customer_code, code: r.item.destination_code, name: r.item.destination_name ?? r.item.destination_code, customer_name: r.item.customer_name, rows: 0 };
      d.rows++;
      unknownDest.set(key, d);
    }
  }
  const counts = { new: 0, updated: 0, unchanged: 0, review: 0, error: 0 } as Record<ImportKind, number>;
  for (const r of rows) counts[r.kind]++;

  const dup = await apiGet<Page<{ id: number; committed_at: string; created_by_name: string | null }>>(`/imports?sha=${file.sha256}&limit=1`);
  return {
    rows, counts,
    unknownDestinations: [...unknownDest.values()],
    unknownLocations: [...unknownLoc.entries()].map(([code, rowsN]) => ({ code, rows: rowsN })).sort((a, b) => b.rows - a.rows),
    duplicateOf: dup.items[0] ?? null,
  };
}

export interface RegisterResult {
  id: number; status: string; row_total: number; row_new: number; row_updated: number; row_unchanged: number; row_error: number; row_review: number;
  committed_at: string; created_by_name: string | null;
}

/**
 * 登録する。全部の行（エラー・要確認も含む）を送る。API が判定し直し、取り込めるものだけを登録する。
 * 途中で通信が切れたら同じ行をもう一度送ってよい（API は行番号ごとに 1 回だけ数える）。
 */
export async function register(
  file: ParsedFile,
  onProgress: (done: number, total: number) => void,
  /** 途中で止まった取込回の続きから送り直すとき、その ID（同じ行を送り直しても二重に数えない） */
  resumeId: number | null,
  onBatch: (id: number) => void,
): Promise<RegisterResult> {
  const id = resumeId ?? (await apiUploadRaw<{ id: number }>('/imports', file.bytes, {
    'X-File-Name': encodeURIComponent(file.name), 'X-File-Sha256': file.sha256, 'X-Encoding': file.encoding,
  })).id;
  onBatch(id);
  const parts = chunks(file.rows.map((r) => r.raw), IMPORT_CHUNK);
  let done = 0;
  onProgress(0, file.rows.length);
  for (const part of parts) {
    // 通信の失敗だけは 2 回まで送り直す（同じ行を送っても二重に数えない）
    for (let attempt = 0; ; attempt++) {
      try { await apiSend('POST', `/imports/${id}/rows`, { rows: part }); break; } catch (e) {
        if (attempt >= 2 || !(e instanceof Error) || !/通信できません/.test(e.message)) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    done += part.length;
    onProgress(done, file.rows.length);
  }
  return apiSend<RegisterResult>('POST', `/imports/${id}/commit`, { expected_rows: file.rows.length });
}

/** 途中で止まった取込回を中止する（登録済みの行は残る） */
export async function abortImport(id: number): Promise<void> {
  await apiSend('POST', `/imports/${id}/abort`, {});
}
