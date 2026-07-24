// 修正申請ページの共有型（Route Handler / クライアントコンポーネント両方から使う）

import type { ReviewRow } from "./review-list";

export interface ReviewState {
  error: string | null;
  success: boolean;
}

export interface ResolvedRow {
  id: string;
  userName: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  breakMinutes: number;
  status: string; // "APPROVED" | "REJECTED"
  reviewedByName: string | null;
  reviewedAtLabel: string | null;
  reviewNote: string | null;
}

export interface CorrectionsPageResponse {
  pending: ReviewRow[];
  resolved: ResolvedRow[];
}
