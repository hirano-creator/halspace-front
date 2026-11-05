import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MISUMI_PROFILE, classify, csvCell, decodeCsv, looksBinary, mapRow, normalizeItem, parseCsv, resolveHeader, rowHash, toCsv, toDate,
  type ImportItem,
} from '../src';

/** ミスミ形式のダミー CSV（81 列・Shift-JIS。値はすべて架空。scratchpad の make_fixture.py で作成） */
const sjis = new Uint8Array(readFileSync(new URL('./fixtures/misumi-sample-sjis.csv', import.meta.url)));

function loadFixture() {
  const decoded = decodeCsv(sjis)!;
  const rows = parseCsv(decoded.text);
  const { index, missing } = resolveHeader(rows[0]!, MISUMI_PROFILE);
  return { decoded, rows, index, missing };
}

describe('文字コードと CSV の解析', () => {
  it('Shift-JIS を判定して読める（半角カナも）', () => {
    const { decoded, rows } = loadFixture();
    expect(decoded.encoding).toBe('shift_jis');
    expect(rows).toHaveLength(9);
    expect(rows.every((r) => r.length === 81)).toBe(true);
    expect(decoded.text).toContain('ﾐﾎﾝﾃﾞﾝｷ001');
    expect(decoded.text).toContain('テスト工業（株）');
  });

  it('UTF-8（BOM あり・なし）も読める', () => {
    const text = 'グローバル番号,数量\r\n5P1,1\r\n';
    const plain = new TextEncoder().encode(text);
    expect(decodeCsv(plain)).toEqual({ text, encoding: 'utf-8' });
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...plain]);
    expect(decodeCsv(bom)).toEqual({ text, encoding: 'utf-8' });
  });

  it('読めないバイト列は null、Excel などは NUL で見分ける', () => {
    expect(decodeCsv(new Uint8Array([0x82, 0xff, 0xfe, 0x80]))).toBeNull();
    expect(looksBinary(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(true);
    expect(looksBinary(sjis)).toBe(false);
  });

  it('クォート内のカンマ・改行・"" と、LF だけの改行', () => {
    expect(parseCsv('a,"b,c","d\r\ne","f""g"\nh,,\n\n')).toEqual([['a', 'b,c', 'd\r\ne', 'f"g'], ['h', '', '']]);
  });

  it('CSV 出力は数式にならないようにし、BOM 付き CRLF', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(toCsv(['x'], [[1]])).toBe('\uFEFFx\r\n1\r\n');
  });
});

describe('列の対応と 1 行の検証', () => {
  it('ミスミ形式の見出しはすべてそろう（列の順番は問わない）', () => {
    expect(loadFixture().missing).toEqual([]);
    const { missing } = resolveHeader(['グローバル番号', '数量'], MISUMI_PROFILE);
    expect(missing).toContain('置場');
  });

  it('1 行目を DB の形にする（お届け先名が空なら直送先名・日付の変換・番号は大文字）', () => {
    const { rows, index } = loadFixture();
    const raw = mapRow(rows[1]!, index, 2);
    const { item, errors } = normalizeItem(raw);
    expect(errors).toEqual([]);
    expect(item).toMatchObject({
      line_no: 2, global_no: '5P900000000001', barcode_global_no: '5P900000000001', slip_no: 'AB9000000001',
      product_code: 'MVSHM-TEST001-AAA', product_name: 'MEVIY SHEET METAL', quantity: 1,
      customer_code: '100001', destination_code: 'S00001', destination_name: 'テスト工業（株）第1工場',
      location_code: '0055', ssd: '2026-11-05', vrd: '2026-11-06', unit_weight: 120, total_weight: 120, data_kind: 'F', export_type: 'D',
    });
  });

  it('置場の 0 は落とさない（文字列のまま）', () => {
    const { rows, index } = loadFixture();
    const items = rows.slice(1).map((r, i) => normalizeItem(mapRow(r, index, i + 2)).item!);
    expect([...new Set(items.map((x) => x.location_code))].sort()).toEqual(['0053', '0055', '0056']);
  });

  it('必須の空欄・数量・日付の誤りを日本語で全部返す', () => {
    const { errors } = normalizeItem({ line_no: 5, global_no: '5P1', barcode_global_no: '5P900000000009', slip_no: 'S', product_code: 'P', quantity: '0', customer_code: 'C', destination_code: 'D', location_code: '0053', ssd: '20261332', data_kind: 'F' });
    expect(errors).toEqual([
      'グローバル番号「5P1」の形式が正しくありません（英数字 4〜40 文字）',
      '数量「0」は 1 以上の整数にしてください',
      'メーカー出荷日「20261332」が日付ではありません',
    ]);
  });

  it('日付は実在するものだけ', () => {
    expect(toDate('20261105')).toBe('2026-11-05');
    expect(toDate('2026/11/05')).toBe('2026-11-05');
    expect(toDate('20260230')).toBeNull();
  });
});

describe('変更の判定と区分', () => {
  const base = (): ImportItem => normalizeItem({
    line_no: 2, global_no: '5P900000000001', barcode_global_no: '5P900000000001', slip_no: 'AB1', product_code: 'P1', quantity: '1',
    customer_code: 'C1', destination_code: 'D1', location_code: '0055', ssd: '20261105', data_kind: 'F',
  }).item!;
  const known = new Set(['0053', '0055']);

  it('ハッシュは行番号に左右されず、中身が変われば変わる', async () => {
    const a = base();
    expect(await rowHash({ ...a, line_no: 99 })).toBe(await rowHash(a));
    expect(await rowHash({ ...a, quantity: 2 })).not.toBe(await rowHash(a));
  });

  it('新規・変更なし・更新・要確認・エラー', async () => {
    const a = base();
    const h = await rowHash(a);
    expect(classify(a, h, undefined, undefined, known).kind).toBe('new');
    expect(classify(a, h, { global_no: a.global_no, barcode_global_no: a.barcode_global_no, row_hash: h, status: 'pending' }, a.global_no, known).kind).toBe('unchanged');
    expect(classify(a, h, { global_no: a.global_no, barcode_global_no: a.barcode_global_no, row_hash: 'old', status: 'pending' }, a.global_no, known).kind).toBe('updated');
    // 照合済みの明細の内容が変わった → 上書きしない
    expect(classify(a, h, { global_no: a.global_no, barcode_global_no: a.barcode_global_no, row_hash: 'old', status: 'matched' }, a.global_no, known).kind).toBe('review');
    expect(classify({ ...a, location_code: '0057' }, h, undefined, undefined, known)).toEqual({ kind: 'review', message: '置場 0057 が置場マスターにありません' });
    expect(classify({ ...a, data_kind: 'C' }, h, undefined, undefined, known).kind).toBe('review');
    expect(classify(a, h, undefined, '5P999999999999', known).kind).toBe('error');
  });
});
