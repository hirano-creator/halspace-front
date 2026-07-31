// 社員番号の採番ルール（接頭辞・桁数）の保存API（POST）
//
// 社員番号自体は全社で一意のまま。ここで決めるのは
// 「新規登録時にどの番号を提案するか」だけなので、既存社員の番号は変わらない。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import type { SettingsFormState } from "@/app/(app)/settings/types";
import { resolveCompanyId } from "../_shared";

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const formData = await request.formData();
  const companyId = await resolveCompanyId(formData);
  if (companyId === "invalid") {
    return NextResponse.json<SettingsFormState>({ error: "対象の会社が見つかりません", success: false });
  }
  if (!companyId) {
    return NextResponse.json<SettingsFormState>({
      error: "社員番号の採番は会社ごとに設定します。会社タブを選んでください",
      success: false,
    });
  }

  const prefix = String(formData.get("codePrefix") ?? "").trim();
  const digits = Number(String(formData.get("codeDigits") ?? "").trim());

  // 接頭辞に数字を許すと連番との境目が分からなくなるため、英字・記号のみにする
  if (prefix && !/^[A-Za-z][A-Za-z\-_]*$/.test(prefix)) {
    return NextResponse.json<SettingsFormState>({
      error: "接頭辞は英字で始まる英字・ハイフン・アンダースコアのみで入力してください（例: A）",
      success: false,
    });
  }
  if (prefix.length > 8) {
    return NextResponse.json<SettingsFormState>({
      error: "接頭辞は8文字以内で入力してください",
      success: false,
    });
  }
  if (!Number.isInteger(digits) || digits < 1 || digits > 10) {
    return NextResponse.json<SettingsFormState>({
      error: "連番の桁数は1〜10の範囲で入力してください",
      success: false,
    });
  }

  await prisma.company.update({
    where: { id: companyId },
    data: { codePrefix: prefix || null, codeDigits: digits },
  });

  return NextResponse.json<SettingsFormState>({ error: null, success: true });
}
