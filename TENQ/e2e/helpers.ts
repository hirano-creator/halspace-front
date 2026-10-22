import { expect, type Page } from '@playwright/test';

/** 開発用ログイン（ログイン画面の下に出るボタン）で入る */
export async function devLogin(page: Page, name: string): Promise<void> {
  await expect(page.getByRole('heading', { name: 'ログイン' })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(name) }).click();
  // ログインが終わる（ログイン画面から移り、外枠が出る）まで待つ。待たずに移動すると、ログイン完了時の移動で上書きされる
  await page.waitForFunction(() => !location.hash.startsWith('#/login'));
  await expect(page.locator('.app-header')).toBeVisible();
}

export async function openMenuIfNeeded(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'メニュー' });
  if (await toggle.isVisible()) await toggle.click();
}
