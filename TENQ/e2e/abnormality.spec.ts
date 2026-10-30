import { expect, test, type Page } from '@playwright/test';
import { devLogin } from './helpers';

/** 1×1 の PNG（写真の代わり） */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const isPc = (page: Page) => page.viewportSize()!.width > 900;

async function switchUser(page: Page, name: string) {
  await page.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('tenq_device_token'); });
  await page.goto('./#/login');
  await page.reload();
  await devLogin(page, name);
}

test('点検で ✕ と一言・写真を送ると異常になり、見取り図で赤く出て、「直した」で緑に戻る', async ({ page }) => {
  test.skip(!isPc(page), '同じ設備の点検を2回しないよう PC だけで行う');
  await page.goto('./');
  await devLogin(page, '山本 健');
  await page.goto('./#/inspect/eq-w03');
  const groups = page.getByRole('group', { name: / の判定$/ });
  await groups.first().waitFor();
  for (let i = 0; i < await groups.count(); i++) await groups.nth(i).getByRole('button', { name: '正常' }).click();
  await groups.nth(1).getByRole('button', { name: '異常' }).click();
  await page.getByPlaceholder('どこが・どうなっているか（一言）').fill('ガスホースに亀裂');
  await page.locator('.memo-photo input[type=file]').setInputFiles({ name: 'hose.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('写真 1')).toBeVisible();
  await page.getByRole('button', { name: '送る', exact: true }).click();
  await expect(page.getByRole('heading', { name: '送りました' })).toBeVisible();
  await expect(page.getByText('写真も送りました。')).toBeVisible();

  // 工場長のホーム（見取り図）で赤く出る。押すと内容と写真、「直した」
  await switchUser(page, '中村 誠');
  const tile = page.getByRole('button', { name: /^W-03 溶接ロボット 3号 ✕ 今日/ });
  await expect(tile).toBeVisible();
  await expect(page.locator('.ng-list')).toContainText('W-03');
  await tile.click();
  const side = page.getByRole('complementary', { name: 'W-03 の詳細' });
  await expect(side).toContainText('ケーブル・ホース');
  await expect(side).toContainText('ガスホースに亀裂');
  await expect(side.locator('.abn-photos img')).toHaveCount(1);
  await side.getByRole('button', { name: '○ 直した' }).click();
  await side.getByLabel('何をして直したか（一言）').fill('ホースを交換した');
  await side.getByRole('button', { name: '記録する' }).click();
  await expect(page.getByRole('button', { name: /^W-03 溶接ロボット 3号 ○ 直した/ })).toBeVisible();
});

test('異常の詳細画面から「直した」を記録でき、履歴に残る（一般社員には出ない）', async ({ page }) => {
  test.skip(!isPc(page), '利用者を切り替えて1件を最後まで進めるので PC だけで行う');
  await page.goto('./');
  await devLogin(page, '山本 健');
  await page.goto('./#/abnormalities/new?equipment=eq-p02');
  await page.getByLabel('異常の内容（ひとことで）').fill('E2E 作動油のにじみ');
  await page.getByText('早めの対応が必要').click();
  await page.getByRole('button', { name: '報告する' }).click();
  await expect(page.getByText('報告しました。')).toBeVisible();
  const url = page.url();
  await expect(page.getByRole('heading', { name: '直した' })).toHaveCount(0);

  await switchUser(page, '鈴木 大地');
  await page.goto(url);
  await page.getByLabel('何をして直したか（一言）').fill('継手のパッキンを交換');
  await page.getByRole('button', { name: '○ 直した' }).click();
  await expect(page.getByText('「直した」を記録しました。')).toBeVisible();
  const timeline = page.locator('.timeline');
  for (const s of ['✕ 異常あり', '○ 直した']) await expect(timeline).toContainText(s);
  await expect(page.locator('.action-item')).toContainText('継手のパッキンを交換');
});

test('異常の一覧で期限超過を確かめられる', async ({ page }) => {
  await page.goto('./');
  await devLogin(page, '中村 誠');
  await page.goto('./#/abnormalities');
  await page.getByRole('button', { name: /期限超過/ }).click();
  const row = page.locator('.abn-row').filter({ hasText: 'ブレーキの効きが弱い' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('期限超過');
});

test('設備の詳細から異常を報告できる（スマホ）', async ({ page }) => {
  test.skip(isPc(page), 'スマホの画面で確かめる');
  await page.goto('./');
  await devLogin(page, '田中 翔');
  await page.goto('./#/abnormalities/new?equipment=eq-b01');
  await page.getByLabel('異常の内容（ひとことで）').fill('スマホからの報告');
  await page.getByText('使用は続けられる').click();
  await page.getByRole('button', { name: '報告する' }).click();
  await expect(page.getByText('報告しました。')).toBeVisible();
});
