export interface StaffItem {
  id: string;
  email: string;
  name: string;
  nameKana: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
  /** 自分自身かどうか（自分の権限変更・無効化を止めるため） */
  isSelf: boolean;
}

export interface StaffListResponse {
  staffs: StaffItem[];
}
