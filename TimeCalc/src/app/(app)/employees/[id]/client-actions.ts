// 社員詳細の勤怠編集フォームから呼ぶクライアント側アクション
// 旧Server Action(employees/[id]/actions.ts)を、Bearerトークン付きfetchでRoute Handlerを叩く形に置き換えたもの。

import { apiFetch } from "@/lib/auth/api-fetch";
import type { AttendanceEditState } from "./types";

export async function saveAttendanceAction(
  _prev: AttendanceEditState,
  formData: FormData,
): Promise<AttendanceEditState> {
  const userId = String(formData.get("userId") ?? "");
  const res = await apiFetch(`/api/employees/${userId}/attendance`, { method: "POST", body: formData });
  return res.json();
}

export async function deleteAttendanceAction(
  _prev: AttendanceEditState,
  formData: FormData,
): Promise<AttendanceEditState> {
  const userId = String(formData.get("userId") ?? "");
  // 削除は日付単位（Attendanceが無く打刻ログだけの日も消せるようにするため）
  const date = String(formData.get("date") ?? "");
  const res = await apiFetch(`/api/employees/${userId}/attendance/${encodeURIComponent(date)}`, {
    method: "DELETE",
  });
  return res.json();
}
