"use client";

// データ分析
//
// このシステムで最も価値があるのは「なぜ買わなかったか」なので、
// 未購入分析を独立したタブにして、そこから「検討中」の顧客へ直接飛べるようにしている。
//
// グラフは内容で使い分ける（部品の一覧と目安は components/charts.tsx の冒頭）。
//   構成比 → 円グラフ / 時間帯・曜日・年代 → 縦棒 / 長い名前のランキング → 横棒 /
//   曜日 × 時間帯 → ヒートマップ / 単独の数字 → 数値タイル

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetchJson, downloadFile } from "@/lib/auth/api-fetch";
import { useAuth } from "@/lib/auth/client";
import { can } from "@/lib/auth/roles";
import { isRegularHoliday } from "@/lib/constants";
import { formatYen } from "@/lib/display";
import { PERIOD_KEYS, PERIOD_LABELS, type PeriodKey } from "@/lib/analytics-period";
import { WEEKDAY_LABELS, formatJstDate } from "@/lib/utils/time";
import {
  BarList,
  ColumnChart,
  HeatmapGrid,
  MiniStats,
  PieChart,
  RateList,
  RatioDonut,
  type ColumnRow,
} from "@/components/charts";
import { Empty, StatCard, buttonSecondaryClass, filterClass, inputClass } from "@/components/ui";
import type { AnalyticsResponse, HourBucket, RateBucket } from "./types";

const TABS = [
  { key: "visit", label: "来店" },
  { key: "purchase", label: "購入" },
  { key: "noPurchase", label: "未購入" },
  { key: "school", label: "スクール" },
  { key: "funnel", label: "顧客行動" },
] as const;

const EXPORTS = [
  { type: "customers", label: "顧客", personal: true },
  { type: "visits", label: "来店履歴", personal: true },
  { type: "purchases", label: "購入履歴", personal: true },
  { type: "schools", label: "スクール履歴", personal: false },
  { type: "reservations", label: "予約", personal: true },
  { type: "follow-ups", label: "フォロー履歴", personal: true },
];

// 時間帯別の表示範囲の目安（営業時間）。この外の時刻に来店があれば、その分だけ広げる
const DEFAULT_HOUR_FROM = 9;
const DEFAULT_HOUR_TO = 20;

export default function AnalyticsPage() {
  const { user, status } = useAuth();
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [from, setFrom] = useState(formatJstDate(new Date()));
  const [to, setTo] = useState(formatJstDate(new Date()));
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("visit");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const load = useCallback(() => {
    if (status !== "authenticated") return;
    const params = new URLSearchParams({ period });
    if (period === "custom") {
      params.set("from", from);
      params.set("to", to);
    }
    apiFetchJson<AnalyticsResponse>(`/api/analytics?${params}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [status, period, from, to]);

  useEffect(load, [load]);

  const canExportPersonal = user ? can(user.role, "export.personal") : false;

  async function exportCsv(type: string) {
    const params = new URLSearchParams({ type, period });
    if (period === "custom") {
      params.set("from", from);
      params.set("to", to);
    }
    try {
      await downloadFile(`/api/export?${params}`);
    } catch {
      setError("出力できませんでした");
    }
  }

  return (
    <div className="pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-6 sm:px-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">データ分析</h1>
          <p className="mt-1.5 text-xs text-gray-soft sm:text-[13px]">
            {data ? data.period.label : "　"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExportOpen((o) => !o)}
          className={buttonSecondaryClass}
        >
          CSV 出力
        </button>
      </div>

      {exportOpen && (
        <div className="mt-3 border-y border-line bg-card px-5 py-4 sm:px-8">
          <p className="text-[12.5px] text-gray-soft">
            表示中の期間で出力します。Excel で開ける形式（BOM 付き UTF-8）です。
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {EXPORTS.map((e) => {
              const blocked = e.personal && !canExportPersonal;
              return (
                <button
                  key={e.type}
                  type="button"
                  disabled={blocked}
                  onClick={() => exportCsv(e.type)}
                  title={blocked ? "個人情報を含むため管理者のみ出力できます" : undefined}
                  className={`${buttonSecondaryClass} text-[13px] disabled:opacity-40`}
                >
                  {e.label}
                </button>
              );
            })}
          </div>
          {!canExportPersonal && (
            <p className="mt-2 text-[11.5px] text-gray-soft">
              氏名や連絡先を含む出力は管理者のみ可能です。
            </p>
          )}
        </div>
      )}

      {/* 期間 */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-y border-line bg-card px-5 py-3 sm:px-8">
        <div className="flex gap-1.5 overflow-x-auto">
          {PERIOD_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setPeriod(k)}
              className={filterClass(period === k)}
            >
              {PERIOD_LABELS[k]}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              className={`${inputClass} w-auto`}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span className="text-gray-soft">〜</span>
            <input
              type="date"
              className={`${inputClass} w-auto`}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        )}
      </div>

      {error && <p className="px-5 py-3 text-[13px] text-danger sm:px-8">{error}</p>}

      {!data ? (
        <Empty>読み込んでいます…</Empty>
      ) : (
        <>
          {/* 全体の要約 */}
          <div className="grid grid-cols-2 border-b border-line bg-card sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="来店" value={data.visit.total} unit="組" highlight />
            <StatCard label="新規" value={data.visit.newCustomers} unit="組" />
            <StatCard label="購入率" value={data.purchase.purchaseRate} unit="%" />
            <StatCard label="売上" value={formatYen(data.purchase.sales)} />
            <StatCard
              label="客単価"
              value={data.purchase.averageSpend > 0 ? formatYen(data.purchase.averageSpend) : "—"}
            />
            <StatCard label="スクール参加" value={data.school.attendees} unit="名" />
          </div>

          {/* タブ */}
          <div className="flex gap-1 overflow-x-auto border-b border-line bg-card px-5 sm:px-8">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`min-h-11 flex-none border-b-2 px-3 text-[13px] ${
                  tab === t.key
                    ? "border-accent font-semibold text-accent"
                    : "border-transparent text-gray-soft"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="bg-card px-5 pb-6 sm:px-8">
            {tab === "visit" && <VisitTab data={data} />}
            {tab === "purchase" && <PurchaseTab data={data} />}
            {tab === "noPurchase" && <NoPurchaseTab data={data} />}
            {tab === "school" && <SchoolTab data={data} />}
            {tab === "funnel" && (
              <div className="max-w-[560px] py-4">
                <p className="mb-4 text-[12.5px] leading-relaxed text-gray-soft">
                  お客様が次の行動に進んだ割合です。分母が小さいうちは数字が振れるので、
                  件数と合わせて見てください。
                </p>
                <RateList
                  rows={[
                    data.funnel.visitToPurchase,
                    data.funnel.visitToSchool,
                    data.funnel.schoolToPurchase,
                    data.funnel.firstToSecondVisit,
                    data.funnel.noPurchaseToLaterPurchase,
                  ]}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 来店

function VisitTab({ data }: { data: AnalyticsResponse }) {
  const hours = hourWindow(data.visit.byHour);
  const hourRows: ColumnRow[] = hours.map((h) => ({
    label: `${h}`,
    value: data.visit.byHour[h]?.count ?? 0,
  }));

  const weekdayRows: ColumnRow[] = data.visit.byWeekday.map((w) => ({
    label: WEEKDAY_LABELS[w.weekday],
    value: w.count,
    // 棒は合計なので、曜日の出現回数が違う期間でも比べられるよう 1 日平均を添える
    note:
      isRegularHoliday(w.weekday) && w.count === 0
        ? "定休"
        : w.days > 0
          ? `${(w.count / w.days).toFixed(1)}/日`
          : undefined,
    muted: isRegularHoliday(w.weekday),
    labelClass: weekdayLabelClass(w.weekday),
  }));

  return (
    <div className="grid gap-x-10 gap-y-2 lg:grid-cols-2">
      <Section title="来店の内訳">
        <div className="py-2">
          <RatioDonut
            value={data.visit.namedRate}
            label="お名前を伺えた率"
            sub={`${data.visit.named} 組 / ${data.visit.total} 組。声をかけられているかの目安になります`}
          />
        </div>
        <PieChart
          segments={[
            { label: "新規", value: data.visit.newCustomers },
            { label: "リピーター", value: data.visit.repeaters },
            { label: "お名前不明", value: data.visit.anonymous },
          ]}
          unit=" 組"
        />
      </Section>
      <Section
        title="男女比"
        sub="グループの内訳を入力した場合は人数分、していない場合は代表値を人数分として数えています"
      >
        <PieChart segments={toRows(data.visit.byGender)} unit=" 人" />
      </Section>

      <Section title="時間帯別の来店" sub="来店時刻（時）ごとの組数。混む時間が分かります">
        <ColumnChart rows={hourRows} />
      </Section>
      <Section title="曜日別の来店" sub="棒は合計、下の数字は 1 日平均の組数。赤は日曜と定休日">
        <ColumnChart rows={weekdayRows} />
      </Section>
      <Section title="曜日 × 時間帯" sub="色が濃いほど来店が多い時間帯（組）。横は時刻（時）">
        <HeatmapGrid
          rows={data.visit.byWeekday.map((w) => ({
            label: WEEKDAY_LABELS[w.weekday],
            labelClass: weekdayLabelClass(w.weekday),
          }))}
          cols={hours.map((h) => `${h}`)}
          values={data.visit.byWeekdayHour.map((row) => hours.map((h) => row[h] ?? 0))}
          unit=" 組"
        />
      </Section>
      <Section title="年代別">
        <ColumnChart
          rows={data.visit.byAgeGroup.map((b) => ({
            label: b.label,
            value: b.count,
            muted: isNeutralLabel(b.label),
          }))}
          unit="人"
        />
      </Section>

      <Section title="来店目的">
        <PieChart segments={toRows(data.visit.byPurpose)} unit=" 組" />
      </Section>
      <Section title="来店経路" sub="経路を複数選んだ来店は、それぞれの経路に数えます">
        <PieChart segments={toRows(data.visit.byChannel)} unit=" 組" />
      </Section>
      <Section title="地域別">
        <BarList rows={toRows(data.visit.byPrefecture)} unit=" 組" limit={10} />
      </Section>
      <Section title="何を見て来たか">
        <BarList rows={toRows(data.visit.byReferrer)} unit=" 組" />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 購入

function PurchaseTab({ data }: { data: AnalyticsResponse }) {
  const weekdaySales: ColumnRow[] = data.purchase.byWeekday.map((w) => ({
    label: WEEKDAY_LABELS[w.weekday],
    value: w.amount,
    note: w.count > 0 ? `${w.count} 件` : undefined,
    muted: isRegularHoliday(w.weekday),
    labelClass: weekdayLabelClass(w.weekday),
  }));

  return (
    <div className="grid gap-x-10 gap-y-2 lg:grid-cols-2">
      <Section title="購入・未購入">
        <div className="py-2">
          <RatioDonut
            value={data.purchase.purchaseRate}
            label="購入率"
            sub={`購入 ${data.purchase.purchasedVisits} 組 / 未購入 ${data.purchase.unpurchasedVisits} 組`}
          />
        </div>
      </Section>
      <Section title="売上">
        <MiniStats
          items={[
            { label: "売上", value: formatYen(data.purchase.sales) },
            { label: "購入件数", value: data.purchase.purchaseCount, unit: "件" },
            {
              label: "客単価",
              value: data.purchase.averageSpend > 0 ? formatYen(data.purchase.averageSpend) : "—",
            },
          ]}
        />
      </Section>
      <Section title="カテゴリー別の売上">
        <PieChart
          segments={data.purchase.byCategory.map((b) => ({ label: b.label, value: b.amount }))}
          format={formatYen}
          centerText={formatYenCompact(data.purchase.sales)}
        />
      </Section>
      <Section title="商品別の売上">
        <BarList
          rows={data.purchase.byProduct.map((b) => ({
            label: b.label,
            value: b.amount,
            note: `${b.count} 点`,
          }))}
          unit=" 円"
          limit={10}
        />
      </Section>
      <Section title="曜日別の売上" sub="棒は売上（円）、下の数字は購入件数。赤は日曜と定休日">
        <ColumnChart rows={weekdaySales} format={formatManCompact} />
      </Section>
      <Section title="年代別の購入率" sub="棒は購入率、下の数字は 購入 / 来店">
        <ColumnChart rows={rateRows(data.purchase.rateByAgeGroup)} unit="%" />
      </Section>
      <Section title="性別の購入率">
        <RateList rows={data.purchase.rateByGender} />
      </Section>
      <Section title="来店経路別の購入率">
        <RateList rows={data.purchase.rateByChannel} />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 未購入

function NoPurchaseTab({ data }: { data: AnalyticsResponse }) {
  return (
    <>
      <div className="grid gap-x-10 gap-y-2 lg:grid-cols-2">
        <Section title="未購入の割合">
          <div className="py-2">
            <RatioDonut
              value={data.noPurchase.rate}
              label="未購入率"
              sub={`${data.noPurchase.count} 組 / ${data.visit.total} 組`}
            />
          </div>
        </Section>
        <Section title="未購入の理由">
          <PieChart segments={toRows(data.noPurchase.byReason)} unit=" 組" />
        </Section>
        <Section title="未購入だった方が見ていた商品">
          <BarList rows={toRows(data.noPurchase.byInterest)} unit=" 組" />
        </Section>
        <Section title="年代別の未購入率" sub="棒は未購入率、下の数字は 未購入 / 来店">
          <ColumnChart rows={rateRows(data.noPurchase.rateByAgeGroup)} unit="%" />
        </Section>
        <Section title="来店経路別の未購入率">
          <RateList rows={data.noPurchase.rateByChannel} />
        </Section>
      </div>

      {/* このシステムで最も使う一覧 */}
      <div className="mt-4 rounded-lg border border-accent">
        <div className="flex items-center justify-between border-b border-line-2 bg-accent-soft px-4 py-3">
          <h2 className="text-[13px] font-semibold text-accent">
            「検討中」で帰られた方（{data.noPurchase.considering.length} 名）
          </h2>
          <span className="text-[11.5px] text-gray-soft">次の提案先</span>
        </div>
        {data.noPurchase.considering.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-gray-faint">
            この期間に「検討中」で帰られた方はいません
          </p>
        ) : (
          <ul className="divide-y divide-line-2">
            {data.noPurchase.considering.map((c) => (
              <li key={c.visitId} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  {c.customerId ? (
                    <Link
                      href={`/customers/${c.customerId}`}
                      className="text-[14px] font-semibold hover:underline"
                    >
                      {c.name}
                    </Link>
                  ) : (
                    <span className="text-[14px] text-gray-soft">{c.name}</span>
                  )}
                  <span className="tabular ml-2 text-[11.5px] text-gray-soft">{c.visitedAt}</span>
                  <p className="mt-0.5 text-[12px] text-gray-soft">
                    {c.interestNames.length > 0 ? `興味：${c.interestNames.join("・")}` : ""}
                    {c.comment && `／${c.comment}`}
                  </p>
                </div>
                {c.phone && (
                  <a
                    href={`tel:${c.phone.replace(/\D/g, "")}`}
                    className="tabular inline-flex flex-none items-center py-2 -my-2 text-[12.5px] text-accent hover:underline"
                  >
                    {c.phone}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// スクール

function SchoolTab({ data }: { data: AnalyticsResponse }) {
  return (
    <div className="grid gap-x-10 gap-y-2 lg:grid-cols-2">
      <Section title="開催と参加">
        <MiniStats
          items={[
            { label: "開催数", value: data.school.sessions, unit: "回" },
            { label: "参加人数", value: data.school.attendees, unit: "名" },
            { label: "1 回あたり", value: data.school.averagePerSession, unit: "名" },
            { label: "キャンセル率", value: data.school.cancelRate, unit: "%" },
          ]}
        />
      </Section>
      <Section title="定員充足率">
        <div className="py-2">
          <RatioDonut
            value={data.school.fillRate}
            label="定員充足率"
            sub={`参加 ${data.school.attendees} 名 / 定員 ${data.school.capacity} 名`}
          />
        </div>
      </Section>
      <Section title="新規とリピーター" sub="期間より前に参加したことがある方をリピーターとしています">
        <PieChart
          segments={[
            { label: "新規参加", value: data.school.newAttendees },
            { label: "リピーター", value: data.school.repeatAttendees },
          ]}
          unit=" 名"
        />
      </Section>
      <Section title="キャンセル">
        <MiniStats
          items={[
            { label: "キャンセル", value: data.school.cancelled, unit: "件" },
            { label: "無断キャンセル", value: data.school.noShow, unit: "件" },
          ]}
        />
      </Section>
      <Section title="コース別の参加者">
        <PieChart segments={toRows(data.school.byCourse)} unit=" 名" />
      </Section>
      <Section title="スタッフ別の担当数">
        <BarList rows={toRows(data.school.byStaff)} unit=" 名" />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 共通

function toRows(buckets: { label: string; count: number }[]) {
  return buckets.map((b) => ({ label: b.label, value: b.count }));
}

/** 率の一覧を縦棒用に。分母が無い行（来店 0）は出さない */
function rateRows(rows: RateBucket[]): ColumnRow[] {
  return rows
    .filter((r) => r.total > 0)
    .map((r) => ({
      label: r.label,
      value: r.rate,
      note: `${r.hit}/${r.total}`,
      muted: isNeutralLabel(r.label),
    }));
}

/** 「未設定」「不明」は比較の対象ではないので棒を灰色にする */
function isNeutralLabel(label: string): boolean {
  return label === "未設定" || label === "不明";
}

/** 日曜と定休日は曜日ラベルを赤にする（ダッシュボードの来店グラフと同じ約束） */
function weekdayLabelClass(weekday: number): string | undefined {
  return weekday === 0 || isRegularHoliday(weekday) ? "text-danger" : undefined;
}

/** 時間帯別の表示範囲。営業時間の目安を基本に、その外に来店があれば広げる */
function hourWindow(byHour: HourBucket[]): number[] {
  const withData = byHour.filter((h) => h.count > 0).map((h) => h.hour);
  const from = Math.min(DEFAULT_HOUR_FROM, ...withData);
  const to = Math.max(DEFAULT_HOUR_TO, ...withData);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** 円グラフの中央など幅の限られた場所向け。"6.4万円" / "8,500円" */
function formatYenCompact(amount: number): string {
  return amount >= 10000 ? `${formatManCompact(amount)}円` : `${amount.toLocaleString("ja-JP")}円`;
}

/** 縦棒の値ラベル向け。1 万円以上は "12.3万"、未満はそのまま */
function formatManCompact(amount: number): string {
  if (amount < 10000) return amount.toLocaleString("ja-JP");
  const man = amount / 10000;
  return `${man >= 100 ? Math.round(man) : Math.round(man * 10) / 10}万`;
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line-2 py-4 last:border-b-0">
      <h2 className="text-[12px] font-semibold tracking-wider text-gray-soft">{title}</h2>
      {sub && <p className="mt-0.5 mb-1 text-[11px] text-gray-faint">{sub}</p>}
      <div className={sub ? "" : "mt-1"}>{children}</div>
    </section>
  );
}
