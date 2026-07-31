// 打刻QR画面の共有型（Route Handler / クライアントコンポーネント両方から使う）

import type { QrCodeData } from "@/lib/qr-board";

export type { QrCodeData };

export interface QrKeyActionState {
  error: string | null;
  success: boolean;
}

export interface DepartmentForQrList {
  id: string;
  name: string;
  kioskKey: string | null;
}

export interface QrListResponse {
  departments: DepartmentForQrList[];
  baseUrl: string;
}

export interface DepartmentQrDetailResponse {
  departmentName: string;
  dailyQrEnabled: boolean;
  today: string;
  gpsUnset: boolean;
  noneEnabled: boolean;
  standard: QrCodeData | null;
  attend: QrCodeData | null;
  outing: QrCodeData | null;
  /** 会社の勤務ルールから解決した本日の始業・終業時刻（"HH:mm"） */
  workStart: string;
  workEnd: string;
  /** ログイン不要のキオスク表示URL（未発行の場合はnull。/settings/qr で発行できる） */
  kioskUrl: string | null;
}
