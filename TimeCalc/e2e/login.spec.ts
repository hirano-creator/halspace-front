import { test, expect } from "@playwright/test";

test.describe("ログイン", () => {
  test("正しい社員番号とパスワードでログインできる", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/社員番号/).fill("0001");
    await page.getByLabel("パスワード").fill("admin123");
    await page.getByRole("button", { name: "ログイン" }).click();

    await expect(page).toHaveURL(/\/my$/);
    await expect(page.getByText("マイページ")).toBeVisible();
  });

  test("誤ったパスワードではエラーが表示される", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/社員番号/).fill("0001");
    await page.getByLabel("パスワード").fill("wrong-password");
    await page.getByRole("button", { name: "ログイン" }).click();

    await expect(page.getByText("社員番号またはパスワードが正しくありません")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("未ログインで保護ページへアクセスするとログイン画面へ誘導される", async ({ page }) => {
    await page.goto("/my");
    await expect(page).toHaveURL(/\/login/);
  });
});
