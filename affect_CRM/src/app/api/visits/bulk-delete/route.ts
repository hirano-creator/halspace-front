import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { deleteVisits } from "@/lib/visit-delete";
import type { VisitBulkDeleteResponse } from "@/app/(app)/visits/types";

/** 一度に消せる上限。一覧 1 ページ分（30 件）で足りるが、余裕を持たせておく */
const MAX_IDS = 100;

/**
 * 来店記録の一括削除（権限 visit.delete）
 *
 * 一覧でチェックを付けた分をまとめて消す。単体削除と同じく、紐づく購入記録・フォロー予定・
 * 会話メモも一緒に消え、顧客の集計も数え直される（deleteVisits）。
 */
export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "visit.delete");
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? Array.from(new Set(body.ids.filter((v): v is string => typeof v === "string" && v !== "")))
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "削除する来店記録を選んでください" }, { status: 400 });
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: `一度に削除できるのは ${MAX_IDS} 件までです` },
      { status: 400 },
    );
  }

  const result = await deleteVisits(ids, auth.user.id);
  const res: VisitBulkDeleteResponse = { deleted: result.visits, purchases: result.purchases };
  return NextResponse.json(res);
}
