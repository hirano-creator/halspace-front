import { expect, test, type Page } from '@playwright/test';
import { devLogin, openAccountMenu } from './helpers';

const isPc = (page: Page) => page.viewportSize()!.width > 900;

test('工場長の「はじめにやること」: できた手順に ✓、「やってみる」で押す場所を案内し、全部終わると消える', async ({ page }) => {
  test.skip(!isPc(page), '見取り図の準備は PC で行う');
  await page.goto('./');
  await devLogin(page, '中村 誠', { guide: true });
  const list = page.getByRole('region', { name: 'はじめにやること' });
  await expect(list).toBeVisible();
  // ダミーデータには建屋・設備・今日の点検があるので、①②④ はもうできている
  await expect(list.locator('li.is-done')).toHaveCount(3);
  await expect(list).toContainText('3 / 5 できました');

  // ③ QR ラベル: ⚙ → 「QRラベル印刷」を光らせ、押すと ✓
  await list.getByRole('button', { name: 'やってみる' }).click();
  await expect(page.getByRole('dialog', { name: '⚙ →「QRラベル印刷」' })).toBeVisible();
  await openAccountMenu(page);
  await page.getByRole('link', { name: 'QRラベル印刷' }).click();
  await expect(page).toHaveURL(/#\/qr/);
  await page.getByRole('link', { name: '工場' }).click();
  await expect(list).toContainText('4 / 5 できました');

  // ⑤ 毎朝の見方: 読んで「わかった」→ 全部できた
  await list.getByRole('button', { name: 'やってみる' }).click();
  await page.getByRole('dialog', { name: '毎朝はここを見るだけ' }).getByRole('button', { name: 'わかった' }).click();
  await expect(list).toContainText('準備ができました');
  await list.getByRole('button', { name: '閉じる' }).click();
  await expect(list).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: 'A棟 プレスライン' })).toBeVisible();
  await expect(list).toHaveCount(0);

  // ⚙ の「使い方を見る」でまた出る
  await openAccountMenu(page);
  await page.getByRole('button', { name: '使い方を見る' }).click();
  await expect(list).toBeVisible();
});

test('「？ 使い方」で画面の各場所に説明の札が付き、Esc で閉じる', async ({ page }) => {
  test.skip(!isPc(page), '見取り図は PC で確認する');
  await page.goto('./');
  await devLogin(page, '中村 誠');
  await page.getByRole('button', { name: '？ 使い方' }).click();
  const help = page.getByRole('dialog', { name: '画面の使い方' });
  await expect(help).toContainText('今日の数');
  await expect(help).toContainText('直っていない異常');
  await expect(help).toContainText('⚙ 設定');
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
});

test('作業者は初めてのときだけ、ホームと点検表で吹き出しの案内が出る', async ({ page }) => {
  await page.goto('./');
  await devLogin(page, '山本 健', { guide: true });
  const first = page.getByRole('dialog', { name: 'まずはここから' });
  await expect(first).toBeVisible();
  await first.getByRole('button', { name: 'わかった' }).click();
  await expect(first).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('山本 健 さん')).toBeVisible();
  await expect(first).toHaveCount(0);  // 2 回目は出ない

  // 点検表: 3 つの吹き出し（開くだけでは点検は始まらない）
  await page.goto('./#/inspect/eq-new');  // D-01: どのテストも点検しない設備
  await page.getByRole('dialog', { name: 'はじめての点検です' }).getByRole('button', { name: 'はじめる' }).click();
  await page.getByRole('dialog', { name: '見て、○ か ✕ を押す' }).getByRole('button', { name: '次へ' }).click();
  await page.getByRole('dialog', { name: '全部付けたら「送る」' }).getByRole('button', { name: 'わかった' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
