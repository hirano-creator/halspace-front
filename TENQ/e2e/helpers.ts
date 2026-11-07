import { expect, type Page } from '@playwright/test';

/** 開発用ログイン（ログイン画面の下に出るボタン）で入る */
export async function devLogin(page: Page, name: string, opts: { guide?: boolean } = {}): Promise<void> {
  await expect(page.getByRole('heading', { name: 'ログイン' })).toBeVisible();
  // 初めての人の案内（吹き出し・はじめにやること）はボタンの上に重なるので、案内を確かめるテスト以外では止める
  await page.evaluate((on) => { if (on) localStorage.removeItem('tenq_onboarding_off'); else localStorage.setItem('tenq_onboarding_off', '1'); }, !!opts.guide);
  await page.getByRole('button', { name: new RegExp(name) }).click();
  // ログインが終わる（ログイン画面から移り、外枠が出る）まで待つ。待たずに移動すると、ログイン完了時の移動で上書きされる
  await page.waitForFunction(() => !location.hash.startsWith('#/login'));
  await expect(page.locator('.app-header')).toBeVisible();
}

/** 上の帯の ⚙（設定とアカウント）を開く。利用者名・「アプリ選択に戻る」もこの中 */
export async function openAccountMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: '設定とアカウント' }).click();
}
