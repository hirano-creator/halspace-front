"use client";

// 設定（管理者のみ）
//
// 選択肢は削除せず無効化する。code（分析の集計キー）は変更させず、
// 表示名だけ自由に変えられるようにしてある。表示名を変えても過去の集計は壊れない。

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiFetchJson } from "@/lib/auth/api-fetch";
import { useAuth } from "@/lib/auth/client";
import { MASTER_TYPES, MASTER_TYPE_LABELS, type MasterType } from "@/lib/constants";
import { Empty, buttonPrimaryClass, filterClass, inputClass } from "@/components/ui";
import type { MasterOptionRow, TagRow } from "./types";

export default function SettingsPage() {
  const { status } = useAuth();
  const [tab, setTab] = useState<"options" | "tags">("options");
  const [type, setType] = useState<MasterType>("VISIT_PURPOSE");
  const [options, setOptions] = useState<MasterOptionRow[] | null>(null);
  const [tags, setTags] = useState<TagRow[] | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (status !== "authenticated") return;
    apiFetchJson<{ options: MasterOptionRow[] }>("/api/master-options")
      .then((r) => setOptions(r.options))
      .catch((e: Error) => setError(e.message));
    apiFetchJson<{ tags: TagRow[] }>("/api/tags")
      .then((r) => setTags(r.tags))
      .catch(() => {});
  }, [status]);

  useEffect(load, [load]);

  async function addItem() {
    const label = newLabel.trim();
    if (!label) return;
    setError(null);

    const body = new FormData();
    body.set("label", label);
    body.set("name", label);
    if (tab === "options") body.set("type", type);

    const res = await apiFetch(tab === "options" ? "/api/master-options" : "/api/tags", {
      method: "POST",
      body,
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(j?.error ?? "追加できませんでした");
      return;
    }
    setNewLabel("");
    load();
  }

  async function rename(url: string, key: string, current: string) {
    const next = prompt("表示名を変更します", current);
    if (next === null || !next.trim() || next === current) return;
    const body = new FormData();
    body.set(key, next.trim());
    const res = await apiFetch(url, { method: "PATCH", body });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(j?.error ?? "変更できませんでした");
    }
    load();
  }

  async function toggle(url: string, isActive: boolean) {
    const body = new FormData();
    body.set("isActive", isActive ? "0" : "1");
    await apiFetch(url, { method: "PATCH", body });
    load();
  }

  const shown = (options ?? []).filter((o) => o.type === type);

  return (
    <div className="pb-10">
      <div className="px-5 pt-6 sm:px-8">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">設定</h1>
        <p className="mt-1.5 text-xs text-gray-soft sm:text-[13px]">
          選択肢は削除せず「使わない」に切り替えます。表示名を変えても、過去の記録の集計は壊れません。
        </p>
      </div>

      <div className="mt-4 flex gap-1 border-b border-line bg-card px-5 sm:px-8">
        {(
          [
            ["options", "選択肢"],
            ["tags", "顧客タグ"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`min-h-11 border-b-2 px-3 text-[13px] ${
              tab === k ? "border-accent font-semibold text-accent" : "border-transparent text-gray-soft"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "options" && (
        <div className="border-b border-line bg-card px-5 py-3 sm:px-8">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {MASTER_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={filterClass(type === t)}
              >
                {MASTER_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="px-5 py-3 text-[13px] text-danger sm:px-8">{error}</p>}

      {/* 追加 */}
      <div className="border-b border-line bg-card px-5 py-4 sm:px-8">
        <div className="flex gap-2">
          <input
            className={inputClass}
            placeholder={tab === "options" ? `${MASTER_TYPE_LABELS[type]}に追加する項目` : "タグ名"}
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addItem();
            }}
          />
          <button type="button" onClick={addItem} className={`${buttonPrimaryClass} flex-none`}>
            追加
          </button>
        </div>
      </div>

      {tab === "options" ? (
        !options ? (
          <Empty>読み込んでいます…</Empty>
        ) : shown.length === 0 ? (
          <Empty>この種別の選択肢はまだありません</Empty>
        ) : (
          <ul className="border-b border-line bg-card">
            {shown.map((o) => (
              <li
                key={o.id}
                className={`flex items-center justify-between gap-3 border-b border-line-2 px-5 py-3 last:border-b-0 sm:px-8 ${
                  o.isActive ? "" : "opacity-50"
                }`}
              >
                <div className="min-w-0">
                  <span className="text-[14px]">{o.label}</span>
                  <span className="tabular ml-2 text-[10.5px] text-gray-faint">{o.code}</span>
                  {!o.isActive && (
                    <span className="ml-2 rounded-sm bg-line-2 px-1.5 py-0.5 text-[10px] text-gray-soft">
                      使わない
                    </span>
                  )}
                </div>
                <div className="flex flex-none gap-2">
                  <button
                    type="button"
                    onClick={() => rename(`/api/master-options/${o.id}`, "label", o.label)}
                    className="min-h-10 px-2 text-[12.5px] text-accent"
                  >
                    表示名を変更
                  </button>
                  <button
                    type="button"
                    onClick={() => toggle(`/api/master-options/${o.id}`, o.isActive)}
                    className="min-h-10 px-2 text-[12.5px] text-gray-soft"
                  >
                    {o.isActive ? "使わない" : "使う"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : !tags ? (
        <Empty>読み込んでいます…</Empty>
      ) : (
        <ul className="border-b border-line bg-card">
          {tags.map((t) => (
            <li
              key={t.id}
              className={`flex items-center justify-between gap-3 border-b border-line-2 px-5 py-3 last:border-b-0 sm:px-8 ${
                t.isActive ? "" : "opacity-50"
              }`}
            >
              <div className="min-w-0">
                <span
                  className="inline-block rounded-sm px-1.5 py-0.5 text-[12px]"
                  style={{
                    backgroundColor: t.color ? `${t.color}1a` : "var(--accent-soft)",
                    color: t.color ?? "var(--accent)",
                  }}
                >
                  {t.name}
                </span>
                <span className="tabular ml-2 text-[11px] text-gray-soft">{t.customerCount} 名</span>
              </div>
              <div className="flex flex-none gap-2">
                <button
                  type="button"
                  onClick={() => rename(`/api/tags/${t.id}`, "name", t.name)}
                  className="min-h-10 px-2 text-[12.5px] text-accent"
                >
                  名前を変更
                </button>
                <button
                  type="button"
                  onClick={() => toggle(`/api/tags/${t.id}`, t.isActive)}
                  className="min-h-10 px-2 text-[12.5px] text-gray-soft"
                >
                  {t.isActive ? "使わない" : "使う"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
