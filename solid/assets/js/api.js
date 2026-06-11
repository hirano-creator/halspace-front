'use strict';
/* API通信共通モジュール
   ⑨でLaravel APIに接続する際はBASE_URLを変更するだけでOK */

const API_BASE = (() => {
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.test')) return 'http://127.0.0.1:8000/api';
  return 'https://halspace-api-production.up.railway.app/api';
})();

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('space_token');

  /* モックトークンの場合はAPIを叩かずエラーにする */
  if (token && token.startsWith('mock-token')) {
    throw new Error('セッションが無効です。再ログインしてください。');
  }

  let res;
  try {
    res = await fetch(API_BASE + path, {
      headers: {
        'Content-Type': 'application/json',
        'Accept':        'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options.headers,
      },
      ...options,
    });
  } catch {
    throw new Error('サーバーに接続できません。Laragonが起動しているか確認してください。');
  }

  if (res.status === 401) {
    spaceLogout();
    return null;
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.message || JSON.stringify(body);
    } catch {
      msg = await res.text().catch(() => msg);
    }
    throw new Error(msg);
  }
  return res.json();
}

const api = {
  get:    path          => apiFetch(path),
  post:   (path, body)  => apiFetch(path, { method:'POST',  body: JSON.stringify(body) }),
  patch:  (path, body)  => apiFetch(path, { method:'PATCH', body: JSON.stringify(body) }),
  delete: path          => apiFetch(path, { method:'DELETE' }),
};

/* ===== 自動更新ヘルパー =====
   - タブ表示中のみ intervalMs ごとに fn を実行（多重実行ガード付き）
   - タブ復帰・ウィンドウフォーカス時は即時実行
   - 連続失敗時は間隔を一時的に最大8倍まで延ばすバックオフ */
function startAutoRefresh(fn, intervalMs) {
  let running = false;
  let failures = 0;
  let lastRun = 0;

  const tick = async (force = false) => {
    if (running || document.hidden && !force) return;
    const backoff = intervalMs * Math.min(2 ** failures, 8);
    if (!force && Date.now() - lastRun < backoff - 50) return;
    running = true;
    try {
      await fn();
      failures = 0;
    } catch {
      failures = Math.min(failures + 1, 3);
    } finally {
      lastRun = Date.now();
      running = false;
    }
  };

  const timer = setInterval(() => tick(false), intervalMs);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(true); });
  window.addEventListener('focus', () => tick(true));
  return () => clearInterval(timer);
}

/* ===== モックデータ（⑨でAPI呼び出しに差し替え） ===== */
const MOCK = {
  projects: [
    { id:1, project_code:'SOLID-2025-0001', title:'底抜きポンプ安全カバー',
      company:'株式会社ABC製作所', company_id:1, status:'in_progress', priority:'high',
      deadline_at:'2025-05-10', delivered_at:null, modeler:'Budi Santoso', created_at:'2025-04-20',
      deadline_reply:{ date:'2025-05-10', note:'予定通り対応可能です。', replied_by:'Budi Santoso', replied_at:'2025-04-21 10:00', status:'ok' } },
    { id:2, project_code:'SOLID-2025-0002', title:'搬送ローラーブラケット',
      company:'株式会社ABC製作所', company_id:1, status:'review_pending', priority:'normal',
      deadline_at:'2025-05-03', delivered_at:null, modeler:'Ahmad Rizki', created_at:'2025-04-18',
      deadline_reply:{ date:'2025-05-06', note:'形状が複雑なため3日の延長をお願いします。', replied_by:'Ahmad Rizki', replied_at:'2025-04-19 14:30', status:'negotiating' } },
    { id:3, project_code:'SOLID-2025-0003', title:'配管サポート金具（×4種）',
      company:'有限会社XYZ工業', company_id:2, status:'submitted', priority:'urgent',
      deadline_at:'2025-04-30', delivered_at:null, modeler:null, created_at:'2025-04-22',
      deadline_reply: null },
    { id:4, project_code:'SOLID-2025-0004', title:'制御盤取付ブラケット',
      company:'株式会社ABC製作所', company_id:1, status:'delivered', priority:'normal',
      deadline_at:'2025-04-15', delivered_at:'2025-04-14', modeler:'Budi Santoso', created_at:'2025-04-01',
      deadline_reply:{ date:'2025-04-15', note:'納期通り完了しました。', replied_by:'Budi Santoso', replied_at:'2025-04-10 09:00', status:'ok' } },
    { id:5, project_code:'SOLID-2025-0005', title:'モーターマウントベース',
      company:'有限会社XYZ工業', company_id:2, status:'approved', priority:'normal',
      deadline_at:'2025-05-20', delivered_at:null, modeler:'Dewi Rahayu', created_at:'2025-04-19',
      deadline_reply:{ date:'2025-05-20', note:'問題ありません。', replied_by:'Dewi Rahayu', replied_at:'2025-04-20 08:45', status:'ok' } },
  ],
  files: [
    { id:1, file_type:'drawing_dxf', file_name:'ZTSPA001_v2.dxf', file_size:245000, uploaded_by:'山田 太郎', created_at:'2025-04-20',
      /* モックDXF: ブラケット断面の簡易図形 */
      dxf_text: `0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n` +
        /* 外形矩形 */
        `0\nLWPOLYLINE\n8\n0\n90\n4\n70\n1\n10\n0\n20\n0\n10\n200\n20\n0\n10\n200\n20\n100\n10\n0\n20\n100\n` +
        /* 穴（円） */
        `0\nCIRCLE\n8\n0\n10\n100\n20\n50\n40\n20\n` +
        /* 小穴×4 */
        `0\nCIRCLE\n8\n0\n10\n20\n20\n20\n40\n8\n` +
        `0\nCIRCLE\n8\n0\n10\n180\n20\n20\n40\n8\n` +
        `0\nCIRCLE\n8\n0\n10\n20\n20\n80\n40\n8\n` +
        `0\nCIRCLE\n8\n0\n10\n180\n20\n80\n40\n8\n` +
        /* 中心線 */
        `0\nLINE\n8\n1\n10\n0\n20\n50\n11\n200\n21\n50\n` +
        `0\nLINE\n8\n1\n10\n100\n20\n0\n11\n100\n21\n100\n` +
        /* テキスト */
        `0\nTEXT\n8\n2\n10\n60\n20\n-12\n40\n6\n1\nZTSPA001_v2\n` +
        `0\nTEXT\n8\n2\n10\n60\n20\n-20\n40\n4\n1\nSS400 t4.5\n` +
        `0\nENDSEC\n0\nEOF\n`
    },
    { id:2, file_type:'drawing_pdf', file_name:'ZTSPA001_rev2.pdf', file_size:1820000, uploaded_by:'山田 太郎', created_at:'2025-04-20',
      /* W3C公開サンプルPDF（CORSフリー） */
      preview_url: 'https://www.w3.org/WAI/WCAG21/Techniques/pdf/PDF2.pdf' },
    { id:3, file_type:'model_3d', file_name:'安全カバー_v1.stp', file_size:3450000, uploaded_by:'Budi Santoso', created_at:'2025-04-23' },
  ],
  comments: [
    { id:1, channel:'client',  user:'山田 太郎',   role:'jp_client',  body:'板厚4.5mmで間違いありません。溶接部の仕上げはグラインダー仕上げをお願いします。', created_at:'2025-04-20 10:32', image:null },
    { id:2, channel:'client',  user:'管理者 花子', role:'jp_admin',   body:'承知しました。モデラーに伝えます。', created_at:'2025-04-20 10:45', image:null },
    { id:3, channel:'modeler', user:'管理者 花子', role:'jp_admin',   body:'グラインダー仕上げ・t4.5 SS400 で進めてください。', created_at:'2025-04-21 09:00', image:null },
    { id:4, channel:'modeler', user:'Budi Santoso', role:'id_modeler', body:'Understood. We will proceed with t4.5 SS400 and grinder finishing on weld seams.', created_at:'2025-04-21 09:15', image:null },
  ],
  companies: [
    { id:1, name:'株式会社ABC製作所', slug:'abc-mfg', plan:'standard', is_active:true, users:3, projects:12 },
    { id:2, name:'有限会社XYZ工業',   slug:'xyz-ind', plan:'trial',    is_active:true, users:1, projects:4 },
    { id:3, name:'株式会社テスト商会', slug:'test-co', plan:'pro',      is_active:false,users:5, projects:0 },
  ],
};
