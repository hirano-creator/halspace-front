"use client";

// 打刻用QRコード掲示画面の表示本体（キオスク／管理者共通）
//
// 画面を左右に分け、左の色面に大きな時計と「今どの打刻のQRか」を出し、右の白い面にQRを1枚だけ出す。
// 色面の色は表示中のQRで変わる（出勤＝緑／退勤＝紫／外出・戻り＝オレンジ／標準QR＝グレー）。
// 「出勤・退勤QR」と「外出・戻りQR」が同格に並んでいると、外出QRを誤って読む事故
// （勤務時間から差し引かれる打刻になる）が起きやすいため、表示するのは常に1枚で、
// 切り替えは白い面の選択肢から行う。今の時間帯に応じた既定の1枚は resolveQrBoardState が決める。
// 印刷時は色面を出さず、有効なQRをすべて並べる。

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { BigClock } from "./big-clock";
import { PrintButton } from "./print-button";
import { QrSvg } from "./qr-svg";
import { resolveQrBoardState, type QrBoardPhase, type QrCodeData } from "@/lib/qr-board";

type PrimaryKind = "attend" | "standard" | "outing";
/** main=時間帯に応じた主役QR / outing=外出・戻りQR / standard=主役が出勤・退勤QRのときの標準QR */
type Selection = "main" | "outing" | "standard";

interface PrimaryQr {
  kind: PrimaryKind;
  data: QrCodeData;
}

// 現在時刻を分精度で購読する（時計の表示とは別。表示の切り替え判定に秒精度は不要）。
// サーバースナップショットは番兵値を返し、ハイドレーション不一致を避ける。
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

/** panel=色面の背景 / finder=QRの切り出しシンボル（白地で読み取れるよう濃いめ） */
const TONES = {
  emerald: { panel: "#059669", finder: "#047857" },
  violet: { panel: "#5b4ee6", finder: "#4f46e5" },
  amber: { panel: "#d97706", finder: "#b45309" },
  slate: { panel: "#475569", finder: "#334155" },
} as const;
type Tone = keyof typeof TONES;

const PHASE_EN: Record<QrBoardPhase, string> = {
  beforeWork: "CLOCK IN",
  lateWindow: "CLOCK IN / OUT",
  working: "CLOCK IN / OUT",
  evening: "CLOCK OUT",
  afterWork: "CLOCK OUT",
};

const OUTING_NOTICE = "⚠ 外出中の時間は勤務時間から差し引かれます";

interface Display {
  data: QrCodeData;
  tone: Tone;
  /** 色面に大きく出す状態の言葉（例: 出勤） */
  word: string;
  en: string;
  notice: string | null;
}

function UrlToggle({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-center print:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-muted underline-offset-2 hover:underline"
      >
        {open ? "URLを隠す" : "URLを表示"}
      </button>
      {open && <p className="mx-auto mt-1 max-w-xs break-all text-xs text-muted">{url}</p>}
    </div>
  );
}

/** 表示するQRを切り替える選択肢（ラジオボタン風） */
function OptionButton({
  title,
  subtitle,
  selected,
  color,
  onClick,
}: {
  title: string;
  subtitle: string;
  selected: boolean;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="flex w-full items-center gap-3 rounded-xl border-[1.5px] border-gray-200 bg-white px-3.5 py-3 text-left transition-colors"
      style={selected ? { borderColor: color, color } : undefined}
    >
      <span
        className="grid size-[18px] shrink-0 place-items-center rounded-full border-2 border-gray-300"
        style={selected ? { borderColor: color } : undefined}
      >
        {selected && <span className="size-2 rounded-full bg-current" />}
      </span>
      <span>
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="block text-xs text-muted">{subtitle}</span>
      </span>
    </button>
  );
}

export function QrBoard({
  qrs,
  workStart,
  workEnd,
  variant,
  departmentName,
  dailyQrEnabled,
  today,
  gpsUnset,
  noneEnabled,
  forgotHref,
  footer,
}: {
  qrs: { standard: QrCodeData | null; attend: QrCodeData | null; outing: QrCodeData | null };
  workStart: string;
  workEnd: string;
  /** admin=管理者画面（設定の補足説明・印刷ボタンあり） / kiosk=公開キオスクページ（画面いっぱいに表示） */
  variant: "admin" | "kiosk";
  departmentName: string;
  dailyQrEnabled: boolean;
  today: string;
  gpsUnset: boolean;
  noneEnabled: boolean;
  /** スマホ忘れ打刻の入口（部署で有効なときだけ渡す） */
  forgotHref?: string;
  /** 白い面の一番下に置く追加要素（キオスクの「ホーム画面に追加」など） */
  footer?: ReactNode;
}) {
  const isAdmin = variant === "admin";
  const nowMinutes = useNowMinutes();
  const board = resolveQrBoardState({ nowMinutes, workStart, workEnd });

  const primary = pickPrimary(qrs);
  // 出勤・退勤QR（または標準QR）と外出・戻りQRが両方ある場合のみ切り替え可能
  // （外出のみ有効な部署は常に外出が主役）
  const canSwapOuting = primary?.kind !== "outing" && !!qrs.outing;
  const canShowStandard = primary?.kind === "attend" && !!qrs.standard;

  const [manual, setManual] = useState<Selection | null>(null);
  const selection: Selection = manual ?? (canSwapOuting && board.outingExpanded ? "outing" : "main");

  const mainTone: Tone = board.phase === "evening" || board.phase === "afterWork" ? "violet" : "emerald";
  const mainWord = board.primaryHeading.replace(/の打刻$/, "");

  let display: Display | null = null;
  if (primary) {
    if (primary.kind === "outing" || (selection === "outing" && qrs.outing)) {
      display = {
        data: primary.kind === "outing" ? primary.data : qrs.outing!,
        tone: "amber",
        word: "外出・戻り",
        en: "AWAY / BACK",
        notice: OUTING_NOTICE,
      };
    } else if (selection === "standard" && canShowStandard) {
      display = {
        data: qrs.standard!,
        tone: "slate",
        word: "その他の打刻",
        en: "SELECT",
        notice: "読み取ったあと、出勤・退勤・外出・戻りの4つのボタンから選んで打刻します",
      };
    } else {
      display = {
        data: primary.data,
        tone: mainTone,
        word: mainWord,
        en: PHASE_EN[board.phase],
        notice: board.notice?.text ?? null,
      };
    }
  }

  const tone = TONES[display?.tone ?? "slate"];
  const hasOptions = canSwapOuting || canShowStandard;
  const printable = [qrs.attend, qrs.standard, qrs.outing].filter((q): q is QrCodeData => q !== null);

  return (
    <>
      <div
        className={`grid grid-cols-1 overflow-hidden bg-white md:grid-cols-[1.1fr_1fr] print:hidden ${
          isAdmin ? "rounded-2xl border border-border shadow-sm md:min-h-[600px]" : "min-h-dvh"
        }`}
      >
        {/* 左：色面（時計と、今どの打刻のQRか） */}
        <section
          className="@container flex flex-col px-6 py-6 text-white transition-colors duration-500 sm:px-10 sm:py-9"
          style={{ backgroundColor: tone.panel }}
        >
          <p className="text-sm font-medium tracking-wider opacity-85">{departmentName}</p>
          <div className="mt-6 md:mt-auto">
            <BigClock />
          </div>
          {display && (
            <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-white/35 pt-5">
              <span className="text-[clamp(32px,9cqw,56px)] font-black leading-none">{display.word}</span>
              <span className="text-xs font-bold tracking-[0.3em] opacity-75">{display.en}</span>
            </div>
          )}
          {display?.notice && (
            <p className="mt-6 self-start rounded-lg bg-black/15 px-3.5 py-2 text-sm leading-relaxed md:mt-auto">
              {display.notice}
            </p>
          )}
        </section>

        {/* 右：白い面（QRと切り替え） */}
        <section className="flex flex-col items-center justify-center gap-4 px-6 py-8 sm:px-10">
          {display ? (
            <>
              <QrSvg
                key={display.data.url}
                value={display.data.url}
                label={display.data.label}
                finderColor={tone.finder}
                className="w-full max-w-[min(290px,42vh)]"
              />
              <div className="max-w-xs text-center">
                <p className="text-sm font-medium text-foreground">カメラで読み取って打刻</p>
                <p className="mt-0.5 text-xs text-muted">{display.data.description}</p>
              </div>
              {isAdmin && <UrlToggle url={display.data.url} />}
            </>
          ) : (
            <p className="max-w-xs rounded-lg bg-amber-50 px-4 py-3 text-center text-sm text-amber-700">
              表示するQRコードが設定されていません。
              {isAdmin ? "下の「表示するQR」から表示したい種類を選んでください。" : "管理者に設定を確認してください。"}
            </p>
          )}

          {hasOptions && primary && (
            <div className="flex w-full max-w-xs flex-col gap-2">
              <OptionButton
                title={board.primaryHeading}
                subtitle="いつもの出退勤はこちら"
                selected={selection === "main"}
                color={TONES[mainTone].panel}
                onClick={() => setManual("main")}
              />
              {canSwapOuting && (
                <OptionButton
                  title="外出・戻りの打刻"
                  subtitle="勤務時間から差し引かれます"
                  selected={selection === "outing"}
                  color={TONES.amber.panel}
                  onClick={() => setManual("outing")}
                />
              )}
              {canShowStandard && (
                <OptionButton
                  title="その他の打刻（標準QR）"
                  subtitle="4つのボタンから選んで打刻"
                  selected={selection === "standard"}
                  color={TONES.slate.panel}
                  onClick={() => setManual("standard")}
                />
              )}
            </div>
          )}

          {forgotHref && (
            <a
              href={forgotHref}
              className="flex w-full max-w-xs items-center gap-3 rounded-xl bg-gray-900 px-4 py-3.5 text-left text-white transition-colors hover:bg-gray-800"
            >
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 opacity-90"
                aria-hidden
              >
                <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
                <path d="M10.5 18.5h3" />
                <path d="M3 3l18 18" />
              </svg>
              <span>
                <span className="block text-[15px] font-bold">スマホを忘れた方はこちら</span>
                <span className="block text-xs opacity-65">名前を選んで、顔写真つきで打刻</span>
              </span>
              <span className="ml-auto text-lg opacity-60" aria-hidden>
                ›
              </span>
            </a>
          )}

          {dailyQrEnabled && <p className="text-xs text-muted">このQRコードは本日（{today}）限り有効です</p>}
          {footer}
        </section>
      </div>

      {isAdmin && gpsUnset && (
        <p className="mx-auto mt-3 max-w-md rounded-lg bg-amber-50 px-3 py-1.5 text-center text-xs text-amber-700 print:hidden">
          GPS座標が未設定のため、位置情報チェックなしで打刻できます
        </p>
      )}

      {isAdmin && !dailyQrEnabled && !noneEnabled && (
        <div className="mt-4 text-center print:hidden">
          <PrintButton />
        </div>
      )}

      {/* 印刷用：有効なQRをすべて並べる（画面では出さない） */}
      <div className="hidden space-y-8 print:block">
        <p className="text-center text-xl font-semibold">{departmentName} の打刻QR</p>
        {printable.map((q) => (
          <div key={q.url} className="mx-auto max-w-xs break-inside-avoid text-center">
            <p className="text-lg font-semibold">{q.label}</p>
            <p className="mt-1 text-xs">{q.description}</p>
            <QrSvg value={q.url} label={q.label} className="mx-auto mt-2 w-60" />
          </div>
        ))}
      </div>
    </>
  );
}
