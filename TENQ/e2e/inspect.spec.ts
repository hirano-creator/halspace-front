import { expect, test, type Page } from '@playwright/test';
import { devLogin } from './helpers';

/**
 * 点検の流れ（第4段階）。PC とスマホの2回走るので、データを変えるテストは端末ごとに別の設備を使う。
 *   PC:    P-04（プレス機・6項目、うち「清掃状態」は任意・対象外可）
 *   スマホ: W-02（溶接ロボット・5項目、うち「ノズル清掃」は任意・対象外可）
 */
const target = (page: Page) => (page.viewportSize()!.width > 900
  ? { id: 'eq-p04', name: 'サーボプレス 4号', required: 5 }
  : { id: 'eq-w02', name: '溶接ロボット 2号', required: 4 });

async function tapAll(page: Page, label: '正常' | '異常') {
  const groups = page.getByRole('group', { name: / の判定$/ });
  await groups.first().waitFor(); // 点検表が出るまで待ってから数える
  const n = await groups.count();
  for (let i = 0; i < n; i++) await groups.nth(i).getByRole('button', { name: label }).click();
}

test('必須項目をすべて選ぶまで完了できず、選ぶと点検が記録される（T-05 / T-06）', async ({ page }) => {
  const t = target(page);
  await page.goto('./');
  await devLogin(page, '山本 健');
  await page.goto(`./#/inspect/${t.id}`);
  await expect(page.getByRole('heading', { name: t.name })).toBeVisible();
  const done = page.getByRole('button', { name: /^あと \d+ 項目$|^送る$/ });
  await expect(done).toHaveText(`あと ${t.required} 項目`);
  await expect(done).toBeDisabled();

  // 1項目だけでは完了できない
  await page.getByRole('group', { name: / の判定$/ }).first().getByRole('button', { name: '正常' }).click();
  await expect(done).toHaveText(`あと ${t.required - 1} 項目`);

  // 読み込み直しても入力途中の内容は消えない
  await page.reload();
  await expect(page.getByRole('button', { name: `あと ${t.required - 1} 項目` })).toBeVisible();

  await tapAll(page, '正常');
  await page.getByRole('button', { name: '送る', exact: true }).click();
  await expect(page.getByRole('heading', { name: '送りました' })).toBeVisible();

  // もう一度開くと「完了しています」になり、二重には点検できない（同じ URL への移動は画面が変わらないので一度ホームへ）
  await page.goto('./#/');
  await expect(page.getByRole('button', { name: /QR を読む/ })).toBeVisible();
  await page.goto(`./#/inspect/${t.id}`);
  await expect(page.getByText(/さんが .* に完了しています/)).toBeVisible();
});

test('✕ を選ぶと一言の入力欄と写真のボタンが出て、送ったあとに注意が出る', async ({ page }) => {
  const id = page.viewportSize()!.width > 900 ? 'eq-m04' : 'eq-c11';
  await page.goto('./');
  await devLogin(page, '鈴木 大地');
  await page.goto(`./#/inspect/${id}`);
  await tapAll(page, '正常');
  const first = page.getByRole('group', { name: / の判定$/ }).first();
  await first.getByRole('button', { name: '異常' }).click();
  await page.getByPlaceholder('どこが・どうなっているか（一言）').fill('カバーに亀裂');
  await expect(page.getByText('＋ 写真')).toBeVisible();
  await page.getByRole('button', { name: '送る', exact: true }).click();
  await expect(page.getByRole('heading', { name: '送りました' })).toBeVisible();
  await expect(page.getByText('✕ が 1 件あります')).toBeVisible();
});

test('ほかの人が点検中の設備では、その人の名前を出して引き継ぎを選ばせる', async ({ page }) => {
  await page.goto('./');
  await devLogin(page, '佐藤 美咲');
  await page.goto('./#/inspect/eq-p03');
  await expect(page.getByText('山本 健 さんが点検中です')).toBeVisible();
  await expect(page.getByRole('button', { name: '引き継いで点検する' })).toBeVisible();
});

test('一般社員のホームは「QR を読む」と「あと N 台」だけ', async ({ page }) => {
  await page.goto('./');
  await devLogin(page, '山本 健');
  await expect(page.getByRole('button', { name: /QR を読む/ })).toBeVisible();
  await expect(page.getByText(/今日の点検 あと\s*\d+\s*台/)).toBeVisible();
  await page.getByRole('button', { name: 'まだの設備を見る' }).click();
  await expect(page.locator('.left-list')).toContainText('P-03');
  await page.getByRole('button', { name: /QR を読む/ }).click();
  await expect(page.getByRole('heading', { name: 'QR を読み取る' })).toBeVisible();
});

test('完了した点検記録を、理由をつけて訂正できる（元の記録は履歴に残る）', async ({ page }) => {
  test.skip(page.viewportSize()!.width <= 900, '同じ記録を2回訂正しないよう PC だけで行う');
  await page.goto('./');
  await devLogin(page, '中村 誠');
  await page.goto('./#/inspections/ins-p01');
  await page.getByRole('button', { name: '訂正する' }).click();
  await page.getByLabel('外観 の判定').selectOption('ng');
  await page.getByLabel('外観 のコメント').fill('フレームに打痕');
  await page.getByRole('button', { name: /訂正を保存（1項目）/ }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('現場で確認し直したら打痕があった');
  await page.getByRole('dialog').getByRole('button', { name: '訂正を保存' }).click();
  await expect(page.getByText('訂正を保存しました')).toBeVisible();
  await expect(page.getByText('第2版')).toBeVisible();
  await expect(page.getByText('理由: 現場で確認し直したら打痕があった')).toBeVisible();
});

test('工場長は点検基準を変更して新しい版を公開できる', async ({ page }) => {
  test.skip(page.viewportSize()!.width <= 900, '版を増やすのは PC だけで行う');
  await page.goto('./');
  await devLogin(page, '中村 誠');
  // ほかのテストで点検しない点検基準（揚重機）を使う。項目数が変わると、点検のテストの必須件数がずれるため
  await page.goto('./#/templates/tpl-lift');
  await page.getByRole('button', { name: '項目を変更する（新しい版）' }).click();
  await page.getByRole('button', { name: '項目を追加' }).click();
  await page.getByLabel('5. 項目名').fill('ワイヤーの素線切れ');
  await page.getByRole('button', { name: '公開する（新しい版）' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('ワイヤーの確認を追加');
  await page.getByRole('dialog').getByRole('button', { name: '公開する' }).click();
  await expect(page.getByText('第2版を公開しました')).toBeVisible();
  await expect(page.getByText('変更理由: ワイヤーの確認を追加')).toBeVisible();
});

test('QR 読み取り画面が開き、カメラが使えないときは代わりの方法を案内する', async ({ page }) => {
  await page.goto('./');
  await devLogin(page, '山本 健');
  await page.goto('./#/scan');
  await expect(page.getByRole('heading', { name: 'QR を読み取る' })).toBeVisible();
  await expect(page.getByRole('button', { name: '設備台帳から選ぶ' })).toBeVisible();
});

test('ホーム画面に追加するためのアイコンと manifest が読める', async ({ page, request }) => {
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const res = await request.get(new URL(href!, page.url()).toString());
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest.short_name).toBe('TENQ');
  for (const icon of manifest.icons) {
    expect((await request.get(new URL(icon.src, new URL(href!, page.url())).toString())).status()).toBe(200);
  }
});
