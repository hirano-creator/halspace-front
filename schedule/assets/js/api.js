/* Schedule Studio — API の呼び出し。通信はすべてここを通す。
   - ログイン情報は sessionStorage の space_token（Space.app 共通。localStorage に置かない）
   - 401 は Space.app のログイン画面へ（共通の auth.js の spaceLogout）
   - 再試行は GET だけ。POST・PUT・DELETE を自動で送り直すと二重登録になりうる */
window.SS = window.SS || {};
(function (SS) {
  const TIMEOUT_MS = 15000;

  function base() {
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.test')) {
      // ローカル確認では作業用 API を別の番号で動かすことがある（dev/login-local.html が指定する）
      let port = '8000';
      try { port = sessionStorage.getItem('ss_api_port') || port; } catch (e) { }
      return 'http://127.0.0.1:' + port + '/api';
    }
    return spaceApiBase();   // solid/assets/js/auth.js（本番の API の場所は 1 か所で持つ）
  }

  class ApiError extends Error {
    constructor(status, message, errors) { super(message); this.status = status; this.errors = errors || null; }
  }
  SS.ApiError = ApiError;

  async function once(method, path, body) {
    const token = sessionStorage.getItem('space_token');
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(base() + path, {
        method, signal: ctrl.signal,
        headers: { 'Accept': 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      throw new ApiError(0, '通信できませんでした。電波の状態を確かめて、もう一度お試しください。');
    } finally { clearTimeout(timer); }
    if (res.status === 401) { spaceLogout(); throw new ApiError(401, 'ログインの有効期限が切れました。'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const first = data.errors ? Object.values(data.errors)[0][0] : null;
      throw new ApiError(res.status, first || data.message || ('エラーが発生しました（' + res.status + '）'), data.errors);
    }
    return data;
  }

  SS.api = async function (method, path, body) {
    try { return await once(method, path, body); }
    catch (e) {
      if (method === 'GET' && e.status === 0) return once(method, path, body);   // 通信の失敗だけ 1 回やり直す
      throw e;
    }
  };
})(window.SS);
