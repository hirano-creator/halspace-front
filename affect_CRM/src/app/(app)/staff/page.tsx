"use client";

// スタッフ管理（管理者のみ）
//
// 退職者は削除せず無効化する。過去の来店・購入の担当者表示を守るため。

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiFetchJson } from "@/lib/auth/api-fetch";
import { useAuth } from "@/lib/auth/client";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import {
  Empty,
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
  labelClass,
} from "@/components/ui";
import type { StaffItem, StaffListResponse } from "./types";

export default function StaffPage() {
  const { status } = useAuth();
  const [data, setData] = useState<StaffListResponse | null>(null);
  const [editing, setEditing] = useState<StaffItem | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (status !== "authenticated") return;
    apiFetchJson<StaffListResponse>("/api/staff")
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [status]);

  useEffect(load, [load]);

  async function toggleActive(s: StaffItem) {
    const label = s.isActive ? "無効" : "有効";
    if (!confirm(`${s.name} さんを${label}にします。よろしいですか？`)) return;
    const body = new FormData();
    body.set("isActive", s.isActive ? "0" : "1");
    const res = await apiFetch(`/api/staff/${s.id}`, { method: "PATCH", body });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(j?.error ?? "変更できませんでした");
    }
    load();
  }

  async function removeStaff(s: StaffItem) {
    if (!confirm(`${s.name} さんを削除します。よろしいですか？\n（元に戻せません）`)) return;
    const res = await apiFetch(`/api/staff/${s.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(j?.error ?? "削除できませんでした");
      return;
    }
    load();
  }

  return (
    <div className="pb-10">
      <div className="flex items-start justify-between gap-3 px-5 pt-6 sm:px-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">スタッフ管理</h1>
          <p className="mt-1.5 text-xs text-gray-soft sm:text-[13px]">
            退職された方は削除せず「無効」にしてください（過去の記録の担当者表示が残ります）
          </p>
        </div>
        <button type="button" onClick={() => setEditing("new")} className={buttonPrimaryClass}>
          ＋ スタッフ追加
        </button>
      </div>

      {error && <p className="px-5 py-3 text-[13px] text-danger sm:px-8">{error}</p>}

      {!data ? (
        <Empty>読み込んでいます…</Empty>
      ) : (
        <div className="mt-4 border-y border-line bg-card">
          {data.staffs.map((s) => (
            <div
              key={s.id}
              className={`flex flex-wrap items-center justify-between gap-3 border-b border-line-2 px-5 py-4 last:border-b-0 sm:px-8 ${
                s.isActive ? "" : "opacity-55"
              }`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[15px] font-semibold">{s.name}</span>
                  {s.nameKana && <span className="text-[11px] text-gray-faint">{s.nameKana}</span>}
                  <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[10.5px] text-accent">
                    {ROLE_LABELS[s.role as Role] ?? s.role}
                  </span>
                  {s.isSelf && <span className="text-[11px] text-gray-faint">（自分）</span>}
                  {!s.isActive && (
                    <span className="rounded-sm bg-line-2 px-1.5 py-0.5 text-[10.5px] text-gray-soft">
                      無効
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[12.5px] text-gray-soft">{s.email}</p>
              </div>
              <div className="flex flex-none gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(s)}
                  className={`${buttonSecondaryClass} text-[13px]`}
                >
                  編集
                </button>
                {!s.isSelf && (
                  <button
                    type="button"
                    onClick={() => toggleActive(s)}
                    className={`${buttonSecondaryClass} text-[13px] ${s.isActive ? "text-danger" : ""}`}
                  >
                    {s.isActive ? "無効にする" : "有効にする"}
                  </button>
                )}
                {!s.isSelf && (
                  <button
                    type="button"
                    onClick={() => removeStaff(s)}
                    className={`${buttonSecondaryClass} text-[13px] text-danger`}
                  >
                    削除
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <StaffDialog
          staff={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function StaffDialog({
  staff,
  onClose,
  onSaved,
}: {
  staff: StaffItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(staff?.name ?? "");
  const [nameKana, setNameKana] = useState(staff?.nameKana ?? "");
  const [email, setEmail] = useState(staff?.email ?? "");
  const [role, setRole] = useState<string>(staff?.role ?? "STAFF");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    setError(null);
    if (!name.trim()) return setError("氏名を入力してください");
    if (!email.trim()) return setError("メールアドレスを入力してください");
    if (!staff && password.length < 8) {
      return setError("パスワードは 8 文字以上で設定してください");
    }
    if (staff && password && password.length < 8) {
      return setError("パスワードは 8 文字以上で設定してください");
    }

    setPending(true);
    try {
      const body = new FormData();
      body.set("name", name.trim());
      body.set("nameKana", nameKana.trim());
      body.set("email", email.trim());
      body.set("role", role);
      if (!staff) {
        body.set("password", password);
      } else if (password) {
        body.set("password", password);
      }

      const res = await apiFetch(staff ? `/api/staff/${staff.id}` : "/api/staff", {
        method: staff ? "PATCH" : "POST",
        body,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error ?? "保存できませんでした");
        return;
      }
      onSaved();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="max-h-[86vh] w-full max-w-[420px] overflow-y-auto rounded-lg bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{staff ? "スタッフの編集" : "スタッフ追加"}</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-xl text-gray-soft">
            ×
          </button>
        </div>

        <div className="py-3">
          <label className={labelClass}>
            氏名<span className="ml-1.5 text-[10.5px] font-normal text-accent">必須</span>
          </label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="py-3">
          <label className={labelClass}>フリガナ</label>
          <input
            className={inputClass}
            placeholder="ヤマダ タロウ"
            value={nameKana}
            onChange={(e) => setNameKana(e.target.value)}
          />
        </div>

        <div className="py-3">
          <label className={labelClass}>
            メールアドレス（ログイン ID）
            <span className="ml-1.5 text-[10.5px] font-normal text-accent">必須</span>
          </label>
          <input
            className={inputClass}
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {staff && (
            <p className="mt-1.5 text-[11px] text-gray-soft">
              変更すると、次回ログインからは新しいメールアドレスを使います
            </p>
          )}
        </div>

        <div className="py-3">
          <label className={labelClass}>
            {staff ? "パスワードを変更する場合のみ入力" : "パスワード"}
            {!staff && <span className="ml-1.5 text-[10.5px] font-normal text-accent">必須</span>}
          </label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              className={`${inputClass} pr-16`}
              placeholder="8 文字以上"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-gray-soft hover:text-ink"
            >
              {showPassword ? "隠す" : "表示"}
            </button>
          </div>
        </div>

        <div className="py-3">
          <label className={labelClass}>権限</label>
          <div className="grid grid-cols-2 gap-2">
            {(["STAFF", "ADMIN"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                disabled={staff?.isSelf}
                className={`min-h-11 rounded-md border text-sm font-semibold disabled:opacity-50 ${
                  role === r ? "border-navy bg-navy text-white" : "border-line bg-card text-ink-2"
                }`}
              >
                {ROLE_LABELS[r]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-gray-soft">
            管理者は顧客の削除・マスタ編集・スタッフ管理・設定ができます。
            {staff?.isSelf && "自分自身の権限は変更できません。"}
          </p>
        </div>

        {error && <p className="mt-1 text-[13px] font-medium text-danger">{error}</p>}

        <div className="mt-4 flex gap-2.5">
          <button type="button" onClick={onClose} className={`${buttonSecondaryClass} flex-1`}>
            キャンセル
          </button>
          <button type="button" onClick={save} disabled={pending} className={`${buttonPrimaryClass} flex-1`}>
            {pending ? "保存しています…" : "保存する"}
          </button>
        </div>
      </div>
    </div>
  );
}
