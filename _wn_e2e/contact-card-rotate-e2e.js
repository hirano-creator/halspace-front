/* 名刺プレビューの回転が保存されるかの検証（バックエンドなし・APIモック）
   直したかった不具合：回転して「更新する」を押しても、開き直すと元の向きに戻る
   原因は2つ
     1. 名刺画像のURLが連絡先IDだけで、差し替えてもブラウザが古い画像を出し続けていた
     2. 回転の保存に scan-card（OCR）を使っており、読み取りに失敗すると画像も残らなかった

   実行: 静的サーバー :8765 を立てて node _wn_e2e/contact-card-rotate-e2e.js */
const { chromium } = require('../_aa_e2e/node_modules/playwright-core');

const BASE = 'http://127.0.0.1:8765/whatsno';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

async function stubApi(page) {
  await page.evaluate(() => {
    /* 横長（40x20）の実画像を用意する。回転できたかは縦横が入れ替わったかで判定する */
    const cv = document.createElement('canvas');
    cv.width = 40; cv.height = 20;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#4455ff'; cx.fillRect(0, 0, 40, 20);
    cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, 8, 4);
    window.__cardDataUrl = cv.toDataURL('image/png');

    window.__db = {
      contacts: [
        { id: 1, name: '山田 太郎', name_kana: 'ヤマダ タロウ', company_name: '山田製作所', email: 'yamada@example.com',
          phone: '', fax: '', tag_ids: [], has_card: true, card_ver: 'v0000001',
          card_image_path: 'wn/contact-cards/1/old.jpg',
          created_at: '2026-06-12T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
          created_by_name: 'テスト', updated_by_name: 'テスト' },
        { id: 2, name: '鈴木 一郎', name_kana: 'スズキ イチロウ', company_name: '鈴木鋼材', email: 'suzuki@example.com',
          phone: '', fax: '', tag_ids: [], has_card: false, card_ver: null,
          created_at: '2026-07-03T00:00:00Z', updated_at: '2026-07-03T00:00:00Z',
          created_by_name: 'テスト', updated_by_name: 'テスト' },
      ],
      saved: [],        // card-image に送られた画像の寸法
      updates: [],      // 更新APIに送られた内容
      scanCalls: 0,     // OCRが呼ばれた回数（回転では0であってほしい）
      urlCalls: [],     // wnContactCardUrl(id, ver) の呼ばれ方
      nextCard: 1,
    };
    const db = window.__db;

    window.wnGetContacts    = async () => JSON.parse(JSON.stringify(db.contacts));
    window.wnGetContactTags = async () => ({ groups: [], tags: [], can_edit: true });
    window.wnUpdateContact  = async (id, f) => {
      db.updates.push(Object.assign({ id: Number(id) }, JSON.parse(JSON.stringify(f))));
      const c = db.contacts.find(x => x.id === Number(id));
      Object.assign(c, f, { tag_ids: f.tag_ids ?? c.tag_ids });
      if (f.card_image_path) {
        c.card_image_path = f.card_image_path;
        c.has_card = true;
        c.card_ver = 'v' + f.card_image_path.replace(/\D/g, '').slice(-6);   // 差し替えたら変わる印
      }
      return c;
    };
    window.wnSaveContact   = async f => { const c = Object.assign({ id: 99 }, f); db.contacts.push(c); return c; };
    window.wnDeleteContact = async () => true;

    /* OCRは回転では呼ばれてはいけない。呼ばれたら回数を数えたうえで失敗させる
       （読み取れない名刺でも回転が保存できることの検証も兼ねる） */
    window.wnScanBusinessCard = async () => {
      db.scanCalls++;
      throw new Error('名刺を読み取れませんでした');
    };
    /* 画像だけの保存。受け取った画像の縦横を控えて、回転済みかを後で確かめる */
    window.wnSaveContactCardImage = async blob => {
      const bmp = await createImageBitmap(blob);
      db.saved.push({ w: bmp.width, h: bmp.height });
      bmp.close?.();
      return { card_image_path: `wn/contact-cards/1/rot${db.nextCard++}00.jpg` };
    };
    /* 実画像は取りに行かず data URL を返す。ver が渡っているかはここで控える */
    window.wnContactCardUrl = (id, ver) => { db.urlCalls.push({ id, ver: ver ?? null }); return window.__cardDataUrl; };
  });
}

const openEdit = async (page, id) => {
  await page.evaluate(id => editContact(allContactsCache.find(c => c.id === id)), id);
  await page.waitForTimeout(150);
};

const rotate = async page => {
  await page.evaluate(() => document.querySelector('#contactCardPreview .ct-rotate-btn').click());
  await page.waitForFunction(() => ctRotateBusy === false && /回転しました|失敗/.test(
    document.getElementById('contactScanStatus')?.innerText || ''), null, { timeout: 15000 });
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    sessionStorage.setItem('space_token', 'mock-token-e2e');
    sessionStorage.setItem('space_user', JSON.stringify({ id: 1, name: 'テスト', role: 'admin', email: 't@example.com', wn_extended_options_enabled: true }));
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.goto(`${BASE}/app/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wnDashboardReady === true, null, { timeout: 30000 });

  /* URL生成は本物のまま検証したいので、差し替える前に控えておく */
  await page.evaluate(() => { window.__realCardUrl = window.wnContactCardUrl; });
  const u1 = await page.evaluate(() => window.__realCardUrl(7, 'abc12345'));
  const u2 = await page.evaluate(() => window.__realCardUrl(7));
  check('URL生成: ver を渡すと v= が付く', /[?&]v=abc12345(&|$)/.test(u1), u1);
  check('URL生成: ver 無しでも従来どおり読める', /\/wn\/contacts\/7\/card/.test(u2) && !/[?&]v=/.test(u2), u2);

  await stubApi(page);
  await page.evaluate(() => openContactsModal());
  await page.waitForSelector('#contactsModal:not(.hidden)', { timeout: 5000 });
  await page.waitForFunction(() => Array.isArray(allContactsCache) && allContactsCache.length > 0, null, { timeout: 10000 });

  /* ── 1. 表示時にバージョンを渡している（ブラウザが古い名刺を出し続けないように） ── */
  await openEdit(page, 1);
  const call = await page.evaluate(() => window.__db.urlCalls.at(-1));
  check('名刺URLに card_ver を渡している', !!call && call.ver === 'v0000001', JSON.stringify(call));

  /* ── 2. 回転はOCRを呼ばない（読み取れない名刺でも向きだけ直せる） ── */
  await rotate(page);
  const st1 = await page.evaluate(() => ({
    scanCalls: window.__db.scanCalls,
    saved: window.__db.saved,
    status: document.getElementById('contactScanStatus')?.innerText || '',
    cardPath: ctCardPath,
  }));
  check('回転でOCR（scan-card）を呼ばない', st1.scanCalls === 0, `呼ばれた回数=${st1.scanCalls}`);
  check('回転した画像を保存している', st1.saved.length === 1 && st1.saved[0].w === 20 && st1.saved[0].h === 40,
        JSON.stringify(st1.saved));
  check('回転が成功と表示される', /回転しました/.test(st1.status), st1.status.slice(0, 40));
  check('保存した画像のパスを保持している', /rot\d+00\.jpg$/.test(st1.cardPath || ''), String(st1.cardPath));

  /* ── 3. 「更新する」で新しい名刺パスが送られる ── */
  await page.evaluate(() => addContactFromForm());
  await page.waitForFunction(() => window.__db.updates.length > 0, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  const upd = await page.evaluate(() => window.__db.updates.at(-1));
  check('更新に回転後の card_image_path が乗る', upd.id === 1 && /rot\d+00\.jpg$/.test(upd.card_image_path || ''),
        JSON.stringify(upd.card_image_path));

  /* ── 4. 開き直すと新しいバージョンのURLになる（＝古いキャッシュを見ない） ── */
  await openEdit(page, 1);
  const call2 = await page.evaluate(() => window.__db.urlCalls.at(-1));
  check('保存後は card_ver が変わっている', !!call2 && !!call2.ver && call2.ver !== 'v0000001', JSON.stringify(call2));

  /* ── 5. 別の連絡先に切り替えたとき、前の名刺を持ち越さない ── */
  await openEdit(page, 2);
  const carried = await page.evaluate(() => ctCardPath);
  check('別の連絡先を開くと名刺パスが持ち越されない', carried === null, String(carried));

  await page.evaluate(() => {
    document.getElementById('contactNameInput').value  = '鈴木 一郎';
    document.getElementById('contactEmailInput').value = 'suzuki@example.com';
  });
  await page.evaluate(() => addContactFromForm());
  await page.waitForTimeout(400);
  const upd2 = await page.evaluate(() => window.__db.updates.at(-1));
  check('名刺を触っていない連絡先には card_image_path を送らない',
        upd2.id === 2 && !('card_image_path' in upd2), JSON.stringify(upd2.card_image_path ?? null));

  /* ── 6. 続けて2回回すと180度になる（回転が積み上がる） ── */
  await openEdit(page, 1);
  await rotate(page);
  await rotate(page);
  const saved = await page.evaluate(() => window.__db.saved);
  check('2回回すと縦横が元に戻る（180度）',
        saved.length === 3 && saved[1].w === 20 && saved[1].h === 40 && saved[2].w === 40 && saved[2].h === 20,
        JSON.stringify(saved));

  await ctx.close();
  await browser.close();

  const ng = results.filter(r => !r.ok);
  console.log(`\n${results.length - ng.length}/${results.length} PASS`);
  if (ng.length) { ng.forEach(r => console.log('  FAIL: ' + r.name)); process.exit(1); }
})();
