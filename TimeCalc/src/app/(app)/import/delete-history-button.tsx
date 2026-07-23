"use client";

// 取込履歴の削除ボタン（確認ダイアログ付き）
// 履歴ログを消すだけで、取り込んだ勤怠データ自体は削除されない

import { useActionState, useEffect } from "react";
import { deleteImportHistoryAction } from "./client-actions";
import type { DeleteHistoryState } from "./types";

const initialState: DeleteHistoryState = { error: null };

export function DeleteHistoryButton({
  historyId,
  onDeleted,
}: {
  historyId: string;
  /** 削除成功後に呼ぶ（一覧の再取得トリガー用） */
  onDeleted?: () => void;
}) {
  const [state, formAction, pending] = useActionState(deleteImportHistoryAction, initialState);

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
