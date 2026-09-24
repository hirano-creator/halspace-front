"use client";

// 社員詳細（締め期間の日別勤務・残業・金額の一覧と月度合計）

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useRequireAuth } from "@/lib/auth/client";
import { apiFetchJson } from "@/lib/auth/api-fetch";
import { formatYen } from "@/lib/attendance/calculator";
import { formatMinutes } from "@/lib/utils/time";
import { Badge, Card, TableCard } from "@/components/ui";
import { MonthPicker } from "@/components/month-picker";
import { AttendanceEditor } from "./attendance-editor";
import { PrintButton } from "./print-button";
import type { EmployeeDetailResponse } from "./types";

/** 修正履歴の変更内容を「前 → 後」で表示する */
function formatLogChange(before: string | null, after: string | null): string {
  const fmt = (json: string | null): string => {
    if (!json) return "なし";
    try {
      const v = JSON.parse(json) as { clockIn?: string; clockOut?: string; breakMinutes?: number };
      return `${v.clockIn ?? "?"}〜${v.clockOut ?? "?"}・休憩${v.breakMinutes ?? 0}分`;
    } catch {
      return "?";
    }
  };
  return `${fmt(before)} → ${fmt(after)}`;
}

type SummaryItem = {
  label: string;
  value: string;
  sub?: string;
  /** 数字の色で種類をほのめかす（amber=割増系・要注意、primary=金額の主役） */
  tone?: "amber" | "primary";
};

/**
 * 月度サマリーの帯。カードをやめて「上に項目名・下に数字」を均等幅で並べ、項目間を縦線で区切る。
 * スマホは4列で折り返すため、各行の先頭では縦線を消す（md以上は1行に並ぶので先頭だけ消す）。
 */
function SummaryStrip({ items, className = "" }: { items: SummaryItem[]; className?: string }) {
  const colsClass = items.length > 7 ? "md:grid-cols-8" : "md:grid-cols-7";
  return (
    <div
      className={`mt-3 grid grid-cols-4 gap-y-3 rounded-lg border border-border bg-surface py-2.5 ${colsClass} ${className}`}
    >
      {items.map((item, i) => {
        const dividerClass = i === 0 ? "" : i % 4 === 0 ? "md:border-l-2" : "border-l-2";
        const valueClass =
          item.tone === "amber"
            ? "text-amber-700"
            : item.tone === "primary"
              ? "text-primary"
              : "text-foreground";
        return (
          <div
            key={item.label}
            className={`flex min-w-0 flex-col items-center gap-0.5 border-slate-300 px-2 text-center ${dividerClass}`}
          >
            <p className="text-[11px] whitespace-nowrap text-muted">{item.label}</p>
            <p className={`text-lg leading-tight font-bold tabular-nums ${valueClass}`}>
              {item.value}
            </p>
            {item.sub && <p className="text-[10px] leading-tight text-muted">{item.sub}</p>}
          </div>
        );
      })}
    </div>
  );
}

export default function EmployeeDetailPage() {
  const { status: authStatus } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const month = searchParams.get("month") ?? "";

  const [data, setData] = useState<EmployeeDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);
  // 「すでに表示できている内容があるか」を再取得の失敗時に参照する
  // （取得の effect の依存配列に data を入れると再取得ループになるため ref で持つ）
  const hasDataRef = useRef(false);
  useEffect(() => {
    hasDataRef.current = data !== null;
  }, [data]);
  // 取得中かどうか。サーバーが遅いときに定期再取得が前回の応答を待たずに重なり、
  // 開きっぱなしのタブが未応答リクエストを積み上げていくのを防ぐ
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    const qs = new URLSearchParams();
    if (month) qs.set("month", month);

    let cancelled = false;
    inFlightRef.current = true;
    apiFetchJson<EmployeeDetailResponse>(`/api/employees/${params.id}/detail?${qs.toString()}`)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setError(null);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        // 定期再取得が一時的に失敗しただけなら、表示中の内容を消さずに次回へ回す
        // （画面がまるごとエラーに置き換わると、読めていた勤怠まで見えなくなるため）
        if (hasDataRef.current) {
          console.warn("勤怠の再取得に失敗しました（表示は前回の内容を維持します）", e);
          return;
        }
        setError(e.message);
      })
      .finally(() => {
        if (!cancelled) inFlightRef.current = false;
      });
    return () => {
      cancelled = true;
      inFlightRef.current = false;
    };
  }, [authStatus, params.id, month, refreshKey]);

  // 他端末での打刻をほぼリアルタイムに反映するため、表示中は定期的に再取得する
  // （間隔を詰めすぎると重い集計が並行して走り、サーバー側が詰まりやすくなる）
  useEffect(() => {
    if (authStatus !== "authenticated") return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible" && !inFlightRef.current) refetch();
    }, 30000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [authStatus, refetch]);

  // 表を下にたどっても社員名・月度・サマリーを見失わないよう、ページ上部を画面上端に固定する。
  // 表の高さは「画面の残り」にしたいが、固定部の高さはバッジの折り返しや金額列の有無で変わるため、
  // 実測してCSS変数で渡す（スマホは縦が狭く固定すると表がほとんど見えないのでmd未満は固定しない）。
  const stickyHeadRef = useRef<HTMLDivElement>(null);
  const [stickyHeadHeight, setStickyHeadHeight] = useState(0);
  const isReady = data !== null;
  useEffect(() => {
    const el = stickyHeadRef.current;
    if (!el) return;
    const update = () => setStickyHeadHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isReady]);

  if (authStatus === "unauthenticated") return null;
  if (authStatus === "loading" || !data) {
    return <p className="py-8 text-center text-sm text-muted">読み込み中...</p>;
  }
  if (error) {
    return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>;
  }

  const showMoney = data.showMoney;

  return (
    <div className="print-attendance-sheet">
      <div
        ref={stickyHeadRef}
        className="bg-background md:sticky md:top-0 md:z-30 md:pb-6 print:static print:pb-0"
      >
        {/* 印刷で1ページ目に表を多く入れるため、名前・属性・月度を1段にまとめて下線で区切る */}
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b-2 border-foreground pb-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-xl font-semibold tracking-tight">{data.employee.name}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-700">
              <span>
                <span className="mr-1 text-muted">社員番号</span>
                {data.employee.employeeCode}
              </span>
              <span>
                <span className="mr-1 text-muted">所属</span>
                {data.employee.departmentName ?? "部署未設定"}
              </span>
              {showMoney && (
                <span>
                  <span className="mr-1 text-muted">時給</span>
                  {formatYen(data.employee.hourlyWage)}
                </span>
              )}
              <Badge tone={data.employee.isActive ? "green" : "red"}>
                {data.employee.isActive ? "在籍中" : "退職済"}
              </Badge>
              <Badge tone="purple">{data.roleLabels[data.employee.role]}</Badge>
              {showMoney && data.employee.hourlyWage === 0 && (
                <Badge tone="amber">時給未設定（金額は¥0になります）</Badge>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-xs text-gray-700">
              {data.year}年{data.monthNum}月度（{data.periodRangeLabel}・締め{data.closingDay}日）
            </span>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <PrintButton />
              <form method="get">
                <MonthPicker defaultValue={data.month} />
              </form>
            </div>
          </div>
        </div>

        {/* 固定時の下余白は親の md:pb-6 が持つため、md以上ではこの mb を外す */}
        <SummaryStrip
          className="mb-6 md:mb-0 print:mb-2"
          items={[
            { label: "勤務日数", value: `${data.summary.workDays}日` },
            // 週単位管理の会社は残業を週合計で区分するため、早出残業・残業の代わりに2区分を出す
            ...(data.weeklyTotals
              ? [
                  { label: "勤務時間", value: formatMinutes(data.weeklyTotals.totalMinutes) },
                  {
                    label: "控除時間",
                    value: formatMinutes(data.monthTotal.deductionMinutes),
                    tone: data.monthTotal.deductionMinutes > 0 ? ("amber" as const) : undefined,
                  },
                  {
                    label: "法定外残業",
                    value: formatMinutes(data.summary.legalOvertimeMinutes),
                    tone: "amber" as const,
                  },
                  {
                    label: "36H超44H以内",
                    value: formatMinutes(data.weeklyTotals.withinLegalOvertimeMinutes),
                    tone: "amber" as const,
                  },
                  {
                    label: "44H超",
                    value: formatMinutes(data.weeklyTotals.overLegalOvertimeMinutes),
                    tone: "amber" as const,
                  },
                ]
              : [
                  { label: "勤務時間", value: formatMinutes(data.monthTotal.workMinutes) },
                  {
                    label: "控除時間",
                    value: formatMinutes(data.monthTotal.deductionMinutes),
                    tone: data.monthTotal.deductionMinutes > 0 ? ("amber" as const) : undefined,
                  },
                  {
                    label: "法定外残業",
                    value: formatMinutes(data.summary.legalOvertimeMinutes),
                    tone: "amber" as const,
                  },
                  {
                    label: "早出残業",
                    value: formatMinutes(data.monthTotal.earlyOvertimeMinutes),
                    tone: "amber" as const,
                  },
                  {
                    label: "残業時間",
                    value: formatMinutes(data.monthTotal.overtimeMinutes),
                    tone: "amber" as const,
                  },
                ]),
            {
              label: "遅刻・早退",
              value: `${data.summary.lateCount}・${data.summary.earlyLeaveCount}回`,
              tone:
                data.summary.lateCount + data.summary.earlyLeaveCount > 0
                  ? ("amber" as const)
                  : undefined,
            },
            ...(showMoney
              ? [
                  {
                    label: "支給額（概算）",
                    value: formatYen(data.payTotal.totalPay),
                    sub: `金額 ${formatYen(data.payTotal.basePay)} ＋ 残業代 ${formatYen(data.payTotal.premiumPay)}`,
                    tone: "primary" as const,
                  },
                ]
              : []),
          ]}
        />
      </div>

      {/* 表だけを画面の残り高さの中でスクロールさせ、列見出し（表ヘッダー）を上端に固定する。
          印刷時は高さ制限・スクロールを解除し、月度の全日をそのまま複数ページに流し込む
          （表のheadは印刷時もページをまたいで自動的に繰り返される） */}
      <TableCard
        scrollClassName="md:max-h-[var(--tc-table-max-h)] md:overflow-y-auto print:max-h-none! print:overflow-visible!"
        scrollStyle={
          { "--tc-table-max-h": `calc(100vh - ${stickyHeadHeight}px - 4.5rem)` } as CSSProperties
        }
      >
        <AttendanceEditor
          userId={data.employee.id}
          rows={data.rows}
          editable={data.editable}
          showMoney={showMoney}
          weeks={data.weeks}
          onChanged={refetch}
        />
      </TableCard>

      {/* 修正履歴は監査用の補足情報のため、印刷（月次勤怠表）には含めない */}
      {data.logs.length > 0 && (
        <Card className="mt-6 print:hidden">
          <h2 className="mb-2 text-sm font-semibold text-muted">修正履歴（この月度・直近30件）</h2>
          <ul className="divide-y divide-border">
            {data.logs.map((log) => (
              <li key={log.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="font-medium">{log.date}</span>
                <Badge
                  tone={
                    log.action === "DELETE" || log.action === "REJECT"
                      ? "red"
                      : log.action === "APPROVE"
                        ? "green"
                        : "gray"
                  }
                >
                  {log.action === "EDIT"
                    ? "修正"
                    : log.action === "DELETE"
                      ? "削除"
                      : log.action === "APPROVE"
                        ? "申請承認"
                        : "申請却下"}
                </Badge>
                <span className="font-mono text-xs tabular-nums text-muted">
                  {formatLogChange(log.before, log.after)}
                </span>
                <span className="text-xs text-muted">
                  {log.actorName ?? "（削除済みユーザー）"} ・ {log.createdAtLabel}
                </span>
                {log.note && <span className="text-xs text-muted">（{log.note}）</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
