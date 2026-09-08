// 顧客の入力パースと、重複顧客の検知
//
// 複数の Route Handler（一覧・詳細）から共有する。"_" 始まりなのでルートにはならない。

import { prisma } from "@/lib/db";
import { normalizeEmail, normalizePhone, trimOrNull } from "@/lib/normalize";
import { formatCustomerCode } from "@/lib/display";
import { GENDERS, toEnum } from "@/lib/constants";
import { parseJstDateTime } from "@/lib/utils/time";

export interface CustomerInput {
  name: string;
  nameKana: string | null;
  nickname: string | null;
  gender: string | null;
  birthday: Date | null;
  phone: string | null;
  phoneDigits: string | null;
  email: string | null;
  emailLower: string | null;
  prefecture: string | null;
  city: string | null;
  addressLine: string | null;
  lineId: string | null;
  instagram: string | null;
  rank: string | null;
  note: string | null;
  tagIds: string[];
  surf: {
    experienceYears: number | null;
    level: string | null;
    boardType: string | null;
    boardSize: string | null;
    wetsuitSize: string | null;
    favoritePoints: string | null;
    frequency: string | null;
    interestedCategories: string | null;
  };
}

/**
 * フォームを検証して入力値に変換する。
 * エラーは「氏名を入力してください」のように、どの項目かが分かる文言で返す。
 */
export function parseCustomerForm(form: FormData): CustomerInput | string {
  const name = String(form.get("name") ?? "").trim();
  if (!name) return "氏名を入力してください";
  if (name.length > 60) return "氏名は 60 文字以内で入力してください";

  const birthdayRaw = trimOrNull(form.get("birthday"));
  let birthday: Date | null = null;
  if (birthdayRaw) {
    birthday = parseJstDateTime(birthdayRaw);
    if (!birthday) return "生年月日は「2000-01-31」の形式で入力してください";
  }

  const experienceRaw = trimOrNull(form.get("experienceYears"));
  let experienceYears: number | null = null;
  if (experienceRaw !== null) {
    const n = Number(experienceRaw);
    if (!Number.isFinite(n) || n < 0 || n > 80) return "サーフィン歴は 0〜80 の数字で入力してください";
    experienceYears = Math.floor(n);
  }

  const phone = trimOrNull(form.get("phone"));
  const email = trimOrNull(form.get("email"));

  return {
    name,
    nameKana: trimOrNull(form.get("nameKana")),
    nickname: trimOrNull(form.get("nickname")),
    gender: toEnum(GENDERS, form.get("gender")),
    birthday,
    phone,
    phoneDigits: normalizePhone(phone),
    email,
    emailLower: normalizeEmail(email),
    prefecture: trimOrNull(form.get("prefecture")),
    city: trimOrNull(form.get("city")),
    addressLine: trimOrNull(form.get("addressLine")),
    lineId: trimOrNull(form.get("lineId")),
    instagram: trimOrNull(form.get("instagram")),
    rank: trimOrNull(form.get("rank")),
    note: trimOrNull(form.get("note")),
    tagIds: form.getAll("tagIds").map(String).filter(Boolean),
    surf: {
      experienceYears,
      level: trimOrNull(form.get("surfLevel")),
      boardType: trimOrNull(form.get("boardType")),
      boardSize: trimOrNull(form.get("boardSize")),
      wetsuitSize: trimOrNull(form.get("wetsuitSize")),
      favoritePoints: trimOrNull(form.get("favoritePoints")),
      frequency: trimOrNull(form.get("surfFrequency")),
      interestedCategories: form.getAll("interestedCategories").map(String).join(",") || null,
    },
  };
}

export interface DuplicateCandidate {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  reason: string;
}

/**
 * 電話番号・メールが一致する既存顧客を探す。
 *
 * 見つかっても自動では統合しない。同一人物と断定できないため、
 * 候補としてスタッフに提示して判断してもらう（企画書 4-3）。
 */
export async function findDuplicateCandidates(
  phoneDigits: string | null,
  emailLower: string | null,
  excludeId?: string,
): Promise<DuplicateCandidate[]> {
  if (!phoneDigits && !emailLower) return [];

  const rows = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      id: excludeId ? { not: excludeId } : undefined,
      OR: [
        ...(phoneDigits ? [{ phoneDigits }] : []),
        ...(emailLower ? [{ emailLower }] : []),
      ],
    },
    select: { id: true, code: true, name: true, phone: true, email: true, phoneDigits: true, emailLower: true },
    take: 5,
  });

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    phone: r.phone,
    email: r.email,
    reason:
      r.phoneDigits && r.phoneDigits === phoneDigits ? "電話番号が同じです" : "メールアドレスが同じです",
  }));
}

/** 顧客番号を採番する（A-0001）。衝突したら呼び出し側でリトライする */
export async function nextCustomerCode(): Promise<string> {
  const setting = await prisma.setting.findUnique({ where: { key: "customerCodePrefix" } });
  const prefix = setting?.value ?? "A";
  const last = await prisma.customer.findFirst({
    where: { code: { startsWith: `${prefix}-` } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const lastNumber = last ? Number(last.code.slice(prefix.length + 1)) : 0;
  return formatCustomerCode(prefix, (Number.isFinite(lastNumber) ? lastNumber : 0) + 1);
}
