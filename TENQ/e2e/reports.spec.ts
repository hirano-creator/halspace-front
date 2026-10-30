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

  await l07.click();
  const side = page.getByRole('complementary', { name: 'L-07 の詳細' });
  await expect(side).toBeVisible();
  await expect(side.getByRole('link', { name: 'この設備の記録・台帳を見る' })).toBeVisible();
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

test('カード一覧の配置を編集して保存できる（設備をドラッグで別のエリアへ）', async ({ page }) => {
  test.skip(!isPc(page), '配置の編集は PC で行う');
  await page.goto('./');
  await devLogin(page, '中村 誠');
  await page.goto('./#/board');
  await page.getByRole('button', { name: '配置を編集' }).click();
  const card = page.getByRole('button', { name: /^D-01 / });
  const target = page.getByRole('region', { name: 'C棟 溶接' });
  await card.dragTo(target);
  await expect(target.getByRole('button', { name: /^D-01 / })).toBeVisible();
  await page.getByRole('button', { name: '配置を保存' }).click();
  await expect(page.getByText('配置を保存しました。')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'C棟 溶接' }).getByRole('button', { name: /^D-01 / })).toBeVisible();
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
  await expect(page.getByRole('button', { name: '配置を編集' })).toHaveCount(0);
});
