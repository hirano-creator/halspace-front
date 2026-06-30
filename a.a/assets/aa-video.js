/* a.a 動画サムネイル生成 & キャッシュ (iOS Safari 対応) */
'use strict';
(function () {
  const THUMB_VER = 'v1';
  const IS_MOBILE = /iP(hone|ad|od)/.test(navigator.userAgent)
    || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
    || /Android/.test(navigator.userAgent);

  function makeSemaphore(max) {
    let active = 0;
    const waiters = [];
    return {
      async acquire() {
        if (active < max) { active++; return; }
        await new Promise(r => waiters.push(r));
        active++;
      },
      release() {
        active--;
        const w = waiters.shift();
        if (w) w();
      },
    };
  }

  // モバイルは同時生成1本に絞る（OOM防止）
  const genSem = makeSemaphore(IS_MOBILE ? 1 : 3);

  const ThumbCache = (() => {
    const DB = 'aa-video-thumbs', STORE = 'thumbs', VER = 1;
    let db = null;
    const open = () => db ? Promise.resolve(db) : new Promise((res, rej) => {
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
      r.onsuccess = e => { db = e.target.result; res(db); };
      r.onerror = () => rej(r.error);
    });
    const tx = async (mode, fn) => {
      const d = await open();
      return new Promise((res, rej) => {
        const t = d.transaction(STORE, mode);
        const s = t.objectStore(STORE);
        const r = fn(s);
        r.onsuccess = () => res(r.result ?? null);
        r.onerror = () => rej(r.error);
      });
    };
    return {
      get: key => tx('readonly', s => s.get(key)),
      set: (key, blob) => tx('readwrite', s => s.put(blob, key)),
    };
  })();

  /**
   * iOS Safari は seek でフレームを得られないため play() → timeupdate 方式を正常系とする。
   * crossOrigin='anonymous' で CORS が通らない場合は toBlob が SecurityError → null を返す。
   */
  function captureVideoThumb(videoUrl) {
    return new Promise(resolve => {
      const video = document.createElement('video');
      // crossOrigin='anonymous' は R2 が CORS 未対応だとロード自体が失敗するため設定しない。
      // 同一オリジンのプロキシ URL を渡す前提（tainted canvas になっても SecurityError を catch する）。
      video.muted          = true;
      video.defaultMuted   = true;
      video.playsInline    = true;
      video.preload        = 'auto';
      // iOS Safari は属性としても必要
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      // display:none だと iOS がデータをロードしないため画面外に配置
      video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;'
        + 'width:320px;height:180px;opacity:.001;pointer-events:none;';
      document.body.appendChild(video);

      let captured = false;
      const finish = blob => {
        if (captured) return;
        captured = true;
        clearTimeout(timer);
        try {
          video.pause();
          video.removeAttribute('src');
          video.src = '';
          video.load(); // Safari はここでデコーダーバッファを解放
          document.body.removeChild(video);
        } catch {}
        resolve(blob);
      };
      const timer = setTimeout(() => finish(null), 10_000);

      const capture = () => {
        if (captured) return;
        try {
          const canvas = document.createElement('canvas');
          canvas.width  = video.videoWidth  || 320;
          canvas.height = video.videoHeight || 180;
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(blob => {
            canvas.width = canvas.height = 0; // backing store 即解放
            finish(blob);
          }, 'image/jpeg', 0.80);
        } catch { finish(null); }
      };
      // rAF×2: フレームが canvas に書かれた後にキャプチャ（直後は黒になる端末がある）
      const captureSoon = () => requestAnimationFrame(() => requestAnimationFrame(capture));

      // iOS Safari 正常系: play() → currentTime が進んだらキャプチャ
      video.addEventListener('loadedmetadata', () => {
        const p = video.play();
        if (p?.catch) p.catch(() => { try { video.currentTime = 0.5; } catch {} });
      });
      video.addEventListener('timeupdate', () => {
        if (!captured && video.currentTime >= 0.1) {
          try { video.pause(); } catch {}
          captureSoon();
        }
      });
      // seek 経路（自動再生不可環境のフォールバック）
      video.addEventListener('seeked', captureSoon, { once: true });
      video.addEventListener('error', () => finish(null), { once: true });

      video.src = videoUrl;
    });
  }

  /**
   * IndexedDB キャッシュ確認 → なければ生成してキャッシュ保存
   * @param {string} videoUrl
   * @param {string} cacheKey
   * @returns {Promise<string|null>}  ObjectURL or null
   */
  async function loadVideoThumb(videoUrl, cacheKey) {
    try {
      const cached = await ThumbCache.get(cacheKey);
      if (cached) return URL.createObjectURL(cached);
    } catch {}

    await genSem.acquire();
    let blob = null;
    try {
      blob = await captureVideoThumb(videoUrl);
    } finally {
      genSem.release();
    }
    if (!blob) return null;
    try { await ThumbCache.set(cacheKey, blob); } catch {}
    return URL.createObjectURL(blob);
  }

  window.AAVideo = { loadVideoThumb, THUMB_VER };
})();
