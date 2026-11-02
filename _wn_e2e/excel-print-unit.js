/* ファイル詳細の「印刷」で Excel を印刷用 HTML にする処理（buildExcelPrintHtml）の単体確認
   サーバー不要。SheetJS は CDN から読む。SHOT=1 で shots/excel-print-*.png と .pdf

   確認すること:
   - 印刷範囲があればその範囲だけ、非表示シートは出ない
   - 結合セル（colspan/rowspan）が残る
   - 列幅の比率どおりに用紙幅いっぱいに収まり、横にはみ出さない
   - 印刷用 PDF が作れる（シートごとに改ページ） */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');
const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../whatsno/assets/js/pages/wn-file-detail.js'), 'utf8');
const pick = name => {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(name + ' が見つからない');
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
};
const code = [pick('escapeHtml'), pick('buildExcelPrintHtml')].join('\n');

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js' });
  await page.addScriptTag({ content: code + '\nvar fileData = { file_name: "検査成績表<test>.xlsx" };' });

  const html = await page.evaluate(() => {
    const aoa = [
      ['検 査 成 績 書', '', '', '', '', '', '', '', '', '', '範囲外'],
      ['製造者', '株式会社ヒラノ', '', '納入年月日', '年　月　日', '', '', '', '承認', '検査', ''],
      ['製造責任者', '', '', '納入数', '', '', '', '', '', '', ''],
      ['種類', '格納箱', '', '注文番号', '', '', '', '', '', '', ''],
      ['No.', '検査項目', '規格値及び許容範囲', 1, 2, 3, '', '', '測定器具', '判定', ''],
      [1, '全幅', '730 ± 4.0', '', '', '', '', '', 'コンベックス', '良\n否', ''],
      [2, '蓋の隙間', '1.0 +0.5, -0 の隙間がある事。\n扉は90°以上開閉し、\nカバーに接触しない事。', '', '', '', '', '', '目視', '良\n否', ''],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = [
      XLSX.utils.decode_range('A1:J1'),
      XLSX.utils.decode_range('B2:C2'),
      XLSX.utils.decode_range('I2:I4'),
      XLSX.utils.decode_range('J2:J4'),
    ];
    ws['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 24 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 10 }, { wch: 7 }, { wch: 30 }];
    ws['!rows'] = [{ hpx: 48 }, {}, {}, {}, {}, { hpx: 44 }, { hpx: 64 }];
    const hidden = XLSX.utils.aoa_to_sheet([['非表示シートの中身']]);
    const second = XLSX.utils.aoa_to_sheet([['2枚目', 'あ'], ['い', 'う']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '検査成績書');
    XLSX.utils.book_append_sheet(wb, hidden, '隠し');
    XLSX.utils.book_append_sheet(wb, second, '別紙');
    wb.Workbook = {
      Names: [{ Name: '_xlnm.Print_Area', Sheet: 0, Ref: "'検査成績書'!$A$1:$J$7" }],
      Sheets: [{ Hidden: 0 }, { Hidden: 1 }, { Hidden: 0 }],
    };
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return buildExcelPrintHtml(buf);
  });

  ok(html.includes('&lt;test&gt;'), 'タイトルのファイル名がエスケープされる');
  ok(!html.includes('範囲外'), '印刷範囲の外（K列）は出ない');
  ok(!html.includes('非表示シートの中身'), '非表示シートは出ない');
  ok(html.includes('2枚目'), '2枚目のシートも出る');

  const pp = await browser.newPage({ viewport: { width: 718, height: 1000 } });
  await pp.setContent(html);
  await pp.emulateMedia({ media: 'print' });
  const m = await pp.evaluate(() => {
    const t = document.querySelector('table');
    return {
      sheets: document.querySelectorAll('section.sheet').length,
      colspan: !!t.querySelector('td[colspan="10"]'),
      rowspan: !!t.querySelector('td[rowspan="3"]'),
      tableW: t.getBoundingClientRect().width,
      bodyW: document.documentElement.scrollWidth,
      font: parseFloat(getComputedStyle(t).fontSize),
      cols: t.querySelectorAll('col').length,
      smallW: document.querySelectorAll('table')[1].getBoundingClientRect().width,
    };
  });
  ok(m.sheets === 2, `シート2枚（実際 ${m.sheets}）`);
  ok(m.colspan && m.rowspan, '結合セルが残る');
  ok(m.cols === 10, `列は A〜J の10列（実際 ${m.cols}）`);
  ok(m.bodyW <= 718, `横にはみ出さない（${m.bodyW}px）`);
  ok(m.smallW < 300, `小さい表は紙いっぱいに拡大しない（${Math.round(m.smallW)}px）`);
  ok(m.font > 8 && m.font < 30, `文字の大きさが用紙幅に応じて決まる（${m.font.toFixed(1)}px）`);

  const pdf = await pp.pdf({ format: 'A4' });
  ok(pdf.length > 1000, `PDF が作れる（${pdf.length} bytes）`);
  if (process.env.SHOT) {
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
    await pp.screenshot({ path: path.join(__dirname, 'shots/excel-print.png'), fullPage: true });
    fs.writeFileSync(path.join(__dirname, 'shots/excel-print.pdf'), pdf);
  }
  await browser.close();
  console.log(fail ? `\n${fail} 件 FAIL` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})();
