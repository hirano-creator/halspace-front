// スマホ忘れ打刻（キオスク）の共有型（Route Handler / クライアントコンポーネント両方から使う）

import type { ClockEventType, ClockPhase } from "@/lib/attendance/clock";

export interface KioskStaff {
  id: string;
  name: string;
  employeeCode: string;
  departmentName: string | null;
  /** キオスクの店舗に所属しているか（false は同じ会社の他店舗） */
  home: boolean;
}

export interface KioskStaffResponse {
  departmentName: string;
  staff: KioskStaff[];
}

export interface KioskStatusResponse {
  name: string;
  phase: ClockPhase;
  /** いま押せる打刻種別（validatePunch と同じ判定） */
  allowedTypes: ClockEventType[];
  /** 当日の打刻（時刻順） */
  events: { type: ClockEventType; time: string }[];
}

export interface KioskPunchResponse {
  error: string | null;
  success: boolean;
  punchedLabel: string | null;
  punchedTime: string | null;
  lateMinutes: number;
  /** 写真の保存に失敗した（打刻自体は成立している） */
  photoFailed: boolean;
}
