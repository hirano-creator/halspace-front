"use client";

// 選択チップ
//
// スマホでキーボードを開かずに入力を終えられるよう、選択式を多用する。
// タップ領域は最低 44px（min-h-10 + py で確保）。

import { chipClass, chipMultiOnClass, chipOnClass } from "./ui";

export interface ChipOption {
  code: string;
  label: string;
}

/** 単一選択。もう一度押すと解除できる（選び直しが早い） */
export function ChipGroup({
  options,
  value,
  onChange,
}: {
  options: ChipOption[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.code}
          type="button"
          onClick={() => onChange(value === o.code ? null : o.code)}
          className={value === o.code ? chipOnClass : chipClass}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 複数選択 */
export function ChipMultiGroup({
  options,
  values,
  onChange,
}: {
  options: ChipOption[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = values.includes(o.code);
        return (
          <button
            key={o.code}
            type="button"
            onClick={() =>
              onChange(on ? values.filter((v) => v !== o.code) : [...values, o.code])
            }
            className={on ? chipMultiOnClass : chipClass}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
