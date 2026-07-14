// ルートアクセスは勤怠一覧へ集約する

import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/attendance");
}
