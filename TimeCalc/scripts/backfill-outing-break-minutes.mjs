// 一回限りの補正スクリプト: 外出（中抜け）が休憩時間帯と重なる場合に
// breakMinutes = 固定休憩 + 外出実測分（重複を控除しない旧計算式）で
// 保存されてしまっていた既存Attendance行を、
// breakMinutes = 固定休憩 + 控除外出時間（重複を除いた分）に再計算する。
//
// 対象: source が "MANUAL" または "CLOCK" の行のみ（CSV取込は元々実測値そのものなので対象外）。
// MANUALはoutingStart/outingEndから、CLOCKはClockEvent（OUT_START〜OUT_END）から外出区間を復元する。
//
// 実行: node scripts/backfill-outing-break-minutes.mjs
//   （--dry-run を付けると更新せず差分だけ表示する）

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

const DEFAULT_BREAK_START = "12:00";
const DEFAULT_BREAK_END = "13:00";

function timeToMinutes(time) {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s+[A-Za-z]+)?$/.exec(time.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 47 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function fixedBreakMinutesOf(rules) {
  const start = timeToMinutes(rules.breakStart);
  const end = timeToMinutes(rules.breakEnd);
  if (start === null || end === null) return 0;
  return Math.max(0, end - start);
}

/** intervals: [{start,end}]（"HH:mm"）。休憩時間帯との重複を除いた控除対象分数を返す */
function deductibleOutingMinutesOf(intervals, breakStart, breakEnd) {
  const bStart = timeToMinutes(breakStart);
  const bEnd = timeToMinutes(breakEnd);
  let actual = 0;
  let overlap = 0;
  for (const itv of intervals) {
    const s = timeToMinutes(itv.start) ?? 0;
    const e = timeToMinutes(itv.end) ?? 0;
    actual += Math.max(0, e - s);
    if (bStart !== null && bEnd !== null) {
      overlap += Math.max(0, Math.min(e, bEnd) - Math.max(s, bStart));
    }
  }
  return Math.max(0, actual - overlap);
}

/** ClockEventの生イベント列から外出（OUT_START〜OUT_END）区間を復元する */
function outingIntervalsFromEvents(events) {
  const outings = [];
  let phase = "beforeWork";
  let outingStart = null;
  for (const ev of events) {
    if (ev.type === "IN" || ev.type === "OUT_END") {
      if (phase === "outing" && outingStart !== null) {
        outings.push({ start: outingStart, end: ev.time });
        outingStart = null;
      }
      phase = "working";
    } else if (ev.type === "OUT_START") {
      if (phase === "working") {
        outingStart = ev.time;
        phase = "outing";
      }
    } else {
      phase = "offWork";
    }
  }
  return outings;
}

async function resolveRulesByCompany() {
  const [globalRow, companyRows] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "workRules" } }),
    prisma.companySetting.findMany({ where: { key: "workRules" } }),
  ]);
  const defaults = { breakStart: DEFAULT_BREAK_START, breakEnd: DEFAULT_BREAK_END };
  const parseLayer = (json) => {
    if (!json) return {};
    try {
      return JSON.parse(json);
    } catch {
      return {};
    }
  };
  const fallback = { ...defaults, ...parseLayer(globalRow?.value) };
  const byCompany = new Map(
    companyRows.map((row) => [row.companyId, { ...fallback, ...parseLayer(row.value) }]),
  );
  return { fallback, byCompany };
}

async function main() {
  const { fallback, byCompany } = await resolveRulesByCompany();
  const rows = await prisma.attendance.findMany({
    where: { source: { in: ["MANUAL", "CLOCK"] } },
    include: { user: { include: { department: true } } },
  });

  let checked = 0;
  let changed = 0;

  for (const row of rows) {
    checked++;
    const companyId = row.user.department?.companyId ?? null;
    const rules = (companyId && byCompany.get(companyId)) || fallback;

    let intervals = [];
    if (row.source === "MANUAL") {
      if (row.outingStart && row.outingEnd) {
        intervals = [{ start: row.outingStart, end: row.outingEnd }];
      }
    } else {
      const events = await prisma.clockEvent.findMany({
        where: { userId: row.userId, date: row.date },
        orderBy: { timestamp: "asc" },
      });
      intervals = outingIntervalsFromEvents(events);
    }

    if (intervals.length === 0) continue; // 外出なしの日は旧計算式でも差は出ない

    const correctBreakMinutes =
      fixedBreakMinutesOf(rules) + deductibleOutingMinutesOf(intervals, rules.breakStart, rules.breakEnd);

    if (correctBreakMinutes !== row.breakMinutes) {
      changed++;
      console.log(
        `${row.user.employeeCode} ${row.user.name} ${row.date} (${row.source}): breakMinutes ${row.breakMinutes} → ${correctBreakMinutes}`,
      );
      if (!dryRun) {
        await prisma.attendance.update({
          where: { id: row.id },
          data: { breakMinutes: correctBreakMinutes },
        });
      }
    }
  }

  console.log(
    `\n確認: ${checked}件（外出ありは${rows.length ? rows.filter((r) => r.outingStart || r.source === "CLOCK").length : 0}件中）, 修正${dryRun ? "対象" : "済み"}: ${changed}件${dryRun ? "（--dry-run のため未更新）" : ""}`,
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
