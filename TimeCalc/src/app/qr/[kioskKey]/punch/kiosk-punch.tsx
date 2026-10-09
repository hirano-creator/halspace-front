"use client";

// スマホ忘れ打刻のステップ画面（店舗タブレット用）
// スタッフ選択 → 状態確認・打刻種別の選択 → 前面カメラで撮影（3秒カウント）→ 結果表示
// 共用端末なので、結果表示や放置のあとは自動で最初の画面に戻し、前の人の状態を残さない。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CLOCK_EVENT_LABELS, type ClockEventType } from "@/lib/attendance/clock";
import { inputClass } from "@/components/ui";
import { BigClock } from "@/components/qr/big-clock";
import type { KioskPunchResponse, KioskStaff, KioskStaffResponse, KioskStatusResponse } from "./types";

type Step =
  | { kind: "select" }
  | { kind: "confirm"; staff: KioskStaff; status: KioskStatusResponse }
  | { kind: "camera"; staff: KioskStaff; type: ClockEventType; count: number }
  | { kind: "sending"; staff: KioskStaff; type: ClockEventType }
  | { kind: "result"; staff: KioskStaff; type: ClockEventType; result: KioskPunchResponse };

/** 結果表示から最初の画面へ戻るまで（ms） */
const RESULT_RESET_MS = 5_000;
/** 確認画面で操作がないとき最初の画面へ戻るまで（ms） */
const IDLE_RESET_MS = 30_000;
const COUNTDOWN_SECONDS = 3;
/** 撮影画像の長辺（px）。顔が判別できれば十分なので小さくして通信量を抑える */
const PHOTO_MAX_SIDE = 480;
const PHOTO_MAX_BYTES = 300 * 1024;

const PHASE_LABELS: Record<KioskStatusResponse["phase"], string> = {
  beforeWork: "勤務前",
  working: "勤務中",
  outing: "外出中",
  offWork: "退勤済み",
};

/** 打刻種別ごとの色（ボタンと、撮影以降の色面）。QR掲示画面の色分けと揃える */
const TYPE_COLORS: Record<ClockEventType, string> = {
  IN: "#059669",
  OUT: "#5b4ee6",
  OUT_START: "#d97706",
  OUT_END: "#0284c7",
};
const TYPE_HINTS: Record<ClockEventType, string> = {
  IN: "これから勤務を始める",
  OUT: "今日の勤務を終える",
  OUT_START: "勤務時間から差し引かれます",
  OUT_END: "外出から戻った",
};
/** 名前選択・打刻内容の選択中の色面 */
const NEUTRAL_PANEL = "#1f2937";
const STEP_LABELS = ["名前を選ぶ", "打刻内容を選ぶ", "顔写真を撮影", "完了"] as const;

function stepNumber(step: Step): number {
  switch (step.kind) {
    case "select":
      return 1;
    case "confirm":
      return 2;
    case "camera":
    case "sending":
      return 3;
    case "result":
      return 4;
  }
}

function panelColor(step: Step): string {
  switch (step.kind) {
    case "camera":
    case "sending":
      return TYPE_COLORS[step.type];
    case "result":
      return step.result.success ? TYPE_COLORS[step.type] : "#b91c1c";
    default:
      return NEUTRAL_PANEL;
  }
}

function captureJpeg(video: HTMLVideoElement): Promise<Blob | null> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return Promise.resolve(null);
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const toBlob = (quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  return toBlob(0.7).then((blob) => (blob && blob.size > PHOTO_MAX_BYTES ? toBlob(0.4) : blob));
}

export function KioskPunch({ kioskKey, departmentName }: { kioskKey: string; departmentName: string }) {
  const [staff, setStaff] = useState<KioskStaff[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"home" | "other">("home");
  const [filter, setFilter] = useState("");
  const [step, setStep] = useState<Step>({ kind: "select" });
  const [message, setMessage] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const api = `/api/kiosk/${kioskKey}`;

  useEffect(() => {
    fetch(`${api}/staff`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "スタッフ一覧を読み込めませんでした");
        setStaff((body as KioskStaffResponse).staff);
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : "スタッフ一覧を読み込めませんでした"));
  }, [api]);

  const stopCamera = useCallback(() => {
    if (countdownRef.current !== null) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  const reset = useCallback(() => {
    stopCamera();
    setStep({ kind: "select" });
    setFilter("");
    setTab("home");
  }, [stopCamera]);

  // 画面を離れたらカメラを止める
  useEffect(() => stopCamera, [stopCamera]);

  // 結果表示・確認画面の放置から最初の画面へ戻す
  useEffect(() => {
    if (step.kind !== "result" && step.kind !== "confirm") return;
    const timer = setTimeout(reset, step.kind === "result" ? RESULT_RESET_MS : IDLE_RESET_MS);
    return () => clearTimeout(timer);
  }, [step, reset]);

  async function selectStaff(s: KioskStaff) {
    setMessage(null);
    try {
      const res = await fetch(`${api}/status?userId=${encodeURIComponent(s.id)}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body.error ?? "状態を取得できませんでした");
        return;
      }
      setStep({ kind: "confirm", staff: s, status: body as KioskStatusResponse });
    } catch {
      setMessage("通信に失敗しました。もう一度お試しください");
    }
  }

  async function send(s: KioskStaff, type: ClockEventType, photo: Blob) {
    setStep({ kind: "sending", staff: s, type });
    const form = new FormData();
    form.set("userId", s.id);
    form.set("type", type);
    form.set("photo", photo, "photo.jpg");
    let result: KioskPunchResponse;
    try {
      const res = await fetch(`${api}/punch`, { method: "POST", body: form });
      result = (await res.json()) as KioskPunchResponse;
      if (!result.error && !result.success) result = { ...result, error: "打刻に失敗しました" };
    } catch {
      result = {
        error: "通信に失敗しました。打刻されていない可能性があります",
        success: false,
        punchedLabel: null,
        punchedTime: null,
        lateMinutes: 0,
        photoFailed: false,
      };
    }
    setStep({ kind: "result", staff: s, type, result });
  }

  async function startCamera(s: KioskStaff, type: ClockEventType) {
    setMessage(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("この端末ではカメラを使えません。後日マイページから修正申請をしてください");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "user" } },
        audio: false,
      });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setMessage(
        name === "NotAllowedError"
          ? "カメラの利用が許可されていません。店舗の管理者に端末の設定を確認してもらってください"
          : "カメラを起動できませんでした",
      );
      return;
    }
    streamRef.current = stream;
    setStep({ kind: "camera", staff: s, type, count: COUNTDOWN_SECONDS });

    let remaining = COUNTDOWN_SECONDS;
    countdownRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        setStep({ kind: "camera", staff: s, type, count: remaining });
        return;
      }
      if (countdownRef.current !== null) clearInterval(countdownRef.current);
      countdownRef.current = null;
      const video = videoRef.current;
      void (video ? captureJpeg(video) : Promise.resolve(null)).then((blob) => {
        stopCamera();
        if (!blob) {
          setStep({ kind: "select" });
          setMessage("撮影できませんでした。もう一度お試しください");
          return;
        }
        void send(s, type, blob);
      });
    }, 1000);
  }

  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      void el.play().catch(() => {});
    }
  }, []);

  const visibleStaff = useMemo(() => {
    if (!staff) return [];
    const q = tab === "other" ? filter.trim() : "";
    return staff.filter(
      (s) => (tab === "home" ? s.home : !s.home) && (!q || s.name.includes(q) || s.employeeCode.includes(q)),
    );
  }, [staff, tab, filter]);
  const hasOther = staff?.some((s) => !s.home) ?? false;

  const current = stepNumber(step);
  const backLinkClass = "text-sm text-gray-600 underline underline-offset-4 hover:text-gray-900";

  return (
    <div className="grid min-h-dvh flex-1 grid-cols-1 grid-rows-[auto_1fr] md:landscape:grid-cols-[0.9fr_1.1fr] md:landscape:grid-rows-1">
      {/* 左：色面（今どのステップかと時計）。撮影から先は選んだ打刻の色になる */}
      <section
        className="@container flex flex-col px-6 py-5 text-white transition-colors duration-500 sm:px-10 sm:py-8"
        style={{ backgroundColor: panelColor(step) }}
      >
        <div>
          <p className="text-sm font-medium tracking-wider opacity-80">{departmentName}</p>
          <h1 className="mt-2 text-xl font-black leading-snug sm:mt-4 sm:text-3xl">スマホを忘れた方の打刻</h1>
          <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-2 sm:mt-4 md:landscape:mt-6 md:landscape:flex-col md:landscape:gap-2.5">
            {STEP_LABELS.map((label, i) => {
              const n = i + 1;
              const state = n === current ? "on" : n < current ? "done" : "todo";
              return (
                <li
                  key={label}
                  className={`flex items-center gap-2.5 text-sm ${
                    state === "on" ? "font-bold" : state === "done" ? "opacity-80" : "opacity-45"
                  }`}
                >
                  <span
                    className={`grid size-6 place-items-center rounded-full border-[1.5px] text-xs font-bold ${
                      state === "on" ? "border-white bg-white text-gray-800" : "border-current"
                    }`}
                  >
                    {state === "done" ? "✓" : n}
                  </span>
                  {/* スマホ幅では今のステップ名だけ出して1行に収める */}
                  <span className={state === "on" ? "" : "hidden sm:inline"}>{label}</span>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="mt-4 sm:mt-6 md:landscape:mt-auto md:landscape:pt-7">
          <BigClock size="lg" />
        </div>
      </section>

      {/* 右：操作 */}
      <section className="flex min-w-0 flex-col bg-white px-6 py-5 sm:px-9 sm:py-8">
        <div className="flex justify-end">
          {step.kind === "select" ? (
            <a href={`/qr/${kioskKey}`} className={backLinkClass}>
              QR画面に戻る
            </a>
          ) : (
            step.kind !== "sending" && (
              <button type="button" onClick={reset} className={backLinkClass}>
                最初に戻る
              </button>
            )
          )}
        </div>

        {message && <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-base text-red-700">{message}</p>}

        {step.kind === "select" && (
          <div className="mt-1">
            <h2 className="text-[22px] font-bold">自分の名前を選んでください</h2>
            <p className="mt-1 text-sm text-muted">打刻のときに前面カメラで顔写真を撮影します。</p>
            {hasOther && (
              <div className="mt-4 flex gap-1.5">
                {(["home", "other"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setTab(t);
                      // 絞り込み欄は他店舗タブにしか無いので、切り替えたら条件を残さない
                      setFilter("");
                    }}
                    className={`rounded-full border-[1.5px] px-4 py-2 text-sm font-semibold ${
                      tab === t ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 text-gray-700"
                    }`}
                  >
                    {t === "home" ? "この店舗の方" : "他の店舗の方"}
                  </button>
                ))}
              </div>
            )}
            {tab === "other" && (
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="名前で絞り込み"
                className={`${inputClass} mt-2.5`}
              />
            )}
            {loadError && <p className="mt-4 text-red-600">{loadError}</p>}
            {!staff && !loadError && <p className="mt-4 text-muted">読み込み中...</p>}
            {staff && visibleStaff.length === 0 && <p className="mt-4 text-muted">該当するスタッフがいません</p>}
            <ul className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {visibleStaff.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => void selectStaff(s)}
                    className="flex min-h-[78px] w-full flex-col items-center justify-center gap-0.5 rounded-2xl border-[1.5px] border-gray-200 bg-white px-2 py-2 text-center transition hover:border-gray-900 hover:bg-gray-50"
                  >
                    <span className="text-[17px] font-bold">{s.name}</span>
                    <span className="text-xs text-gray-400">
                      {s.employeeCode}
                      {!s.home && s.departmentName ? `・${s.departmentName}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {step.kind === "confirm" && (
          <div className="mt-1 flex flex-1 flex-col">
            <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4">
              <p className="text-[28px] font-black">
                {step.status.name}
                <span className="ml-1 text-base font-medium">さん</span>
              </p>
              <span className="mt-2 inline-block rounded-full bg-gray-200 px-3 py-1 text-[13px] font-bold text-gray-700">
                現在：{PHASE_LABELS[step.status.phase]}
              </span>
              {step.status.events.length > 0 && (
                <p className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-muted">
                  本日の打刻
                  {step.status.events.map((e, i) => (
                    <span key={i}>
                      {CLOCK_EVENT_LABELS[e.type]}
                      <b className="ml-1 font-semibold text-foreground">{e.time}</b>
                    </span>
                  ))}
                </p>
              )}
            </div>
            {step.status.allowedTypes.length === 0 ? (
              <p className="mt-6 text-base">いま打刻できる操作はありません。</p>
            ) : (
              <>
                <h2 className="mt-6 text-[22px] font-bold">打刻する内容を押してください</h2>
                <p className="mt-1 text-sm text-muted">押すと3秒後に写真を撮影します。</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {step.status.allowedTypes.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => void startCamera(step.staff, t)}
                      className={`flex min-h-[clamp(84px,18vh,140px)] flex-col items-center justify-center gap-1 rounded-2xl text-white transition hover:brightness-110 ${
                        step.status.allowedTypes.length === 1 ? "col-span-2" : ""
                      }`}
                      style={{ backgroundColor: TYPE_COLORS[t] }}
                    >
                      <span className="text-3xl font-black">{CLOCK_EVENT_LABELS[t]}</span>
                      <span className="text-xs opacity-85">{TYPE_HINTS[t]}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="mt-auto pt-5 text-xs leading-relaxed text-gray-400">
              撮影した写真は勤怠の確認のためだけに使い、90日後に自動で削除されます。
            </p>
          </div>
        )}

        {step.kind === "camera" && (
          <div className="flex flex-col items-center">
            <p className="text-center text-lg font-bold">
              {step.staff.name} さんの{CLOCK_EVENT_LABELS[step.type]}
              <span className="mt-0.5 block text-sm font-normal text-muted">カメラに顔を向けてください</span>
            </p>
            <div className="relative mt-4 w-full max-w-[min(20rem,48vh)] overflow-hidden rounded-3xl bg-black">
              {/* 前面カメラは鏡像のほうが自然なので表示だけ反転する（撮影画像は反転しない） */}
              <video ref={attachVideo} playsInline muted className="aspect-[3/4] w-full -scale-x-100 object-cover" />
              <span className="absolute inset-0 flex items-center justify-center text-[132px] font-extrabold text-white drop-shadow-lg">
                {step.count}
              </span>
            </div>
          </div>
        )}

        {step.kind === "sending" && (
          <div className="m-auto text-center text-lg text-gray-700">
            <div className="mx-auto mb-4 size-10 animate-spin rounded-full border-4 border-gray-200 border-t-gray-900" />
            {step.staff.name} さんの{CLOCK_EVENT_LABELS[step.type]}を記録しています...
          </div>
        )}

        {step.kind === "result" && (
          <div className="my-auto py-5 text-center">
            {step.result.success ? (
              <>
                <div
                  className="mx-auto grid size-[84px] place-items-center rounded-full text-white"
                  style={{ backgroundColor: TYPE_COLORS[step.type] }}
                >
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </div>
                <p className="mt-4 text-[44px] font-black" style={{ color: TYPE_COLORS[step.type] }}>
                  {step.result.punchedLabel}
                  <span className="ml-2.5 tabular-nums">{step.result.punchedTime}</span>
                </p>
                <p className="mt-1 text-xl">{step.staff.name} さん、打刻しました</p>
                {step.result.lateMinutes > 0 && (
                  <p className="mx-auto mt-4 max-w-sm rounded-lg bg-orange-50 px-4 py-2.5 text-sm leading-relaxed text-amber-700">
                    始業時刻より{step.result.lateMinutes}分遅い打刻です。理由は後からマイページで入力できます。
                  </p>
                )}
                {step.result.photoFailed && (
                  <p className="mt-3 text-sm text-amber-700">写真の保存に失敗しました（打刻は記録されています）</p>
                )}
              </>
            ) : (
              <p className="text-xl text-red-700">{step.result.error}</p>
            )}
            <div className="mx-auto mt-7 h-1 w-48 overflow-hidden rounded bg-gray-100">
              <div className="h-full bg-gray-400 [animation:kiosk-reset-bar_5s_linear_forwards]" />
            </div>
            <p className="mt-2 text-xs text-gray-400">5秒後に最初の画面に戻ります</p>
            <button type="button" onClick={reset} className={`mt-4 ${backLinkClass}`}>
              最初の画面に戻る
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
