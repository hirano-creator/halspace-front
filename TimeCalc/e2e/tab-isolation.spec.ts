import { test, expect } from "@playwright/test";

test.describe("タブごとのセッション分離（本改修の核心）", () => {
  test("同一ブラウザの複数タブで別々のアカウントに同時ログインできる", async ({ browser }) => {
    const context = await browser.newContext();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    // タブA: 管理者でログイン
    await pageA.goto("/login");
    await pageA.getByLabel(/社員番号/).fill("0001");
    await pageA.getByLabel("パスワード").fill("admin123");
    await pageA.getByRole("button", { name: "ログイン" }).click();
    await expect(pageA).toHaveURL(/\/my$/);

    // タブB: 店長でログイン（別アカウント）
    await pageB.goto("/login");
    await pageB.getByLabel(/社員番号/).fill("0002");
    await pageB.getByLabel("パスワード").fill("password123");
    await pageB.getByRole("button", { name: "ログイン" }).click();
    await expect(pageB).toHaveURL(/\/my$/);

    // それぞれのタブで自分のアカウント名がサイドバーに表示されている
    await expect(pageA.getByText("管理者", { exact: true })).toBeVisible();
    await expect(pageB.getByText("店長 花子", { exact: true })).toBeVisible();

    // リロードしても互いに影響しない（sessionStorageはタブごとに独立）
    await pageA.reload();
    await pageB.reload();
    await expect(pageA).toHaveURL(/\/my$/);
    await expect(pageA.getByText("管理者", { exact: true })).toBeVisible();
    await expect(pageB).toHaveURL(/\/my$/);
    await expect(pageB.getByText("店長 花子", { exact: true })).toBeVisible();

    // タブAでログアウトしても、タブBのセッションは維持される
    await pageA.getByRole("button", { name: "ログアウト" }).click();
    await expect(pageA).toHaveURL(/\/login/);

    await pageB.reload();
    await expect(pageB).toHaveURL(/\/my$/);
    await expect(pageB.getByText("店長 花子", { exact: true })).toBeVisible();

    await context.close();
  });
});

test.describe("QR打刻導線", () => {
  test("未ログインタブはログイン後、元のクエリ付きURLへ戻る", async ({ page }) => {
    await page.goto("/clock?dept=00000000-0000-0000-0000-000000000000&kind=attend");
    await expect(page).toHaveURL(/\/login\?redirect=/);

    await page.getByLabel(/社員番号/).fill("0003");
    await page.getByLabel("パスワード").fill("password123");
    await page.getByRole("button", { name: "ログイン" }).click();

    await expect(page).toHaveURL(/\/clock\?dept=00000000-0000-0000-0000-000000000000&kind=attend/);
  });
});
