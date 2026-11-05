// 性能テスト用 DB の API（wrangler dev --port 8788 --persist-to .wrangler/perf）で、主な API の応答時間を測る。
//   node scripts/perf/measure-api.mjs [API の URL=http://127.0.0.1:8788/api]
// 照合は 200 回続けて読む（正常・読み取り済み・未登録を混ぜる）。ローカルの時間なので、本番の目安として見る。
const API = process.argv[2] ?? 'http://127.0.0.1:8788/api';
const H = { Authorization: 'Bearer dev-900002', 'Content-Type': 'application/json' };
const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
const day = (n) => new Date(Date.parse(today) + n * 86_400_000).toISOString().slice(0, 10);
const HA = { ...H, Authorization: 'Bearer dev-900001' };

for (let i = 0; i < 60; i++) { try { if ((await fetch(`${API}/health`)).ok) break; } catch { /* 待つ */ } await new Promise((r) => setTimeout(r, 1000)); }

async function time(fn, n = 20) {
  const ts = [];
  for (let i = 0; i < n; i++) { const t = performance.now(); const r = await fn(i); if (!r.ok) throw new Error(`${r.status} ${await r.text()}`); await r.text(); ts.push(performance.now() - t); }
  ts.sort((a, b) => a - b);
  const p = (q) => Math.round(ts[Math.min(ts.length - 1, Math.floor(ts.length * q))]);
  return { 回数: n, 中央値ms: p(0.5), '95%ms': p(0.95), 最大ms: Math.round(ts[ts.length - 1]) };
}

const ws = await (await fetch(`${API}/work-sessions`, { method: 'POST', headers: H, body: JSON.stringify({ staff_id: 1, device_id: 'perf-api-device-01', device_label: '性能テスト' }) })).json();
const run = Date.now().toString(36);
const rows = [];
const add = async (name, fn, n) => rows.push({ API: name, ...(await time(fn, n)) });
// 照合待ちの明細（最後の 2 日分）と照合済みの明細を混ぜて読む
await add('照合 POST /scans（200 回）', (i) => {
  const kind = i % 10;
  const g = kind < 6 ? `5PF${String(359000 + i).padStart(11, '0')}` : kind < 9 ? `5PF${String(1000 + i).padStart(11, '0')}` : `5PZZ${i}`;
  return fetch(`${API}/scans`, { method: 'POST', headers: H, body: JSON.stringify({ work_session_id: ws.id, client_scan_id: `perf-${run}-${i}-xxxx`, raw_value: g }) });
}, 200);
await add('置場別チェック GET /scan-board', () => fetch(`${API}/scan-board?vrd=${today}&location_id=3`, { headers: H }));
await add('今日の件数 GET /scans/today', () => fetch(`${API}/scans/today`, { headers: H }));
await add('ダッシュボード GET /dashboard', () => fetch(`${API}/dashboard`, { headers: H }));
await add('読み取り履歴 1 日', () => fetch(`${API}/scan-logs?from=${day(-3)}&to=${day(-3)}&limit=100`, { headers: H }));
await add('読み取り履歴 1 か月・正常以外', () => fetch(`${API}/scan-logs?from=${day(-33)}&to=${day(-3)}&result=problem&limit=100`, { headers: H }));
await add('注文データ 3 週間', () => fetch(`${API}/orders/items?from=${day(-7)}&to=${day(14)}&limit=100`, { headers: H }));
await add('注文データ 1 年・番号で検索', () => fetch(`${API}/orders/items?from=${day(-365)}&to=${today}&q=5PF0000035&limit=100`, { headers: H }), 5);
await add('分析 得意先別 1 か月', () => fetch(`${API}/analytics/orders?from=${today.slice(0, 7)}-01&to=${today}&group=customer`, { headers: HA }), 10);
await add('分析 得意先別 1 年', () => fetch(`${API}/analytics/orders?from=${day(-365)}&to=${today}&group=customer`, { headers: HA }), 5);
await add('分析 読み取り 1 年（月別・集計表）', () => fetch(`${API}/analytics/scans?from=${day(-365)}&to=${today}&group=month`, { headers: HA }), 10);
console.table(rows);
