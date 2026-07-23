"use client";

// 出勤・退勤QRのスキャン即打刻（「スキャン即打刻」設定のスタッフ専用）
// マウント時に一度だけ GPS取得 → autoPunchAction を自動実行する。
// 成功後は router.replace で ?kind=attend を外し、リロード等での再実行を防ぐ。

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { autoPunchAction } from "./client-actions";
import type { AutoPunchState } from "./types";
import { buttonPrimaryClass } from "@/components/ui";
import { LateReasonForm } from "./clock-buttons";

const initialState: AutoPunchState = {
  error: null,
  success: false,
  punchedLabel: null,
  punchedTime: null,
  lateMinutes: 0,
  eventId: null,
  alreadyPunched: false,
  confirmOut: false,
};

export function AutoPunch({
  departmentId,
  token,
  onPunched,
}: {
  departmentId: string;
  token: string | null;
  /** 打刻成功後に呼ぶ（現在状態・タイムライン再取得のトリガー用） */
  onPunched?: () => void;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(autoPunchAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);
  const forceRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const fired = useRef(false);
  const [locating, setLocating] = useState(true);

  // StrictMode / 再レンダーでの多重発火を防ぎつつ、マウント時に一度だけ自動打刻する
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    if (!("geolocation" in navigator)) {
      setLocating(false);
      formRef.current?.requestSubmit();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (latRef.current) latRef.current.value = String(pos.coords.latitude);
        if (lngRef.current) lngRef.current.value = String(pos.coords.longitude);
        setLocating(false);
        formRef.current?.requestSubmit();
      },
      () => {
        // 取得失敗時も送信する（GPS必須の部署ならサーバー側で拒否される）
        setLocating(false);
        formRef.current?.requestSubmit();
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  // 打刻確定後だけURLからkind/tokenを外す（打刻済み表示・確認待ちはボタン操作の余地を残す）
  useEffect(() => {
    if (state.success) {
      router.replace("/clock");
      onPunched?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success, router]);

  function retry(withForce: boolean, withConfirm: boolean) {
    if (forceRef.current) forceRef.current.value = withForce ? "on" : "";
    if (confirmRef.current) confirmRef.current.value = withConfirm ? "on" : "";
    formRef.current?.requestSubmit();
  }

  return (
    <div className="space-y-4 text-center">
      <form ref={formRef} action={formAction} className="hidden">
        <input type="hidden" name="departmentId" value={departmentId} />
        {token && <input type="hidden" name="token" value={token} />}
        <input ref={latRef} type="hidden" name="lat" />
        <input ref={lngRef} type="hidden" name="lng" />
        <input ref={forceRef} type="hidden" name="force" />
        <input ref={confirmRef} type="hidden" name="confirm" />
      </form>

      {pending ? (
        <p className="text-sm text-muted">打刻しています...</p>
      ) : locating ? (
        <p className="text-sm text-muted">位置情報を確認しています...</p>
      ) : null}

      {!pending && state.confirmOut && (
        <div className="rounded-lg bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-800">外出中です。退勤しますか?</p>
          <button type="button" onClick={() => retry(false, true)} className={`${buttonPrimaryClass} mt-3`}>
            退勤する
          </button>
        </div>
      )}

      {!pending && state.alreadyPunched && (
        <div className="rounded-lg bg-violet-50 px-4 py-3">
          <p className="text-primary">
            <span className="font-semibold">{state.punchedLabel}</span>
            <span className="mx-1 font-mono text-lg font-semibold tabular-nums">
              {state.punchedTime}
            </span>
            を打刻済みです
          </p>
          <button
            type="button"
            onClick={() => retry(true, false)}
            className="mt-3 text-xs text-muted underline underline-offset-2"
          >
            続けて打刻する
          </button>
        </div>
      )}

      {state.success && state.punchedLabel && (
        <div className="space-y-3">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700">
            <span className="font-semibold">{state.punchedLabel}</span>
            <span className="mx-1 font-mono text-lg font-semibold tabular-nums">
              {state.punchedTime}
            </span>
            を記録しました
          </p>
          {state.lateMinutes > 0 && state.eventId && (
            <LateReasonForm eventId={state.eventId} lateMinutes={state.lateMinutes} onSaved={onPunched} />
          )}
        </div>
      )}

      {!pending && state.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2">
          <p className="text-sm text-red-600">{state.error}</p>
          <button
            type="button"
            onClick={() => retry(false, false)}
            className="mt-2 text-xs text-muted underline underline-offset-2"
          >
            もう一度試す
          </button>
        </div>
      )}
    </div>
  );
}
