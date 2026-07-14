// ページ遷移中に即座に表示するローディング画面
// データ取得（DB接続）に数秒かかることがあるため、
// 「反応していない」ように見えないよう体感速度を改善する目的で設置している

export default function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
        <p className="text-sm text-muted">読み込み中...</p>
      </div>
    </div>
  );
}
