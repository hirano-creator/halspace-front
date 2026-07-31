// 打刻QR掲示画面（キオスク／管理者共通）の時間帯判定
//
// 会社の勤務ルール（始業・終業）を基準に「今どのQRを主役として見せるか」
// 「外出・戻りQRを既定で展開するか」を決める。QR自体の読み取り可否は
// サーバー側の打刻APIが状態(phase)で判定するため、ここでの見出し・展開状態は
// あくまで「掲示物としての見せ方」の制御であり、打刻そのものを妨げない。

import { timeToMinutes, formatMinutes } from "@/lib/utils/time";

/** 1枚のQRコードの表示データ（画像・URL・説明文） */
export interface QrCodeData {
  label: string;
  description: string;
  dataUrl: string;
  url: string;
}

export type QrBoardPhase = "beforeWork" | "lateWindow" | "working" | "evening" | "afterWork";

export interface QrBoardState {
  phase: QrBoardPhase;
  /** 主役カードの見出し（例: "出勤の打刻"） */
  primaryHeading: string;
  /** 外出・戻りQRを既定で展開するか（false=折りたたみ） */
  outingExpanded: boolean;
  /** 時計の下に出す定刻情報（null=非表示） */
  notice: { tone: "info" | "warn"; text: string } | null;
}

/** 始業直後、遅刻警告を出し続ける長さ（分） */
const LATE_WARN_WINDOW = 60;
/** 始業からこの分数が経過したら外出・戻りQRを自動展開する */
const OUTING_OPEN_AFTER_START = 30;
/** 終業のこの分数前から「退勤の打刻」表示・外出展開に切り替える */
const EVENING_BEFORE_END = 60;

export function resolveQrBoardState(args: {
  /** 0時からの経過分（現在時刻）。ハイドレーション前は null */
  nowMinutes: number | null;
  /** "HH:mm" */
  workStart: string;
  /** "HH:mm" */
  workEnd: string;
}): QrBoardState {
  const { nowMinutes } = args;
  const start = timeToMinutes(args.workStart);
  const end = timeToMinutes(args.workEnd);

  if (nowMinutes === null || start === null || end === null || end <= start) {
    return {
      phase: "working",
      primaryHeading: "出勤・退勤の打刻",
      outingExpanded: false,
      notice: null,
    };
  }

  if (nowMinutes < start) {
    return {
      phase: "beforeWork",
      primaryHeading: "出勤の打刻",
      outingExpanded: false,
      notice: { tone: "info", text: `始業 ${args.workStart} まで あと${formatMinutes(start - nowMinutes)}` },
    };
  }

  if (nowMinutes < start + LATE_WARN_WINDOW) {
    return {
      phase: "lateWindow",
      primaryHeading: "出勤・退勤の打刻",
      outingExpanded: nowMinutes >= start + OUTING_OPEN_AFTER_START,
      notice: {
        tone: "warn",
        text: `⚠ 始業 ${args.workStart} を${nowMinutes - start}分過ぎています（遅刻の打刻になります）`,
      },
    };
  }

  if (nowMinutes < end - EVENING_BEFORE_END) {
    return {
      phase: "working",
      primaryHeading: "出勤・退勤の打刻",
      outingExpanded: true,
      notice: { tone: "info", text: `勤務時間中（終業 ${args.workEnd} まで あと${formatMinutes(end - nowMinutes)}）` },
    };
  }

  if (nowMinutes < end) {
    return {
      phase: "evening",
      primaryHeading: "退勤の打刻",
      outingExpanded: true,
      notice: { tone: "info", text: `終業 ${args.workEnd} まで あと${formatMinutes(end - nowMinutes)}` },
    };
  }

  return {
    phase: "afterWork",
    primaryHeading: "退勤の打刻",
    outingExpanded: false,
    notice: { tone: "info", text: `終業 ${args.workEnd} を過ぎています` },
  };
}
