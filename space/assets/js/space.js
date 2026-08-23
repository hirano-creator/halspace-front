'use strict';

/* ===== API ベースURL（ローカル開発 vs 本番自動切替） ===== */
const SPACE_API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname.endsWith('.test'))
  ? 'http://127.0.0.1:8000/api'
  : 'https://halspace-api-production.up.railway.app/api';

/* a.aは同一オリジンの兄弟アプリ（solid/whatsno/meetlog等）と違い、本番は別オリジン
   （aa-sns.pages.dev）のCloudflare Pagesなので、相対パス遷移ではログインが引き継がれない。
   ローカルはリポジトリ内の兄弟ディレクトリとして相対パスで配信されているのでそのまま使う。 */
const AA_FRONTEND = (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname.endsWith('.test'))
  ? '../a.a/index.html'
  : 'https://aa-sns.pages.dev/index.html';

/* ===== モックユーザーデータ（⑨でAPI接続に置き換える） =====
   URLパラメータ ?role=client / modeler / admin で切り替え可能   */
const MOCK_USERS = {
  client: { id: 1, name: '山田 太郎', email: 'yamada@abc-mfg.co.jp',
            role: 'general', solid_type: 'jp_client', company: '株式会社ABC製作所',
            apps: ['solid'], token: 'mock-token-client' },
  modeler: { id: 2, name: 'Budi Santoso', email: 'budi@halspace.id',
             role: 'general', solid_type: 'id_modeler', company: 'HaLSpace Indonesia',
             apps: ['solid'], token: 'mock-token-modeler' },
  admin:   { id: 3, name: '管理者 花子', email: 'admin@halspace.co.jp',
             role: 'admin', company: '株式会社HaLSpace',
             apps: ['solid', 'whatsno', 'meetlog', '3d-datashop'], token: 'mock-token-admin' },
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
  { id: '3d-datashop',
    name: '3D DataShop',
    desc: '製造業設計者向け3Dデータライブラリ。標準部品（JIS/ISO）を直接ダウンロード、メーカー固有部品はリンクで案内。',
    icon: 'fa-solid fa-shapes',
    iconClass: 'app-icon-datashop',
    url: '../3d-data_shop/index.html' },
  { id: 'aa',
    name: 'a.a',
    desc: '経営者のための業界SNS。図面・現物を主役に、同業者へ会社や業界の情報を発信・共有できます。',
    icon: 'fa-solid fa-comments',
    iconClass: 'app-icon-aa',
    url: '../a.a/app/feed.html' },
];
/* 未提供のアプリ（旧 id:'future' の枠）は下段の STORE_APPS に移した。
   APP_CATALOG は「契約すれば今すぐ開けるアプリ」だけを持つ。 */

/* 今月のおすすめ（ヒーロー）。毎月ここを差し替えて画面に動きを出す。
   画像は space/assets/img/featured/ に置き、960×600px 程度を推奨。
   見出しは行ごとに配列で持つ（HTMLを混ぜずに改行位置を指定するため）。 */
const FEATURED = {
  appId: 'whatsno',
  eyebrow: "TODAY'S PICK — 今月のおすすめ",
  titleLines: ['図面も、動画も、CADも。', "ぜんぶ What'sNo に。"],
  desc: '製造業向けクラウドストレージ。今月からマニュアル機能・連絡先タグが追加されました。あなたの会社では23名が利用中です。',
  image: 'assets/img/featured/whatsno.svg',
  openLabel: "What'sNo を開く",
  openUrl: '../whatsno/app/dashboard.html',
  subLabel: '新機能を見る',
  subUrl: null,
};

/* 提携企業からのお知らせ（協賛バナー）。
   Phase 1 は掲載社が少ないためここに直接書く。管理画面からの登録はPhase 2で対応する。
   画像は space/assets/img/sponsor/ に置き、1200×400px を推奨。 */
const SPONSOR_BANNERS = [
  { id: 'yamada',
    company: '山田工業株式会社',
    headline: '薄物でも、浮かない。',
    desc: '電磁チャック MC-200。試作1個から対応します。',
    image: 'assets/img/sponsor/yamada-kogyo.svg',
    url: null },
  { id: 'aoyama',
    company: 'アオヤマ精機',
    headline: '写真と寸法だけで、治具になる。',
    desc: '治具設計サポート。1点からご相談いただけます。',
    image: 'assets/img/sponsor/aoyama-seiki.svg',
    url: null },
  { id: 'chubu',
    company: '中部運輸ロジスティクス',
    headline: '揺らさず、その日のうちに。',
    desc: '精密機械専用便。名古屋圏は当日配送に対応。',
    image: 'assets/img/sponsor/chubu-logi.svg',
    url: null },
];

/* Space.app ストアに並べるアプリ。
   status: 'available'（申し込める） / 'preorder'（先行受付） / 'planned'（構想中）
   画像は space/assets/img/store/ に置き、800×450px を推奨。
   金額はこの画面には出さない——会社規模で条件が変わるため、詳細ページと個別のご案内で伝える。 */
const STORE_APPS = [
  { id: 'analytics', name: 'Analytics', cat: '業務効率',
    desc: '各サービスの利用状況・アクセスデータをリアルタイムで可視化するダッシュボード。',
    image: 'assets/img/store/analytics.svg', status: 'available' },
  { id: 'timecalc', name: 'TimeCalc', cat: '業務効率',
    desc: '打刻・勤怠計算・月次勤怠表の印刷まで。Square連携にも対応します。',
    image: 'assets/img/store/timecalc.svg', status: 'available' },
  { id: 'invoice', name: 'Invoice', cat: '業務効率',
    desc: '請求書をOCRで自動読み取り。受発注データと突き合わせて管理します。',
    image: 'assets/img/store/invoice.svg', status: 'preorder' },
  { id: 'workflow', name: 'Workflow', cat: '業務効率',
    desc: '承認フロー・タスク管理・通知を一元化。チーム間の業務連携をスムーズに。',
    image: 'assets/img/store/workflow.svg', status: 'preorder' },
  { id: 'connect', name: 'Connect', cat: 'コミュニケーション',
    desc: '取引先・仕入先とのデータ共有・やりとりを安全に。外部コラボレーション機能。',
    image: 'assets/img/store/connect.svg', status: 'planned' },
  { id: 'quote', name: 'Quote', cat: '業務効率',
    desc: '図面から見積を作成し、そのままSOLIDの発注につなげられます。',
    image: 'assets/img/store/quote.svg', status: 'planned' },
];

/* 掲載状態ごとのバッジとボタンの出しわけ */
const STORE_STATUS = {
  available: { label: 'ご利用可能', badge: 'store-badge-available', action: '申し込む',          primary: true  },
  preorder:  { label: '先行受付',   badge: 'store-badge-preorder',  action: '先行受付に登録',    primary: false },
  planned:   { label: '準備中',     badge: 'store-badge-planned',   action: 'お知らせを受け取る', primary: false },
};

/* 問い合わせ先。Phase 3で申し込みフォームに差し替える。 */
const STORE_CONTACT = 'info@halspace.co.jp';

/* ===== ユーティリティ ===== */
function saveAuth(user) {
  sessionStorage.setItem('space_token', user.token);
  sessionStorage.setItem('space_user',  JSON.stringify(user));
}
function getAuth() {
  const raw = sessionStorage.getItem('space_user');
  return raw ? JSON.parse(raw) : null;
}
/* 自分自身のプロフィール更新など、ログイン後に変わったフィールドだけを
   sessionStorageのキャッシュへ反映する（再ログインなしで即時反映するため） */
function patchAuthUser(patch) {
  const user = getAuth();
  if (!user) return null;
  Object.assign(user, patch);
  sessionStorage.setItem('space_user', JSON.stringify(user));
  return user;
}
function clearAuth() {
  sessionStorage.removeItem('space_token');
  sessionStorage.removeItem('space_user');
}
/* ログイン情報はタブごとに独立したsessionStorageに保存しているため、
   別タブで別アカウントにログインしても、このタブのセッションには影響しない。 */
function requireAuth(redirectTo = 'login.html') {
  const user = getAuth();
  if (!user) { location.href = redirectTo; return null; }
  return user;
}

/* a.aは別オリジンなのでSSOチケットを発行して引き継ぐ（他アプリ同様「そのまま入れる」ため）。
   チケット発行に失敗した場合（モックユーザー等）はa.aの通常ログイン画面へフォールバック。 */
async function openAa() {
  const token = sessionStorage.getItem('space_token');
  try {
    const res = await fetch(`${SPACE_API}/aa/sso/ticket`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error('ticket failed');
    const data = await res.json();
    location.href = `${AA_FRONTEND}#sso=${encodeURIComponent(data.ticket)}`;
  } catch {
    location.href = AA_FRONTEND;
  }
}

/* ===== ログインページ ===== */
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  /* モック用: URLパラメータ ?role=admin でロール変更 */
  const roleParam = new URLSearchParams(location.search).get('role');
  if (roleParam && MOCK_USERS[roleParam]) {
    document.getElementById('email').value    = MOCK_USERS[roleParam].email;
    document.getElementById('password').value = 'password';
    loginForm.requestSubmit();
  }

  const loginErr    = document.getElementById('loginError');
  const loginErrMsg = document.getElementById('loginErrorMsg');

  function showLoginError(msg) {
    if (!msg) { loginErr.classList.remove('show'); return; }
    loginErrMsg.textContent = msg;
    loginErr.classList.add('show');
  }

  /* ログイン成立後の遷移。login.html が演出フック（spaceLoginFx）を持っていれば
     その再生を待ってから移る。フックがない・演出が終わらない場合でも必ず遷移する。 */
  function enterApps() {
    const go = () => { location.href = 'apps.html'; };
    const fx = window.spaceLoginFx;
    if (!fx || typeof fx.play !== 'function') { go(); return; }

    let moved = false;
    const once = () => { if (!moved) { moved = true; go(); } };
    setTimeout(once, 2500);              /* 演出が固まっても取り残されないための保険 */
    Promise.resolve(fx.play()).then(once, once);
  }

  /* ログイン成立。信頼済み端末で1回で通った場合も、確認コードを通った場合も同じ */
  function completeLogin(data) {
    const u = data.user;
    saveAuth({
      id: u.id, name: u.name, email: u.email,
      role: u.role, solid_type: u.solid_type, is_operator: u.is_operator,
      company: u.company_name, company_id: u.company_id,
      apps: u.apps_enabled ?? ['solid'],
      wn_extended_options_enabled: u.wn_extended_options_enabled ?? false,
      token: data.token,
    });
    enterApps();
  }

  /* 2段階認証つきログイン。信頼していない端末では確認コードの入力へ進む。
     APIが応答したエラーは throw し、ネットワーク不通は err.status なしで区別できる。 */
  async function startLogin(email, password) {
    const res = await mfaLogin({ apiBase: SPACE_API, email, password });

    if (res.mode === 'done') { completeLogin(res.data); return; }

    showLoginError('');
    mfaOpenPanel({
      maskedEmail: res.maskedEmail,
      resendAfter: res.resendAfter,
      onError: showLoginError,
      onVerify: async (code, rememberDevice) => {
        const data = await mfaVerify({
          apiBase: SPACE_API, email, challenge: res.challenge, code, rememberDevice,
        });
        completeLogin(data);
      },
      onResend: () => mfaResend({ apiBase: SPACE_API, challenge: res.challenge }),
      onBack: () => showLoginError(''),
    });
  }

  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('loginBtn');
    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    btn.classList.add('loading');
    showLoginError('');

    const resetBtn = () => btn.classList.remove('loading');

    try {
      await startLogin(email, password);
      resetBtn(); /* 確認コードの入力に進んだ場合。ログイン成立時は遷移済み */
    } catch (ex) {
      /* APIが返したエラー（401/403/503等）はそのまま伝える */
      if (ex.status) {
        showLoginError(ex.message);
        resetBtn();
        return;
      }

      /* Laragon未起動時はモックユーザーで開発継続 */
      const mockUser = Object.values(MOCK_USERS).find(u => u.email === email);
      if (mockUser && password === 'password') {
        saveAuth(mockUser);
        enterApps();
        return;
      }
      showLoginError('サーバーに接続できません。しばらく経ってから再度お試しください。');
      resetBtn();
    }
  });

  /* クイックログインボタン（実APIで認証）。
     一度確認コードを通せば端末が記憶されるので、以後はワンクリックで入れる。 */
  const QUICK_CREDS = {
    client:  { email: 'sato@sample-seizo.co.jp',  password: 'password' },
    modeler: { email: 'budi@halspace.co.jp',       password: 'password' },
    admin:   { email: 'admin@halspace.co.jp',      password: 'password' },
  };
  document.querySelectorAll('.quick-login-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const role  = btn.dataset.role;
      const creds = QUICK_CREDS[role];
      if (!creds) return;

      btn.disabled = true;
      showLoginError('');

      try {
        await startLogin(creds.email, creds.password);
      } catch (ex) {
        /* API返却エラーもネットワーク不通も、開発用ボタンなのでモックへ倒す */
        const mock = MOCK_USERS[role];
        if (mock) { saveAuth(mock); enterApps(); return; }
        showLoginError(ex.message);
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

  if (['admin', 'super_admin'].includes(user.role)) {
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
      card.addEventListener('click', () => {
        if (app.id === 'aa') { openAa(); return; }
        location.href = app.url;
      });
    }
    appsGrid.appendChild(card);
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    clearAuth();
    location.href = 'login.html';
  });

  /* ── 横スクロール矢印 ── */
  const arrowLeft  = document.getElementById('arrowLeft');
  const arrowRight = document.getElementById('arrowRight');
  const SCROLL_AMOUNT = 260;

  function updateArrows() {
    const sl = appsGrid.scrollLeft;
    const maxSl = appsGrid.scrollWidth - appsGrid.clientWidth;
    arrowLeft.classList.toggle('hidden',  sl <= 4);
    arrowRight.classList.toggle('hidden', sl >= maxSl - 4);
  }

  arrowLeft.addEventListener('click', () => {
    appsGrid.scrollBy({ left: -SCROLL_AMOUNT, behavior: 'smooth' });
  });
  arrowRight.addEventListener('click', () => {
    appsGrid.scrollBy({ left:  SCROLL_AMOUNT, behavior: 'smooth' });
  });
  appsGrid.addEventListener('scroll', updateArrows, { passive: true });
  updateArrows();

  renderHero(user);
  renderSponsors();
  renderStore();
}

/* ── 今月のおすすめ（ヒーロー） ── */
function renderHero(user) {
  const hero = document.getElementById('hero');
  if (!hero || !FEATURED) { hero?.remove(); return; }

  document.getElementById('heroEyebrow').textContent = FEATURED.eyebrow;
  document.getElementById('heroTitle').innerHTML =
    FEATURED.titleLines.map(esc).join('<br>');
  document.getElementById('heroDesc').textContent = FEATURED.desc;

  const img = document.getElementById('heroImage');
  if (FEATURED.image) {
    img.src = FEATURED.image;
  } else {
    img.closest('.hero-visual').remove();
  }

  /* 未契約のアプリを特集することもあるので、その場合は開かせずストアへ送る */
  const owned = user?.apps?.includes(FEATURED.appId);
  const actions = document.getElementById('heroActions');

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'hero-btn hero-btn-main';
  main.innerHTML = owned
    ? `<i class="fa-solid fa-arrow-right"></i>${esc(FEATURED.openLabel)}`
    : '<i class="fa-solid fa-circle-info"></i>詳しく見る';
  main.addEventListener('click', () => {
    if (owned && FEATURED.openUrl) {
      if (FEATURED.appId === 'aa') { openAa(); return; }
      location.href = FEATURED.openUrl;
      return;
    }
    document.querySelector('.store-section')?.scrollIntoView({ behavior: 'smooth' });
  });
  actions.appendChild(main);

  if (FEATURED.subLabel) {
    const sub = document.createElement('button');
    sub.type = 'button';
    sub.className = 'hero-btn hero-btn-sub';
    sub.innerHTML = `<i class="fa-solid fa-circle-info"></i>${esc(FEATURED.subLabel)}`;
    sub.addEventListener('click', () => {
      if (FEATURED.subUrl) location.href = FEATURED.subUrl;
    });
    actions.appendChild(sub);
  }
}

/* 掲載内容は将来管理画面から入るため、HTMLへ差し込む前に必ずエスケープする */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* 掲載枠より候補が多いときは日替わりで回し、特定の1社が出続けないようにする */
function pickRotating(list, count) {
  if (list.length <= count) return list.slice();
  const offset = Math.floor(Date.now() / 86400000) % list.length;
  return Array.from({ length: count }, (_, i) => list[(offset + i) % list.length]);
}

/* ── 提携企業からのお知らせ（協賛バナー） ── */
function renderSponsors() {
  const grid = document.getElementById('sponsorGrid');
  if (!grid) return;

  const items = pickRotating(SPONSOR_BANNERS, 2);
  if (!items.length) {
    document.querySelector('.sponsor-section')?.remove();
    return;
  }

  grid.innerHTML = items.map(b => `
    <article class="sponsor-card"${b.url ? ' role="link" tabindex="0"' : ''}>
      <img class="sponsor-img" src="${esc(b.image)}" alt="" loading="lazy">
      <span class="sponsor-ad">広告</span>
      <div class="sponsor-body">
        <div class="sponsor-company">${esc(b.company)}</div>
        <h3 class="sponsor-headline">${esc(b.headline)}</h3>
        <p class="sponsor-desc">${esc(b.desc)}</p>
      </div>
    </article>`).join('');

  /* リンク先が未設定の掲載はクリックしても何も起きないようにする（空遷移を防ぐ） */
  grid.querySelectorAll('.sponsor-card').forEach((card, i) => {
    const url = items[i].url;
    if (!url) return;
    card.classList.add('is-linked');
    const open = () => window.open(url, '_blank', 'noopener');
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });
}

/* ── Space.app ストア ── */
function renderStore() {
  const grid = document.getElementById('storeGrid');
  if (!grid) return;

  /* すでに契約中のアプリは上段の「利用中のアプリ」に出るので、ストアには並べない */
  const user = getAuth();
  const owned = user?.apps ?? [];
  const items = STORE_APPS.filter(a => !owned.includes(a.id)).slice(0, 6);

  if (!items.length) {
    document.querySelector('.store-section')?.remove();
    return;
  }

  grid.innerHTML = items.map(app => {
    const st = STORE_STATUS[app.status] ?? STORE_STATUS.planned;
    return `
    <article class="store-card">
      <div class="store-thumb">
        <img src="${esc(app.image)}" alt="" loading="lazy">
        <span class="store-badge ${st.badge}">${esc(st.label)}</span>
      </div>
      <div class="store-body">
        <h3 class="store-name">${esc(app.name)}</h3>
        <div class="store-cat">${esc(app.cat)}</div>
        <p class="store-desc">${esc(app.desc)}</p>
        <div class="store-actions">
          <button type="button" class="store-btn store-btn-sub" data-app="${esc(app.id)}" data-kind="detail">詳しく見る</button>
          <button type="button" class="store-btn ${st.primary ? 'store-btn-main' : 'store-btn-alt'}" data-app="${esc(app.id)}" data-kind="apply">${esc(st.action)}</button>
        </div>
      </div>
    </article>`;
  }).join('');

  /* Phase 1 は申し込みフォームを作らず、件名を用意したメールで受け付ける */
  grid.querySelectorAll('.store-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const app = STORE_APPS.find(a => a.id === btn.dataset.app);
      if (!app) return;
      const st = STORE_STATUS[app.status] ?? STORE_STATUS.planned;
      const subject = btn.dataset.kind === 'detail'
        ? `【Space.app】${app.name} について詳しく知りたい`
        : `【Space.app】${app.name} の${st.action}`;
      const body = [
        `${app.name}（${st.label}）についてご連絡します。`,
        '',
        `会社名：${user?.company ?? ''}`,
        `お名前：${user?.name ?? ''}`,
        `ご連絡先：${user?.email ?? ''}`,
        '',
        'ご要望・ご質問：',
        '',
      ].join('\n');
      location.href = `mailto:${STORE_CONTACT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
  });
}
