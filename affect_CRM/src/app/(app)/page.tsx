"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetchJson } from "@/lib/auth/api-fetch";
import { useAuth } from "@/lib/auth/client";
import { formatYen } from "@/lib/display";
import {
  Badge,
  Empty,
  StatCard,
  StatusDot,
  buttonSecondaryClass,
  inlineLinkClass,
} from "@/components/ui";
import type { DashboardResponse } from "./types";

export default function DashboardPage() {
  const { status } = useAuth();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    apiFetchJson<DashboardResponse>("/api/dashboard")
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: Error) => {
        // 再取得に失敗しても表示中の内容は消さない（スタッフの作業を止めないため）
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  if (!data) {
    return <Empty>{error ? `読み込めませんでした（${error}）` : "読み込んでいます…"}</Empty>;
  }

  const s = data.stats;

  return (
    <div className="pb-8">
      <div className="flex items-start justify-between gap-4 px-5 pt-6 sm:px-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">ダッシュボード</h1>
          <p className="mt-1.5 text-xs text-gray-soft sm:text-[13px]">{data.date}</p>
        </div>
        <Link href="/visits/quick" className={`${buttonSecondaryClass} hidden sm:inline-flex`}>
          ＋ 来店登録
        </Link>
      </div>

      {/* 指標。今日の来店だけをアクセント色にして、最初に目が行く場所を 1 つに絞る */}
      <div className="mt-5 grid grid-cols-2 border-y border-line bg-card sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="今日の来店"
          value={s.todayVisits}
          unit="組"
          sub={`お名前あり ${s.todayNamedVisits} ／ 不明 ${s.todayAnonymousVisits}`}
          highlight
        />
        <StatCard
          label="今日の予約"
          value={s.todayReservations}
          unit="件"
          sub={`スクール ${s.todaySchoolReservations} 件`}
        />
        <StatCard label="今月の来店" value={s.monthVisits} unit="組" />
        <StatCard label="新規顧客" value={s.monthNewCustomers} unit="名" sub="今月" />
        <StatCard
          label="購入率"
          value={s.monthPurchaseRate}
          unit="%"
          sub={`購入 ${s.monthPurchasedVisits} ／ 未購入 ${s.monthUnpurchasedVisits}`}
        />
        <StatCard
          label="今月の売上"
          value={formatYen(s.monthSales)}
          sub={s.monthAverageSpend > 0 ? `客単価 ${formatYen(s.monthAverageSpend)}` : undefined}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 border-y border-line bg-card lg:grid-cols-2">
        <Panel title="今日の予約" href="/calendar" hrefLabel="カレンダーを見る">
          {data.todayReservations.length === 0 ? (
            <Row muted>今日の予約はありません</Row>
          ) : (
            data.todayReservations.map((r) => (
              <Row key={r.id}>
                <span className="tabular w-[42px] flex-none text-[13px] font-semibold text-navy">
                  {r.startTime}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{r.courseName}</span>
                  <span className="mt-0.5 block text-[11.5px] text-gray-soft">
                    {r.customerName} 様{r.headcount > 1 && ` ほか ${r.headcount - 1} 名`}
                    {r.staffName && `／担当 ${r.staffName}`}
                    {r.source === "WEB" && "／Web予約"}
                  </span>
                </span>
                <StatusDot tone={r.status === "TENTATIVE" ? "wait" : "ok"}>
                  {r.status === "TENTATIVE" ? "仮予約" : r.status === "ATTENDED" ? "参加済" : "確定"}
                </StatusDot>
              </Row>
            ))
          )}
        </Panel>

        <Panel title="今日フォローする顧客" href="/follow-ups" hrefLabel="すべて見る" bordered>
          {data.todayFollowUps.length === 0 ? (
            <Row muted>今日フォローする顧客はいません</Row>
          ) : (
            data.todayFollowUps.map((f) => (
              <Row key={f.id}>
                <span className="min-w-0 flex-1">
                  <Link href={`/customers/${f.customerId}`} className="font-semibold hover:underline">
                    {f.customerName}
                  </Link>
                  {f.overdue && <Badge>期限切れ</Badge>}
                  <span className="mt-0.5 block text-[11.5px] text-gray-soft">
                    {f.content}
                    {f.memo && `／${f.memo}`}
                  </span>
                </span>
              </Row>
            ))
          )}
        </Panel>
      </div>

      <div className="mt-6 grid grid-cols-1 border-y border-line bg-card lg:grid-cols-2">
        <Panel title="最近の来店" href="/visits" hrefLabel="来店一覧へ">
          {data.recentVisits.length === 0 ? (
            <Row muted>まだ来店の記録がありません</Row>
          ) : (
            data.recentVisits.map((v) => (
              <Row key={v.id}>
                <span className="tabular w-[42px] flex-none text-[13px] font-semibold text-ink-2">
                  {v.time}
                </span>
                <span className="min-w-0 flex-1">
                  {v.customerId ? (
                    <Link
                      href={`/customers/${v.customerId}`}
                      className="font-semibold hover:underline"
                    >
                      {v.displayName}
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-gray-soft">
                      <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-dashed border-gray-faint" />
                      {v.displayName}
                    </span>
                  )}
                  <span className="mt-0.5 block text-[11.5px] text-gray-soft">
                    {[v.purposeLabel && `目的：${v.purposeLabel}`, v.channelLabel && `経路：${v.channelLabel}`]
                      .filter(Boolean)
                      .join("／")}
                  </span>
                </span>
                <StatusDot tone={v.purchased ? "ok" : "off"}>
                  {v.purchased ? "購入" : "未購入"}
                </StatusDot>
              </Row>
            ))
          )}
        </Panel>

        <Panel title="最近の購入" href="/products/purchases" hrefLabel="購入履歴へ" bordered>
          {data.recentPurchases.length === 0 ? (
            <Row muted>まだ購入の記録がありません</Row>
          ) : (
            data.recentPurchases.map((p) => (
              <Row key={p.id}>
                <span className="min-w-0 flex-1">
                  <Link href={`/customers/${p.customerId}`} className="font-semibold hover:underline">
                    {p.customerName}
                  </Link>
                  <span className="mt-0.5 block truncate text-[11.5px] text-gray-soft">{p.items}</span>
                </span>
                <span className="tabular flex-none text-sm font-semibold">
                  {formatYen(p.totalAmount)}
                </span>
              </Row>
            ))
          )}
        </Panel>
      </div>
    </div>
  );
}

function Panel({
  title,
  href,
  hrefLabel,
  bordered = false,
  children,
}: {
  title: string;
  href: string;
  hrefLabel: string;
  bordered?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`px-5 pt-4 pb-2 sm:px-6 ${bordered ? "border-t border-line-2 lg:border-t-0 lg:border-l" : ""}`}>
      <div className="mb-1.5 flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wider text-gray-soft">{title}</h2>
        <Link href={href} className={inlineLinkClass}>
          {hrefLabel}
        </Link>
      </div>
      {children}
    </div>
  );
}

function Row({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  if (muted) {
    return <p className="py-6 text-center text-[13px] text-gray-faint">{children}</p>;
  }
  return (
    <div className="flex items-center gap-3.5 border-b border-line-2 py-3 text-[13px] last:border-b-0">
      {children}
    </div>
  );
}
