import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { devLogin } from './helpers';

const isPc = (page: Page) => page.viewportSize()!.width > 900;

test('見取り図: 建屋ごとに設備を 3 色（✕ 異常・○ 正常・まだ）で出し、異常は右の欄にも並ぶ', async ({ page }) => {
  await page.goto('./');
  await devLogin(page, '中村 誠');
  // 工場長のホームが見取り図
  const press = page.getByRole('region', { name: 'A棟 プレスライン' });
  await expect(press).toBeVisible();
  const l07 = page.getByRole('button', { name: /^L-07 NC旋盤 7号 ✕/ });
  await expect(l07).toBeVisible();
  await expect(l07).toHaveClass(/eq-ng/);
  // 直っていない異常は前の日からでも赤のまま（CR-2 は 3 日前に見つかった）
  await expect(page.getByRole('button', { name: /^CR-2 チェーンブロック 1t ✕ 3日前から/ })).toBeVisible();
  // 止めている設備でも、直っていない異常があれば赤のまま
  await expect(page.getByRole('button', { name: /^K-02 研削盤 2号 ✕/ })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '直っていない異常' })).toContainText('CR-2');

  // 設備を押すと、そのそばに小窓。この設備でできることもここから
  await l07.click();
  const pop = page.getByRole('dialog', { name: 'L-07 の詳細' });
  await expect(pop).toBeVisible();
  await expect(pop.getByRole('link', { name: 'この設備の記録・台帳を見る' })).toBeVisible();
  await expect(pop.getByRole('link', { name: 'QR ラベルを印刷' })).toHaveAttribute('href', /#\/qr\?factory=fac-1a&ids=/);
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);

  // 右の欄の異常を押しても同じ小窓
  await page.getByRole('complementary', { name: '直っていない異常' }).getByRole('button', { name: /CR-2/ }).click();
  await expect(page.getByRole('dialog', { name: 'CR-2 の詳細' })).toBeVisible();
  await page.keyboard.press('Escape');

  // 建屋の名前を押すと建屋の小窓
  await page.getByRole('button', { name: 'A棟 プレスライン', exact: true }).click();
  const areaPop = page.getByRole('dialog', { name: 'A棟 プレスライン の操作' });
  await expect(areaPop.getByRole('button', { name: '✏ 名前を変える' })).toBeVisible();
  await areaPop.getByRole('button', { name: '🏷 この建屋の QR ラベルをまとめて印刷' }).click();
  await expect(page).toHaveURL(/#\/qr\?factory=fac-1a&ids=/);
});

test('カード一覧の自動更新は、画面を見ていない間は止まり、戻ると読み直す', async ({ page }) => {
  test.skip(!isPc(page), 'カード一覧は PC で確認する');
  // document.hidden を切り替えられるようにする（実際のタブ切り替えの代わり）
  await page.addInitScript(() => {
    const w = window as unknown as { __hidden: boolean };
    w.__hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => w.__hidden });
  });
  await page.clock.install();
  await page.goto('./');
  await devLogin(page, '中村 誠');
  // 工場長のホームは見取り図。最初の読み込みが終わってから数え始める
  await expect(page.getByRole('region', { name: 'A棟 プレスライン' })).toBeVisible();
  let calls = 0;
  let pending = 0;
  const isBoard = (u: string) => u.includes('/api/board?');
  page.on('request', (r) => { if (isBoard(r.url())) { calls++; pending++; } });
  page.on('requestfinished', (r) => { if (isBoard(r.url())) pending--; });
  page.on('requestfailed', (r) => { if (isBoard(r.url())) pending--; });
  const setHidden = (hidden: boolean) => page.evaluate((h) => {
    (window as unknown as { __hidden: boolean }).__hidden = h;
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

  await page.clock.runFor(31_000);
  await expect.poll(() => calls).toBeGreaterThanOrEqual(1);  // 30秒後の更新
  await expect.poll(() => pending).toBe(0);  // 通信中のまま時計を進めると、タイムアウト扱いの再試行が起きるので待つ

  await setHidden(true);
  const hiddenAt = calls;
  await page.clock.runFor(95_000);
  expect(calls).toBe(hiddenAt);  // 見ていない間は呼ばない

  await setHidden(false);
  await expect.poll(() => calls).toBe(hiddenAt + 1);  // 戻ったらすぐ1回読み直す
});

test('「配置を動かす」の間だけ、設備と建屋をつかんで動かせる。すぐ保存され、元に戻せる', async ({ page }) => {
  test.skip(!isPc(page), '配置は PC で動かす');
  await page.goto('./');
  await devLogin(page, '中村 誠');
  await page.goto('./#/board');
  await page.getByRole('button', { name: '🔓 配置を動かす' }).click();
  const card = page.getByRole('button', { name: /^D-01 / });
  const tray = page.getByRole('region', { name: 'まだ置いていない設備' });
  const weld = page.getByRole('region', { name: 'C棟 溶接' });

  // 設備をつかんで建屋へ → すぐ保存。「元に戻す」で戻る
  await card.dragTo(weld);
  await expect(page.getByText('D-01 を「C棟 溶接」へ動かしました（保存しました）')).toBeVisible();
  await expect(weld.getByRole('button', { name: /^D-01 / })).toBeVisible();
  await page.getByRole('button', { name: '元に戻す' }).click();
  await expect(tray.getByRole('button', { name: /^D-01 / })).toBeVisible();
  await card.dragTo(weld);
  await expect(weld.getByRole('button', { name: /^D-01 / })).toBeVisible();

  // 建屋の右下 ◢ を左下へ引っぱると幅が狭く・高さが高くなり、帯をつかんで右へ動かせる（横 12 列・縦 1 マス 40px＋すき間 12px のマス目に吸い付く）
  const floor = await page.locator('.floor').boundingBox();
  const col = floor!.width / 12;
  const rz = await weld.locator('.bld-rz').boundingBox();
  await page.mouse.move(rz!.x + rz!.width / 2, rz!.y + rz!.height / 2);
  await page.mouse.down();
  await page.mouse.move(rz!.x - col * 2, rz!.y + rz!.height / 2 + 52 * 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText('「C棟 溶接」の大きさを変えました（保存しました）')).toBeVisible();
  const gridRow = (l: typeof weld) => l.evaluate((el) => (el as HTMLElement).style.gridRow);
  await expect.poll(() => gridRow(weld)).toBe('4 / span 5');
  const bar = await weld.locator('h2').boundingBox();
  await page.mouse.move(bar!.x + 60, bar!.y + bar!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar!.x + 60 + col * 2, bar!.y + bar!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText('「C棟 溶接」を動かしました（保存しました）')).toBeVisible();
  const gridColumn = (l: typeof weld) => l.evaluate((el) => (el as HTMLElement).style.gridColumn);
  await expect.poll(() => gridColumn(weld)).toBe('3 / span 7');

  await page.getByRole('button', { name: '🔒 固定する' }).click();
  await page.reload();
  const weld2 = page.getByRole('region', { name: 'C棟 溶接' });
  await expect(weld2.getByRole('button', { name: /^D-01 / })).toBeVisible();
  await expect.poll(() => gridColumn(weld2)).toBe('3 / span 7');
  await expect.poll(() => gridRow(weld2)).toBe('4 / span 5');
});

test('点検履歴を絞り込み、その条件で CSV を出力できる（BOM 付き UTF-8）', async ({ page }) => {
  test.skip(!isPc(page), 'ダウンロードの確認は PC で行う');
  await page.goto('./');
  await devLogin(page, '佐藤 美咲');
  await page.goto('./#/inspections');
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await page.getByLabel('結果').selectOption('ng');
  await page.getByRole('button', { name: '検索' }).click();
  // 検索結果が入れ替わるのを待ってから確かめる
  await expect(page.locator('tbody tr', { hasText: '異常なし' })).toHaveCount(0);
  await expect(page.locator('tbody tr').first()).toContainText('異常あり');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'この条件で CSV を出力' }).click()]);
  expect(download.suggestedFilename()).toContain('点検記録');
  const bytes = readFileSync(await download.path());
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = bytes.toString('utf8');
  expect(text).toContain('異常あり');
  expect(text).not.toContain('異常なし');
});

test('月間点検表と ISO 監査向けの一覧を印刷用に開ける', async ({ page }) => {
  test.skip(!isPc(page), '帳票は PC で確認する');
  await page.goto('./');
  await devLogin(page, '中村 誠');
  await page.goto('./#/reports');
  await page.getByLabel('設備').selectOption({ label: 'L-07 NC旋盤 7号' });
  await page.getByRole('button', { name: '印刷用の画面を開く' }).nth(1).click();
  await expect(page.getByRole('heading', { name: /日常点検表 \d+年\d+月/ })).toBeVisible();
  await expect(page.locator('.sheet-table')).toContainText('異音・振動');
  await expect(page.locator('.sheet-table td.ng').first()).toHaveText('×');

  await page.goto('./#/reports');
  await page.getByRole('button', { name: '印刷用の画面を開く' }).first().click();
  await expect(page.getByRole('heading', { name: '設備日常点検 記録一覧' })).toBeVisible();
  for (const h of ['1. 点検の実施状況', '2. 使用した点検基準の版', '3. 点検記録の訂正', '4. 異常と是正処置', '5. 取り消した点検']) {
    await expect(page.getByRole('heading', { name: new RegExp(h.replace('.', '\\.')) })).toBeVisible();
  }
});

test('操作の記録に CSV の出力が残り、システム設定を変更できる', async ({ page }) => {
  test.skip(!isPc(page), '管理画面は PC で確認する');
  await page.goto('./');
  await devLogin(page, '高橋 遥');
  await page.goto('./#/admin/settings');
  await page.getByLabel('「遅れ」と判定する時刻').fill('08:45');
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page.getByText('設定を保存しました。')).toBeVisible();
  await page.goto('./#/admin/audit');
  await page.getByLabel('操作').selectOption('settings');
  await page.getByRole('button', { name: '絞り込む' }).click();
  await expect(page.locator('tbody')).toContainText('設定の変更');
});

test('一般社員には CSV・帳票と管理の入口がなく、見取り図は見られる（配置の編集はできない）', async ({ page }) => {
  await page.goto('./');
  await devLogin(page, '山本 健');
  await page.goto('./#/reports');
  await expect(page.getByText('この画面を開く権限がありません')).toBeVisible();
  await page.goto('./#/board');
  await expect(page.getByRole('region', { name: 'A棟 プレスライン' })).toBeVisible();
  await expect(page.getByRole('button', { name: '🔓 配置を動かす' })).toHaveCount(0);
});
