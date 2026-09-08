export interface AttendanceItem {
  id: string;
  customerId: string;
  customerName: string;
  courseName: string | null;
  attendedAt: string;
  staffName: string | null;
  evalPaddle: number | null;
  evalTakeoff: number | null;
  evalWaveSelection: number | null;
  evalRiding: number | null;
  evalTotal: number | null;
  comment: string | null;
  nextRecommendation: string | null;
  hasEvaluation: boolean;
}

export interface AttendanceListResponse {
  attendances: AttendanceItem[];
}
