// 公開の Web 予約ページの型

export interface PublicSession {
  id: string;
  /** "2026-09-05" */
  date: string;
  startTime: string;
  endTime: string;
  courseName: string;
  courseDescription: string | null;
  price: number;
  durationMinutes: number;
  capacity: number;
  reserved: number;
  remaining: number;
}

export interface PublicReserveResult {
  reservationId: string;
  courseName: string;
  date: string;
  startTime: string;
  headcount: number;
}
