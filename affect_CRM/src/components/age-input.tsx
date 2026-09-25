"use client";

// 来店時の年齢入力
//
// 基本は年代をタップするだけ。正確な年齢が分かるときだけ数字で入れられる。
// 年齢を入れたら年代は自動で決まる（年代と年齢が食い違った記録を作らない）。

import { ChipGroup } from "./chips";
import { inputClass, labelClass } from "./ui";
import { AGE_GROUPS, AGE_GROUP_LABELS } from "@/lib/constants";
import { ageToGroup } from "@/lib/utils/time";

// 「不明」は選ばない＝不明として扱うので、チップには出さない
const AGE_CHIP_OPTIONS = AGE_GROUPS.filter((code) => code !== "UNKNOWN").map((code) => ({
  code,
  label: AGE_GROUP_LABELS[code],
}));

export function AgeInput({
  label = "年齢",
  ageGroup,
  age,
  onChange,
}: {
  label?: string;
  ageGroup: string | null;
  /** 入力途中の値もそのまま持つため文字列 */
  age: string;
  onChange: (next: { ageGroup: string | null; age: string }) => void;
}) {
  return (
    <section className="border-b border-line py-4">
      <label className={labelClass}>{label}</label>
      <ChipGroup
        options={AGE_CHIP_OPTIONS}
        value={ageGroup}
        // 年代を選び直したら、合わなくなった年齢は消す
        onChange={(v) => {
          const n = Number(age);
          const keepAge = age !== "" && Number.isInteger(n) && v !== null && ageToGroup(n) === v;
          onChange({ ageGroup: v, age: keepAge ? age : "" });
        }}
      />
      <div className="mt-2.5 flex items-center gap-2">
        <input
          className={`${inputClass} w-24!`}
          inputMode="numeric"
          placeholder="正確な年齢"
          aria-label="正確な年齢"
          value={age}
          onChange={(e) => {
            // 全角数字もそのまま受け付ける
            const next = e.target.value
              .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
              .replace(/[^0-9]/g, "")
              .slice(0, 3);
            const n = Number(next);
            onChange({
              age: next,
              ageGroup: next !== "" && n <= 120 ? ageToGroup(n) : ageGroup,
            });
          }}
        />
        <span className="text-sm text-gray-soft">歳</span>
        <span className="text-xs text-gray-soft">正確な年齢が分かるときだけ</span>
      </div>
    </section>
  );
}
