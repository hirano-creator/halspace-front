"use client";

// ホームページからのスクール予約
//
// 枠一覧 → 入力 → 完了 の 3 ステップを 1 ページで進める。
// 表示するのは日付・時間・コース・定員・予約人数・残り人数。予約者の個人情報は一切出さない。

import { useEffect, useMemo, useState } from "react";
import { formatYen } from "@/lib/display";
import type { PublicReserveResult, PublicSession } from "./types";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function dateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}月${d}日（${dow}）`;
}

export default function ReservePage() {
  const [sessions, setSessions] = useState<PublicSession[] | null>(null);
  const [selected, setSelected] = useState<PublicSession | null>(null);
  const [done, setDone] = useState<PublicReserveResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/public/sessions")
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions: PublicSession[] }>) : Promise.reject(r)))
      .then((d) => setSessions(d.sessions))
      .catch(() => setLoadError("予約枠を読み込めませんでした。時間をおいてお試しください。"));
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, PublicSession[]>();
    for (const s of sessions ?? []) {
      (map.get(s.date) ?? map.set(s.date, []).get(s.date)!).push(s);
    }
    return [...map.entries()];
  }, [sessions]);

  if (done) {
    return (
      <div className="mx-auto max-w-[560px] px-6 py-16 text-center">
        <p className="text-[11px] tracking-[0.2em] text-accent">RESERVATION COMPLETED</p>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">ご予約を承りました</h1>
        <p className="mt-4 text-[14px] leading-relaxed text-gray-soft">
          この時点では<b className="text-ink">仮のお申し込み</b>です。
          <br />
          当日の海の状況を確認したうえで、店舗からご連絡し確定いたします。
        </p>
        <dl className="mt-8 divide-y divide-line border-y border-line text-left">
          <Row label="コース" value={done.courseName} />
          <Row label="日時" value={`${dateLabel(done.date)} ${done.startTime}`} />
          <Row label="人数" value={`${done.headcount} 名`} />
        </dl>
        <button
          type="button"
          onClick={() => {
            setDone(null);
            setSelected(null);
          }}
          className="mt-8 text-[13px] text-accent underline-offset-4 hover:underline"
        >
          予約枠の一覧に戻る
        </button>
      </div>
    );
  }

  if (selected) {
    return <ReserveForm session={selected} onBack={() => setSelected(null)} onDone={setDone} />;
  }

  return (
    <div className="mx-auto max-w-[860px] px-6 py-12">
      <p className="text-[11px] tracking-[0.2em] text-accent">SURF SCHOOL</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">スクールのご予約</h1>
      <p className="mt-4 max-w-[560px] text-[14px] leading-relaxed text-gray-soft">
        はじめての方から経験者の方まで、レベルに合わせてご案内します。
        ご希望の日程を選んでお進みください。
      </p>

      {loadError && <p className="mt-8 text-[13px] text-danger">{loadError}</p>}

      {!sessions && !loadError && (
        <p className="mt-12 text-center text-sm text-gray-soft">読み込んでいます…</p>
      )}

      {sessions && sessions.length === 0 && (
        <p className="mt-12 rounded-lg border border-dashed border-line px-6 py-10 text-center text-sm text-gray-soft">
          現在ご予約いただける枠がありません。
          <br />
          お手数ですが、店舗までお問い合わせください。
        </p>
      )}

      <div className="mt-10 space-y-10">
        {grouped.map(([date, items]) => (
          <section key={date}>
            <h2 className="border-b border-line pb-2 text-[15px] font-semibold">{dateLabel(date)}</h2>
            <ul className="divide-y divide-line">
              {items.map((s) => {
                const full = s.remaining === 0;
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-4 py-5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-3">
                        <span className="tabular text-lg font-semibold text-accent">
                          {s.startTime}
                        </span>
                        <span className="text-[15px] font-semibold">{s.courseName}</span>
                        <span className="tabular text-[13px] text-gray-soft">
                          {formatYen(s.price)}
                        </span>
                      </div>
                      {s.courseDescription && (
                        <p className="mt-1.5 text-[13px] leading-relaxed text-gray-soft">
                          {s.courseDescription}
                        </p>
                      )}
                      <p className="tabular mt-1.5 text-[12.5px] text-gray-soft">
                        定員 {s.capacity} 名／予約 {s.reserved} 名／
                        <span className={full ? "text-gray-faint" : "font-semibold text-accent"}>
                          残り {s.remaining} 名
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={full}
                      onClick={() => setSelected(s)}
                      className={`min-h-12 flex-none rounded-md px-6 text-[15px] font-semibold ${
                        full
                          ? "cursor-not-allowed bg-line-2 text-gray-faint"
                          : "bg-accent text-white hover:opacity-90"
                      }`}
                    >
                      {full ? "満席" : "予約する"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function ReserveForm({
  session,
  onBack,
  onDone,
}: {
  session: PublicSession;
  onBack: () => void;
  onDone: (r: PublicReserveResult) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [headcount, setHeadcount] = useState("1");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const field =
    "w-full min-h-12 rounded-md border border-line px-3.5 text-base text-ink placeholder:text-gray-faint focus:border-accent focus:outline-none";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("お名前を入力してください");
    if (!phone.trim() && !email.trim()) {
      return setError("電話番号かメールアドレスのどちらかを入力してください");
    }

    setPending(true);
    try {
      const body = new FormData();
      body.set("sessionId", session.id);
      body.set("name", name.trim());
      body.set("phone", phone.trim());
      body.set("email", email.trim());
      body.set("headcount", headcount);
      body.set("note", note.trim());

      const res = await fetch("/api/public/reservations", { method: "POST", body });
      const data = (await res.json().catch(() => null)) as
        | { reservation: PublicReserveResult }
        | { error: string }
        | null;

      if (!res.ok || !data || !("reservation" in data)) {
        setError((data && "error" in data && data.error) || "送信できませんでした");
        return;
      }
      onDone(data.reservation);
    } catch {
      setError("通信に失敗しました。もう一度お試しください");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-[560px] px-6 py-12">
      <button type="button" onClick={onBack} className="text-[13px] text-gray-soft hover:text-ink">
        ← 予約枠の一覧に戻る
      </button>

      <h1 className="mt-5 text-xl font-semibold tracking-tight sm:text-2xl">ご予約内容の入力</h1>

      <dl className="mt-6 divide-y divide-line border-y border-line">
        <Row label="コース" value={session.courseName} />
        <Row label="日時" value={`${dateLabel(session.date)} ${session.startTime}〜${session.endTime}`} />
        <Row label="料金" value={`${formatYen(session.price)}／名`} />
        <Row label="残り" value={`${session.remaining} 名`} />
      </dl>

      <form onSubmit={submit} className="mt-8 space-y-5">
        <div>
          <label className="mb-2 block text-[13px] font-semibold">
            お名前<span className="ml-2 text-[11px] font-normal text-accent">必須</span>
          </label>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <label className="mb-2 block text-[13px] font-semibold">電話番号</label>
          <input
            className={field}
            inputMode="tel"
            placeholder="090-1234-5678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-2 block text-[13px] font-semibold">メールアドレス</label>
          <input
            className={field}
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className="mt-1.5 text-[11.5px] text-gray-soft">
            電話番号かメールアドレスのどちらかをご入力ください。確定のご連絡に使用します。
          </p>
        </div>

        <div>
          <label className="mb-2 block text-[13px] font-semibold">人数</label>
          <select
            className={`${field} appearance-none bg-white`}
            value={headcount}
            onChange={(e) => setHeadcount(e.target.value)}
          >
            {Array.from({ length: Math.min(session.remaining, 10) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} 名
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-[13px] font-semibold">ご要望（任意）</label>
          <textarea
            className={`${field} min-h-[90px] py-3`}
            placeholder="サーフィン経験の有無、レンタルのご希望など"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-3.5 py-3 text-[13px] text-danger">{error}</p>
        )}

        <p className="rounded-md bg-accent-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-gray-soft">
          送信の時点では<b className="text-ink">仮のお申し込み</b>となります。
          当日の海の状況を確認したうえで、店舗からご連絡し確定いたします。
        </p>

        <button
          type="submit"
          disabled={pending}
          className="min-h-14 w-full rounded-md bg-accent text-base font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "送信しています…" : "この内容で予約する"}
        </button>
      </form>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-5 py-3.5 text-[14px]">
      <dt className="w-[72px] flex-none text-gray-soft">{label}</dt>
      <dd className="min-w-0 flex-1 font-medium">{value}</dd>
    </div>
  );
}
