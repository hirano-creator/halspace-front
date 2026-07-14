// Netlify Scheduled Function: サイトを定期 ping してウォーム状態を維持する
// - Netlify 関数コンテナのコールドスタート防止（JST 6:00〜22:59）
// - Neon のスリープ防止は /api/warm 側が JST 8:00〜17:59 に限定して行う
//   （Neon 無料枠は月100 CU時間。全時間帯起こすと超過してDBが止まるため）
// cron は UTC 表記。

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
