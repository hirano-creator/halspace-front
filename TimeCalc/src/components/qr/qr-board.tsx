"use client";

// 打刻用QRコード掲示画面の表示本体（キオスク／管理者共通）
//
// 「出勤・退勤QR」と「外出・戻りQR」が同格に並んでいると、外出QRを誤って
// 読む事故（勤務時間から差し引かれる打刻になる）が起きやすい。
// このコンポーネントでは、今の時間帯に応じて主役QRを1枚大きく中央に出し、
// 外出・戻りQRは折りたたんで「間違って踏まない」見せ方にする。

import { useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { RealtimeClock } from "@/components/realtime-clock";
import { PrintButton } from "./print-button";
import { resolveQrBoardState, type QrCodeData } from "@/lib/qr-board";

type PrimaryKind = "attend" | "standard" | "outing";

interface PrimaryQr {
  kind: PrimaryKind;
  data: QrCodeData;
}

// 現在時刻を分精度で購読する（打刻ボタンのような秒精度は不要）。
// RealtimeClock と同じくサーバースナップショットは null を返し、ハイドレーション不一致を避ける。
function subscribe(onTick: () => void): () => void {
  const timer = setInterval(onTick, 15_000);
  return () => clearInterval(timer);
}
function getNowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}
function getServerNowMinutes(): number {
  return -1; // ハイドレーション前の番兵値（resolveQrBoardStateにはnullへ変換して渡す）
}

function useNowMinutes(): number | null {
  const minutes = useSyncExternalStore(subscribe, getNowMinutes, getServerNowMinutes);
  return minutes === -1 ? null : minutes;
}

function pickPrimary(qrs: {
  standard: QrCodeData | null;
  attend: QrCodeData | null;
  outing: QrCodeData | null;
}): PrimaryQr | null {
  if (qrs.attend) return { kind: "attend", data: qrs.attend };
  if (qrs.standard) return { kind: "standard", data: qrs.standard };
  if (qrs.outing) return { kind: "outing", data: qrs.outing };
  return null;
}

const TONE_CLASSES = {
  emerald: {
    badge: "bg-emerald-100 text-emerald-700",
    border: "border-emerald-200",
  },
  primary: {
    badge: "bg-violet-100 text-primary",
    border: "border-primary/25",
  },
  amber: {
    badge: "bg-amber-100 text-amber-700",
    border: "border-amber-200",
  },
  gray: {
    badge: "bg-gray-100 text-gray-600",
    border: "border-border",
  },
} as const;

type Tone = keyof typeof TONE_CLASSES;

function QrImage({
  dataUrl,
  label,
  sizePx,
}: {
  dataUrl: string;
  label: string;
  sizePx: number;
}) {
  return (
    <div
      className="mx-auto w-full rounded-xl bg-white p-3"
      style={{ maxWidth: `min(${sizePx + 24}px, 38vh)` }}
    >
      <Image
        src={dataUrl}
        alt={`${label}のQRコード`}
        width={sizePx}
        height={sizePx}
        unoptimized
        className="h-auto w-full rounded-lg border border-border"
      />
    </div>
  );
}

function UrlToggle({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="print:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-muted underline-offset-2 hover:underline"
      >
        {open ? "URLを隠す" : "URLを表示"}
      </button>
      {open && <p className="mt-1 max-w-xs break-all text-xs text-muted">{url}</p>}
    </div>
  );
}

function BigQrCard({
  data,
  heading,
  tone,
  warningText,
  showUrlToggle,
}: {
  data: QrCodeData;
  heading: string;
  tone: Tone;
  warningText?: string;
  showUrlToggle: boolean;
}) {
  const toneClass = TONE_CLASSES[tone];
  const icon = tone === "amber" ? "🟠" : tone === "primary" ? "🟣" : "🟢";

  return (
    <div className={`w-full max-w-md rounded-xl border-2 bg-surface p-4 shadow-sm ${toneClass.border}`}>
      <div className="flex flex-col items-center gap-2 text-center">
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${toneClass.badge}`}>
          {icon} {heading}
        </span>
        {warningText && (
          <p className={`rounded-full px-3 py-1 text-xs font-medium ${toneClass.badge}`}>{warningText}</p>
        )}
        <p className="text-xs text-muted">{data.description}</p>
        <QrImage dataUrl={data.dataUrl} label={data.label} sizePx={260} />
        {showUrlToggle && (
          <div className="print:hidden">
            <UrlToggle url={data.url} />
          </div>
        )}
      </div>
    </div>
  );
}

/** 今は大きく表示していない方のQRへ切り替えるための1行トリガー（押すと大小が入れ替わる） */
function SwapTrigger({
  title,
  subtitle,
  tone,
  onClick,
}: {
  title: string;
  subtitle: string;
  tone: Tone;
  onClick: () => void;
}) {
  const toneClass = TONE_CLASSES[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-xl border ${toneClass.border} bg-surface px-4 py-3 text-left print:hidden`}
    >
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted">{subtitle}</span>
      </span>
      <span className="shrink-0 text-xs text-muted">開く ▼</span>
    </button>
  );
}

function SecondaryItem({
  data,
  tone,
  triggerTitle,
  triggerSubtitle,
  warningText,
  expanded,
  onToggle,
  showUrlToggle,
}: {
  data: QrCodeData;
  tone: Tone;
  triggerTitle: string;
  triggerSubtitle: string;
  warningText?: string;
  expanded: boolean;
  onToggle: () => void;
  showUrlToggle: boolean;
}) {
  const toneClass = TONE_CLASSES[tone];

  return (
    <div className={`rounded-xl border ${toneClass.border} bg-surface`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left print:hidden"
      >
        <span>
          <span className="block text-sm font-semibold">{triggerTitle}</span>
          <span className="block text-xs text-muted">{triggerSubtitle}</span>
        </span>
        <span className="shrink-0 text-xs text-muted">{expanded ? "閉じる ▲" : "開く ▼"}</span>
      </button>
      <div className={expanded ? "block" : "hidden print:block"}>
        <div className="flex flex-col items-center gap-2 border-t border-border/70 px-4 py-4 text-center">
          {warningText && (
            <p className={`rounded-full px-3 py-1 text-xs font-medium ${toneClass.badge}`}>
              {warningText}
            </p>
          )}
          <p className="text-xs text-muted">{data.description}</p>
          <QrImage dataUrl={data.dataUrl} label={data.label} sizePx={220} />
          {showUrlToggle && <UrlToggle url={data.url} />}
        </div>
      </div>
    </div>
  );
}

export function QrBoard({
  qrs,
  workStart,
  workEnd,
  variant,
  dailyQrEnabled,
  today,
  gpsUnset,
  noneEnabled,
}: {
  qrs: { standard: QrCodeData | null; attend: QrCodeData | null; outing: QrCodeData | null };
  workStart: string;
  workEnd: string;
  /** admin=管理者画面（設定の補足説明・印刷ボタンあり） / kiosk=公開キオスクページ（表示専用） */
  variant: "admin" | "kiosk";
  dailyQrEnabled: boolean;
  today: string;
  gpsUnset: boolean;
  noneEnabled: boolean;
}) {
  const isAdmin = variant === "admin";
  const nowMinutes = useNowMinutes();
  const board = resolveQrBoardState({ nowMinutes, workStart, workEnd });

  const [standardOpen, setStandardOpen] = useState(false);

  const primary = pickPrimary(qrs);
  // 出勤・退勤QRと外出・戻りQRが両方ある場合のみスワップ可能（外出のみ有効な部署は常に外出がprimary扱い）
  const canSwapOuting = primary?.kind !== "outing" && !!qrs.outing;
  const showStandard = primary?.kind !== "standard" && qrs.standard;

  const [manualOutingActive, setManualOutingActive] = useState<boolean | null>(null);
  const outingActive = canSwapOuting && (manualOutingActive ?? board.outingExpanded);

  const primaryTone: Tone =
    primary?.kind === "outing" ? "amber" : board.phase === "evening" || board.phase === "afterWork" ? "primary" : "emerald";
  const primaryHeading = primary?.kind === "outing" ? "外出・戻りQR" : board.primaryHeading;

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      {dailyQrEnabled && (
        <p className="mx-auto max-w-md rounded-lg bg-violet-50 px-3 py-1.5 text-center text-xs text-primary print:hidden">
          このQRコードは本日（{today}）限り有効です
        </p>
      )}

      <RealtimeClock />

      {board.notice && (
        <p
          className={`mx-auto max-w-md rounded-lg px-3 py-1.5 text-center text-sm font-medium ${
            board.notice.tone === "warn" ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-muted"
          }`}
        >
          {board.notice.text}
        </p>
      )}

      {noneEnabled && (
        <p className="mx-auto max-w-md rounded-lg bg-amber-50 px-3 py-1.5 text-center text-xs text-amber-700 print:hidden">
          表示するQRコードが設定されていません。
          {isAdmin ? "下の「表示するQR」から表示したい種類を選んでください。" : "管理者に設定を確認してください。"}
        </p>
      )}

      {isAdmin && gpsUnset && (
        <p className="mx-auto max-w-md rounded-lg bg-amber-50 px-3 py-1.5 text-center text-xs text-amber-700 print:hidden">
          GPS座標が未設定のため、位置情報チェックなしで打刻できます
        </p>
      )}

      {/* 出勤・退勤QRより上に置くことで、画面の高さに関わらずスクロールなしで見つけられるようにする */}
      {canSwapOuting && (
        <div className="mx-auto w-full max-w-md">
          {outingActive ? (
            <SwapTrigger
              title={primaryHeading}
              subtitle="こちらに戻る"
              tone={primaryTone}
              onClick={() => setManualOutingActive(false)}
            />
          ) : (
            <SwapTrigger
              title="外出・戻りの打刻はこちら"
              subtitle="勤務時間から差し引かれます"
              tone="amber"
              onClick={() => setManualOutingActive(true)}
            />
          )}
        </div>
      )}

      {primary && (
        <div className={outingActive ? "hidden justify-center print:flex" : "flex justify-center"}>
          <BigQrCard data={primary.data} heading={primaryHeading} tone={primaryTone} showUrlToggle={isAdmin} />
        </div>
      )}
      {canSwapOuting && qrs.outing && (
        <div className={outingActive ? "flex justify-center" : "hidden justify-center print:flex"}>
          <BigQrCard
            data={qrs.outing}
            heading="外出・戻りQR"
            tone="amber"
            warningText="⚠ このQRは外出・戻り専用です"
            showUrlToggle={isAdmin}
          />
        </div>
      )}

      {showStandard && qrs.standard && (
        <div className="mx-auto w-full max-w-md">
          <SecondaryItem
            data={qrs.standard}
            tone="gray"
            triggerTitle="その他の打刻（標準QR）"
            triggerSubtitle="出勤・退勤・外出・戻りの4ボタンから選んで打刻"
            expanded={standardOpen}
            onToggle={() => setStandardOpen((v) => !v)}
            showUrlToggle={isAdmin}
          />
        </div>
      )}

      {isAdmin && !dailyQrEnabled && !noneEnabled && (
        <div className="text-center print:hidden">
          <PrintButton />
        </div>
      )}
    </div>
  );
}
