'use strict';
/* What'sNo API ラッパー */

const WN_API_BASE = (() => {
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.test')) return 'http://127.0.0.1:8000/api';
  return 'https://halspace-api-production.up.railway.app/api';
})();

/* ログイン情報はタブごとに独立したsessionStorageに保存しているため、
   別タブで別アカウントにログインしても、このタブのセッションには影響しない。 */

/* ── デスクトップ連携から開いたときだけ前回のログインを引き継ぐ ──
   右クリック「What'sNoを開く」は毎回まっさらな新規タブで開くため、
   タブ独立のsessionStorageは必ず空になり、そのままだと毎回ログイン画面になる。
   そこでログイン中の控えをlocalStorageに持っておき、URLに from=desktop が
   付いている場合に限って復元する。通常の新規タブは今まで通り未ログインのままなので、
   タブごとに別アカウントを開ける設計は維持される。 */
const WN_DESKTOP_SESSION_KEY = 'wn_desktop_session';

function wnClearDesktopSession() {
  try { localStorage.removeItem(WN_DESKTOP_SESSION_KEY); } catch {}
}

/* このタブのログインを控えとして保存（次回デスクトップから開いたとき用） */
function wnPersistDesktopSession() {
  const token = sessionStorage.getItem('space_token');
  const user  = sessionStorage.getItem('space_user');
  if (!token || !user) return;
  try { localStorage.setItem(WN_DESKTOP_SESSION_KEY, JSON.stringify({ token, user })); } catch {}
}

function wnRestoreDesktopSession() {
  if (new URLSearchParams(location.search).get('from') !== 'desktop') return;
  if (sessionStorage.getItem('space_token')) return;  /* このタブは既にログイン済み */
  try {
    const saved = JSON.parse(localStorage.getItem(WN_DESKTOP_SESSION_KEY) || 'null');
    if (!saved || !saved.token || !saved.user) return;
    sessionStorage.setItem('space_token', saved.token);
    sessionStorage.setItem('space_user',  saved.user);
  } catch {}
}

/* requireSpaceAuth() より先に走らせる必要があるため、読み込み時点で実行する */
wnRestoreDesktopSession();
wnPersistDesktopSession();

async function wnFetch(path, options = {}) {
  const token = sessionStorage.getItem('space_token');
  /* FormData の場合は Content-Type を付けない（ブラウザに multipart 境界を
     付けさせる）。JSON を強制すると multipart が壊れてサーバーが解析できない。 */
  const isFormData = (typeof FormData !== 'undefined') && (options.body instanceof FormData);
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    'Accept': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(WN_API_BASE + path, { ...options, headers });
  if (res.status === 401) {
    /* モックトークンはAPIが401を返して当然 — リダイレクトしない */
    if (token && token.startsWith('mock-token')) return null;
    sessionStorage.removeItem('space_token');
    sessionStorage.removeItem('space_user');
    wnClearDesktopSession();  /* 失効したトークンでデスクトップから再ログインしないように */
    location.href = '../../../space/login.html';
    return null;
  }
  return res;
}

/* ファイル一覧
   params: { tag, sort, search, liked, recent, mine, company_id, page, per_page }
   返り値: { data: [], meta: {current_page,last_page,per_page,total}, error: null }
        or { data: null, meta: null, error: 'msg' }
   - エラーと「本当に空」を区別するため戻り値を構造化
   - 本番APIは単一ワーカーで動作するため、アップロードやAI応答など重い処理が
     スレッドを占有している間は一覧取得が一時的に詰まり、ハング→接続リセット
     （fetch の Failed to fetch）になりやすい。スレッドが空くまで数百ms〜数秒の
     ことが多いので、各試行にタイムアウト(中断)を設けて「ハング」を「再試行」に
     変え、指数バックオフで複数回リトライして自動回復させる。 */
async function wnGetFiles(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, v); });
  const path = '/wn/files?' + q.toString();

  const MAX_ATTEMPTS     = 4;
  const BACKOFF_MS       = [0, 700, 1600, 3200];   /* 試行前の待機（合計 ~5.5s） */
  const PER_TRY_TIMEOUT  = 15000;                  /* 1試行が詰まったら中断して再試行 */

  let lastError = 'unknown';
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt]) await new Promise(r => setTimeout(r, BACKOFF_MS[attempt]));

    const ctl   = new AbortController();
    const timer = setTimeout(() => ctl.abort(), PER_TRY_TIMEOUT);
    try {
      const res = await wnFetch(path, { signal: ctl.signal });
      clearTimeout(timer);
      if (!res) return { data: null, meta: null, error: 'auth' };           /* wnFetchが401でリダイレクト済み */
      if (res.status >= 500) { lastError = `server-${res.status}`; continue; }   /* 5xxはリトライ */
      if (!res.ok) return { data: null, meta: null, error: `http-${res.status}` };           /* 4xxは即返す */
      const json = await res.json();
      wnSyncStorageMode(json.meta);
      return { data: json.data ?? [], meta: json.meta ?? null, error: null };
    } catch (e) {
      clearTimeout(timer);
      lastError = (e && e.name === 'AbortError') ? 'timeout' : 'network';        /* 中断/接続失敗はリトライ */
    }
  }
  return { data: null, meta: null, error: lastError };
}

/* ── 保存モードと可視範囲 ──────────────────────────────
   会社の保存モード:
     shared   … 社内全員が全ファイルを見られる（従来の挙動）
     personal … 既定は個人保管。社内共有にしたものだけ全員に見える

   フロントはUIの出し分けにしか使わない。権限の強制は必ずサーバー側
   （scopeVisibleTo / scopeEditableBy）で行うので、この値が古くても
   表示が古くなるだけで、見えてはいけないものが見えることはない。 */
let wnStorageMode = null;

function wnGetStorageMode() {
  if (wnStorageMode) return wnStorageMode;
  try {
    const u = JSON.parse(sessionStorage.getItem('space_user') || '{}');
    if (u.wn_storage_mode) wnStorageMode = u.wn_storage_mode;
  } catch (_) { /* 壊れたJSONは無視して既定に倒す */ }
  return wnStorageMode || 'shared';
}

function wnIsPersonalMode() {
  return wnGetStorageMode() === 'personal';
}

/* 一覧APIの meta から自己補正する。super_adminが切り替えた直後は
   sessionStorage の値が古いままなので、通信のたびに最新へ寄せる。 */
function wnSyncStorageMode(meta) {
  if (!meta || !meta.storage_mode) return false;
  const changed = wnStorageMode !== null && wnStorageMode !== meta.storage_mode;
  wnStorageMode = meta.storage_mode;
  try {
    const u = JSON.parse(sessionStorage.getItem('space_user') || '{}');
    if (u.wn_storage_mode !== meta.storage_mode) {
      u.wn_storage_mode = meta.storage_mode;
      sessionStorage.setItem('space_user', JSON.stringify(u));
    }
  } catch (_) { /* 保存できなくても動作は続く */ }
  return changed;
}

/* 可視範囲の切り替え（同名の全バージョンにまとめて効く） */
async function wnSetFileVisibility(id, visibility) {
  const res = await wnFetch(`/wn/files/${id}/visibility`, {
    method: 'PATCH',
    body: JSON.stringify({ visibility }),
  });
  if (!res || !res.ok) return null;
  return await res.json();
}

/* 自分のファイルをまとめて社内共有にする（切替前後の復旧導線） */
async function wnShareAllMine() {
  const res = await wnFetch('/wn/files/share-all-mine', { method: 'POST' });
  if (!res || !res.ok) return null;
  return await res.json();
}

/* ファイル詳細 */
async function wnGetFile(id) {
  const res = await wnFetch(`/wn/files/${id}`);
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* ── アップロードのサイズ方針 ──
   WN_MULTIPART_THRESHOLD を超えるものは R2 へ直送（分割・再送可能）にする。
   それ以下は実績のある単発送信のまま（往復が少なく速い）。 */
const WN_MAX_UPLOAD_BYTES      = 5 * 1024 * 1024 * 1024;   /* 5GB */
const WN_MULTIPART_THRESHOLD   = 50 * 1024 * 1024;         /* 50MB */
const WN_MULTIPART_CONCURRENCY = 3;                        /* 同時に送るパート数 */
const WN_SIGN_BATCH            = 50;                       /* 一度にまとめて署名する数 */

/* R2直送マルチパートアップロード

   ファイル全体をメモリに載せず、file.slice() で切り出した Blob を
   そのまま XHR に渡す（ArrayBuffer 化しない）。これでGB級でも
   端末のメモリを圧迫しない。バイト列はAPIサーバーを通らない。

   ローカル開発など分割が使えない環境では init が 409 を返すので、
   fallback フラグ付きで throw して呼び出し元が単発送信に切り替える。 */
async function wnUploadFileMultipart(file, { onProgress, overwriteId = null, shareToCompany = false } = {}) {
  const initRes = await wnFetch('/wn/uploads/init', {
    method: 'POST',
    body: JSON.stringify({
      file_name:    file.name,
      size:         file.size,
      mime_type:    file.type || 'application/octet-stream',
      overwrite_id: overwriteId,
    }),
  });
  if (!initRes) throw new Error('認証が切れました');
  if (initRes.status === 409) {
    throw Object.assign(new Error('この環境では分割アップロードを利用できません'), { fallback: true });
  }
  if (!initRes.ok) {
    let msg = `アップロードを開始できませんでした (${initRes.status})`;
    try { msg = (await initRes.json()).message || msg; } catch {}
    throw new Error(msg);
  }

  const { ticket, part_size: partSize, part_count: partCount } = await initRes.json();

  const loaded = new Array(partCount).fill(0);
  const etags  = new Array(partCount).fill(null);
  const report = () => {
    if (!onProgress) return;
    const sum = loaded.reduce((a, b) => a + b, 0);
    /* 完了はサーバーのcomplete後に出すので、送信中は99%止まり */
    onProgress(Math.min(99, Math.round(sum / file.size * 100)));
  };

  /* 署名URLは往復を減らすためまとめて取り、期限切れ時だけ個別に取り直す */
  const signed = new Map();
  const signParts = async (numbers) => {
    const res = await wnFetch('/wn/uploads/sign', {
      method: 'POST',
      body: JSON.stringify({ ticket, part_numbers: numbers }),
    });
    if (!res || !res.ok) throw Object.assign(new Error('署名URLの取得に失敗しました'), { retryable: true });
    const { urls } = await res.json();
    Object.entries(urls).forEach(([n, u]) => signed.set(Number(n), u));
  };
  /* 並列ワーカーが同時に未署名を見つけて同じ範囲を何度も要求しないよう、
     まとめ取りは常に1本だけ走らせ、他は完了を待つ */
  let signInFlight = null;
  const urlForPart = async (n, refresh = false) => {
    if (refresh) { signed.delete(n); await signParts([n]); return signed.get(n); }
    while (!signed.has(n)) {
      if (signInFlight) { await signInFlight; continue; }
      const batch = [];
      for (let i = n; i <= partCount && batch.length < WN_SIGN_BATCH; i++) {
        if (!signed.has(i)) batch.push(i);
      }
      if (!batch.length) break;
      signInFlight = signParts(batch).finally(() => { signInFlight = null; });
      await signInFlight;
    }
    return signed.get(n);
  };

  const putPart = (n, url) => new Promise((resolve, reject) => {
    const start = (n - 1) * partSize;
    const blob  = file.slice(start, Math.min(start + partSize, file.size));
    const xhr   = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) { loaded[n - 1] = e.loaded; report(); }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        /* ETag は complete に必須。読めない場合は R2 の CORS 設定漏れ */
        const etag = xhr.getResponseHeader('ETag');
        if (!etag) {
          reject(Object.assign(new Error('ETagを取得できませんでした（R2のCORS設定を確認してください）'), { retryable: false }));
          return;
        }
        loaded[n - 1] = blob.size;
        report();
        resolve(etag);
      } else if (xhr.status === 403) {
        reject(Object.assign(new Error('署名URLの期限が切れました'), { retryable: true, expired: true }));
      } else {
        reject(Object.assign(new Error(`パート${n}の送信に失敗しました (${xhr.status})`), { retryable: true }));
      }
    };
    xhr.onerror   = () => reject(Object.assign(new Error(`パート${n}でネットワークエラー`), { retryable: true }));
    xhr.ontimeout = () => reject(Object.assign(new Error(`パート${n}でタイムアウト`), { retryable: true }));
    xhr.timeout   = 600000;   /* 1パート16MB。細い回線でも送り切れる余裕を取る */
    xhr.send(blob);
  });

  const uploadPart = async (n) => {
    const BACKOFF_MS = [0, 1000, 3000, 6000];
    let lastErr;
    for (let i = 0; i < BACKOFF_MS.length; i++) {
      if (BACKOFF_MS[i]) await new Promise(r => setTimeout(r, BACKOFF_MS[i]));
      try {
        return await putPart(n, await urlForPart(n, !!lastErr?.expired));
      } catch (e) {
        lastErr = e;
        loaded[n - 1] = 0;   /* 失敗分は進捗から戻す */
        report();
        if (!e || !e.retryable) throw e;
      }
    }
    throw lastErr;
  };

  /* 最初のエラーを共有フラグで持ち回り、残りのワーカーを自然に止める。
     Promise.all の途中脱出に任せると、後から失敗した分が unhandled rejection になる */
  let failure = null;
  let next    = 1;
  const worker = async () => {
    while (!failure && next <= partCount) {
      const n = next++;
      try {
        etags[n - 1] = await uploadPart(n);
      } catch (e) {
        failure = failure || e;
        return;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(WN_MULTIPART_CONCURRENCY, partCount) }, worker)
  );

  if (failure) {
    /* 未完了のパートは残しておくと課金対象になるため必ず破棄する。
       投げっぱなしにすると失敗直後の画面遷移で送信されないので待つ */
    try {
      await wnFetch('/wn/uploads/abort', { method: 'POST', body: JSON.stringify({ ticket }) });
    } catch {}
    /* file.slice() は遅延読み込み。撮影直後の写真などで元ファイル参照が
       無効化されると復帰不能なので、選び直しを促す */
    if (failure.name === 'NotReadableError') {
      throw new Error('ファイルを読み取れませんでした。選び直してください');
    }
    throw failure;
  }

  const res = await wnFetch('/wn/uploads/complete', {
    method: 'POST',
    body: JSON.stringify({
      ticket,
      parts: etags.map((etag, i) => ({ number: i + 1, etag })),
      share_to_company: shareToCompany ? 1 : 0,
    }),
  });
  if (!res) throw new Error('認証が切れました');
  if (!res.ok) {
    let msg = `アップロードの完了処理に失敗しました (${res.status})`;
    try { msg = (await res.json()).message || msg; } catch {}
    throw new Error(msg);
  }

  if (onProgress) onProgress(100);
  return await res.json();
}

/* ファイルアップロード（XHR・進捗コールバック付き）
   - 50MB超は R2直送マルチパートへ委譲（GB級はこちらでないと端末が落ちる）
   - 50MB以下は multipart ではなく raw バイナリで送信（CF Workers のメモリ二重バッファ回避）
   - サーバー側は Content-Type が multipart 以外なら X-File-Name ヘッダーで名前を受け取る
   - ネットワーク系エラーは指数バックオフで最大3回リトライ（wnOverwriteFile と同方針） */
async function wnUploadFile(file, { onProgress, shareToCompany = false } = {}) {
  if (file.size > WN_MAX_UPLOAD_BYTES) {
    throw new Error(`${file.name} は5GBを超えています`);
  }
  if (file.size > WN_MULTIPART_THRESHOLD) {
    try {
      return await wnUploadFileMultipart(file, { onProgress, shareToCompany });
    } catch (e) {
      if (!e || !e.fallback) throw e;   /* fallback は分割非対応環境のみ */
    }
  }

  const token = sessionStorage.getItem('space_token');

  // ArrayBuffer 経由で Blob に変換（iOS Safari の File 参照無効化対策）
  const buffer = await file.arrayBuffer();
  const blob = new Blob([buffer], { type: file.type || 'application/octet-stream' });

  // Railway へ直送（CORS は API 側で許可済み。旧 /api/wn-upload プロキシは
  // 大容量で Worker メモリ上限に当たり壊れるため廃止）
  // 個人保管モードで「アップロード後に社内共有する」を選んだときだけ立てる。
  // ボディはバイナリなのでフォーム値では渡せず、クエリで送る。
  const uploadUrl = WN_API_BASE + '/wn/files' + (shareToCompany ? '?share_to_company=1' : '');

  const attempt = () => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Content-Type', blob.type);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 401) {
        sessionStorage.removeItem('space_token');
        wnClearDesktopSession();
        location.href = '../../../space/login.html';
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(Object.assign(new Error('レスポンスの解析に失敗しました'), { retryable: false })); }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(Object.assign(new Error(err.message || `アップロードエラー (${xhr.status})`), { retryable: false }));
        } catch {
          reject(Object.assign(new Error(`アップロードエラー (${xhr.status})`), { retryable: false }));
        }
      }
    };
    xhr.onerror   = () => reject(Object.assign(new Error(`ネットワークエラー (XHR)`), { retryable: true }));
    xhr.ontimeout = () => reject(Object.assign(new Error('タイムアウト'), { retryable: true }));
    xhr.timeout = 300000;
    xhr.send(blob);
  });

  const BACKOFF_MS = [0, 1000, 2500];
  let lastErr;
  for (let i = 0; i < BACKOFF_MS.length; i++) {
    if (BACKOFF_MS[i]) await new Promise(r => setTimeout(r, BACKOFF_MS[i]));
    try {
      return await attempt();
    } catch (e) {
      lastErr = e;
      if (!e || !e.retryable) throw e;
    }
  }
  throw lastErr;
}

/* 既存ファイルの内容を上書き（新バージョンを作らない）
   50MB超は wnUploadFile と同じく R2直送マルチパートへ委譲する。 */
async function wnOverwriteFile(id, file, { onProgress } = {}) {
  if (file.size > WN_MAX_UPLOAD_BYTES) {
    throw new Error(`${file.name} は5GBを超えています`);
  }
  if (file.size > WN_MULTIPART_THRESHOLD) {
    try {
      return await wnUploadFileMultipart(file, { onProgress, overwriteId: id });
    } catch (e) {
      if (!e || !e.fallback) throw e;
    }
  }

  const token = sessionStorage.getItem('space_token');
  const buffer = await file.arrayBuffer();
  const blob = new Blob([buffer], { type: file.type || 'application/octet-stream' });

  // Railway へ直送（プロキシ廃止。CORS は API 側で許可済み）
  const url = WN_API_BASE + `/wn/files/${id}/overwrite`;

  /* 1回分の送信。ネットワーク系失敗(onerror/ontimeout)は retryable=true を付けて
     reject し、呼び出し側で再試行できるようにする。HTTPエラーやJSON解析失敗は
     サーバーの確定的な応答なので再試行しない(retryable=false)。 */
  const attempt = () => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Content-Type', blob.type);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.onload = () => {
      if (xhr.status === 401) {
        sessionStorage.removeItem('space_token');
        wnClearDesktopSession();
        location.href = '../../../space/login.html';
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(Object.assign(new Error('レスポンスの解析に失敗しました'), { retryable: false })); }
      } else {
        let msg;
        try { msg = JSON.parse(xhr.responseText).message; } catch {}
        reject(Object.assign(new Error(msg || `上書きエラー (${xhr.status})`), { retryable: false }));
      }
    };
    xhr.onerror   = () => reject(Object.assign(new Error('ネットワークエラー (XHR)'), { retryable: true }));
    xhr.ontimeout = () => reject(Object.assign(new Error('タイムアウト'), { retryable: true }));
    xhr.timeout = 300000;
    xhr.send(blob);
  });

  /* 上書きは冪等（同じ内容で上書き）なので、デプロイ切替や回線の瞬断による
     一時的な接続リセットは安全に再試行できる。注釈保存が一度の瞬断で失われ
     ないよう、ネットワーク系エラーのみ指数バックオフで最大3回試行する。 */
  const BACKOFF_MS = [0, 1000, 2500];
  let lastErr;
  for (let i = 0; i < BACKOFF_MS.length; i++) {
    if (BACKOFF_MS[i]) await new Promise(r => setTimeout(r, BACKOFF_MS[i]));
    try {
      return await attempt();
    } catch (e) {
      lastErr = e;
      if (!e || !e.retryable) throw e;   /* 確定的エラーは即座に投げる */
    }
  }
  throw lastErr;
}

/* ファイル削除 */
async function wnDeleteFile(id) {
  const res = await wnFetch(`/wn/files/${id}`, { method: 'DELETE' });
  return res && res.ok;
}

/* ファイル名変更 */
async function wnRenameFile(id, fileName) {
  const res = await wnFetch(`/wn/files/${id}/rename`, {
    method: 'PATCH',
    body: JSON.stringify({ file_name: fileName }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* タグ一覧 */
async function wnGetTags() {
  const res = await wnFetch('/wn/tags');
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

/* タグ並び替え保存 */
async function wnReorderTags(orders) {
  const res = await wnFetch('/wn/tags/reorder', {
    method: 'PATCH',
    body: JSON.stringify({ orders }),
  });
  return res && res.ok;
}

/* いいねトグル */
async function wnToggleLike(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/like`, { method: 'POST' });
  if (!res || !res.ok) return null;
  return res.json();
}

/* コメント一覧 */
async function wnGetComments(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/comments`);
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

/* コメント投稿 */
async function wnPostComment(fileId, body) {
  const res = await wnFetch(`/wn/files/${fileId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* コメント編集 */
async function wnUpdateComment(fileId, commentId, body) {
  const res = await wnFetch(`/wn/files/${fileId}/comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* コメント削除 */
async function wnDeleteComment(fileId, commentId) {
  const res = await wnFetch(`/wn/files/${fileId}/comments/${commentId}`, {
    method: 'DELETE',
  });
  return !!(res && res.ok);
}

/* バージョン履歴 */
async function wnGetVersions(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/versions`);
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

/* プレビュー用URL */
async function wnGetViewUrl(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/view`);
  if (!res || !res.ok) return null;
  return (await res.json()).url ?? null;
}

/* タグ追加（マスターから選択） */
async function wnAddTag(fileId, tagId) {
  const res = await wnFetch(`/wn/files/${fileId}/tags`, {
    method: 'POST',
    body: JSON.stringify({ tag_id: tagId }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* タグマスター作成（管理者のみ） */
async function wnCreateTag(name) {
  const res = await wnFetch('/wn/tags', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* タグマスター削除（管理者のみ） */
async function wnDeleteTag(tagId) {
  const res = await wnFetch(`/wn/tags/${tagId}`, { method: 'DELETE' });
  return res && res.ok;
}

/* タグ削除 */
async function wnRemoveTag(fileId, tagId) {
  const res = await wnFetch(`/wn/files/${fileId}/tags/${tagId}`, { method: 'DELETE' });
  return res && res.ok;
}

/* 類似ファイル検索 */
async function wnGetSimilarFiles(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/similar`);
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

/* 自然言語検索 */
async function wnSemanticSearch(query) {
  const res = await wnFetch(`/wn/search/semantic?q=${encodeURIComponent(query)}`);
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

/* public-view プロキシURL（認証トークン付き） */
function wnPublicViewUrl(fileId) {
  const token = sessionStorage.getItem('space_token');
  return WN_API_BASE + `/wn/files/${fileId}/public-view` + (token ? `?token=${encodeURIComponent(token)}` : '');
}

/* 保存型サムネイルURL（<img> で直接読める。未生成なら 404 を返す）。
   g= はサムネ生成世代（サーバーの WN_THUMB_GEN と揃える。ロジック変更時に上げる）。
   t= はファイル更新時刻。差し替え時にURLが変わり古いサムネを掴まないようにする。
   サーバーは immutable を使わず ETag+再検証で配信するため、万一の誤配信も自己修復する。 */
const WN_THUMB_GEN = 'g4';
function wnThumbUrl(fileId, updatedAt) {
  const token = sessionStorage.getItem('space_token');
  const ts = updatedAt ? Date.parse(updatedAt) || '' : '';
  const parts = [];
  if (token) parts.push(`token=${encodeURIComponent(token)}`);
  parts.push(`g=${WN_THUMB_GEN}`);
  if (ts) parts.push(`t=${ts}`);
  return WN_API_BASE + `/wn/files/${fileId}/thumb?` + parts.join('&');
}

/* クライアント生成サムネ(blob)をサーバーへ保存（pdf/heic/video/dxf 用）。
   失敗しても表示には影響しないので例外は握りつぶす。 */
async function wnUploadThumb(fileId, blob) {
  try {
    if (!blob) return;
    const fd = new FormData();
    fd.append('thumb', blob, 'thumb.jpg');
    await wnFetch(`/wn/files/${fileId}/thumb`, { method: 'POST', body: fd });
  } catch (e) { /* 保存失敗は無視（次回再生成される） */ }
}

/* DXF テキストを取得（Shift-JIS自動判定） */
async function wnFetchDxfText(fileId) {
  const res = await fetch(wnPublicViewUrl(fileId));
  if (!res.ok) return null;
  const buffer = await res.arrayBuffer();
  // UTF-8で試してShift-JIS文字化け（0x80以上で日本語なし）なら再デコード
  let text = new TextDecoder('utf-8').decode(buffer);
  if (/�/.test(text) || (/[\x80-\xFF]/.test(text) && !/[　-鿿]/.test(text))) {
    try { text = new TextDecoder('shift-jis').decode(buffer); } catch (e) {}
  }
  return text;
}

/* ファイルを ArrayBuffer で取得（R2 署名付きURL or ローカルプロキシ両対応）
   onProgress(pct) を渡すと 0〜100 のダウンロード進捗を通知する */
async function wnFetchFileBuffer(fileId, { onProgress, timeoutMs = 120000 } = {}) {
  /* AbortController で各 fetch にタイムアウトを設ける（既定 120 秒） */
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error('タイムアウト（' + Math.round(timeoutMs/1000) + '秒）')), timeoutMs);
  try {
    const urlRes = await wnFetch(`/wn/files/${fileId}/view`, { signal: ctl.signal });
    if (!urlRes || !urlRes.ok) {
      throw new Error('署名URL取得に失敗 (status=' + (urlRes?.status ?? 'no response') + ')');
    }
    const { url } = await urlRes.json();
    if (!url) throw new Error('署名URLが空です');

    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error('ファイル取得に失敗 (status=' + res.status + ')');

    const contentLength = res.headers.get('Content-Length');
    if (!onProgress || !contentLength) return await res.arrayBuffer();

    const total  = parseInt(contentLength, 10);
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress(Math.round(received / total * 100));
    }

    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
    return merged.buffer;
  } catch (e) {
    console.error('[wnFetchFileBuffer] fileId=' + fileId, e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* Office Online Viewer 用パブリックプロキシURL
   - Microsoft側がプロキシを取得するため token をURLに付与する
   - localhost / .test ではMicrosoftから到達不可能なため null を返す（呼び出し側でフォールバック表示） */
function wnOfficeViewerUrl(fileId) {
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.test')) return null;
  const token = sessionStorage.getItem('space_token');
  if (!token) return null;
  const proxyUrl = WN_API_BASE + `/wn/files/${fileId}/public-view?token=${encodeURIComponent(token)}`;
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(proxyUrl)}`;
}

/* Officeプレビュー対応拡張子か判定 */
function wnIsOfficeFile(fileName) {
  const ext = (fileName || '').split('.').pop().toLowerCase();
  return ['xlsx','xls','xlsm','docx','doc','docm','pptx','ppt','pptm'].includes(ext);
}

/* ファイル削除 */
async function wnDeleteFile(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}`, { method: 'DELETE' });
  return res && res.ok;
}

/* ダウンロード */
function wnDownload(fileId) {
  const token = sessionStorage.getItem('space_token');
  const a = document.createElement('a');
  a.href = WN_API_BASE + `/wn/files/${fileId}/download` +
           (token ? `?token=${encodeURIComponent(token)}` : '');
  a.target = '_blank';
  a.click();
}

/* 承認ワークフロー */
async function wnSubmitApproval(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/submit-approval`, { method: 'POST' });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}
async function wnApprove(fileId, comment = '') {
  const res = await wnFetch(`/wn/files/${fileId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}
async function wnReject(fileId, comment = '') {
  const res = await wnFetch(`/wn/files/${fileId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}
async function wnCancelApproval(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/cancel-approval`, { method: 'POST' });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* 承認ステータスのラベル・色 */
/* 可視範囲バッジ。全社共有モードでは全ファイルが同じ状態なので何も出さない
   （全部に同じバッジが付いても情報量がゼロで、画面が煩くなるだけ）。 */
function wnVisibilityBadgeHtml(f) {
  if (!wnIsPersonalMode()) return '';
  const shared = (f.visibility ?? 'company') === 'company';
  const color  = shared ? '#22705f' : '#574c8e';
  const bg     = shared ? '#ddede7' : '#e5e2f2';
  const icon   = shared ? 'fa-users' : 'fa-lock';
  const label  = shared ? '社内共有' : '個人';
  return `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;
    color:${color};background:${bg};white-space:nowrap;">
    <i class="fa-solid ${icon}" style="margin-right:3px;"></i>${label}</span>`;
}

function wnApprovalBadge(status) {
  const map = {
    none:     { label: '承認なし',  color: '#90A4AE', bg: '#ECEFF1' },
    pending:  { label: '承認申請中', color: '#F57C00', bg: '#FFF3E0' },
    approved: { label: '承認済み',  color: '#2E7D32', bg: '#E8F5E9' },
    rejected: { label: '差し戻し',  color: '#C62828', bg: '#FFEBEE' },
  };
  return map[status] ?? map.none;
}

/* QRトークン発行 */
async function wnIssueQr(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/qr`, { method: 'POST' });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* アクセス分析 */
async function wnGetStats(days = 30) {
  const res = await wnFetch(`/wn/stats?days=${days}`);
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* 既読ユーザー一覧 */
async function wnGetViewers(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/viewers`);
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

/* 外部共有 */
async function wnCreateShare(fileId, { expiresDays, password, accessLimit } = {}) {
  const res = await wnFetch(`/wn/files/${fileId}/share`, {
    method: 'POST',
    body: JSON.stringify({
      expires_days:  expiresDays  || null,
      password:      password     || null,
      access_limit:  accessLimit  || null,
    }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}
/* 共有リンクを一括発行し、{ [fileId]: {token,url,expires_at} } を返す。
   ファイル数ぶん wnCreateShare を並列に投げると、本番APIが単一ワーカーのため
   サーバー側で直列化して待ち時間がファイル数に比例する（メール共有で顕著）。
   API未デプロイ（404/405）のときだけ従来の並列発行にフォールバックする。 */
async function wnCreateSharesBulk(fileIds, { expiresDays, password, accessLimit } = {}) {
  const ids = [...new Set((fileIds || []).map(Number))].filter(n => !Number.isNaN(n));
  if (ids.length === 0) return {};

  const res = await wnFetch('/wn/files/share-bulk', {
    method: 'POST',
    body: JSON.stringify({
      file_ids:      ids,
      expires_days:  expiresDays  || null,
      password:      password     || null,
      access_limit:  accessLimit  || null,
    }),
  });

  if (res && res.ok) {
    const list = (await res.json()).data ?? [];
    const map  = {};
    for (const s of list) map[s.file_id] = { token: s.token, url: s.url, expires_at: s.expires_at };
    return map;
  }

  // 一括APIが無い環境（旧API）だけ従来方式に戻す。それ以外の失敗はそのまま失敗させる
  // （res が null＝401リダイレクト中/モックトークンのときも再送しない）
  if (!res || (res.status !== 404 && res.status !== 405)) return {};

  const results = await Promise.all(ids.map(id => wnCreateShare(id, { expiresDays, password, accessLimit })));
  const map = {};
  ids.forEach((id, i) => { if (results[i]) map[id] = results[i]; });
  return map;
}

async function wnGetShares(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/shares`);
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}
async function wnDeleteShare(fileId, shareId) {
  const res = await wnFetch(`/wn/files/${fileId}/shares/${shareId}`, { method: 'DELETE' });
  return res && res.ok;
}

/* 通知一覧 */
async function wnGetNotifications() {
  const res = await wnFetch('/wn/notifications');
  if (!res || !res.ok) return { data: [], unread: 0 };
  return res.json();
}

/* 全件既読 */
async function wnReadAllNotifications() {
  await wnFetch('/wn/notifications/read-all', { method: 'POST' });
}

/* 1件既読 */
async function wnReadNotification(id) {
  await wnFetch(`/wn/notifications/${id}/read`, { method: 'POST' });
}

/* ファイルをメールで送信 */
async function wnSendFileByEmail(fileId, emails, message) {
  const res = await wnFetch(`/wn/files/${fileId}/send-email`, {
    method: 'POST',
    body: JSON.stringify({ emails, message }),
  });
  if (!res || !res.ok) {
    const err = await res?.json().catch(() => ({}));
    throw new Error(err.message || 'メール送信に失敗しました');
  }
  return res.json();
}

/* スキル実行（自然言語の指示 → どのスキルを発動するか判定・下書き） */
async function wnRunSkill(instruction, fileId, contacts) {
  const res = await wnFetch('/wn/skills/run', {
    method: 'POST',
    body: JSON.stringify({ instruction, file_id: fileId, contacts: contacts || [] }),
  });
  if (!res || !res.ok) {
    const err = await res?.json().catch(() => ({}));
    throw new Error(err.message || 'スキルの実行に失敗しました');
  }
  return res.json();
}

/* スキル実行の確定結果を記録（status: 'executed' | 'canceled'） */
async function wnConfirmSkillRun(runId, status) {
  if (!runId) return null;
  const res = await wnFetch(`/wn/skills/runs/${runId}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}

/* スキル実行履歴（自社・最新100件） */
async function wnGetSkillRuns() {
  const res = await wnFetch('/wn/skills/runs');
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

/* ── 連絡先（会社単位・スキルの宛先解決に使用） ── */
async function wnGetContacts() {
  const res = await wnFetch('/wn/contacts');
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}
/* fields: { name, email, company_name, name_kana, phone, fax, tag_ids }
   tag_ids を渡さなければタグは触らない（サーバー側も同じ契約） */
async function wnSaveContact(fields) {
  const res = await wnFetch('/wn/contacts', {
    method: 'POST',
    body: JSON.stringify(_wnContactBody(fields)),
  });
  if (!res || !res.ok) {
    const err = await res?.json().catch(() => ({}));
    throw new Error(err.message || '連絡先の保存に失敗しました');
  }
  return (await res.json()).data;
}
async function wnUpdateContact(id, fields) {
  const res = await wnFetch(`/wn/contacts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(_wnContactBody(fields)),
  });
  if (!res || !res.ok) {
    const err = await res?.json().catch(() => ({}));
    throw new Error(err.message || '連絡先の更新に失敗しました');
  }
  return (await res.json()).data;
}
function _wnContactBody(f = {}) {
  const body = {
    name:         f.name,
    email:        f.email,
    company_name: f.company_name || null,
    name_kana:    f.name_kana    || null,
    phone:        f.phone        || null,
    fax:          f.fax          || null,
  };
  if (Array.isArray(f.tag_ids)) body.tag_ids = f.tag_ids;
  // 名刺スキャンで撮ったときだけ送る（送らなければ既存の名刺画像はそのまま）
  if (f.card_image_path) body.card_image_path = f.card_image_path;
  return body;
}

/* ── 名刺スキャン ──
   画像を送って項目を受け取るだけ（連絡先はまだ作らない）。
   画像はサーバー側でR2に置かれ、card_image_path が一緒に返る */
async function wnScanBusinessCard(blob) {
  const fd = new FormData();
  fd.append('card', blob, 'card.jpg');
  const res = await wnFetch('/wn/contacts/scan-card', { method: 'POST', body: fd });
  if (!res || !res.ok) {
    const err = await res?.json().catch(() => ({}));
    throw new Error(err.message || '名刺を読み取れませんでした');
  }
  return (await res.json()).data;
}

/* 連絡先に添付した名刺画像のURL（<img> で直接読める） */
function wnContactCardUrl(contactId) {
  const token = sessionStorage.getItem('space_token');
  return WN_API_BASE + `/wn/contacts/${contactId}/card` + (token ? `?token=${encodeURIComponent(token)}` : '');
}

/* ── ローマ字 → カタカナ（ヘボン式・辞書不要） ──
   名刺に印字されたローマ字だけを機械的に変換する。AIに読みを推測させないための処理。
   長音（TARO＝たろう など）は名刺表記に現れないことが多く、そのまま「タロ」になる。
   誤りを見つけやすいよう、呼び出し側で「自動入力」と分かる表示にすること。 */
const WN_ROMAJI_MAP = {
  kya:'キャ', kyu:'キュ', kyo:'キョ', gya:'ギャ', gyu:'ギュ', gyo:'ギョ',
  sha:'シャ', shu:'シュ', sho:'ショ', sya:'シャ', syu:'シュ', syo:'ショ',
  ja:'ジャ',  ju:'ジュ',  jo:'ジョ',  jya:'ジャ', jyu:'ジュ', jyo:'ジョ', zya:'ジャ', zyu:'ジュ', zyo:'ジョ',
  cha:'チャ', chu:'チュ', cho:'チョ', tya:'チャ', tyu:'チュ', tyo:'チョ',
  nya:'ニャ', nyu:'ニュ', nyo:'ニョ', hya:'ヒャ', hyu:'ヒュ', hyo:'ヒョ',
  bya:'ビャ', byu:'ビュ', byo:'ビョ', pya:'ピャ', pyu:'ピュ', pyo:'ピョ',
  mya:'ミャ', myu:'ミュ', myo:'ミョ', rya:'リャ', ryu:'リュ', ryo:'リョ',
  shi:'シ', chi:'チ', tsu:'ツ', tu:'ツ', fu:'フ', hu:'フ', si:'シ', ti:'チ', ji:'ジ', di:'ヂ', du:'ヅ',
  ka:'カ', ki:'キ', ku:'ク', ke:'ケ', ko:'コ',
  sa:'サ', su:'ス', se:'セ', so:'ソ',
  ta:'タ', te:'テ', to:'ト',
  na:'ナ', ni:'ニ', nu:'ヌ', ne:'ネ', no:'ノ',
  ha:'ハ', hi:'ヒ', he:'ヘ', ho:'ホ',
  ma:'マ', mi:'ミ', mu:'ム', me:'メ', mo:'モ',
  ya:'ヤ', yu:'ユ', yo:'ヨ',
  ra:'ラ', ri:'リ', ru:'ル', re:'レ', ro:'ロ',
  wa:'ワ', wo:'ヲ', we:'ウェ', wi:'ウィ',
  ga:'ガ', gi:'ギ', gu:'グ', ge:'ゲ', go:'ゴ',
  za:'ザ', zu:'ズ', ze:'ゼ', zo:'ゾ',
  da:'ダ', de:'デ', do:'ド',
  ba:'バ', bi:'ビ', bu:'ブ', be:'ベ', bo:'ボ',
  pa:'パ', pi:'ピ', pu:'プ', pe:'ペ', po:'ポ',
  va:'ヴァ', vi:'ヴィ', vu:'ヴ', ve:'ヴェ', vo:'ヴォ',
  a:'ア', i:'イ', u:'ウ', e:'エ', o:'オ',
};

function wnRomajiToKatakana(src) {
  if (!src) return '';
  let s = String(src).toLowerCase().trim()
    // マクロン・サーカムフレックスは長音として扱う（Ō→オー）
    .replace(/[āâ]/g, 'a-').replace(/[īî]/g, 'i-').replace(/[ūû]/g, 'u-')
    .replace(/[ēê]/g, 'e-').replace(/[ōô]/g, 'o-')
    .replace(/[^a-z\s'’-]/g, '');
  // OHNO 式の h 長音（母音+h の直後が子音か語末なら長音）
  s = s.replace(/([aeiou])h(?=[^aeiouy]|$)/g, '$1-');

  let out = '';
  for (let i = 0; i < s.length; ) {
    const ch = s[i];

    if (/\s/.test(ch)) { out += ' ';  i++; continue; }
    if (ch === '-')    { out += 'ー'; i++; continue; }
    if (ch === "'" || ch === '’') { i++; continue; }   // n' の区切り記号

    // 促音。tch（＝っち）も含める
    if (ch === 't' && s.substr(i + 1, 2) === 'ch') { out += 'ッ'; i++; continue; }
    if (/[bcdfghjklmpqrstvwxyz]/.test(ch) && ch === s[i + 1]) { out += 'ッ'; i++; continue; }

    /* ん（母音・y が続かない n）。
       「Kenichi」のように区切りを書かない名刺は「ケニチ」になる（けんいち とは判別できない）。
       逆に「田中 TANAKA」は「タナカ」で正しいので、印字どおりの解釈を既定にしている。
       区切りが書かれた「Ken'ichi」は ケンイチ になる。カナ欄は自動入力の目印を付けて確認を促す。 */
    if (ch === 'n' && !/[aiueoy]/.test(s[i + 1] ?? '')) { out += 'ン'; i++; continue; }

    // 3文字 → 2文字 → 1文字の順で当てる
    let hit = false;
    for (const len of [3, 2, 1]) {
      const key = s.substr(i, len);
      if (key.length === len && WN_ROMAJI_MAP[key]) { out += WN_ROMAJI_MAP[key]; i += len; hit = true; break; }
    }
    if (!hit) i++;   // 読めない文字は捨てる
  }
  return out.replace(/\s+/g, ' ').trim();
}

/* 名刺のローマ字表記（例: KENICHIRO HORIUCHI）を「姓 名」のカナにする。
   日本の名刺は「名→姓」の順が多い。片方だけ全大文字なら、そちらを姓と見なす（YAMADA Taro 形式）。 */
function wnRomajiNameToKana(roman) {
  const parts = String(roman ?? '').trim().split(/[\s　]+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length !== 2) return wnRomajiToKatakana(parts.join(' '));

  const isUpper = w => w === w.toUpperCase() && /[A-Z]/.test(w);
  let [first, second] = parts;
  // 「YAMADA Taro」形式なら全大文字の方が姓。それ以外は「名 姓」とみなして入れ替える
  const familyFirst = isUpper(first) && !isUpper(second);
  const family = familyFirst ? first : second;
  const given  = familyFirst ? second : first;
  return `${wnRomajiToKatakana(family)} ${wnRomajiToKatakana(given)}`.trim();
}

/* ── 連絡先タグ（グループ＋タグ） ──
   作成・改名・削除は管理者のみ。can_edit で編集導線の出し分けを行う */
async function wnGetContactTags() {
  const res = await wnFetch('/wn/contact-tags');
  if (!res || !res.ok) return { groups: [], tags: [], can_edit: false };
  return (await res.json()).data ?? { groups: [], tags: [], can_edit: false };
}
async function wnCreateContactTag({ name, kana, groupId }) {
  return _wnTagWrite('/wn/contact-tags', 'POST', { name, kana: kana || null, group_id: groupId || null });
}
async function wnUpdateContactTag(id, { name, kana, groupId }) {
  return _wnTagWrite(`/wn/contact-tags/${id}`, 'PATCH', { name, kana: kana || null, group_id: groupId || null });
}
async function wnDeleteContactTag(id) {
  return _wnTagWrite(`/wn/contact-tags/${id}`, 'DELETE');
}
async function wnCreateContactTagGroup(name) {
  return _wnTagWrite('/wn/contact-tag-groups', 'POST', { name });
}
async function wnUpdateContactTagGroup(id, name) {
  return _wnTagWrite(`/wn/contact-tag-groups/${id}`, 'PATCH', { name });
}
/* deleteTags=true なら中のタグごと削除、false なら「未分類」に残す */
async function wnDeleteContactTagGroup(id, deleteTags) {
  return _wnTagWrite(`/wn/contact-tag-groups/${id}`, 'DELETE', { delete_tags: !!deleteTags });
}
async function _wnTagWrite(path, method, body) {
  const res = await wnFetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!res || !res.ok) {
    const err = await res?.json().catch(() => ({}));
    throw new Error(err.message || 'タグの保存に失敗しました');
  }
  return (await res.json()).data ?? true;
}
async function wnDeleteContact(id) {
  const res = await wnFetch(`/wn/contacts/${id}`, { method: 'DELETE' });
  return !!(res && res.ok);
}

/* ── 関連ファイル ── */
async function wnGetRelations(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/relations`);
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}
async function wnAddRelation(fileId, relatedId) {
  const res = await wnFetch(`/wn/files/${fileId}/relations`, {
    method: 'POST',
    body: JSON.stringify({ related_id: relatedId }),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}
async function wnRemoveRelation(fileId, relationId) {
  const res = await wnFetch(`/wn/files/${fileId}/relations/${relationId}`, { method: 'DELETE' });
  return res && res.ok;
}
async function wnSuggestRelations(fileId) {
  const res = await wnFetch(`/wn/files/${fileId}/relations/suggest`);
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

/* ── マニュアル（工場向け手順書・会社単位） ── */

/* マニュアル一覧
   params: { search, search_reading, tag, status, mine, sort, page, per_page }
     sort: recent(最近見た) | popular(よく見る) | newest | oldest | name
   返り値: { data: [], meta: {...}, error: null } / { data: null, meta: null, error: 'msg' }
   wnGetFiles と同じくエラーと「本当に空」を区別し、詰まりをリトライで自動回復させる */
async function wnGetManuals(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v); });
  const path = '/wn/manuals?' + q.toString();

  const MAX_ATTEMPTS    = 4;
  const BACKOFF_MS      = [0, 700, 1600, 3200];
  const PER_TRY_TIMEOUT = 15000;

  let lastError = 'unknown';
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt]) await new Promise(r => setTimeout(r, BACKOFF_MS[attempt]));

    const ctl   = new AbortController();
    const timer = setTimeout(() => ctl.abort(), PER_TRY_TIMEOUT);
    try {
      const res = await wnFetch(path, { signal: ctl.signal });
      clearTimeout(timer);
      if (!res) return { data: null, meta: null, error: 'auth' };
      if (res.status >= 500) { lastError = `server-${res.status}`; continue; }
      if (!res.ok) return { data: null, meta: null, error: `http-${res.status}` };
      const json = await res.json();
      return { data: json.data ?? [], meta: json.meta ?? null, error: null };
    } catch (e) {
      clearTimeout(timer);
      lastError = (e && e.name === 'AbortError') ? 'timeout' : 'network';
    }
  }
  return { data: null, meta: null, error: lastError };
}

/* マニュアルで使われているタグ一覧（used=true で件数0のタグを除く） */
async function wnGetManualTags(used = false) {
  const res = await wnFetch('/wn/manuals/tags' + (used ? '?used=1' : ''));
  if (!res || !res.ok) return [];
  return (await res.json()).data ?? [];
}

/* タグ付与（tagIdまたはnameのどちらか。nameは無ければその場で作成される） */
async function wnAddManualTag(id, { tagId, name } = {}) {
  const res = await wnFetch(`/wn/manuals/${id}/tags`, {
    method: 'POST',
    body: JSON.stringify(tagId ? { tag_id: tagId } : { name }),
  });
  if (!res || !res.ok) {
    const err = await res?.json().catch(() => ({}));
    throw new Error(err.message || 'タグの追加に失敗しました');
  }
  return (await res.json()).data;
}

async function wnRemoveManualTag(id, tagId) {
  const res = await wnFetch(`/wn/manuals/${id}/tags/${tagId}`, { method: 'DELETE' });
  return !!(res && res.ok);
}

/* 閲覧記録（「最近見た/よく見る」の並べ替え用。失敗しても閲覧を妨げない） */
async function wnTrackManualView(id) {
  try {
    await wnFetch(`/wn/manuals/${id}/view`, { method: 'POST' });
  } catch (e) { /* 記録できなくても表示は継続する */ }
}
async function wnGetManual(id) {
  const res = await wnFetch(`/wn/manuals/${id}`);
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}
async function wnCreateManual(title, description = '') {
  const res = await wnFetch('/wn/manuals', {
    method: 'POST',
    body: JSON.stringify({ title, description: description || null }),
  });
  if (!res || !res.ok) {
    const err = await res?.json().catch(() => ({}));
    throw new Error(err.message || 'マニュアルの作成に失敗しました');
  }
  return (await res.json()).data;
}
async function wnUpdateManual(id, patch) {
  const res = await wnFetch(`/wn/manuals/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}
async function wnDeleteManual(id) {
  const res = await wnFetch(`/wn/manuals/${id}`, { method: 'DELETE' });
  return !!(res && res.ok);
}
async function wnAddManualStep(id, { type, fileId, caption, body } = {}) {
  const res = await wnFetch(`/wn/manuals/${id}/steps`, {
    method: 'POST',
    body: JSON.stringify({
      type,
      file_id: fileId || null,
      caption: caption || null,
      body:    body    || null,
    }),
  });
  if (!res || !res.ok) {
    const err = await res?.json().catch(() => ({}));
    throw new Error(err.message || 'ステップの追加に失敗しました');
  }
  return (await res.json()).data;
}
async function wnUpdateManualStep(id, stepId, patch) {
  const res = await wnFetch(`/wn/manuals/${id}/steps/${stepId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!res || !res.ok) return null;
  return (await res.json()).data ?? null;
}
async function wnDeleteManualStep(id, stepId) {
  const res = await wnFetch(`/wn/manuals/${id}/steps/${stepId}`, { method: 'DELETE' });
  return !!(res && res.ok);
}
async function wnReorderManualSteps(id, order) {
  const res = await wnFetch(`/wn/manuals/${id}/steps/reorder`, {
    method: 'PATCH',
    body: JSON.stringify({ order }),
  });
  return !!(res && res.ok);
}

/* ── a.a（経営者向け業界SNS）へ投稿 ── */
const AA_APP_URL = (() => {
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.test')) return 'http://localhost:8080';
  return 'https://aa-sns.pages.dev';
})();

/* What'sNoファイルをそのままa.aへ投稿。
   複数渡すと**まとめて1投稿**になり、a.a側では選んだ順のスライドとして表示される。 */
async function wnPostToAa(wnFileIds, { category, body } = {}) {
  const res = await wnFetch('/aa/posts/from-wn', {
    method: 'POST',
    body: JSON.stringify({
      wn_file_ids: [].concat(wnFileIds).map(Number),
      category: category || null,
      body: body || '',
    }),
  });
  if (!res || !res.ok) {
    const err = await res?.json().catch(() => ({}));
    const e = new Error(err.message || 'a.aへの投稿に失敗しました');
    e.code = err.code;
    throw e;
  }
  return (await res.json()).data;
}

/* a.a SSOチケット発行（会員判定の事前チェック・新規タブオープンの両方に使う使い捨てチケット） */
async function wnGetAaTicket() {
  const res = await wnFetch('/aa/sso/ticket', { method: 'POST' });
  if (!res || !res.ok) return null;
  return res.json(); // { ticket, is_member, expires_in }
}

/* a.aをSSOで新規タブオープン（ポップアップブロック回避のため、必ずボタンのクリックハンドラから直接呼ぶこと） */
async function wnOpenAaInNewTab() {
  const t = await wnGetAaTicket();
  if (!t || !t.ticket) { wnShowToast('a.aへの連携に失敗しました', 'danger'); return; }
  window.open(`${AA_APP_URL}/#sso=${encodeURIComponent(t.ticket)}`, '_blank');
}

/* ──────────────────────────────
   ユーティリティ
   ────────────────────────────── */

function wnFormatSize(bytes) {
  if (bytes < 1024)        return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 ** 3)   return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 ** 3).toFixed(2) + ' GB';
}

function wnFormatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function wnFileIcon(fileName, mimeType = '') {
  /* 拡張子最優先（DB の mime_type が誤登録されていても正しいアイコンを返す）。
     map に該当しなければ mime_type からのフォールバックを使う */
  const ext = (fileName || '').split('.').pop().toLowerCase();
  const map = {
    pdf:  { icon: 'fa-file-pdf',    cls: 'file-icon-pdf' },
    dxf:  { icon: 'fa-file-lines',  cls: 'file-icon-dxf' },
    dwg:  { icon: 'fa-file-lines',  cls: 'file-icon-dxf' },
    stl:  { icon: 'fa-cube',        cls: 'file-icon-stl' },
    stp:  { icon: 'fa-cube',        cls: 'file-icon-stl' },
    step: { icon: 'fa-cube',        cls: 'file-icon-stl' },
    obj:  { icon: 'fa-cube',        cls: 'file-icon-stl' },
    png:  { icon: 'fa-file-image',  cls: 'file-icon-img' },
    jpg:  { icon: 'fa-file-image',  cls: 'file-icon-img' },
    jpeg: { icon: 'fa-file-image',  cls: 'file-icon-img' },
    gif:  { icon: 'fa-file-image',  cls: 'file-icon-img' },
    webp: { icon: 'fa-file-image',  cls: 'file-icon-img' },
    heic: { icon: 'fa-file-image',  cls: 'file-icon-img' },
    heif: { icon: 'fa-file-image',  cls: 'file-icon-img' },
    svg:  { icon: 'fa-file-image',  cls: 'file-icon-img' },
    mp4:  { icon: 'fa-file-video',  cls: 'file-icon-img' },
    mov:  { icon: 'fa-file-video',  cls: 'file-icon-img' },
    avi:  { icon: 'fa-file-video',  cls: 'file-icon-img' },
    xlsx: { icon: 'fa-file-excel',  cls: 'file-icon-xls' },
    xls:  { icon: 'fa-file-excel',  cls: 'file-icon-xls' },
    csv:  { icon: 'fa-file-csv',    cls: 'file-icon-xls' },
    docx: { icon: 'fa-file-word',   cls: 'file-icon-doc' },
    doc:  { icon: 'fa-file-word',   cls: 'file-icon-doc' },
    zip:  { icon: 'fa-file-zipper', cls: 'file-icon-zip' },
    rar:  { icon: 'fa-file-zipper', cls: 'file-icon-zip' },
  };
  if (map[ext]) return map[ext];
  /* 拡張子マップに無ければ mime_type からフォールバック */
  if (mimeType.startsWith('image/')) return { icon: 'fa-file-image', cls: 'file-icon-img' };
  if (mimeType.startsWith('video/')) return { icon: 'fa-file-video', cls: 'file-icon-img' };
  return { icon: 'fa-file', cls: 'file-icon-other' };
}

/* annotate.html で注釈編集できる形式か（PDF・画像のみ。PowerPointは対象外） */
function wnIsAnnotatable(fileName, mimeType = '') {
  const ext  = (fileName || '').split('.').pop().toLowerCase();
  const mime = mimeType || '';
  if (['pptx', 'ppt', 'pptm'].includes(ext)) return false;
  return ext === 'pdf' || mime === 'application/pdf'
    || mime.startsWith('image/')
    || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'svg'].includes(ext);
}

/* ── Knowl ── */
async function wnBrainAsk(question, sessionId = null, folderId = null) {
  const res = await wnFetch('/wn/brain/ask', {
    method: 'POST',
    body: JSON.stringify({ question, session_id: sessionId, folder_id: folderId }),
  });
  if (!res || !res.ok) throw { status: res?.status };
  return res.json();
}
async function wnBrainSessions() {
  const res = await wnFetch('/wn/brain/sessions');
  if (!res || !res.ok) return [];
  return res.json();
}
async function wnBrainSession(id) {
  const res = await wnFetch(`/wn/brain/sessions/${id}`);
  if (!res || !res.ok) return {};
  return res.json();
}
async function wnBrainNewSession() {
  const res = await wnFetch('/wn/brain/sessions', { method: 'POST', body: JSON.stringify({}) });
  if (!res || !res.ok) return null;
  return res.json();
}
async function wnBrainMeter() {
  const res = await wnFetch('/wn/brain/meter');
  if (!res || !res.ok) throw new Error('meter fetch failed');
  return res.json();
}
async function wnBrainNotes() {
  const res = await wnFetch('/wn/brain/notes');
  if (!res || !res.ok) return { data: [] };
  return res.json();
}
async function wnBrainAddNote(content) {
  const res = await wnFetch('/wn/brain/notes', {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
  if (!res || !res.ok) throw { status: res?.status };
  return res.json();
}
async function wnBrainDeleteNote(id) {
  const res = await wnFetch(`/wn/brain/notes/${id}`, { method: 'DELETE' });
  return !!(res && res.ok);
}

/* ────────────────────────────────
   メーラー起動（PC / スマホ共通）
   スマホは mailto の制約が厳しく「押しても何も起きない」になりやすいため、
   起動経路をここに集約する
   ──────────────────────────────── */

// スマホのメーラーは mailto が長すぎると起動せず無反応になるため上限を設ける。
// 日本語は %エンコードで1文字9文字に膨らむので、4000 で本文およそ350文字ぶん。
// PCは従来どおり無制限（これまで問題が出ていないため挙動を変えない）。
const WN_MAILTO_MAX_LEN_MOBILE = 4000;

/* スマホ・タブレット判定（iPadOSはMacを名乗るため maxTouchPoints も見る） */
function wnIsMobileDevice() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod|Android/i.test(ua)
    || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
}

/* mailto: URL を組み立てる。
   m.parts = { message, core, signature } を渡すと、長すぎるときに
   署名 → メッセージ の順で削り、共有リンク（core）だけは必ず残す。
   戻り値: { url, trimmed } */
function wnBuildMailtoUrl(m) {
  const enc   = encodeURIComponent;
  const max   = wnIsMobileDevice() ? WN_MAILTO_MAX_LEN_MOBILE : Infinity;
  const build = (body) => {
    const q = [];
    if (m.cc)      q.push(`cc=${enc(m.cc)}`);
    if (m.bcc)     q.push(`bcc=${enc(m.bcc)}`);
    if (m.subject) q.push(`subject=${enc(m.subject)}`);
    q.push(`body=${enc(body)}`);
    return `mailto:${m.to}?${q.join('&')}`;
  };

  const full = build(m.body);
  if (full.length <= max || !m.parts) return { url: full, trimmed: false };

  const compose = (msg, sig) => [msg, m.parts.core].filter(Boolean).join('\r\n\r\n') + (sig || '');

  // 1) まず署名を落とす
  let url = build(compose(m.parts.message, ''));
  if (url.length <= max) return { url, trimmed: true };

  // 2) それでも長ければメッセージを後ろから削る
  let msg = m.parts.message || '';
  while (msg) {
    msg = msg.slice(0, Math.max(0, Math.floor(msg.length * 0.8) - 1));
    url = build(compose(msg ? `${msg}…` : '', ''));
    if (url.length <= max) return { url, trimmed: true };
  }

  // 3) 共有リンクだけで上限を超える（ファイル多数）→ 削らずそのまま返す
  return { url: build(compose('', '')), trimmed: true };
}

/* mailto: を開く。
   - iOSのホーム画面PWAでは location.href への代入が無視されることがあるため
     <a> のクリックを主経路にする
   - 既定メールアプリ未設定の端末では mailto が完全に無反応になるので、
     画面が離れたか（blur / visibilitychange）で起動可否を推定して onFail を呼ぶ */
function wnOpenMailto(url, { onLaunch, onFail } = {}) {
  let left = false;
  const mark = () => { left = true; };
  window.addEventListener('blur', mark);
  document.addEventListener('visibilitychange', mark);

  try {
    const a = document.createElement('a');
    a.href = url;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 2000);
  } catch {
    window.location.href = url;
  }

  setTimeout(() => {
    window.removeEventListener('blur', mark);
    document.removeEventListener('visibilitychange', mark);
    if (left) onLaunch?.(); else onFail?.();
  }, 1500);
}

/* ホーム画面に追加したPWA（standalone）で開いているか */
function wnIsStandalonePwa() {
  return window.navigator.standalone === true
    || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/* 外部サイトを開く。
   iOSのホーム画面アプリ（standalone）では window.open が無視されて「何も起きない」ため、
   <a target="_blank"> のクリックでブラウザに渡す。それでも開かなければ同じ画面で遷移する。 */
function wnOpenExternalUrl(url) {
  let left = false;
  const mark = () => { left = true; };
  window.addEventListener('blur', mark);
  document.addEventListener('visibilitychange', mark);

  const a = document.createElement('a');
  a.href   = url;
  a.target = '_blank';
  a.rel    = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    window.removeEventListener('blur', mark);
    document.removeEventListener('visibilitychange', mark);
    a.remove();
    if (!left) window.location.href = url;   // 新規タブが開かなかった端末向けのフォールバック
  }, 1000);
}

/* Gmailの作成画面を開く。
   googlegmail:// スキームはアプリ未インストール時に「アドレスが無効です」警告が出るため使わない。
   Web版URLならAndroidはGmailアプリに引き継がれ、iOSはブラウザのGmailが開く
   （iOSはGmailアプリを直接起動する手段がないため、Gmailアプリを使いたい場合は
     既定メールアプリをGmailにして「メールアプリ」＝mailto を使ってもらう）。 */
function wnOpenGmailCompose(m) {
  const enc = encodeURIComponent;
  const url = 'https://mail.google.com/mail/?view=cm&fs=1'
    + `&to=${enc(m.to)}`
    + (m.cc  ? `&cc=${enc(m.cc)}`   : '')
    + (m.bcc ? `&bcc=${enc(m.bcc)}` : '')
    + `&su=${enc(m.subject)}`
    + `&body=${enc(m.body)}`;

  // スマホ（特にホーム画面アプリ）は window.open が無視されるため <a> クリック経由で開く
  if (wnIsMobileDevice()) { wnOpenExternalUrl(url); return; }
  const w = window.open(url, '_blank');
  if (!w) window.location.href = url;   // ポップアップ不可のアプリ内ブラウザ対策
}

function wnShowToast(msg, type = '') {
  const c = document.getElementById('toastContainer');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast${type ? ' toast-' + type : ''}`;
  const iconMap = { success: 'circle-check', danger: 'circle-exclamation', warning: 'triangle-exclamation' };
  t.innerHTML = `<i class="fa-solid fa-${iconMap[type] ?? 'bell'}"></i> ${msg}`;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
}

/* ────────────────────────────────
   メール送信前チェック: 連絡先に未登録の宛先を報告する
   （dashboard / file-detail のメールモーダル共通）
   ──────────────────────────────── */

/* 連絡先（wnGetContacts の結果）に無いメールアドレスを、重複を除いて返す */
function wnFindUnknownEmails(emails, contacts) {
  const known = new Set(
    (contacts || []).map(c => (c?.email || '').trim().toLowerCase()).filter(Boolean)
  );
  const seen = new Set();
  const out  = [];
  for (const raw of emails || []) {
    const email = (raw || '').trim();
    const key   = email.toLowerCase();
    if (!email || known.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/* 「今後は表示しない」の記憶（端末ごと） */
const WN_UNKNOWN_CONTACT_OFF_KEY = 'wn_unknown_contact_popup_off';
function wnIsUnknownContactPopupOff() {
  return localStorage.getItem(WN_UNKNOWN_CONTACT_OFF_KEY) === '1';
}
function wnSetUnknownContactPopupOff(off) {
  if (off) localStorage.setItem(WN_UNKNOWN_CONTACT_OFF_KEY, '1');
  else     localStorage.removeItem(WN_UNKNOWN_CONTACT_OFF_KEY);
}

/* 非表示にしているあいだは、メールモーダルに「元に戻す」導線を出しておく。
   設定画面が無いため、これが無いと一度切ったきり戻せなくなる。
   メールモーダルを開くたびに呼ぶ（dashboard / file-detail 共通） */
function wnRenderUnknownContactNotice() {
  document.getElementById('wnUnknownContactNotice')?.remove();
  if (!wnIsUnknownContactPopupOff()) return;

  const footer = document.getElementById('emailMailtoBtn')?.closest('.modal-footer');
  if (!footer) return;

  const el = document.createElement('div');
  el.id = 'wnUnknownContactNotice';
  el.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);'
    + 'background:rgba(255,152,0,.10);border-radius:6px;padding:7px 10px;margin-top:12px;line-height:1.6;';
  el.innerHTML = `
    <i class="fa-solid fa-bell-slash" style="color:#E17055;"></i>
    <span style="flex:1;">連絡先に未登録の宛先のお知らせは非表示にしています</span>
    <button type="button" class="btn btn-outline btn-sm" data-act="restore"
            style="flex-shrink:0;font-size:11px;padding:4px 8px;white-space:nowrap;">元に戻す</button>`;
  el.querySelector('[data-act="restore"]').addEventListener('click', () => {
    wnSetUnknownContactPopupOff(false);
    wnRenderUnknownContactNotice();
    wnShowToast('未登録の宛先をお知らせするように戻しました', 'success');
  });
  footer.parentNode.insertBefore(el, footer);
}

/* 未登録の宛先をポップアップで報告する。
   onProceed(newContacts) は「登録せずに送信」「登録して送信」のどちらでも呼ばれる
   （newContacts は名前が入力された分だけ。登録しない場合は空配列）。
   スマホは mailto / 新規タブがタップ直後でないとブロックされるため、
   ボタンのクリックハンドラから同期で onProceed を呼ぶ（保存の完了は待たない）。 */
function wnShowUnknownContactsPopup(emails, onProceed) {
  document.getElementById('wnUnknownContactsModal')?.remove();

  const list    = Array.isArray(emails) ? emails : [];
  const overlay = document.createElement('div');
  overlay.id        = 'wnUnknownContactsModal';
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '1100';   // メールモーダル（1000）の上に重ねる
  overlay.innerHTML = `
    <div class="modal" style="max-width:440px;">
      <div class="modal-header">
        <span class="modal-title">
          <i class="fa-solid fa-user-plus" style="color:#E17055;margin-right:6px;"></i>連絡先に未登録の宛先があります
        </span>
        <button class="modal-close" data-act="cancel"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <p style="font-size:12px;color:var(--muted);line-height:1.7;margin-bottom:14px;">
        次の宛先は連絡先に登録されていません。名前を入れて登録しておくと、次回から入力候補に出ます。
      </p>
      <div data-rows style="display:flex;flex-direction:column;gap:12px;"></div>
      <label style="display:flex;align-items:center;gap:6px;margin-top:16px;font-size:11.5px;color:var(--muted);cursor:pointer;">
        <input type="checkbox" data-dontask style="cursor:pointer;">今後は表示しない
      </label>
      <div class="modal-footer" style="margin-top:14px;">
        <button class="btn btn-ghost btn-sm" data-act="cancel">キャンセル</button>
        <button class="btn btn-outline btn-sm" data-act="skip">登録せずに送信</button>
        <button class="btn btn-accent btn-sm" data-act="save" disabled>登録して送信</button>
      </div>
    </div>`;

  const rowsEl  = overlay.querySelector('[data-rows]');
  const saveBtn = overlay.querySelector('[data-act="save"]');
  const inputs  = [];

  for (const email of list) {
    const row  = document.createElement('div');
    const addr = document.createElement('div');
    addr.style.cssText = 'font-size:12px;font-weight:700;color:var(--primary);margin-bottom:5px;word-break:break-all;';
    addr.textContent = email;   // 宛先はユーザー入力なので textContent で埋める
    const input = document.createElement('input');
    input.type        = 'text';
    input.className   = 'form-input';
    input.placeholder = '名前（例: 山田 太郎）';
    input.maxLength   = 100;
    input.style.cssText = 'padding:7px 10px;font-size:13px;';
    input.dataset.email = email;
    row.appendChild(addr);
    row.appendChild(input);
    rowsEl.appendChild(row);
    inputs.push(input);
  }

  // 名前が1件も入っていないと「登録して送信」は押せない（name はサーバー側で必須）
  const syncSaveBtn = () => { saveBtn.disabled = !inputs.some(i => i.value.trim()); };
  inputs.forEach(i => i.addEventListener('input', syncSaveBtn));

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) { if (e.target === overlay) close(); return; }
    if (btn.dataset.act === 'cancel') { close(); return; }

    // 送信まで進んだときだけ記憶する（キャンセルは設定を変えない）
    if (overlay.querySelector('[data-dontask]')?.checked) wnSetUnknownContactPopupOff(true);

    const newContacts = btn.dataset.act === 'save'
      ? inputs.map(i => ({ name: i.value.trim(), email: i.dataset.email })).filter(c => c.name)
      : [];
    close();
    onProceed(newContacts);
  });

  document.body.appendChild(overlay);
  setTimeout(() => inputs[0]?.focus(), 50);
}

/* ポップアップで入力された連絡先を裏で保存する（送信を待たせない）。
   onSaved(count) は保存後のキャッシュ更新用 */
function wnSaveNewContactsInBackground(contacts, onSaved) {
  if (!contacts?.length) return;
  Promise.all(contacts.map(c => wnSaveContact(c).catch(() => null))).then(results => {
    const ok = results.filter(Boolean).length;
    if (ok) wnShowToast(`${ok}件を連絡先に登録しました`, 'success');
    if (ok < contacts.length) wnShowToast('一部の連絡先を登録できませんでした', 'warning');
    onSaved?.(ok);
  });
}
