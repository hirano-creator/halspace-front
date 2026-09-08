// スクール・予約の型（Route Handler とクライアントで共有する）

export interface CourseItem {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  price: number;
  capacity: number;
  level: string | null;
  levelLabel: string | null;
  isPublished: boolean;
  staffIds: string[];
  staffNames: string[];
}

export interface CourseListResponse {
  courses: CourseItem[];
  staffs: { id: string; name: string }[];
  levels: { code: string; label: string }[];
}

export interface ReservationItem {
  id: string;
  customerId: string;
  customerName: string;
  headcount: number;
  status: string;
  source: string;
  note: string | null;
}

export interface SessionItem {
  id: string;
  /** "2026-09-05" */
  date: string;
  startTime: string;
  endTime: string;
  courseId: string;
  courseName: string;
  capacity: number;
  reserved: number;
  remaining: number;
  staffId: string | null;
  staffName: string | null;
  status: string;
  isPublished: boolean;
  note: string | null;
  reservations: ReservationItem[];
}

export interface CalendarResponse {
  /** 表示範囲（JST の日付） */
  from: string;
  to: string;
  sessions: SessionItem[];
  courses: { id: string; name: string; durationMinutes: number; capacity: number }[];
  staffs: { id: string; name: string }[];
}

export interface AttendanceInput {
  customerId: string;
  courseId: string | null;
  attendedAt: string;
}
