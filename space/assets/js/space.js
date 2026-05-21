'use strict';

/* ===== モックユーザーデータ（⑨でAPI接続に置き換える） =====
   URLパラメータ ?role=jp_admin / id_modeler で切り替え可能   */
const MOCK_USERS = {
  jp_client: { id: 1, name: '山田 太郎', email: 'yamada@abc-mfg.co.jp',
               role: 'jp_client', company: '株式会社ABC製作所',
               apps: ['solid'], token: 'mock-token-jp-client' },
  id_modeler: { id: 2, name: 'Budi Santoso', email: 'budi@halspace.id',
                role: 'id_modeler', company: 'HaLSpace Indonesia',
                apps: ['solid'], token: 'mock-token-id-modeler' },
  jp_admin:   { id: 3, name: '管理者 花子', email: 'admin@halspace.co.jp',
                role: 'jp_admin', company: '株式会社HaLSpace',
                apps: ['solid', 'whatsno', 'meetlog'], token: 'mock-token-jp-admin' },
};

const APP_CATALOG = [
  { id: 'solid',
    name: 'SOLID',
    desc: 'DXF・PDF図面をアップロードするだけで3Dモデルを受発注。インドネシアのプロスタッフが対応します。',
    icon: 'fa-solid fa-cube',
    iconClass: 'app-icon-solid',
    url: '../solid/app/dashboard.html' },
  { id: 'whatsno',
    name: "What'sNo",
    desc: '製造業向けクラウドストレージ。図面・仕様書・動画・CADデータを一元管理。',
    icon: 'fa-solid fa-database',
    iconClass: 'app-icon-whatsno',
    url: '../whatsno/app/dashboard.html' },
  { id: 'meetlog',
    name: 'MeetLog',
    desc: '議事録・会議メモをAIで整形・構造化。音声入力・承認ワークフロー・QR配布に対応。',
    icon: 'fa-solid fa-clipboard-list',
    iconClass: 'app-icon-meetlog',
    url: '../meetlog/app/dashboard.html' },
  { id: 'future',
    name: '近日公開',
    desc: '新しいサービスを順次追加予定です。',
    icon: 'fa-solid fa-plus',
    iconClass: 'app-icon-future',
    url: null },
];

/* ===== ユーティリティ ===== */
function saveAuth(user) {
  localStorage.setItem('space_token', user.token);
  localStorage.setItem('space_user',  JSON.stringify(user));
}
function getAuth() {
  const raw = localStorage.getItem('space_user');
  return raw ? JSON.parse(raw) : null;
}
function clearAuth() {
  localStorage.removeItem('space_token');
  localStorage.removeItem('space_user');
}
function requireAuth(redirectTo = 'login.html') {
  const user = getAuth();
  if (!user) { location.href = redirectTo; return null; }
  return user;
}

/* ===== ログインページ ===== */
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  /* モック用: URLパラメータ ?role=jp_admin でロール変更 */
  const roleParam = new URLSearchParams(location.search).get('role');
  if (roleParam && MOCK_USERS[roleParam]) {
    document.getElementById('email').value    = MOCK_USERS[roleParam].email;
    document.getElementById('password').value = 'password';
    loginForm.requestSubmit();
  }

  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const btn    = document.getElementById('loginBtn');
    const err    = document.getElementById('loginError');
    const errMsg = document.getElementById('loginErrorMsg');
    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    btn.classList.add('loading');
    err.classList.remove('show');

    const resetBtn = () => btn.classList.remove('loading');

    try {
      const res = await fetch('http://127.0.0.1:8000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        errMsg.textContent = data.message || 'ログインに失敗しました。';
        err.classList.add('show');
        resetBtn();
        return;
      }

      const u = data.user;
      saveAuth({
        id: u.id, name: u.name, email: u.email,
        role: u.role, company: u.company_name,
        apps: u.apps_enabled ?? ['solid'],
        token: data.token,
      });
      location.href = 'apps.html';

    } catch (ex) {
      /* Laragon未起動時はモックユーザーで開発継続 */
      const mockUser = Object.values(MOCK_USERS).find(u => u.email === email);
      if (mockUser && password === 'password') {
        saveAuth(mockUser);
        location.href = 'apps.html';
        return;
      }
      errMsg.textContent = 'サーバーに接続できません。Laragonが起動しているか確認してください。';
      err.classList.add('show');
      resetBtn();
    }
  });

  /* クイックログインボタン（実APIで認証） */
  const QUICK_CREDS = {
    jp_client:  { email: 'sato@sample-seizo.co.jp',  password: 'password' },
    id_modeler: { email: 'budi@halspace.co.jp',       password: 'password' },
    jp_admin:   { email: 'admin@halspace.co.jp',      password: 'password' },
  };
  document.querySelectorAll('.quick-login-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const role  = btn.dataset.role;
      const creds = QUICK_CREDS[role];
      if (!creds) return;

      btn.disabled = true;

      const useMock = () => {
        const mock = MOCK_USERS[role];
        if (mock) { saveAuth(mock); location.href = 'apps.html'; }
      };

      try {
        const res = await fetch('http://127.0.0.1:8000/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(creds),
        });
        if (res.ok) {
          const data = await res.json();
          const u = data.user;
          saveAuth({
            id: u.id, name: u.name, email: u.email,
            role: u.role, company: u.company_name,
            apps: u.apps_enabled ?? ['solid'],
            token: data.token,
          });
          location.href = 'apps.html';
          return;
        }
        /* API返却エラー（401/422等）→ モックフォールバック */
        useMock();
      } catch {
        /* ネットワーク不通（Laragon未起動）→ モックフォールバック */
        useMock();
      }
      btn.disabled = false;
    });
  });
}

/* ===== アプリ選択ページ ===== */
const appsGrid = document.getElementById('appsGrid');
if (appsGrid) {
  const user = requireAuth('../space/login.html');
  if (!user) throw new Error('未認証');

  document.getElementById('headerUserName').textContent = user.name;
  document.getElementById('headerCompany').textContent  = user.company;
  const firstName = user.name.split(' ')[0];
  const n = firstName;

  /* ── 今日は何の日（MM-DD → メッセージ生成関数） ── */
  const SPECIAL_DAYS = {
    '01-01': n => `🎍 あけましておめでとうございます、${n}さん！今年もよろしくお願いします。`,
    '01-07': n => `🌿 今日は七草粥の日。${n}さん、一年の無病息災をお祈りします。`,
    '02-03': n => `👹 今日は節分！${n}さん、鬼は外、福は内！`,
    '02-14': n => `🍫 今日はバレンタインデー。${n}さん、素敵な一日を！`,
    '02-22': n => `🐱 今日は猫の日（にゃん・にゃん・にゃん）！${n}さん、にゃんにゃん頑張りましょう。`,
    '03-03': n => `🎎 今日はひな祭り。${n}さん、桃の節句をお楽しみください。`,
    '03-14': n => `🍬 今日はホワイトデー。${n}さん、お返しは準備できましたか？`,
    '04-01': n => `🃏 今日はエイプリルフール。${n}さん、誰かをびっくりさせましたか？`,
    '04-29': n => `🌸 今日は昭和の日。${n}さん、ゴールデンウィーク楽しんでください！`,
    '05-05': n => `🎏 今日はこどもの日。${n}さん、心はいつまでも子どもで！`,
    '06-21': n => `☀️ 今日は夏至。一年で一番昼が長い日です、${n}さん！`,
    '07-07': n => `🎋 今日は七夕。${n}さん、お願い事はしましたか？`,
    '07-20': n => `🌊 今日は海の日。${n}さん、大きな波に乗っていきましょう！`,
    '08-11': n => `⛰️ 今日は山の日。${n}さん、山のように大きな仕事を！`,
    '09-01': n => `⛑️ 今日は防災の日。${n}さん、備えあれば憂いなし。`,
    '09-09': n => `🌸 今日は重陽の節句（菊の節句）。${n}さん、長寿と健康をお祈りします。`,
    '10-01': n => `☕ 今日はコーヒーの日。${n}さん、一杯飲んでリフレッシュを！`,
    '10-31': n => `🎃 今日はハロウィン。${n}さん、Trick or Treat！`,
    '11-01': n => `📚 今日は本の日。${n}さん、良い本に出会えますように。`,
    '11-11': n => `🍫 今日はポッキーの日（1111）！${n}さん、甘いもので一息つきましょう。`,
    '11-23': n => `🙏 今日は勤労感謝の日。${n}さん、いつもお疲れ様です。`,
    '12-22': n => `❄️ 今日は冬至。ゆず湯であたたまってください、${n}さん！`,
    '12-24': n => `🎄 今夜はクリスマスイブ。${n}さん、素敵な夜を！`,
    '12-25': n => `🎅 メリークリスマス、${n}さん！今日も良い一日を。`,
    '12-31': n => `🎍 今日は大晦日。${n}さん、今年も一年お疲れ様でした！`,
  };

  /* ── 通常のランダム挨拶 ── */
  const GREETINGS = [
    n => `おかえりなさい、${n}さん`,
    n => `こんにちは、${n}さん！今日も一緒に頑張りましょう。`,
    n => `お疲れ様です、${n}さん。今日もよろしくお願いします。`,
    n => `ようこそ、${n}さん！`,
    n => `${n}さん、今日はどんな一日にしますか？`,
    n => `こんにちは、${n}さん。今日も良い仕事を。`,
    n => `お待ちしていました、${n}さん！`,
    n => `${n}さん、今日も素晴らしい仕事を！`,
    n => `さあ、はじめましょう、${n}さん！`,
    n => `今日も頑張りましょう、${n}さん！`,
    n => `${n}さん、今日も一日よろしくお願いします。`,
    n => `おはようございます、${n}さん！`,
    n => `${n}さん、今日も一歩ずつ着実に！`,
    n => `今日という日は、二度と来ません。${n}さん、良い一日を！`,
    n => `${n}さん、今日も笑顔で頑張りましょう！`,
  ];

  /* 今日が特別な日なら優先表示、そうでなければ日付ベースのローテーション */
  const now = new Date();
  const todayKey = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const specialFn = SPECIAL_DAYS[todayKey];
  const welcomeText = specialFn
    ? specialFn(n)
    : GREETINGS[Math.floor(Date.now() / 86400000) % GREETINGS.length](n);
  document.getElementById('welcomeMsg').textContent = welcomeText;

  if (['jp_admin', 'super_admin'].includes(user.role)) {
    document.getElementById('adminLink').style.display = '';
  }

  APP_CATALOG.forEach(app => {
    const enabled = user.apps.includes(app.id);
    const isFuture = app.id === 'future';
    const card = document.createElement('div');
    card.className = `app-card${(!enabled && !isFuture) ? ' locked' : ''}${isFuture ? ' locked' : ''}`;
    card.innerHTML = `
      ${(!enabled || isFuture) ? '<i class="fa-solid fa-lock lock-icon"></i>' : ''}
      <div class="app-icon ${app.iconClass}">
        <i class="${app.icon}"></i>
      </div>
      <div class="app-name">${app.name}</div>
      <div class="app-desc">${app.desc}</div>
      <span class="app-tag ${enabled && !isFuture ? 'app-tag-active' : 'app-tag-soon'}">
        <i class="fa-solid ${enabled && !isFuture ? 'fa-circle-check' : 'fa-clock'}"></i>
        ${enabled && !isFuture ? '利用中' : '近日公開'}
      </span>`;
    if (enabled && !isFuture && app.url) {
      card.addEventListener('click', () => { location.href = app.url; });
    }
    appsGrid.appendChild(card);
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    clearAuth();
    location.href = 'login.html';
  });
}
