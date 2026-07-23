import { test, expect } from "@playwright/test";

test.describe("勤怠一覧のCSVエクスポート", () => {
  test("集計CSVをダウンロードできる", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/社員番号/).fill("0001");
    await page.getByLabel("パスワード").fill("admin123");
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page).toHaveURL(/\/my$/);

    await page.goto("/attendance");
    await expect(page.getByText("勤怠一覧")).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "集計CSV出力" }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^kintai_shukei_\d{4}-\d{2}\.csv$/);
  });
});
