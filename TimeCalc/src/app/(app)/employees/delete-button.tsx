"use client";

// 社員削除ボタン（確認ダイアログ付き）

import { useActionState } from "react";
import { deleteEmployeeAction, type EmployeeDeleteState } from "./actions";

const initialState: EmployeeDeleteState = { error: null };

export function DeleteEmployeeButton({
  employeeId,
  employeeName,
}: {
  employeeId: string;
  employeeName: string;
}) {
  const [state, formAction, pending] = useActionState(deleteEmployeeAction, initialState);

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
