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

test('点検で異常を選ぶと、完了画面からそのまま写真付きで報告できる', async ({ page }) => {
  test.skip(!isPc(page), '同じ設備の点検を2回しないよう PC だけで行う');
  await page.goto('./');
  await devLogin(page, '山本 健');
  await page.goto('./#/inspect/eq-w03');
  const groups = page.getByRole('group', { name: / の判定$/ });
  await groups.first().waitFor();
  for (let i = 0; i < await groups.count(); i++) await groups.nth(i).getByRole('button', { name: '正常' }).click();
  await groups.nth(1).getByRole('button', { name: '異常' }).click();
  await page.getByPlaceholder(/右側の安全カバー/).fill('ガスホースに亀裂');
  await page.getByRole('button', { name: '点検を完了' }).click();

  await page.getByRole('button', { name: '異常を報告' }).click();
  await expect(page.getByLabel('異常の内容（ひとことで）')).toHaveValue('ケーブル・ホースの異常');
  await expect(page.getByLabel('詳しい内容')).toHaveValue('ガスホースに亀裂');
  await page.getByText('けが・故障・品質不良につながるおそれがある').click();
  await expect(page.getByRole('alert').filter({ hasText: '設備の使用を止め' })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({ name: 'hose.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('img', { name: '選んだ写真 1' })).toBeVisible();
  await page.getByRole('button', { name: '報告する' }).click();

  await expect(page.getByText('報告しました。')).toBeVisible();
  await expect(page.getByRole('heading', { name: '写真（1）' })).toBeVisible();
  await expect(page.locator('.photo-grid img')).toHaveCount(1);
  await expect(page.getByRole('link', { name: /の点検/ })).toBeVisible();
});

test('担当決め → 着手 → 是正 → 再確認（別の人）→ 承認 まで追跡できる（T-09）', async ({ page }) => {
  test.skip(!isPc(page), '利用者を切り替えて1件を最後まで進めるので PC だけで行う');
  await page.goto('./');
  await devLogin(page, '山本 健');
  await page.goto('./#/equipment/eq-p02');
  await page.getByRole('button', { name: '異常を報告' }).click();
  await page.getByLabel('異常の内容（ひとことで）').fill('E2E 作動油のにじみ');
  await page.getByText('早めの対応が必要').click();
  await page.getByRole('button', { name: '報告する' }).click();
  await expect(page.getByText('報告しました。')).toBeVisible();
  const url = page.url();
  // 一般社員には対応の操作が出ない
  await expect(page.getByRole('heading', { name: '対応する' })).toHaveCount(0);

  await switchUser(page, '中村 誠');
  await page.goto(url);
  await page.getByLabel('対応担当者').selectOption({ label: '鈴木 大地' });
  const due = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(Date.now() + 3 * 86_400_000));
  await page.getByLabel('対応期限').fill(due);
  await page.getByRole('button', { name: '決める' }).click();
  await expect(page.getByText('担当と期限を決めました。')).toBeVisible();

  await switchUser(page, '鈴木 大地');
  await expect(page.getByRole('link', { name: /あなたが担当の異常/ })).toBeVisible();
  await page.goto(url);
  await page.getByRole('button', { name: '対応を始める' }).click();
  await expect(page.getByText('対応中にしました。')).toBeVisible();
  await page.getByLabel('修理・是正の内容').fill('継手のパッキンを交換');
  await page.getByLabel('原因').fill('パッキンの劣化');
  await page.getByRole('button', { name: '是正完了にする' }).click();
  await expect(page.getByText('是正を記録しました。')).toBeVisible();
  // 自分で直したものは自分で再確認できない（ボタンが出ない）
  await expect(page.getByRole('button', { name: /直っている/ })).toHaveCount(0);

  await switchUser(page, '中村 誠');
  await page.goto(url);
  await page.getByRole('button', { name: '直っている（再確認済み）' }).click();
  await expect(page.getByText('再確認しました。')).toBeVisible();
  await page.getByRole('button', { name: '承認して完了' }).click();
  await expect(page.getByText('承認して完了にしました。')).toBeVisible();

  const timeline = page.locator('.timeline');
  for (const s of ['発生', '未対応', '対応中', '是正完了', '再確認済み', '承認・完了']) await expect(timeline).toContainText(s);
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
