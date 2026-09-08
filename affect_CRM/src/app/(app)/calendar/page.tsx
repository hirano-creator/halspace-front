"use client";

// 予約カレンダー（月／週／日）
//
// 外部のカレンダーライブラリは使わず自前で組む。バンドルを軽く保ち、
// 運用コスト 0 円の方針を崩さないため。

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, apiFetchJson } from "@/lib/auth/api-fetch";
import { useAuth } from "@/lib/auth/client";
import { can } from "@/lib/auth/roles";
import { RESERVATION_STATUS_LABELS } from "@/lib/constants";
import { formatJstDate } from "@/lib/utils/time";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  filterClass,
  inputClass,
  labelClass,
} from "@/components/ui";
import type { CalendarResponse, SessionItem } from "../schools/types";
import type { CustomerSuggestion } from "../visits/types";

type View = "month" | "week" | "day";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** JST の日付文字列 "2026-09-05" を足し引きする */
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return formatJstDate(new Date(Date.UTC(y, m - 1, d + days) - 9 * 60 * 60 * 1000));
}

function rangeOf(view: View, anchor: string): { from: string; to: string } {
  const [y, m, d] = anchor.split("-").map(Number);
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "week") {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const from = shiftDate(anchor, -dow);
    return { from, to: shiftDate(from, 6) };
  }
  // 月表示は前後の空白を含めた 6 週間分
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const from = formatJstDate(new Date(Date.UTC(y, m - 1, 1 - firstDow) - 9 * 60 * 60 * 1000));
  return { from, to: shiftDate(from, 41) };
}

export default function CalendarPage() {
  const { user, status } = useAuth();
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(() => formatJstDate(new Date()));
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [sessionForm, setSessionForm] = useState<{ date: string } | null>(null);
  const [reserveFor, setReserveFor] = useState<SessionItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => rangeOf(view, anchor), [view, anchor]);
  const today = formatJstDate(new Date());

  const load = useCallback(() => {
    if (status !== "authenticated") return;
    apiFetchJson<CalendarResponse>(`/api/calendar?from=${range.from}&to=${range.to}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [status, range.from, range.to]);

  useEffect(load, [load]);

  const byDate = useMemo(() => {
    const map = new Map<string, SessionItem[]>();
    for (const s of data?.sessions ?? []) {
      (map.get(s.date) ?? map.set(s.date, []).get(s.date)!).push(s);
    }
    return map;
  }, [data]);

  const days = useMemo(() => {
    const out: string[] = [];
    let cur = range.from;
    while (cur <= range.to) {
      out.push(cur);
      cur = shiftDate(cur, 1);
    }
    return out;
  }, [range]);

  const canDelete = user ? can(user.role, "data.delete") : false;

  /** 予約が入っている枠は API 側で拒否される。中止にしたい場合はステータスを使う */
  async function removeSession(s: SessionItem) {
    if (!confirm(`${s.date} ${s.startTime} の「${s.courseName}」の枠を削除します。よろしいですか？`)) {
      return;
    }
    const res = await apiFetch(`/api/schools/sessions/${s.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(j?.error ?? "削除できませんでした");
      return;
    }
    load();
  }

  const move = (dir: 1 | -1) => {
    if (view === "day") setAnchor((a) => shiftDate(a, dir));
    else if (view === "week") setAnchor((a) => shiftDate(a, dir * 7));
    else {
      const [y, m] = anchor.split("-").map(Number);
      setAnchor(formatJstDate(new Date(Date.UTC(y, m - 1 + dir, 1) - 9 * 60 * 60 * 1000)));
    }
  };

  const title = (() => {
    const [y, m, d] = anchor.split("-").map(Number);
    if (view === "month") return `${y}年${m}月`;
    if (view === "week") return `${range.from} 〜 ${range.to}`;
    const dow = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    return `${y}年${m}月${d}日（${dow}）`;
  })();

  return (
    <div className="pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-6 sm:px-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">予約カレンダー</h1>
          <p className="mt-1.5 text-xs text-gray-soft sm:text-[13px]">
            ここで作った枠が、そのままホームページの予約枠になります
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSessionForm({ date: selectedDate ?? today })}
          className={buttonPrimaryClass}
        >
          ＋ 枠を作る
        </button>
      </div>

      {/* 表示切替 */}
      <div className="mt-4 flex items-center justify-between gap-3 border-y border-line bg-card px-5 py-3 sm:px-8">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => move(-1)} className="min-h-10 px-3 text-gray-soft">
            ←
          </button>
          <span className="min-w-[132px] text-center text-sm font-semibold">{title}</span>
          <button type="button" onClick={() => move(1)} className="min-h-10 px-3 text-gray-soft">
            →
          </button>
          <button
            type="button"
            onClick={() => setAnchor(today)}
            className="ml-1 min-h-10 px-2 text-[12.5px] text-accent"
          >
            今日
          </button>
        </div>
        <div className="flex gap-1">
          {(["month", "week", "day"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={filterClass(view === v)}
            >
              {v === "month" ? "月" : v === "week" ? "週" : "日"}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="px-5 py-3 text-[13px] text-danger sm:px-8">{error}</p>}

      {/* 月表示 */}
      {view === "month" && (
        <div className="border-b border-line bg-card">
          <div className="grid grid-cols-7 border-b border-line-2">
            {WEEKDAYS.map((w) => (
              <div key={w} className="px-1 py-2 text-center text-[11px] text-gray-soft">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const sessions = byDate.get(d) ?? [];
              const inMonth = d.slice(0, 7) === anchor.slice(0, 7);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setSelectedDate(d);
                    setAnchor(d);
                    setView("day");
                  }}
                  className={`min-h-[86px] border-r border-b border-line-2 p-1.5 text-left last:border-r-0 ${
                    inMonth ? "" : "bg-bg"
                  }`}
                >
                  <span
                    className={`tabular text-[11px] ${
                      d === today
                        ? "rounded bg-accent px-1.5 py-0.5 font-semibold text-white"
                        : inMonth
                          ? "text-ink-2"
                          : "text-gray-faint"
                    }`}
                  >
                    {Number(d.slice(8))}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {sessions.slice(0, 3).map((s) => (
                      <div
                        key={s.id}
                        className={`truncate rounded px-1 py-0.5 text-[10px] ${
                          s.remaining === 0
                            ? "bg-line-2 text-gray-soft"
                            : "bg-accent-soft text-accent"
                        }`}
                      >
                        {s.startTime} {s.courseName}
                      </div>
                    ))}
                    {sessions.length > 3 && (
                      <div className="px-1 text-[10px] text-gray-faint">ほか {sessions.length - 3} 件</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 週・日表示 */}
      {view !== "month" && (
        <div className="border-b border-line bg-card">
          {days.map((d) => {
            const sessions = byDate.get(d) ?? [];
            const [y, m, dd] = d.split("-").map(Number);
            const dow = WEEKDAYS[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
            return (
              <div key={d} className="border-b border-line-2 last:border-b-0">
                <div className="flex items-center justify-between bg-bg px-5 py-2 sm:px-8">
                  <span className="tabular text-[13px] font-semibold">
                    {m}/{dd}（{dow}）{d === today && <span className="ml-2 text-accent">今日</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSessionForm({ date: d })}
                    className="text-[12.5px] text-accent"
                  >
                    ＋ この日に枠を作る
                  </button>
                </div>
                {sessions.length === 0 ? (
                  <p className="px-5 py-4 text-[13px] text-gray-faint sm:px-8">枠がありません</p>
                ) : (
                  <ul className="divide-y divide-line-2">
                    {sessions.map((s) => (
                      <li key={s.id} className="px-5 py-3.5 sm:px-8">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="tabular text-[13px] font-semibold text-navy">
                              {s.startTime}〜{s.endTime}
                            </span>
                            <span className="ml-2 text-[15px] font-semibold">{s.courseName}</span>
                            <p className="mt-1 text-[11.5px] text-gray-soft">
                              定員 {s.capacity} 名／予約 {s.reserved} 名／
                              <span className={s.remaining === 0 ? "text-danger" : "font-semibold text-accent"}>
                                残り {s.remaining} 名
                              </span>
                              {s.staffName && `／担当 ${s.staffName}`}
                              {!s.isPublished && "／非公開"}
                              {s.status === "CANCELLED" && "／中止"}
                            </p>
                          </div>
                          <div className="flex flex-none items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setReserveFor(s)}
                              disabled={s.remaining === 0}
                              className={`${buttonSecondaryClass} text-[13px] disabled:opacity-40`}
                            >
                              ＋ 予約
                            </button>
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => removeSession(s)}
                                className="min-h-10 px-2 text-[12.5px] text-danger hover:underline"
                              >
                                枠を削除
                              </button>
                            )}
                          </div>
                        </div>

                        {s.reservations.length > 0 && (
                          <ul className="mt-2.5 divide-y divide-line-2 rounded-md border border-line">
                            {s.reservations.map((r) => (
                              <li
                                key={r.id}
                                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                              >
                                <span className="text-[13px]">
                                  {r.customerName}
                                  {r.headcount > 1 && ` ほか ${r.headcount - 1} 名`}
                                  {r.source === "WEB" && (
                                    <span className="ml-1.5 rounded-sm bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">
                                      Web
                                    </span>
                                  )}
                                </span>
                                <select
                                  aria-label="予約ステータス"
                                  className="min-h-9 rounded-md border border-line bg-card px-2 text-[12.5px]"
                                  value={r.status}
                                  onChange={async (e) => {
                                    const body = new FormData();
                                    body.set("status", e.target.value);
                                    const res = await apiFetch(`/api/reservations/${r.id}`, {
                                      method: "PATCH",
                                      body,
                                    });
                                    if (!res.ok) {
                                      const j = (await res.json().catch(() => null)) as { error?: string } | null;
                                      setError(j?.error ?? "変更できませんでした");
                                    }
                                    load();
                                  }}
                                >
                                  {Object.entries(RESERVATION_STATUS_LABELS).map(([k, v]) => (
                                    <option key={k} value={k}>
                                      {v}
                                    </option>
                                  ))}
                                </select>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {sessionForm && data && (
        <SessionDialog
          date={sessionForm.date}
          courses={data.courses}
          staffs={data.staffs}
          onClose={() => setSessionForm(null)}
          onSaved={() => {
            setSessionForm(null);
            load();
          }}
        />
      )}

      {reserveFor && (
        <ReserveDialog
          session={reserveFor}
          onClose={() => setReserveFor(null)}
          onSaved={() => {
            setReserveFor(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/** 開催枠を作るダイアログ */
function SessionDialog({
  date,
  courses,
  staffs,
  onClose,
  onSaved,
}: {
  date: string;
  courses: CalendarResponse["courses"];
  staffs: CalendarResponse["staffs"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [day, setDay] = useState(date);
  const [startTime, setStartTime] = useState("09:00");
  const [capacity, setCapacity] = useState(String(courses[0]?.capacity ?? 5));
  const [staffId, setStaffId] = useState("");
  const [isPublished, setIsPublished] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    setError(null);
    if (!courseId) return setError("コースを選んでください");
    setPending(true);
    try {
      const body = new FormData();
      body.set("courseId", courseId);
      body.set("date", day);
      body.set("startTime", startTime);
      body.set("capacity", capacity);
      if (staffId) body.set("staffId", staffId);
      body.set("isPublished", isPublished ? "1" : "0");
      const res = await apiFetch("/api/schools/sessions", { method: "POST", body });
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
    <Dialog title="予約枠を作る" onClose={onClose}>
      {courses.length === 0 ? (
        <p className="text-[13px] text-gray-soft">
          先に「スクール」でコースを登録してください。
        </p>
      ) : (
        <>
          <div className="py-3">
            <label className={labelClass}>コース</label>
            <select
              className={`${inputClass} appearance-none`}
              value={courseId}
              onChange={(e) => {
                setCourseId(e.target.value);
                const c = courses.find((x) => x.id === e.target.value);
                if (c) setCapacity(String(c.capacity));
              }}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2 py-3">
            <div>
              <label className={labelClass}>開催日</label>
              <input type="date" className={inputClass} value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>開始時間</label>
              <input
                type="time"
                className={inputClass}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 py-3">
            <div>
              <label className={labelClass}>定員</label>
              <input
                className={inputClass}
                inputMode="numeric"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>担当スタッフ</label>
              <select
                className={`${inputClass} appearance-none`}
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
              >
                <option value="">未定</option>
                {staffs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex min-h-11 items-center gap-2.5 py-1 text-[13px]">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
            />
            ホームページの予約ページに出す
          </label>
          {error && <p className="mt-2 text-[13px] font-medium text-danger">{error}</p>}
          <div className="mt-4 flex gap-2.5">
            <button type="button" onClick={onClose} className={`${buttonSecondaryClass} flex-1`}>
              キャンセル
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className={`${buttonPrimaryClass} flex-1`}
            >
              {pending ? "保存しています…" : "保存する"}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

/** 店舗側から予約を入れるダイアログ */
function ReserveDialog({
  session,
  onClose,
  onSaved,
}: {
  session: SessionItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CustomerSuggestion[]>([]);
  const [customer, setCustomer] = useState<CustomerSuggestion | null>(null);
  const [headcount, setHeadcount] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      apiFetchJson<{ customers: CustomerSuggestion[] }>(
        `/api/customers/search?q=${encodeURIComponent(query)}`,
      )
        .then((r) => {
          if (!cancelled) setSuggestions(r.customers);
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  async function save() {
    setError(null);
    if (!customer) return setError("顧客を選んでください");
    setPending(true);
    try {
      const body = new FormData();
      body.set("sessionId", session.id);
      body.set("customerId", customer.id);
      body.set("headcount", headcount);
      const res = await apiFetch("/api/reservations", { method: "POST", body });
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
    <Dialog title="予約を入れる" onClose={onClose}>
      <p className="text-[13px] text-gray-soft">
        {session.date} {session.startTime}／{session.courseName}／残り {session.remaining} 名
      </p>

      <div className="py-3">
        <label className={labelClass}>顧客</label>
        {customer ? (
          <div className="flex min-h-11 items-center justify-between rounded-md border border-accent px-3">
            <span className="font-semibold">{customer.name}</span>
            <button type="button" onClick={() => setCustomer(null)} className="text-[12.5px] text-accent">
              変更
            </button>
          </div>
        ) : (
          <>
            <input
              className={inputClass}
              placeholder="名前・電話番号で検索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul className="mt-2 max-h-52 overflow-y-auto rounded-md border border-line">
              {suggestions.length === 0 && (
                <li className="px-3 py-3 text-center text-[13px] text-gray-soft">
                  該当する顧客がいません
                </li>
              )}
              {suggestions.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setCustomer(c)}
                    className="w-full border-b border-line-2 px-3 py-2.5 text-left text-[13px] last:border-b-0 hover:bg-bg"
                  >
                    {c.name}
                    <span className="ml-2 text-[11px] text-gray-soft">{c.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="py-3">
        <label className={labelClass}>人数</label>
        <input
          className={inputClass}
          inputMode="numeric"
          value={headcount}
          onChange={(e) => setHeadcount(e.target.value)}
        />
      </div>

      {error && <p className="mt-1 text-[13px] font-medium text-danger">{error}</p>}
      <div className="mt-4 flex gap-2.5">
        <button type="button" onClick={onClose} className={`${buttonSecondaryClass} flex-1`}>
          キャンセル
        </button>
        <button type="button" onClick={save} disabled={pending} className={`${buttonPrimaryClass} flex-1`}>
          {pending ? "保存しています…" : "予約する"}
        </button>
      </div>
    </Dialog>
  );
}

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="max-h-[86vh] w-full max-w-[460px] overflow-y-auto rounded-lg bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-xl text-gray-soft">
            ×
          </button>
        </div>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}
