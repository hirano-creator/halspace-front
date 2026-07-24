// 打刻画面まわりの共有型（Route Handler / クライアントコンポーネント両方から使う）

import type { ClockPhase } from "@/lib/attendance/clock";

export interface PunchState {
  error: string | null;
  success: boolean;
  /** 打刻に成功した種別のラベル（例: "出勤"）。成功フィードバック表示用 */
  punchedLabel: string | null;
  /** 打刻に成功した時刻 "HH:mm" */
  punchedTime: string | null;
  /** 出勤打刻が所定始業より遅かった場合の遅刻分数（理由入力を促す） */
  lateMinutes: number;
  /** 打刻したイベントID（後から理由を追記する用） */
  eventId: string | null;
}

export interface AutoPunchState {
  error: string | null;
  success: boolean;
  punchedLabel: string | null;
  punchedTime: string | null;
  lateMinutes: number;
  eventId: string | null;
  /** 直近の打刻から間もないため、二重打刻防止で今回は実行しなかった（直近の打刻内容を返す） */
  alreadyPunched: boolean;
  /** 外出中に出勤・退勤QRを読んだため、退勤してよいかの確認が必要 */
  confirmOut: boolean;
}

export interface ReasonState {
  error: string | null;
  success: boolean;
}

export interface ClockStatusResponse {
  viewer: { id: string; name: string };
  department: { id: string; name: string } | null;
  status: {
    phase: ClockPhase;
    canClockIn: boolean;
    canClockOut: boolean;
    canOutStart: boolean;
    canOutEnd: boolean;
  };
  events: {
    id: string;
    type: string;
    time: string;
    reason: string | null;
    /** 修正申請の承認・管理者編集による修正後の時刻を表示している */
    corrected: boolean;
    /** 修正で取り消された打刻（「未出勤」「未退勤」に直した日の出退勤打刻） */
    cancelled: boolean;
  }[];
  qrKind: "attend" | "outing" | null;
  requestedDeptId: string | null;
  qrTokenError: string | null;
  needsGuidance: boolean;
  clockMode: "free" | "qrTap" | "qrScan";
}
