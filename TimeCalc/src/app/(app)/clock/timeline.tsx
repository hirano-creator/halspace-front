// 当日の打刻タイムライン表示

interface TimelineEvent {
  id: string;
  type: string;
  time: string;
  reason?: string | null;
}

const TYPE_STYLES: Record<string, { label: string; className: string }> = {
  IN: { label: "出勤", className: "bg-emerald-100 text-emerald-700" },
  OUT: { label: "退勤", className: "bg-violet-100 text-violet-700" },
  OUT_START: { label: "外出", className: "bg-amber-100 text-amber-700" },
  OUT_END: { label: "戻り", className: "bg-sky-100 text-sky-700" },
};

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted">本日の打刻はまだありません</p>;
  }

  return (
    <ul className="space-y-2">
      {events.map((e) => {
        const style = TYPE_STYLES[e.type] ?? { label: e.type, className: "bg-gray-100 text-gray-700" };
        return (
          <li key={e.id} className="flex items-center gap-3 text-sm">
            <span
              className={`inline-flex w-14 justify-center rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}
            >
              {style.label}
            </span>
            <span className="font-mono tabular-nums">{e.time}</span>
            {e.reason && <span className="truncate text-xs text-muted">{e.reason}</span>}
          </li>
        );
      })}
    </ul>
  );
}
