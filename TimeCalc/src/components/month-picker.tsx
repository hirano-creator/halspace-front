"use client";

// 月度選択（選んだ瞬間にフォームを送信して表示を切り替える）

import { inputClass } from "@/components/ui";

export function MonthPicker({ name = "month", defaultValue }: { name?: string; defaultValue: string }) {
  return (
    <input
      type="month"
      name={name}
      defaultValue={defaultValue}
      className={inputClass}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    />
  );
}
