// ルートアクセスはマイページへ集約する（全社員が自分の勤怠をまず確認できるように）

import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/my");
}
