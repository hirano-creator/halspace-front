// これから作る画面のプレースホルダ
//
// ナビには最初から全メニューを出す（完成形が分かるように）。
// 未実装の画面はここで「いつ作るか」を明示して、404 で行き止まりにしない。

export function ComingSoon({
  title,
  phase,
  children,
}: {
  title: string;
  phase: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="border-b border-line bg-card px-5 pt-6 pb-4 sm:px-8">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        <p className="mt-1.5 text-xs text-gray-soft sm:text-[13px]">{phase} で作ります</p>
      </div>
      <div className="mx-auto max-w-[640px] px-5 py-10 sm:px-8">
        <div className="rounded-lg border border-dashed border-line bg-card px-5 py-8 text-center">
          <p className="text-sm leading-relaxed text-gray-soft">{children}</p>
        </div>
      </div>
    </div>
  );
}
