"use client";

// 社員削除ボタン（確認ダイアログ付き）

import { useActionState, useEffect } from "react";
import { deleteEmployeeAction } from "./client-actions";
import type { EmployeeDeleteState } from "./types";

const initialState: EmployeeDeleteState = { error: null };

export function DeleteEmployeeButton({
  employeeId,
  employeeName,
  onDeleted,
}: {
  employeeId: string;
  employeeName: string;
  /** 削除成功後に呼ぶ（一覧の再取得トリガー用） */
  onDeleted?: () => void;
}) {
  const [state, formAction, pending] = useActionState(deleteEmployeeAction, initialState);

  useEffect(() => {
    // useActionStateは送信のたびに新しいオブジェクトを返すため、initialStateと異なる
    // 参照になった時点＝1回以上送信済みと判定できる（successフィールドが無い型のため）
    if (state !== initialState && state.error === null) onDeleted?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !confirm(
            `社員「${employeeName}」を削除しますか？\nこの社員の勤怠データもすべて削除されます。この操作は取り消せません。`,
          )
        ) {
          e.preventDefault();
        }
      }}
      className="inline"
    >
      <input type="hidden" name="id" value={employeeId} />
      <button
        type="submit"
        disabled={pending}
        className="text-sm text-red-500 hover:underline disabled:opacity-50"
        title={state.error ?? undefined}
      >
        削除
      </button>
    </form>
  );
}
