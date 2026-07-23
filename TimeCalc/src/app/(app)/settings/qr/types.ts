// 打刻QR画面の共有型（Route Handler / クライアントコンポーネント両方から使う）

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

export interface QrCodeData {
  label: string;
  description: string;
  dataUrl: string;
  url: string;
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
}
