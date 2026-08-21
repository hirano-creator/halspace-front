"use client";

// 社員詳細（月次勤怠表）の印刷ボタン。A4横向きでの印刷はグローバルCSSの
// print-attendance-sheet クラス（globals.css）が担う。

import { buttonSecondaryClass } from "@/components/ui";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={`${buttonSecondaryClass} print:hidden`}
    >
      🖨 印刷する
    </button>
  );
}
