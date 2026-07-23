"use client";

// 打刻ボタン（出勤・退勤・外出・戻り）
// Geolocation取得 → punchAction呼び出し。状態に応じて押せるボタンのみ活性化し誤打刻を防ぐ。

import { useActionState, useEffect, useRef, useState } from "react";
import { punchAction, saveEventReasonAction } from "./client-actions";
import type { PunchState, ReasonState } from "./types";
import type { ClockEventType } from "@/lib/attendance/clock";
import { buttonPrimaryClass, inputClass } from "@/components/ui";

const initialState: PunchState = {
  error: null,
  success: false,
  punchedLabel: null,
  punchedTime: null,
  lateMinutes: 0,
  eventId: null,
};

const initialReasonState: ReasonState = { error: null, success: false };

// タップ領域を大きく取った打刻ボタンの共通クラス（スマホの誤タップ防止に最低高さを確保）
const punchButtonBase =
  "flex min-h-20 flex-col items-center justify-center gap-0.5 rounded-xl border text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 disabled:saturate-0";

/** 遅刻時などに打刻直後へ理由を追記するフォーム */
export function LateReasonForm({
  eventId,
  lateMinutes,
  onSaved,
}: {
  eventId: string;
  lateMinutes: number;
  /** 保存成功後に呼ぶ（タイムライン再取得のトリガー用） */
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveEventReasonAction, initialReasonState);

  useEffect(() => {
    if (state.success) onSaved?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  if (state.success) {
    return (
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        理由を記録しました
      </p>
    );
  }

  return (
    <form action={formAction} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <input type="hidden" name="eventId" value={eventId} />
      <p className="text-sm font-medium text-amber-800">
        始業時刻より{lateMinutes}分遅い打刻です
      </p>
      <p className="mt-0.5 text-xs text-amber-700">
        遅刻理由を記入できます（後からマイページでも記入できます）
      </p>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          name="reason"
          placeholder="例: 電車遅延のため"
          maxLength={200}
          className={inputClass}
        />
        <button type="submit" disabled={pending} className={`${buttonPrimaryClass} shrink-0`}>
          {pending ? "保存中..." : "記入する"}
        </button>
      </div>
      {state.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

export function ClockButtons({
  departmentId,
  token,
  kind,
  mode = "full",
  canClockIn,
  canClockOut,
  canOutStart,
  canOutEnd,
  onPunched,
}: {
  departmentId: string | null;
  token: string | null;
  /** 打刻したQRコードの種類（punchAction側のkind×type整合チェック用） */
  kind?: "attend" | "outing" | null;
  /** ボタンの絞り込み: full=4つ全部 / attend=出勤・退勤のみ / outing=外出・戻りのみ */
  mode?: "full" | "attend" | "outing";
  canClockIn: boolean;
  canClockOut: boolean;
  canOutStart: boolean;
  canOutEnd: boolean;
  /** 打刻成功後に呼ぶ（現在状態・タイムライン再取得のトリガー用） */
  onPunched?: () => void;
}) {
  const [state, formAction, pending] = useActionState(punchAction, initialState);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [showReason, setShowReason] = useState(false);

  useEffect(() => {
    if (state.success) onPunched?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  const formRef = useRef<HTMLFormElement>(null);
  const typeRef = useRef<HTMLInputElement>(null);
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);

  function punch(type: ClockEventType) {
    setGeoError(null);
    if (typeRef.current) typeRef.current.value = type;

    if (!("geolocation" in navigator)) {
      formRef.current?.requestSubmit();
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (latRef.current) latRef.current.value = String(pos.coords.latitude);
        if (lngRef.current) lngRef.current.value = String(pos.coords.longitude);
        setLocating(false);
        formRef.current?.requestSubmit();
      },
      () => {
        // 取得失敗時も送信する（GPS必須の部署ならサーバー側で拒否される）
        setGeoError("位置情報を取得できませんでした");
        setLocating(false);
        formRef.current?.requestSubmit();
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const busy = pending || locating;

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <input ref={typeRef} type="hidden" name="type" />
      <input ref={latRef} type="hidden" name="lat" />
      <input ref={lngRef} type="hidden" name="lng" />
      {departmentId && <input type="hidden" name="departmentId" value={departmentId} />}
      {token && <input type="hidden" name="token" value={token} />}
      {kind && <input type="hidden" name="kind" value={kind} />}

      <div className="grid grid-cols-2 gap-3">
        {mode !== "outing" && (
          <button
            type="button"
            onClick={() => punch("IN")}
            disabled={!canClockIn || busy}
            className={`${punchButtonBase} border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700`}
          >
            出勤
          </button>
        )}
        {mode !== "outing" && (
          <button
            type="button"
            onClick={() => punch("OUT")}
            disabled={!canClockOut || busy}
            className={`${punchButtonBase} border-primary bg-primary text-white hover:bg-primary-hover`}
          >
            退勤
          </button>
        )}
        {mode !== "attend" && (
          <button
            type="button"
            onClick={() => punch("OUT_START")}
            disabled={!canOutStart || busy}
            className={`${punchButtonBase} border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100`}
          >
            外出
            <span className="text-[11px] font-normal">勤務時間から除外</span>
          </button>
        )}
        {mode !== "attend" && (
          <button
            type="button"
            onClick={() => punch("OUT_END")}
            disabled={!canOutEnd || busy}
            className={`${punchButtonBase} border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100`}
          >
            戻り
            <span className="text-[11px] font-normal">外出から復帰</span>
          </button>
        )}
      </div>

      {busy && <p className="text-center text-sm text-muted">処理中...</p>}

      <div>
        <button
          type="button"
          onClick={() => setShowReason((v) => !v)}
          className="text-xs text-muted underline-offset-2 hover:underline"
        >
          {showReason ? "理由の記入を閉じる" : "理由を記入して打刻する（遅刻・外出理由など）"}
        </button>
        {showReason && (
          <input
            type="text"
            name="reason"
            placeholder="例: 通院のため外出"
            maxLength={200}
            className={`${inputClass} mt-2`}
          />
        )}
      </div>

      {geoError && <p className="text-xs text-amber-600">{geoError}</p>}
      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
      )}
      {state.success && state.punchedLabel && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-emerald-700">
          <span className="font-semibold">{state.punchedLabel}</span>
          <span className="mx-1 font-mono text-lg font-semibold tabular-nums">
            {state.punchedTime}
          </span>
          を記録しました
        </p>
      )}
      {state.success && state.lateMinutes > 0 && state.eventId && (
        <LateReasonForm eventId={state.eventId} lateMinutes={state.lateMinutes} onSaved={onPunched} />
      )}
    </form>
  );
}
