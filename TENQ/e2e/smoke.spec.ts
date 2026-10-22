import { expect, test } from '@playwright/test';

test('画面が開き、API とローカル D1 につながる', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle(/TENQ/);
  await expect(page.getByTestId('health')).toContainText('工場 3 件');
});

test('入力欄・ボタンの文字は 16px 以上（iOS の自動ズーム対策）', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => { const b = document.createElement('button'); b.id = 'probe'; document.body.append(b); });
  const size = await page.$eval('#probe', (el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
});
