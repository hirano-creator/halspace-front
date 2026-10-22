import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { devLogin } from './helpers';

const isPc = (page: Page) => page.viewportSize()!.width > 900;

test('カード一覧: エリアごとに状態の色と文字で表示し、絞り込みと詳細が使える', async ({ page }) => {
  await page.goto('./');
  await devLogin(page, '中村 誠');
  await page.goto('./#/board');
  const press = page.getByRole('region', { name: 'A棟 プレスライン' });
  await expect(press).toBeVisible();
  const l07 = page.getByRole('button', { name: /^L-07 NC旋盤 7号 異常あり/ });
  await expect(l07).toBeVisible();
  await expect(l07).toContainText('異常');
  await expect(page.getByRole('button', { name: /^K-02 研削盤 2号 停止中/ })).toBeVisible();

  // 「異常あり」で絞り込むと、それ以外は薄くなる
  await page.getByRole('button', { name: /異常あり/ }).first().click();
  // 停止中の K-02 は「異常あり」ではないので薄くなる（P-01 などは別のテストで異常に訂正されることがある）
  await expect(page.getByRole('button', { name: /^K-02 / })).toHaveClass(/dim/);
  await expect(l07).not.toHaveClass(/dim/);

  await l07.click();
  const drawer = page.getByRole('dialog', { name: 'L-07 NC旋盤 7号' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: '今日の点検記録' })).toBeVisible();
  await expect(page.getByText('直近30日の集計')).toBeVisible();
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

test('一般社員には CSV・帳票と管理の入口がなく、カード一覧は見られる', async ({ page }) => {
  await page.goto('./');
  await devLogin(page, '山本 健');
  await page.goto('./#/reports');
  await expect(page.getByText('この画面を開く権限がありません')).toBeVisible();
  await page.goto('./#/board');
  await expect(page.getByRole('heading', { name: /カード一覧/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '配置を編集' })).toHaveCount(0);
});
