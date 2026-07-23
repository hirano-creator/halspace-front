"use client";

// QRコード印刷ボタン

import { buttonPrimaryClass } from "@/components/ui";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={`${buttonPrimaryClass} print:hidden`}
    >
      印刷する
    </button>
  );
}
