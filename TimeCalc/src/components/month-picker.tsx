"use client";

// 月度選択（選んだ瞬間にフォームを送信して表示を切り替える）

import { inputClass } from "@/components/ui";

export function MonthPicker({ name = "month", defaultValue }: { name?: string; defaultValue: string }) {
  return (
    <input
      type="month"
      name={name}
      defaultValue={defaultValue}
      aria-label="表示する月度"
      // iOS Safari は month 入力にネイティブの装飾と余白を足すため、
      // appearance-none と ::-webkit-date-and-time-value の余白リセットで
      // 隣のボタンと高さ・文字位置が揃うようにしている
      className={`${inputClass} appearance-none [&::-webkit-date-and-time-value]:my-0 [&::-webkit-date-and-time-value]:h-auto [&::-webkit-date-and-time-value]:text-left`}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    />
  );
}
