"use client";

// 匿名グループの「お一人ずつの内訳」入力
//
// 既定は今まで通りグループ代表の年代・性別 1 組だけ。
// 2人以上のグループで年代・性別が一様でないときだけ、この内訳入力を開く。
// 開いた瞬間はグループの代表値で全員分を埋めるので、違う人だけ変更すればよい
// （同質なグループなら追加のタップは発生しない）。

import { AGE_GROUPS, AGE_GROUP_LABELS } from "@/lib/constants";
import { ChipGroup } from "./chips";
import { buttonSecondaryClass } from "./ui";
import type { GuestBreakdownRow } from "@/app/(app)/visits/types";

const AGE_OPTIONS = AGE_GROUPS.map((code) => ({ code, label: AGE_GROUP_LABELS[code] }));
const GENDER_OPTIONS = [
  { code: "MALE", label: "男性" },
  { code: "FEMALE", label: "女性" },
  { code: "UNKNOWN", label: "不明" },
];

export function GuestBreakdownEditor({
  rows,
  onChange,
  groupAgeGroup,
  groupGender,
}: {
  rows: GuestBreakdownRow[];
  onChange: (rows: GuestBreakdownRow[]) => void;
  groupAgeGroup: string | null;
  groupGender: string | null;
}) {
  const open = rows.length > 0;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() =>
          onChange([
            { ageGroup: groupAgeGroup, gender: groupGender },
            { ageGroup: groupAgeGroup, gender: groupGender },
          ])
        }
        className="mt-1 inline-flex items-center py-1.5 text-[12.5px] text-accent hover:underline"
      >
        お一人ずつ分けて入力する
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2.5">
      {rows.map((row, i) => (
        <div key={i} className="rounded-md border border-line p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-semibold text-gray-soft">{i + 1}人目</span>
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
              className="py-1 text-[12px] text-danger"
            >
              削除
            </button>
          </div>
          <div className="mt-2">
            <ChipGroup
              options={AGE_OPTIONS}
              value={row.ageGroup}
              onChange={(v) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ageGroup: v } : r)))}
            />
          </div>
          <div className="mt-2">
            <ChipGroup
              options={GENDER_OPTIONS}
              value={row.gender}
              onChange={(v) => onChange(rows.map((r, idx) => (idx === i ? { ...r, gender: v } : r)))}
            />
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onChange([...rows, { ageGroup: groupAgeGroup, gender: groupGender }])}
          className="inline-flex items-center py-1.5 text-[12.5px] text-accent hover:underline"
        >
          ＋ もう一人追加
        </button>
        <button
          type="button"
          onClick={() => onChange([])}
          className={`${buttonSecondaryClass} h-auto min-h-9 px-2.5 text-[12px]`}
        >
          まとめて入力に戻す
        </button>
      </div>
    </div>
  );
}
