import { expect, test } from '@playwright/test';
import { devLogin, openMenuIfNeeded } from './helpers';

test('未ログインで QR を開くと、ログイン後にその設備の点検表が開く（T-04）', async ({ page }) => {
  await page.goto('./#/q/TENQDEVSEEDQRZAN');
  await devLogin(page, '山本 健');
  await expect(page.getByRole('heading', { name: '天井クレーン 2.8t' })).toBeVisible();
  await expect(page.getByText(/中村 誠 さんが .* に完了しています/)).toBeVisible();
});

test('再発行済みの古い QR は案内を出す', async ({ page }) => {
  await page.goto('./');
  await devLogin(page, '山本 健');
  await page.goto('./#/q/TENQDEVSEEDQROLD');
  await expect(page.getByText('再発行済み')).toBeVisible();
});

test('一般社員には登録・QR印刷・管理の入口が出ない', async ({ page }) => {
  await page.goto('./');
  await devLogin(page, '山本 健');
  await expect(page.getByRole('heading', { name: '山本 健 さん' })).toBeVisible();
  await openMenuIfNeeded(page);
  const nav = page.getByRole('navigation', { name: 'メニュー' });
  await expect(nav.getByRole('link', { name: '設備台帳' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'QRラベル印刷' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'ユーザー管理' })).toHaveCount(0);
  await page.goto('./#/equipment');
  await expect(page.getByRole('button', { name: '設備を登録' })).toHaveCount(0);
  await page.goto('./#/admin/users');
  await expect(page.getByText('この画面を開く権限がありません')).toBeVisible();
});

test('設備担当者は担当設備の一部の項目だけ編集できる', async ({ page }) => {
  // PC とスマホが同時に走るので、同じ設備を同時に編集しないよう端末ごとに別の担当設備を使う
  const id = page.viewportSize()!.width > 900 ? 'eq-p02' : 'eq-l05';
  await page.goto('./');
  await devLogin(page, '佐藤 美咲');
  await page.goto(`./#/equipment/${id}/edit`);
  await expect(page.getByText('設備担当者が変更できるのは')).toBeVisible();
  await expect(page.getByLabel('設備名')).toBeDisabled();
  const loc = page.getByLabel('設置場所');
  await expect(loc).toBeEnabled();
  await loc.fill('A棟 プレスライン 2列目（E2E）');
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page.getByText('A棟 プレスライン 2列目（E2E）')).toBeVisible();
});

test('工場長が設備を登録すると QR コードが発行される', async ({ page }) => {
  const code = `E2E-${Date.now().toString(36).toUpperCase()}`;
  await page.goto('./');
  await devLogin(page, '中村 誠');
  await page.goto('./#/equipment/new');
  await page.getByLabel('設備番号').fill(code);
  await page.getByLabel('設備名').fill('E2E テスト設備');
  await page.getByLabel('エリア（カード一覧の置き場所）').selectOption({ label: 'B棟 切削' });
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page.getByRole('heading', { name: `${code} E2E テスト設備` })).toBeVisible();
  await expect(page.getByRole('img', { name: `${code} の QR コード` })).toBeVisible();
  await expect(page.locator('svg.qr path')).toHaveCount(1);
});

test('同じ設備番号は登録できない', async ({ page }) => {
  await page.goto('./');
  await devLogin(page, '中村 誠');
  await page.goto('./#/equipment/new');
  await page.getByLabel('設備番号').fill('P-01');
  await page.getByLabel('設備名').fill('重複');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page.getByText('この設備番号は同じ工場ですでに使われています')).toBeVisible();
});

test('QR ラベルを選んで印刷イメージを作れる', async ({ page }) => {
  await page.goto('./');
  await devLogin(page, '佐藤 美咲');
  await page.goto('./#/qr');
  await page.getByLabel(/P-01/).check();
  await page.getByLabel(/P-03/).check();
  await expect(page.getByRole('button', { name: /印刷する（2枚・1ページ）/ })).toBeEnabled();
  await expect(page.locator('.sheet .label')).toHaveCount(2);
  await expect(page.locator('.sheet .label-code').first()).toHaveText('P-01');
});

test('システム管理者はユーザー管理を開ける', async ({ page }) => {
  await page.goto('./');
  await devLogin(page, '高橋 遥');
  await page.goto('./#/admin/users');
  await expect(page.getByRole('heading', { name: 'ユーザー管理' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /佐藤 美咲/ })).toBeVisible();
});

test('一覧で検索できる', async ({ page }) => {
  await page.goto('./');
  await devLogin(page, '山本 健');
  await page.goto('./#/equipment');
  await page.getByLabel('キーワード').fill('溶接');
  await expect(page.locator('tbody tr')).toHaveCount(3);
});

test('入力欄・ボタンの文字は 16px 以上（iOS の自動ズーム対策）', async ({ page }) => {
  await page.goto('./#/login');
  const sizes = await page.$$eval('input, button', (els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16);
});

test('メニューの下に利用者と「アプリ選択に戻る」（Space.app のアプリ共通）。ログアウトは出さない', async ({ page }) => {
  await page.goto('./');
  await devLogin(page, '山本 健');
  await openMenuIfNeeded(page);
  const nav = page.getByRole('navigation', { name: 'メニュー' });
  await expect(nav.locator('.sidebar-user-name')).toHaveText('山本 健');
  await expect(nav.getByRole('link', { name: 'アプリ選択に戻る' })).toHaveAttribute('href', '../../space/apps.html');
  await expect(nav.getByText('ログアウト')).toHaveCount(0);
});

test('TENQ のログイン画面から直接入ったタブは「ログアウト」になる', async ({ page }) => {
  await page.goto('./');
  await devLogin(page, '山本 健');
  await page.evaluate(() => sessionStorage.setItem('tenq_standalone', '1'));
  await page.reload();
  await expect(page.getByRole('heading', { name: '山本 健 さん' })).toBeVisible();  // 読み込みが終わってからメニューを開く
  await openMenuIfNeeded(page);
  const nav = page.getByRole('navigation', { name: 'メニュー' });
  await expect(nav.getByRole('button', { name: 'ログアウト' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'アプリ選択に戻る' })).toHaveCount(0);
  await nav.getByRole('button', { name: 'ログアウト' }).click();
  await expect(page).toHaveURL(/#\/login/);
});
