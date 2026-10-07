"use client";

// スマホ忘れ打刻のステップ画面（店舗タブレット用）
// スタッフ選択 → 状態確認・打刻種別の選択 → 前面カメラで撮影（3秒カウント）→ 結果表示
// 共用端末なので、結果表示や放置のあとは自動で最初の画面に戻し、前の人の状態を残さない。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CLOCK_EVENT_LABELS, type ClockEventType } from "@/lib/attendance/clock";
import { inputClass } from "@/components/ui";
import type { KioskPunchResponse, KioskStaff, KioskStaffResponse, KioskStatusResponse } from "./types";

type Step =
  | { kind: "select" }
  | { kind: "confirm"; staff: KioskStaff; status: KioskStatusResponse }
  | { kind: "camera"; staff: KioskStaff; type: ClockEventType; count: number }
  | { kind: "sending"; staff: KioskStaff; type: ClockEventType }
  | { kind: "result"; staff: KioskStaff; result: KioskPunchResponse };

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

const TYPE_STYLES: Record<ClockEventType, string> = {
  IN: "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700",
  OUT: "border-primary bg-primary text-white hover:bg-primary-hover",
  OUT_START: "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100",
  OUT_END: "border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100",
};

const bigButton =
  "flex min-h-24 flex-col items-center justify-center rounded-xl border text-xl font-semibold transition disabled:opacity-40";

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
    setStep({ kind: "result", staff: s, result });
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

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-4 flex items-center justify-between gap-2">
        <div>
          <p className="text-sm text-muted">{departmentName}</p>
          <h1 className="text-2xl font-semibold tracking-tight">スマホを忘れた方の打刻</h1>
        </div>
        {step.kind === "select" ? (
          <a href={`/qr/${kioskKey}`} className="shrink-0 text-sm text-primary underline">
            QR画面に戻る
          </a>
        ) : (
          step.kind !== "sending" && (
            <button type="button" onClick={reset} className="shrink-0 text-sm text-primary underline">
              最初に戻る
            </button>
          )
        )}
      </header>

      {message && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-base text-red-700">{message}</p>}

      {step.kind === "select" && (
        <section>
          <p className="mb-3 text-base">自分の名前を選んでください。打刻時に顔写真を撮影します。</p>
          {hasOther && (
            <div className="mb-3 flex gap-2">
              {(["home", "other"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTab(t);
                    // 絞り込み欄は他店舗タブにしか無いので、切り替えたら条件を残さない
                    setFilter("");
                  }}
                  className={`rounded-full border px-4 py-2 text-sm font-medium ${
                    tab === t ? "border-primary bg-primary text-white" : "border-border bg-white"
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
              className={`${inputClass} mb-3`}
            />
          )}
          {loadError && <p className="text-red-600">{loadError}</p>}
          {!staff && !loadError && <p className="text-muted">読み込み中...</p>}
          {staff && visibleStaff.length === 0 && <p className="text-muted">該当するスタッフがいません</p>}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {visibleStaff.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => void selectStaff(s)}
                  className="flex min-h-20 w-full flex-col items-center justify-center rounded-xl border border-border bg-white px-2 py-3 text-center transition hover:border-primary hover:bg-primary/5"
                >
                  <span className="text-lg font-semibold">{s.name}</span>
                  <span className="text-xs text-muted">
                    {s.employeeCode}
                    {!s.home && s.departmentName ? `・${s.departmentName}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step.kind === "confirm" && (
        <section className="space-y-5">
          <div className="rounded-xl border border-border bg-white p-4">
            <p className="text-2xl font-semibold">{step.status.name} さん</p>
            <p className="mt-1 text-base text-muted">
              現在の状態：<span className="font-medium text-foreground">{PHASE_LABELS[step.status.phase]}</span>
            </p>
            {step.status.events.length > 0 && (
              <p className="mt-1 text-sm text-muted">
                本日の打刻：{step.status.events.map((e) => `${CLOCK_EVENT_LABELS[e.type]} ${e.time}`).join("、")}
              </p>
            )}
          </div>
          {step.status.allowedTypes.length === 0 ? (
            <p className="text-base">いま打刻できる操作はありません。</p>
          ) : (
            <>
              <p className="text-base">打刻する内容を押してください。押すと3秒後に写真を撮影します。</p>
              <div className="grid grid-cols-2 gap-3">
                {step.status.allowedTypes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => void startCamera(step.staff, t)}
                    className={`${bigButton} ${TYPE_STYLES[t]}`}
                  >
                    {CLOCK_EVENT_LABELS[t]}
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="text-xs text-muted">
            撮影した写真は勤怠の確認のためだけに使い、90日後に自動で削除されます。
          </p>
        </section>
      )}

      {step.kind === "camera" && (
        <section className="flex flex-col items-center">
          <p className="mb-3 text-lg">
            {step.staff.name} さんの{CLOCK_EVENT_LABELS[step.type]}：カメラに顔を向けてください
          </p>
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-black">
            {/* 前面カメラは鏡像のほうが自然なので表示だけ反転する（撮影画像は反転しない） */}
            <video ref={attachVideo} playsInline muted className="aspect-[3/4] w-full -scale-x-100 object-cover" />
            <span className="absolute inset-0 flex items-center justify-center text-8xl font-bold text-white drop-shadow-lg">
              {step.count}
            </span>
          </div>
        </section>
      )}

      {step.kind === "sending" && (
        <p className="mt-16 text-center text-xl">
          {step.staff.name} さんの{CLOCK_EVENT_LABELS[step.type]}を記録しています...
        </p>
      )}

      {step.kind === "result" && (
        <section className="mt-10 text-center">
          {step.result.success ? (
            <>
              <p className="text-3xl font-semibold text-emerald-700">
                {step.result.punchedLabel} {step.result.punchedTime}
              </p>
              <p className="mt-2 text-xl">{step.staff.name} さん、打刻しました</p>
              {step.result.lateMinutes > 0 && (
                <p className="mt-3 text-base text-amber-700">
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
          <button type="button" onClick={reset} className="mt-8 text-base text-primary underline">
            最初の画面に戻る
          </button>
        </section>
      )}
    </div>
  );
}
