'use strict';
/* ログイン2段階認証（メール確認コード ＋ 信頼済み端末）の共通モジュール。

   Space（space/login.html）と SOLID（solid/login.html）は同一オリジンで、
   ログインフォームのidとクラスも共通のため、コード入力パネルごとここで面倒を見る。
   別オリジンの a.a は相対パスでこのファイルを読めないので、必要な処理を
   a.a/assets/aa-api.js 側に持っている（変更するときは両方を直すこと）。 */

/* ===== 信頼済み端末のトークン =====
   ログイン情報（space_token / space_user）はタブごとのsessionStorageのままにし、
   ここで扱う端末トークンだけを localStorage に置く。sessionStorageに入れると
   新しいタブを開くたびに確認コードを求めることになり、2段階認証が実用にならない。

   保存するのはユーザー情報を一切含まない不透明な文字列だけ。かつサーバー側で
   「そのトークンがそのユーザーのものか」を必ず検証しているので、1台のPCを複数
   アカウントで使っても、他人の端末信頼を借りることはできない。 */
const MFA_DEVICE_STORE_KEY = 'space_device_tokens';

/* メールアドレスを平文で保存しないための短いダイジェスト（FNV-1a）。
   秘密を守るための仕組みではなく（秘密はトークン側）、localStorageに
   ログインIDの一覧を残さないための目隠し。同期処理で済むのが利点。 */
function mfaEmailKey(email) {
  let h = 0x811c9dc5;
  const s = String(email || '').trim().toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function mfaReadStore() {
  try {
    const raw = localStorage.getItem(MFA_DEVICE_STORE_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return (obj && typeof obj === 'object') ? obj : {};
  } catch {
    return {}; /* プライベートモード等でlocalStorageが使えなくても落とさない */
  }
}

function mfaWriteStore(store) {
  try {
    localStorage.setItem(MFA_DEVICE_STORE_KEY, JSON.stringify(store));
  } catch {
    /* 保存できないブラウザでは毎回コード入力になるが、ログイン自体は通す */
  }
}

function getDeviceToken(email) {
  return mfaReadStore()[mfaEmailKey(email)] || null;
}

function saveDeviceToken(email, token) {
  if (!token) return;
  const store = mfaReadStore();
  store[mfaEmailKey(email)] = token;
  mfaWriteStore(store);
}

function clearDeviceToken(email) {
  const store = mfaReadStore();
  delete store[mfaEmailKey(email)];
  mfaWriteStore(store);
}

/* ===== API =====
   いずれも失敗時は Error を投げる。error.restart が true のときは
   チャレンジが無効になっているので、メールアドレスの入力からやり直させる。 */

async function mfaFetch(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body),
  });

  let data = {};
  try { data = await res.json(); } catch { /* 502等でHTMLが返るケース */ }

  if (!res.ok) {
    const err = new Error(data.message || 'ログインに失敗しました。');
    err.status  = res.status;
    err.restart = !!data.restart;
    err.data    = data;
    throw err;
  }
  return data;
}

/**
 * 1段階目。信頼済み端末なら { mode: 'done', data } が返り、そのままログインできる。
 * そうでなければ { mode: 'mfa', ... } が返るので、確認コードの入力へ進む。
 */
async function mfaLogin({ apiBase, email, password }) {
  const data = await mfaFetch(`${apiBase}/auth/login`, {
    email,
    password,
    device_token: getDeviceToken(email),
  });

  if (data.mfa_required) {
    return {
      mode: 'mfa',
      challenge: data.challenge,
      maskedEmail: data.masked_email,
      resendAfter: data.resend_after || 60,
    };
  }
  return { mode: 'done', data };
}

/** 2段階目。成功したら端末トークンを保存して、ログインのレスポンスをそのまま返す。 */
async function mfaVerify({ apiBase, email, challenge, code, rememberDevice }) {
  const data = await mfaFetch(`${apiBase}/auth/login/verify`, {
    challenge,
    code,
    remember_device: !!rememberDevice,
  });

  if (data.device_token) saveDeviceToken(email, data.device_token);

  return data;
}

async function mfaResend({ apiBase, challenge }) {
  return mfaFetch(`${apiBase}/auth/login/resend`, { challenge });
}

/* ===== コード入力パネル =====
   ログインフォーム（#loginForm）の直後に差し込み、フォームと入れ替えて表示する。
   .form-group / .btn-login / .login-error はSpaceとSOLIDの両方が持っている
   クラスなので、見た目はそのページのデザインをそのまま引き継ぐ。 */

const MFA_PANEL_CSS = `
  .mfa-panel { animation: mfaFadeIn .25s ease both; }
  @keyframes mfaFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  .mfa-lead { font-size: 13.5px; line-height: 1.7; margin: 0 0 18px; opacity: .8; }
  .mfa-lead strong { font-weight: 600; opacity: 1; }
  .mfa-code-input { letter-spacing: .5em; font-size: 22px !important; text-align: center; font-family: 'Courier New', monospace; }
  .mfa-remember { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 1.5; margin: 0 0 18px; cursor: pointer; opacity: .85; }
  .mfa-remember input { margin: 2px 0 0; flex: none; }
  .mfa-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; text-align: center; }
  .mfa-link { background: none; border: 0; padding: 0; font: inherit; font-size: 13px; color: inherit; opacity: .7; cursor: pointer; text-decoration: underline; }
  .mfa-link:hover:not(:disabled) { opacity: 1; }
  .mfa-link:disabled { cursor: default; opacity: .4; text-decoration: none; }
`;

const MFA_PANEL_HTML = `
  <p class="mfa-lead">
    確認コードを <strong class="mfa-to"></strong> にお送りしました。<br>
    メールに記載された6桁の数字を入力してください。
  </p>
  <form class="mfa-form" novalidate>
    <div class="form-group">
      <label for="mfaCode">確認コード</label>
      <input type="text" id="mfaCode" class="mfa-code-input" inputmode="numeric"
             autocomplete="one-time-code" maxlength="6" placeholder="000000" required>
    </div>
    <label class="mfa-remember">
      <input type="checkbox" class="mfa-remember-check" checked>
      <span>この端末を記憶する（次回から90日間、コードの入力は不要です）</span>
    </label>
    <button type="submit" class="btn-login mfa-submit">
      <span class="btn-text">ログイン</span>
      <span class="btn-spinner"></span>
    </button>
  </form>
  <div class="mfa-actions">
    <button type="button" class="mfa-link mfa-resend">コードを再送する</button>
    <button type="button" class="mfa-link mfa-back">メールアドレスの入力に戻る</button>
  </div>
`;

/**
 * コード入力パネルを開く。
 *
 * @param {object}   o
 * @param {string}   o.maskedEmail  伏せ字の宛先（どのアドレスに届くか分かるように出す）
 * @param {number}   o.resendAfter  再送できるようになるまでの秒数
 * @param {function} o.onVerify     (code, rememberDevice) => Promise 成功でパネルを閉じる
 * @param {function} o.onResend     () => Promise
 * @param {function} o.onBack       () => void パネルを閉じてフォームへ戻す
 * @param {function} o.onError      (message) => void エラー表示（ページ側の.login-errorを使う）
 */
function mfaOpenPanel(o) {
  const form = document.getElementById('loginForm');
  if (!form) return null;

  if (!document.getElementById('mfaPanelStyle')) {
    const style = document.createElement('style');
    style.id = 'mfaPanelStyle';
    style.textContent = MFA_PANEL_CSS;
    document.head.appendChild(style);
  }

  /* 開発用クイックログイン等、フォーム以外の入口もコード入力中は隠す */
  const devSection = document.querySelector('.dev-section');

  const panel = document.createElement('div');
  panel.className = 'mfa-panel';
  panel.innerHTML = MFA_PANEL_HTML;
  form.insertAdjacentElement('afterend', panel);

  const codeInput = panel.querySelector('.mfa-code-input');
  const remember  = panel.querySelector('.mfa-remember-check');
  const submitBtn = panel.querySelector('.mfa-submit');
  const resendBtn = panel.querySelector('.mfa-resend');
  const backBtn   = panel.querySelector('.mfa-back');
  const codeForm  = panel.querySelector('.mfa-form');

  panel.querySelector('.mfa-to').textContent = o.maskedEmail || '';

  form.style.display = 'none';
  if (devSection) devSection.style.display = 'none';

  let countdownTimer = null;

  function close() {
    clearInterval(countdownTimer);
    panel.remove();
    form.style.display = '';
    if (devSection) devSection.style.display = '';
  }

  function setBusy(busy) {
    submitBtn.classList.toggle('loading', busy);
    codeInput.disabled = busy;
  }

  function startCountdown(seconds) {
    clearInterval(countdownTimer);
    let left = Math.max(0, Math.ceil(seconds));

    const tick = () => {
      if (left <= 0) {
        clearInterval(countdownTimer);
        resendBtn.disabled = false;
        resendBtn.textContent = 'コードを再送する';
        return;
      }
      resendBtn.disabled = true;
      resendBtn.textContent = `コードを再送する（${left}秒後）`;
      left--;
    };

    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  /* 数字以外は受け付けない。スマホの自動入力で貼り付けられた文字列も整形する */
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/[^0-9]/g, '').slice(0, 6);
  });

  codeForm.addEventListener('submit', async e => {
    e.preventDefault();
    const code = codeInput.value.trim();
    if (code.length !== 6) {
      o.onError('確認コードを6桁で入力してください。');
      return;
    }

    setBusy(true);
    try {
      await o.onVerify(code, remember.checked);
      close();
    } catch (err) {
      o.onError(err.message);
      if (err.restart) { close(); return; }
      setBusy(false);
      codeInput.select();
    }
  });

  resendBtn.addEventListener('click', async () => {
    resendBtn.disabled = true;
    try {
      const data = await o.onResend();
      o.onError('');
      startCountdown(data.resend_after || 60);
      codeInput.value = '';
      codeInput.focus();
    } catch (err) {
      o.onError(err.message);
      if (err.restart) { close(); return; }
      startCountdown(err.data?.retry_after || 10);
    }
  });

  backBtn.addEventListener('click', () => { close(); o.onBack?.(); });

  startCountdown(o.resendAfter || 60);
  codeInput.focus();

  return { close, setBusy };
}
