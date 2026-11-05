/**
 * CSV 取込の列の対応と 1 行の検証（docs/csv-import.md §3〜§5）。
 *
 * 画面: CSV を読む → mapRow（列名で値を取り出す）→ normalizeItem（検証・変換）→ rowHash → 差分を計算してプレビュー
 * API : 画面から mapRow の結果（文字列のまま）を受け取り、normalizeItem と rowHash を**やり直す**（画面の結果を信用しない）
 *
 * 他社の CSV は列名が違うので、列の対応表（CsvProfile）を会社の設定に持てるようにしてある。
 * プログラムに会社ごとの分岐を書かない。
 */

export const IMPORT_FIELDS = [
  'global_no', 'barcode_global_no', 'slip_no', 'product_code', 'product_name', 'quantity',
  'customer_code', 'customer_name', 'destination_code', 'destination_name', 'customer_order_no',
  'location_code', 'ssd', 'vrd', 'order_date', 'ship_method', 'export_type',
  'unit_weight', 'total_weight', 'packing_line', 'data_kind',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** 列の対応表。項目ごとに CSV の列名の候補（前から順に、値が空でない最初の列を使う） */
export type CsvProfile = Record<ImportField, string[]>;

/** ミスミの出荷指示 CSV（2026-11-05 にサンプルで確認した 81 列）。株式会社ヒラノの初期設定 */
export const MISUMI_PROFILE: CsvProfile = {
  global_no: ['グローバル番号'],
  barcode_global_no: ['バーコード用グローバル番号'],
  slip_no: ['受注伝票番号'],
  product_code: ['商品コード'],
  product_name: ['商品名(現地語)', '商品名称(英語)'],
  quantity: ['数量'],
  customer_code: ['得意先コード'],
  customer_name: ['得意先名'],
  destination_code: ['直送先コード'],
  destination_name: ['お届け先名', '直送先名'],
  customer_order_no: ['顧客注文番号'],
  location_code: ['置場'],
  ssd: ['メーカー出荷日(SSD)'],
  vrd: ['ミスミ納期(VRD)'],
  order_date: ['発注日(POD)'],
  ship_method: ['出荷方法'],
  export_type: ['輸出区分'],
  unit_weight: ['個別重量'],
  total_weight: ['商品重量'],
  packing_line: ['梱包ラインNo.'],
  data_kind: ['データ区分'],
};

/** CSV になければ取り込めない項目 */
export const REQUIRED_FIELDS: readonly ImportField[] = [
  'global_no', 'barcode_global_no', 'slip_no', 'product_code', 'quantity', 'customer_code', 'destination_code', 'location_code', 'ssd', 'data_kind',
];

export const FIELD_LABELS: Record<ImportField, string> = {
  global_no: 'グローバル番号', barcode_global_no: 'バーコード用グローバル番号', slip_no: '受注伝票番号', product_code: '商品コード',
  product_name: '商品名', quantity: '数量', customer_code: '得意先コード', customer_name: '得意先名', destination_code: '直送先コード',
  destination_name: '納品先名', customer_order_no: '顧客注文番号', location_code: '置場', ssd: 'メーカー出荷日', vrd: 'ミスミ納期',
  order_date: '発注日', ship_method: '出荷方法', export_type: '輸出区分', unit_weight: '個別重量', total_weight: '商品重量',
  packing_line: '梱包ラインNo.', data_kind: 'データ区分',
};

/** 画面 → API に送る 1 行（CSV の値を文字列のまま） */
export type RawItem = Partial<Record<ImportField, string>> & { line_no: number };

/** 検証・変換した 1 行（DB に入れる形） */
export interface ImportItem {
  line_no: number;
  global_no: string;
  barcode_global_no: string;
  slip_no: string;
  product_code: string;
  product_name: string;
  quantity: number;
  customer_code: string;
  customer_name: string | null;
  destination_code: string;
  destination_name: string | null;
  customer_order_no: string | null;
  location_code: string;
  ssd: string;
  vrd: string | null;
  order_date: string | null;
  ship_method: string | null;
  export_type: string | null;
  unit_weight: number | null;
  total_weight: number | null;
  packing_line: string | null;
  data_kind: string;
}

/** 列名の対応を調べる。足りない必須列の名前を返す（列の順番は問わない） */
export function resolveHeader(header: string[], profile: CsvProfile): { index: Record<ImportField, number[]>; missing: string[] } {
  const norm = header.map((h) => h.trim().replace(/^\uFEFF/, ''));
  const index = {} as Record<ImportField, number[]>;
  const missing: string[] = [];
  for (const f of IMPORT_FIELDS) {
    index[f] = profile[f].map((name) => norm.indexOf(name)).filter((i) => i >= 0);
    if (REQUIRED_FIELDS.includes(f) && index[f].length === 0) missing.push(profile[f][0] ?? FIELD_LABELS[f]);
  }
  return { index, missing };
}

/** 1 行の値を列名の対応で取り出す（前から順に、空でない最初の列） */
export function mapRow(cells: string[], index: Record<ImportField, number[]>, lineNo: number): RawItem {
  const out: RawItem = { line_no: lineNo };
  for (const f of IMPORT_FIELDS) {
    for (const i of index[f]) {
      const v = (cells[i] ?? '').trim();
      if (v !== '') { out[f] = v; break; }
    }
  }
  return out;
}

const NO_PATTERN = /^[A-Za-z0-9\-_.]{4,40}$/;
const CODE_PATTERN = /^[A-Za-z0-9\-_.]{1,32}$/;

/** YYYYMMDD または YYYY-MM-DD / YYYY/MM/DD を、実在する日付の YYYY-MM-DD にする */
export function toDate(v: string): string | null {
  const m = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const t = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (t.getUTCFullYear() !== Number(y) || t.getUTCMonth() !== Number(mo) - 1 || t.getUTCDate() !== Number(d)) return null;
  return `${y}-${mo}-${d}`;
}

const opt = (v: string | undefined, max: number) => (v === undefined || v === '' ? null : v.slice(0, max));

/**
 * 1 行を検証して DB の形にする。エラーは「何が・どうだめか」を日本語で返す。
 * 照合に使う番号は大文字にそろえる（バーコードの読み取り値も大文字にそろえて比べるため）。
 */
export function normalizeItem(raw: RawItem): { item: ImportItem | null; errors: string[] } {
  const errors: string[] = [];
  const need = (f: ImportField) => {
    const v = raw[f];
    if (v === undefined || v === '') { errors.push(`${FIELD_LABELS[f]}が空欄です`); return ''; }
    return v;
  };
  const no = (f: ImportField) => {
    const v = need(f).toUpperCase();
    if (v && !NO_PATTERN.test(v)) errors.push(`${FIELD_LABELS[f]}「${v.slice(0, 20)}」の形式が正しくありません（英数字 4〜40 文字）`);
    return v;
  };
  const code = (f: ImportField) => {
    const v = need(f);
    if (v && !CODE_PATTERN.test(v)) errors.push(`${FIELD_LABELS[f]}「${v.slice(0, 20)}」の形式が正しくありません`);
    return v;
  };
  const num = (f: ImportField) => {
    const v = raw[f];
    if (v === undefined || v === '') return null;
    const n = Number(v.replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0) { errors.push(`${FIELD_LABELS[f]}「${v.slice(0, 20)}」が数値ではありません`); return null; }
    return n;
  };
  const date = (f: ImportField, required: boolean) => {
    const v = required ? need(f) : raw[f] ?? '';
    if (!v) return null;
    const d = toDate(v);
    if (!d) errors.push(`${FIELD_LABELS[f]}「${v.slice(0, 20)}」が日付ではありません`);
    return d;
  };

  const global_no = no('global_no');
  const barcode_global_no = no('barcode_global_no');
  const slip_no = code('slip_no');
  const product_code = need('product_code').slice(0, 80);
  const qtyText = need('quantity');
  const quantity = Number(qtyText);
  if (qtyText && (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000)) errors.push(`数量「${qtyText.slice(0, 10)}」は 1 以上の整数にしてください`);
  const customer_code = code('customer_code');
  const destination_code = code('destination_code');
  const location_code = code('location_code');
  const ssd = date('ssd', true);
  const vrd = date('vrd', false);
  const order_date = date('order_date', false);
  const unit_weight = num('unit_weight');
  const total_weight = num('total_weight');
  const data_kind = need('data_kind').slice(0, 10);

  if (errors.length) return { item: null, errors };
  return {
    errors,
    item: {
      line_no: raw.line_no,
      global_no, barcode_global_no, slip_no, product_code,
      product_name: (raw.product_name ?? '').slice(0, 200),
      quantity,
      customer_code, customer_name: opt(raw.customer_name, 100),
      destination_code, destination_name: opt(raw.destination_name, 100),
      customer_order_no: opt(raw.customer_order_no, 100),
      location_code,
      ssd: ssd!, vrd, order_date,
      ship_method: opt(raw.ship_method, 50), export_type: opt(raw.export_type, 5),
      unit_weight, total_weight,
      packing_line: opt(raw.packing_line, 20),
      data_kind,
    },
  };
}

/**
 * 変更の判定に使うハッシュ（docs/csv-import.md §5）。取り込む項目だけを決まった順に並べる。
 * 行番号・データ連携日などは入れない（中身が同じなのに「更新」にならないように）。
 */
export async function rowHash(item: ImportItem): Promise<string> {
  const values = IMPORT_FIELDS.map((f) => item[f] ?? null);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(values)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 取込の区分（docs/csv-import.md §4） */
export const IMPORT_KINDS = ['new', 'updated', 'unchanged', 'review', 'error'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  new: '新規', updated: '更新', unchanged: '変更なし', review: '要確認', error: 'エラー',
};

/** 1 回の送信で送る行数・照会するキーの数（Workers の CPU と D1 の 1 回あたりの問い合わせ数に収めるため） */
export const IMPORT_CHUNK = 200;
export const LOOKUP_CHUNK = 500;
export const IMPORT_MAX_ROWS = 20_000;
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/** 登録済みの明細（照会の結果） */
export interface ExistingItem {
  global_no: string;
  barcode_global_no: string;
  row_hash: string;
  status: string;
}

/**
 * 1 行の区分を決める。画面のプレビューと API の登録で同じ判定を使う。
 *  - 置場がマスターにない・データ区分が F 以外・照合済みの明細の内容が変わった → 要確認（取り込まない）
 *  - バーコード用番号が別の明細で使われている → エラー
 */
export function classify(
  item: ImportItem,
  hash: string,
  existing: ExistingItem | undefined,
  barcodeOwner: string | undefined,
  knownLocations: ReadonlySet<string>,
): { kind: ImportKind; message: string | null } {
  if (barcodeOwner && barcodeOwner !== item.global_no) {
    return { kind: 'error', message: `バーコード用グローバル番号 ${item.barcode_global_no} が、別の明細（${barcodeOwner}）で使われています` };
  }
  if (item.data_kind !== 'F') return { kind: 'review', message: `データ区分が「${item.data_kind}」です（F 以外は内容を確認してから取り込みます）` };
  if (!knownLocations.has(item.location_code)) return { kind: 'review', message: `置場 ${item.location_code} が置場マスターにありません` };
  if (!existing) return { kind: 'new', message: null };
  if (existing.row_hash === hash) return { kind: 'unchanged', message: null };
  if (existing.status !== 'pending') {
    return { kind: 'review', message: 'すでに照合済み（または取消・要確認）の明細の内容が変わっています。上書きしていません' };
  }
  return { kind: 'updated', message: null };
}
