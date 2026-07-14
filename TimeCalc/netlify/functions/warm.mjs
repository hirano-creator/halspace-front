// Netlify Scheduled Function: サイトを定期 ping してウォーム状態を維持する
// - Netlify 関数コンテナのコールドスタート防止
// - Neon（無料枠・5分アイドルで自動休止）のスリープ防止
// 実行時間帯は JST 6:00〜22:59（cron は UTC 表記）。
// 深夜帯は Neon の無料コンピュート時間（月191.9時間）を節約するため止める。

export default async () => {
  const res = await fetch("https://timecalc-hirano.netlify.app/api/warm");
  if (!res.ok) {
    console.error(`warm ping failed: ${res.status}`);
  }
};

export const config = {
  // UTC 0:00-13:59 と 21:00-23:59 = JST 9:00-22:59 と 6:00-8:59
  schedule: "*/4 0-13,21-23 * * *",
};
