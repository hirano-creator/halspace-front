"use client";

// 取込履歴の削除ボタン（確認ダイアログ付き）
// 履歴ログを消すだけで、取り込んだ勤怠データ自体は削除されない

import { useActionState } from "react";
import { deleteImportHistoryAction, type DeleteHistoryState } from "./actions";

const initialState: DeleteHistoryState = { error: null };

export function DeleteHistoryButton({ historyId }: { historyId: string }) {
  const [state, formAction, pending] = useActionState(deleteImportHistoryAction, initialState);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !confirm(
            "この取込履歴を削除しますか？\n（取り込んだ勤怠データ自体は削除されません。履歴の記録のみ消えます）",
          )
        ) {
          e.preventDefault();
        }
      }}
      className="inline"
    >
      <input type="hidden" name="id" value={historyId} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-red-500 hover:underline disabled:opacity-50"
        title={state.error ?? undefined}
      >
        削除
      </button>
    </form>
  );
}
