"use client";

// 打刻QR一覧（部署ごとのQR表示リンク＋キオスク表示URLの発行・コピー・再発行・無効化）

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { buildKioskUrl } from "@/lib/qr";
import { issueKioskKeyAction, revokeKioskKeyAction } from "./client-actions";
import type { DepartmentForQrList, QrKeyActionState } from "./types";
import { Card, buttonPrimaryClass, buttonSecondaryClass } from "@/components/ui";

const initialState: QrKeyActionState = { error: null, success: false };

/** 1部署分のキオスクURL管理行 */
function DepartmentQrRow({
  department,
  baseUrl,
  onChanged,
}: {
  department: DepartmentForQrList;
  baseUrl: string;
  /** 発行・再発行・無効化成功後に呼ぶ（一覧の再取得トリガー用） */
  onChanged?: () => void;
}) {
  const [issueState, issueAction, issuePending] = useActionState(
    issueKioskKeyAction,
    initialState,
  );
  const [revokeState, revokeAction, revokePending] = useActionState(
    revokeKioskKeyAction,
    initialState,
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if ((issueState.success && !issueState.error) || (revokeState.success && !revokeState.error)) {
      onChanged?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueState.success, issueState.error, revokeState.success, revokeState.error]);

  const kioskUrl = department.kioskKey ? buildKioskUrl(baseUrl, department.kioskKey) : null;

  async function handleCopy() {
    if (!kioskUrl) return;
    await navigator.clipboard.writeText(kioskUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold">{department.name}</p>
        <Link href={`/settings/qr/${department.id}`} className={buttonSecondaryClass}>
          QR表示
        </Link>
      </div>

      {kioskUrl ? (
        <div className="space-y-2">
          <p className="break-all rounded-lg bg-gray-50 px-3 py-2 text-xs text-muted">
            {kioskUrl}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={handleCopy} className={buttonSecondaryClass}>
              {copied ? "コピーしました" : "コピー"}
            </button>
            <form
              action={issueAction}
              onSubmit={(e) => {
                if (!confirm("再発行すると、現在のキオスクURLは無効になります。よろしいですか？")) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="departmentId" value={department.id} />
              <button type="submit" disabled={issuePending} className={buttonSecondaryClass}>
                {issuePending ? "再発行中..." : "再発行"}
              </button>
            </form>
            <form
              action={revokeAction}
              onSubmit={(e) => {
                if (!confirm("キオスクURLを無効化しますか？店舗に表示中の画面は使えなくなります。")) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="departmentId" value={department.id} />
              <button type="submit" disabled={revokePending} className={buttonSecondaryClass}>
                {revokePending ? "無効化中..." : "無効化"}
              </button>
            </form>
          </div>
        </div>
      ) : (
        <form action={issueAction}>
          <input type="hidden" name="departmentId" value={department.id} />
          <button type="submit" disabled={issuePending} className={buttonPrimaryClass}>
            {issuePending ? "発行中..." : "キオスクURLを発行"}
          </button>
        </form>
      )}

      {(issueState.error || revokeState.error) && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          {issueState.error ?? revokeState.error}
        </p>
      )}
    </Card>
  );
}

export function QrList({
  departments,
  baseUrl,
  onChanged,
}: {
  departments: DepartmentForQrList[];
  baseUrl: string;
  /** 発行・再発行・無効化成功後に呼ぶ（一覧の再取得トリガー用） */
  onChanged?: () => void;
}) {
  if (departments.length === 0) {
    return <p className="text-sm text-muted">部署が登録されていません</p>;
  }

  return (
    <div className="space-y-4">
      {departments.map((department) => (
        <DepartmentQrRow key={department.id} department={department} baseUrl={baseUrl} onChanged={onChanged} />
      ))}
    </div>
  );
}
