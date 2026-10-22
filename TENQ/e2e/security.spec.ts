import { expect, test } from '@playwright/test';
import { devLogin } from './helpers';

test('利用者が入力した HTML は実行されず、文字として表示される（XSS 対策）', async ({ page }) => {
  test.skip(page.viewportSize()!.width <= 900, '登録を2回しないよう PC だけで行う');
  const name = '<img src=x onerror="window.__xss=1">';
  await page.goto('./');
  await devLogin(page, '中村 誠');
  await page.goto('./#/equipment/new');
  await page.getByLabel('設備番号').fill(`XSS-${Date.now().toString(36)}`);
  await page.getByLabel('設備名').fill(name);
  await page.getByLabel('備考').fill('<script>window.__xss=2</script>');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page.getByRole('heading', { name: new RegExp('onerror') })).toBeVisible();
  await expect(page.getByText('<script>window.__xss=2</script>')).toBeVisible();
  await page.goto('./#/equipment');
  await page.getByLabel('キーワード').fill('onerror');
  await expect(page.getByRole('link', { name })).toBeVisible();
  await page.goto('./#/board');
  await expect(page.locator('.mc-name', { hasText: 'onerror' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
});
