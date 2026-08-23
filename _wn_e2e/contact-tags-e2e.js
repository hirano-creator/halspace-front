/* 連絡先のタグ機能（グループ＋タグ）の検証（バックエンドなし・APIモック）
   - タグの作成・改名・削除・グループ移動は管理者のみ
   - 並び順は「よみ」優先のあいうえお順（漢字は localeCompare だけでは読み順にならない）
   - 絞り込みは OR（いずれかを含む）
   - 名前欄のIME確定でカナ欄を自動補完（読みが取れない端末では何もしない）

   実行: 静的サーバー :8765 を立てて node _wn_e2e/contact-tags-e2e.js
   （APIは page 側で差し替えるのでバックエンドは不要） */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');

const BASE = 'http://127.0.0.1:8765/whatsno';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

/* この環境では Playwright の実マウス入力がページに届かないため、
   既存の _wn_e2e と同じく JS 経由（el.click() / value 代入）で操作する */
const clk = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) throw new Error('要素がない: ' + s);
  el.click();
}, sel);

const clkText = (page, sel, text, childSel) => page.evaluate(({ sel, text, childSel }) => {
  const host = [...document.querySelectorAll(sel)].find(e => e.textContent.includes(text));
  if (!host) throw new Error('要素がない: ' + sel + ' / ' + text);
  const el = childSel ? host.querySelector(childSel) : host;
  if (!el) throw new Error('子要素がない: ' + childSel);
  el.click();
}, { sel, text, childSel });

const setVal = (page, sel, v) => page.evaluate(({ sel, v }) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error('要素がない: ' + sel);
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, { sel, v });

const textOf = (page, sel, contains) => page.evaluate(({ sel, contains }) => {
  const el = [...document.querySelectorAll(sel)].find(e => e.textContent.includes(contains));
  return el ? el.innerText : '';
}, { sel, contains });

/* 連絡先・タグAPIをページ側で差し替える。canEdit で管理者/一般を切り替える */
async function stubApi(page, canEdit) {
  await page.evaluate(canEdit => {
    /* 「加工」グループに漢字タグを置く。よみが無いと文字コード順になってしまうため、
       機械加工=キカイカコウ / 曲げ加工=マゲカコウ を持たせて読み順を検証できるようにする */
    window.__db = {
      groups: [{ id: 1, name: '加工', sort_order: 1 }, { id: 2, name: '材料', sort_order: 2 }],
      tags: [
        { id: 11, group_id: 1, name: '曲げ加工', kana: 'マゲカコウ', count: 1 },
        { id: 12, group_id: 1, name: '機械加工', kana: 'キカイカコウ', count: 0 },
        { id: 13, group_id: 1, name: 'レーザー',  kana: '',           count: 1 },
        { id: 21, group_id: 2, name: '鋼材',     kana: 'コウザイ',    count: 1 },
      ],
      contacts: [
        { id: 1, name: '山田 太郎', name_kana: 'ヤマダ タロウ', company_name: '山田製作所', email: 'yamada@example.com',
          phone: '03-1111-2222', fax: '03-1111-2223', tag_ids: [11, 13],
          created_at: '2026-06-12T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
          created_by_name: '平野 秀和', updated_by_name: '田中 稔' },
        { id: 2, name: '鈴木 一郎', name_kana: 'スズキ イチロウ', company_name: '鈴木鋼材', email: 'suzuki@example.com',
          phone: '', fax: '', tag_ids: [21],
          created_at: '2026-07-03T00:00:00Z', updated_at: '2026-07-03T00:00:00Z',
          created_by_name: '平野 秀和', updated_by_name: '平野 秀和' },
        { id: 3, name: '伊藤 昇', name_kana: 'イトウ ノボル', company_name: '伊藤商会', email: 'ito@example.com',
          phone: '', fax: '', tag_ids: [],
          created_at: '2026-08-06T00:00:00Z', updated_at: '2026-08-06T00:00:00Z',
          created_by_name: '平野 秀和', updated_by_name: '平野 秀和' },
      ],
      nextId: 100,
      canEdit,
    };
    const db = window.__db;
    const recount = () => db.tags.forEach(t => { t.count = db.contacts.filter(c => c.tag_ids.includes(t.id)).length; });

    window.wnGetContacts     = async () => JSON.parse(JSON.stringify(db.contacts));
    window.wnGetContactTags  = async () => ({ groups: [...db.groups], tags: JSON.parse(JSON.stringify(db.tags)), can_edit: db.canEdit });
    /* 本番の store は同じメールなら updateOrCreate で更新に倒れる。モックも同じ挙動にする */
    window.wnSaveContact     = async f => {
      const exist = db.contacts.find(c => (c.email || '').toLowerCase() === (f.email || '').toLowerCase());
      if (exist) {
        Object.assign(exist, f, { tag_ids: f.tag_ids ?? exist.tag_ids, updated_at: '2026-08-08T00:00:00Z', updated_by_name: '平野 秀和' });
        recount(); return exist;
      }
      const c = { id: db.nextId++, ...f, tag_ids: f.tag_ids ?? [],
                  created_at: '2026-08-08T00:00:00Z', updated_at: '2026-08-08T00:00:00Z',
                  created_by_name: '平野 秀和', updated_by_name: '平野 秀和' };
      db.contacts.push(c); recount(); return c;
    };
    window.wnUpdateContact   = async (id, f) => {
      const c = db.contacts.find(x => x.id === Number(id));
      Object.assign(c, f, { tag_ids: f.tag_ids ?? c.tag_ids, updated_at: '2026-08-08T00:00:00Z', updated_by_name: '平野 秀和' });
      recount(); return c;
    };
    window.wnDeleteContact   = async id => { db.contacts = db.contacts.filter(c => c.id !== Number(id)); recount(); return true; };

    const needAdmin = () => { if (!db.canEdit) throw new Error('タグの編集は管理者のみ行えます'); };
    /* 名刺スキャン。__cardResult を差し替えて読み取り結果を変える */
    window.__cardResult = {
      name: '堀内 健一郎', name_roman: 'KENICHIRO HORIUCHI', company: '株式会社堀内鋼機',
      department: '製造部', title: '係長', email: 'k.horiuchi@example.co.jp',
      phone: '053-441-2200', mobile: '090-8765-4321', fax: '053-441-2201',
      address: '静岡県浜松市', card_image_path: 'wn/contact-cards/1/dummy.jpg',
    };
    // __cardQueue に積むと1枚ずつ違う結果を返す（まとめ読み取りの検証用）
    window.__cardQueue = null;
    window.wnScanBusinessCard = async () => {
      if (Array.isArray(window.__cardQueue) && window.__cardQueue.length) {
        const next = window.__cardQueue.shift();
        if (next === 'ERROR') throw new Error('読み取りに失敗しました');
        return JSON.parse(JSON.stringify(next));
      }
      return JSON.parse(JSON.stringify(window.__cardResult));
    };
    // 1x1 の透明GIF。実画像を取りに行かせない
    window.wnContactCardUrl = () => 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

    window.wnCreateContactTag = async ({ name, kana, groupId }) => {
      needAdmin();
      const t = { id: db.nextId++, group_id: groupId ? Number(groupId) : null, name, kana: kana || null, count: 0 };
      db.tags.push(t); return t;
    };
    window.wnUpdateContactTag = async (id, { name, kana, groupId }) => {
      needAdmin();
      const t = db.tags.find(x => x.id === Number(id));
      Object.assign(t, { name, kana: kana || null, group_id: groupId ? Number(groupId) : null });
      return t;
    };
    window.wnDeleteContactTag = async id => {
      needAdmin();
      db.tags = db.tags.filter(t => t.id !== Number(id));
      db.contacts.forEach(c => { c.tag_ids = c.tag_ids.filter(x => x !== Number(id)); });
      recount(); return true;
    };
    window.wnCreateContactTagGroup = async name => {
      needAdmin();
      const g = { id: db.nextId++, name, sort_order: db.groups.length + 1 };
      db.groups.push(g); return g;
    };
    window.wnUpdateContactTagGroup = async (id, name) => {
      needAdmin();
      const g = db.groups.find(x => x.id === Number(id)); g.name = name; return g;
    };
    window.wnDeleteContactTagGroup = async (id, deleteTags) => {
      needAdmin();
      const gid = Number(id);
      if (deleteTags) {
        const ids = db.tags.filter(t => t.group_id === gid).map(t => t.id);
        db.tags = db.tags.filter(t => t.group_id !== gid);
        db.contacts.forEach(c => { c.tag_ids = c.tag_ids.filter(x => !ids.includes(x)); });
      } else {
        db.tags.forEach(t => { if (t.group_id === gid) t.group_id = null; });
      }
      db.groups = db.groups.filter(g => g.id !== gid);
      recount(); return true;
    };
  }, canEdit);
}

async function openModal(page) {
  /* トップバーのアイコンは実クリックが届かないため関数を直接呼ぶ */
  await page.evaluate(() => openContactsModal());
  await page.waitForSelector('#contactsModal:not(.hidden)', { timeout: 5000 });
  await page.waitForFunction(() => Array.isArray(allContactsCache) && allContactsCache.length > 0, null, { timeout: 10000 });
  await page.waitForTimeout(200);
}

async function newPage(browser, canEdit) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com', wn_extended_options_enabled: true }));
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.goto(`${BASE}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wnDashboardReady === true, null, { timeout: 30000 });
  await stubApi(page, canEdit);
  await openModal(page);
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  /* ── 管理者 ── */
  const { ctx: aCtx, page } = await newPage(browser, true);

  check('モーダルが2カラムで開く',
    await page.isVisible('#contactsModal .ct-left') && await page.isVisible('#contactsModal .ct-right'));
  check('電話・FAX欄がある', await page.isVisible('#contactPhoneInput') && await page.isVisible('#contactFaxInput'));

  /* 並び順：連絡先はカナのあいうえお順 */
  const order = await page.evaluate(() => _ctVisibleContacts().map(c => c.name));
  check('連絡先がカナのあいうえお順に並ぶ',
    JSON.stringify(order) === JSON.stringify(['伊藤 昇', '鈴木 一郎', '山田 太郎']), order.join(' → '));

  /* 並び順：タグはグループ内で「よみ」優先のあいうえお順 */
  const tagOrder = await page.evaluate(() => ctTagsOf(1).map(t => t.name));
  check('タグはよみ優先のあいうえお順に並ぶ（漢字を含んでも読み順）',
    JSON.stringify(tagOrder) === JSON.stringify(['機械加工', '曲げ加工', 'レーザー']), tagOrder.join(' → '));

  /* 一覧の表示内容 */
  const row = await textOf(page, '#contactsList .ct-r', '山田 太郎');
  check('一覧にTEL/FAXが出る', row.includes('TEL 03-1111-2222') && row.includes('FAX 03-1111-2223'), row.replace(/\n/g, ' / '));
  check('一覧にタグが出る', row.includes('曲げ加工') && row.includes('レーザー'));
  check('一覧に登録日・登録者・更新者が出る',
    row.includes('登録 2026/06/12') && row.includes('平野 秀和') && row.includes('更新 2026/08/01') && row.includes('田中 稔'),
    row.replace(/\n/g, ' / '));
  check('更新がない連絡先は更新欄を出さない', !(await textOf(page, '#contactsList .ct-r', '鈴木 一郎')).includes('更新'));

  /* タグで絞り込み（OR） */
  await clkText(page, '.ct-nav-item', '鋼材');
  await page.waitForTimeout(200);
  check('タグで絞り込める', (await page.locator('#contactsList .ct-r').count()) === 1);
  await clkText(page, '.ct-nav-item', '曲げ加工');
  await page.waitForTimeout(200);
  check('複数選択は「いずれかを含む」（OR）', (await page.locator('#contactsList .ct-r').count()) === 2);
  await clkText(page, '.ct-nav-item', 'タグなし');
  await page.waitForTimeout(200);
  check('「タグなし」で未設定の連絡先を出せる', (await page.locator('#contactsList .ct-r').count()) === 3);
  await clk(page, '#contactFilterClear');
  await page.waitForTimeout(200);
  check('絞り込みを解除できる', (await page.locator('#contactsList .ct-r').count()) === 3);

  /* 管理者はタグを作れる */
  await clk(page, '#contactTagPickBtn');
  await page.waitForTimeout(200);
  check('管理者には「タグを編集」が出る', await page.isVisible('#ctManageBtn'));
  await clk(page, '#ctOpenNewTag');
  await setVal(page, '#ctNewTagName', '溶接');
  await setVal(page, '#ctNewTagKana', 'ヨウセツ');
  await clk(page, '#ctNewTagOk');
  await page.waitForFunction(() => ctTags.some(t => t.name === '溶接'), null, { timeout: 5000 });
  check('作ったタグはそのまま選択状態になる', await page.evaluate(() => [...ctSel].some(id => ctTag(id)?.name === '溶接')));

  /* 連絡先の登録（タグ付き） */
  await clk(page, '#contactTagPickBtn');
  await setVal(page, '#contactNameInput',    '佐藤 健');
  await setVal(page, '#contactKanaInput',    'サトウ ケン');
  await setVal(page, '#contactCompanyInput', '佐藤溶接工業');
  await setVal(page, '#contactEmailInput',   'sato@example.com');
  await setVal(page, '#contactPhoneInput',   '052-777-8888');
  await clk(page, '#contactAddBtn');
  await page.waitForFunction(() => allContactsCache.some(c => c.email === 'sato@example.com'), null, { timeout: 5000 });
  await page.waitForTimeout(200);
  check('タグ付きで登録できる', (await textOf(page, '#contactsList .ct-r', '佐藤 健')).includes('溶接'));
  check('登録後はフォームが空に戻る', (await page.inputValue('#contactNameInput')) === '' && (await page.evaluate(() => ctSel.size)) === 0);

  /* 編集でタグが復元される */
  await clkText(page, '#contactsList .ct-r', '山田 太郎', '.contact-edit-btn');
  await page.waitForTimeout(200);
  check('編集でタグが復元される', (await page.evaluate(() => ctSel.size)) === 2);
  check('編集で登録・更新の履歴が出る',
    await page.isVisible('#contactMeta') && (await page.locator('#contactMeta').innerText()).includes('登録：'));
  await clk(page, '#contactCancelEditBtn');
  check('やめるでフォームが戻る', (await page.evaluate(() => ctSel.size)) === 0);

  /* タグ削除は使用件数を出して確認し、連絡先からも外れる */
  await clk(page, '#contactTagPickBtn');
  await clk(page, '#ctManageBtn');
  await page.waitForTimeout(200);
  let dialog = '';
  page.once('dialog', d => { dialog = d.message(); d.accept(); });
  await clkText(page, '.ct-opt', '曲げ加工', '[data-tdel]');
  await page.waitForFunction(() => !ctTags.some(t => t.name === '曲げ加工'), null, { timeout: 5000 });
  await page.waitForTimeout(200);
  check('タグ削除の確認に使用件数が出る', /連絡先 1件 からも外れます/.test(dialog), dialog);
  check('タグを消すと連絡先からも外れる', !(await textOf(page, '#contactsList .ct-r', '山田 太郎')).includes('曲げ加工'));

  /* グループ削除（タグは未分類に残す） */
  page.once('dialog', d => d.dismiss());
  await clkText(page, '.ct-ghead', '加工', '[data-gdel]');
  await page.waitForFunction(() => !ctGroups.some(g => g.name === '加工'), null, { timeout: 5000 });
  check('グループを消してもタグは未分類として残る',
    await page.evaluate(() => ctTags.some(t => t.name === 'レーザー' && !t.group_id)));

  /* ── 名刺スキャン（読み取りAPIはモック。UIの流れとカナ変換を見る） ── */
  const scan = (page, patch = {}) => page.evaluate(async patch => {
    Object.assign(window.__cardResult, patch);
    // 1x1 のPNGをファイル代わりに渡す（縮小処理を通すため実画像である必要がある）
    const bin = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
    await scanBusinessCard(new File([bin], 'card.png', { type: 'image/png' }));
  }, patch);

  await page.evaluate(() => _contactCancelEdit());
  await scan(page);
  check('名刺スキャンで名前・会社・メールが入る',
    (await page.inputValue('#contactNameInput')) === '堀内 健一郎' &&
    (await page.inputValue('#contactCompanyInput')) === '株式会社堀内鋼機' &&
    (await page.inputValue('#contactEmailInput')) === 'k.horiuchi@example.co.jp');
  check('電話とFAXを取り違えない',
    (await page.inputValue('#contactPhoneInput')) === '053-441-2200' &&
    (await page.inputValue('#contactFaxInput')) === '053-441-2201');
  check('カナは名刺のローマ字から機械変換する（姓→名の順）',
    (await page.inputValue('#contactKanaInput')) === 'ホリウチ ケニチロ',
    await page.inputValue('#contactKanaInput'));
  check('自動入力した欄に印が付く', (await page.locator('#contactNameInput.ct-ai').count()) === 1);
  check('読み取った名刺の控えが出る', await page.isVisible('#contactCardPreview img'));
  check('名刺画像のパスを保持する', (await page.evaluate(() => ctCardPath)) === 'wn/contact-cards/1/dummy.jpg');

  await clk(page, '#contactAddBtn');
  await page.waitForFunction(() => allContactsCache.some(c => c.email === 'k.horiuchi@example.co.jp'), null, { timeout: 5000 });
  check('名刺画像を添えて登録される',
    (await page.evaluate(() => allContactsCache.find(c => c.email === 'k.horiuchi@example.co.jp')?.card_image_path)) === 'wn/contact-cards/1/dummy.jpg');
  check('登録後は自動入力の印が消える', (await page.locator('#contactNameInput.ct-ai').count()) === 0);

  /* 同じメールアドレスなら更新に切り替える */
  await scan(page);
  check('同じメールの名刺は更新モードになる', (await page.locator('#contactAddBtnLabel').innerText()) === '更新する');
  check('重複の注意が出る', (await page.locator('#contactScanStatus').innerText()).includes('同じメールアドレス'));

  /* 同じ会社の人が居ればタグを引き継ぐ */
  await page.evaluate(() => _contactCancelEdit());
  await scan(page, { email: 'new-person@example.com', company: '山田製作所', name: '山田 次郎', name_roman: 'JIRO YAMADA' });
  check('同じ会社の既存連絡先からタグを引き継ぐ',
    (await page.evaluate(() => [...ctSel].map(id => ctTag(id)?.name).sort().join(','))) === 'レーザー',
    await page.evaluate(() => [...ctSel].map(id => ctTag(id)?.name).join(',')));

  /* ローマ字が無ければカナは空のまま（AIに読みを作らせない） */
  await page.evaluate(() => _contactCancelEdit());
  await scan(page, { email: 'noroman@example.com', name: '斎藤 三郎', name_roman: '', company: '' });
  check('ローマ字が無ければカナは空にする', (await page.inputValue('#contactKanaInput')) === '');
  check('その旨を画面で知らせる', (await page.locator('#contactScanStatus').innerText()).includes('ローマ字が無い'));
  await page.evaluate(() => _contactCancelEdit());

  /* ── 登録済みファイルから読み取る（?scan_file= 経由の入口） ── */
  await page.evaluate(() => {
    // 1x1 PNG を「What'sNo上の名刺画像ファイル」として見せる
    const bin = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
    window.allFiles = [{ id: 777, file_name: '名刺_堀内.png', mime_type: 'image/png' }];
    window.wnFetchFileBuffer = async () => bin.buffer;
    Object.assign(window.__cardResult, { email: 'from-file@example.co.jp', name: '堀内 健一郎', company: '株式会社堀内鋼機' });
  });
  await page.evaluate(() => _ctScanFromFile(777));
  await page.waitForFunction(() => document.getElementById('contactEmailInput').value === 'from-file@example.co.jp', null, { timeout: 10000 });
  check('登録済みファイルから読み取ってフォームに入る',
    (await page.inputValue('#contactNameInput')) === '堀内 健一郎');
  check('ファイル経由でも自動入力の印が付く', (await page.locator('#contactCompanyInput.ct-ai').count()) === 1);
  await page.evaluate(() => _contactCancelEdit());

  /* ── まとめて読み取り ── */
  await page.evaluate(() => {
    window.__cardQueue = [
      { name: '青木 一', name_roman: 'HAJIME AOKI', company: '青木工業', email: 'aoki@example.com', phone: '01-1111-1111', fax: '', card_image_path: 'wn/contact-cards/1/a.jpg' },
      { name: '山田 三郎', name_roman: 'SABURO YAMADA', company: '山田製作所', email: 'saburo@example.com', phone: '', fax: '', card_image_path: 'wn/contact-cards/1/b.jpg' },
      { name: '伊藤 昇', name_roman: '', company: '伊藤商会', email: 'ito@example.com', phone: '', fax: '', card_image_path: 'wn/contact-cards/1/c.jpg' },   // 既存＝更新
      { name: 'メール無し', name_roman: '', company: 'メール無し工業', email: '', phone: '', fax: '', card_image_path: null },
      'ERROR',
    ];
  });
  await page.evaluate(async () => {
    const bin = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
    const files = [1, 2, 3, 4, 5].map(n => new File([bin], `card${n}.png`, { type: 'image/png' }));
    await scanCardsBulk(files);
  });
  check('まとめ読み取りの一覧が出る', (await page.locator('#cardBulkList .ct-r').count()) === 5);
  /* 連絡先モーダル(z-index:1000)の裏に回らないこと */
  const bulkZ = await page.evaluate(() => getComputedStyle(document.getElementById('cardBulkModal')).zIndex);
  check('まとめ読み取りの画面が前面に出る',
    (await page.locator('#cardBulkSaveBtn').isVisible()) && Number(bulkZ) > 1000, `z-index=${bulkZ}`);
  check('既存と同じメールは「更新」と表示する',
    (await page.locator('#cardBulkList .ct-r', { hasText: '伊藤 昇' }).innerText()).includes('更新'));
  check('新規は「新規」と表示する',
    (await page.locator('#cardBulkList .ct-r', { hasText: '青木 一' }).innerText()).includes('新規'));
  check('メールが無い名刺は選べない',
    await page.locator('#cardBulkList input[type=checkbox]').nth(3).isDisabled());
  check('読み取り失敗も一覧に出す',
    (await page.locator('#cardBulkList .ct-r', { hasText: '読み取れませんでした' }).count()) === 1);
  check('同じ会社の既存連絡先からタグを引き継ぐ（まとめ読み取り）',
    (await page.locator('#cardBulkList .ct-r', { hasText: '山田 三郎' }).innerText()).includes('レーザー'));
  check('登録ボタンに件数が出る',
    (await page.locator('#cardBulkSaveLabel').innerText()).includes('3件'),
    await page.locator('#cardBulkSaveLabel').innerText());

  const before = await page.evaluate(() => allContactsCache.length);
  await clk(page, '#cardBulkSaveBtn');
  await page.waitForFunction(() => document.getElementById('cardBulkModal').classList.contains('hidden'), null, { timeout: 15000 });
  const after = await page.evaluate(() => allContactsCache.length);
  check('チェックした分だけ登録される（更新は増えない）', after === before + 2, `${before} → ${after}`);
  check('まとめ登録でも名刺画像が紐づく',
    (await page.evaluate(() => allContactsCache.find(c => c.email === 'aoki@example.com')?.card_image_path)) === 'wn/contact-cards/1/a.jpg');
  await page.evaluate(() => { window.__cardQueue = null; });

  /* カナのIME自動入力 */
  const ime = (reading, confirmed) => page.evaluate(({ reading, confirmed }) => {
    const el = document.getElementById('contactNameInput');
    el.dispatchEvent(new CompositionEvent('compositionstart'));
    for (const ch of reading) el.dispatchEvent(new CompositionEvent('compositionupdate', { data: ch }));
    el.value += confirmed;
    el.dispatchEvent(new CompositionEvent('compositionend', { data: confirmed }));
    return document.getElementById('contactKanaInput').value;
  }, { reading, confirmed });

  await page.evaluate(() => { document.getElementById('contactNameInput').value = ''; document.getElementById('contactKanaInput').value = ''; });
  check('名前をIMEで打つとカナが自動で入る', (await ime('やまだ', '山田')) === 'ヤマダ');
  check('続けて打つと後ろに足される',       (await ime('たろう', '太郎')) === 'ヤマダ タロウ');
  await page.evaluate(() => { document.getElementById('contactKanaInput').value = ''; });
  const noReading = await page.evaluate(() => {
    const el = document.getElementById('contactNameInput');
    el.dispatchEvent(new CompositionEvent('compositionstart'));
    el.dispatchEvent(new CompositionEvent('compositionupdate', { data: '' }));   // 読みが取れない端末
    el.dispatchEvent(new CompositionEvent('compositionend', { data: '佐藤' }));
    return document.getElementById('contactKanaInput').value;
  });
  check('読みが取れない端末では誤ったカナを入れない', noReading === '', `"${noReading}"`);

  await aCtx.close();

  /* ── 一般ユーザー（タグの編集導線が出ないこと） ── */
  const { ctx: gCtx, page: gp } = await newPage(browser, false);
  await clk(gp, '#contactTagPickBtn');
  await gp.waitForTimeout(200);
  check('一般には「タグを編集」が出ない',     !(await gp.isVisible('#ctManageBtn')));
  check('一般には「新しいタグ」が出ない',     !(await gp.isVisible('#ctOpenNewTag')));
  check('一般には「グループを追加」が出ない', !(await gp.isVisible('#ctOpenNewGroup')));
  check('一般でもタグの選択肢は見える',       (await gp.locator('#contactTagPanel .ct-opt').count()) > 0);
  await gCtx.close();

  /* ── スマホ幅は縦積み ── */
  const mctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  await mctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com', wn_extended_options_enabled: true }));
  });
  const mp = await mctx.newPage();
  await mp.goto(`${BASE}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await mp.waitForFunction(() => window.__wnDashboardReady === true, null, { timeout: 30000 });
  await stubApi(mp, true);
  await openModal(mp);
  check('スマホ幅では縦積みになる',
    (await mp.evaluate(() => getComputedStyle(document.querySelector('#contactsModal .ct-body')).flexDirection)) === 'column');
  await mctx.close();

  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n合計 ${results.length}件 / PASS ${results.length - failed.length} / FAIL ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})();
