/* ============================================================
   What'sNo 詳細プレビュー用キャッシュ（IndexedDB + LRU）

   方針:
     - キー: preview_{fileId}_{updated_at}   ファイル更新で自動失効
     - 値:   { blob: Blob, size: number, accessed: number }
     - 上限: 500MB または 100件（超過時は最終アクセスが古いものから削除）

   公開 API:
     WnPreviewCache.get(fileId, updatedAt)            → Blob | null
     WnPreviewCache.set(fileId, updatedAt, blob)      → Promise<void>
     WnPreviewCache.clear()                           → Promise<void>
   ============================================================ */
const WnPreviewCache = (() => {
  const DB_NAME    = 'wn-preview-cache';
  const STORE_NAME = 'previews';
  const VERSION    = 1;

  const MAX_BYTES = 500 * 1024 * 1024;  // 500MB
  const MAX_ITEMS = 100;

  let db = null;

  function open() {
    if (db) return Promise.resolve(db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE_NAME)) {
          const store = d.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('accessed', 'accessed');
        }
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror   = () => reject(req.error);
    });
  }

  function buildKey(fileId, updatedAt) {
    return `preview_${fileId}_${updatedAt ?? ''}`;
  }

  async function get(fileId, updatedAt) {
    try {
      const d   = await open();
      const key = buildKey(fileId, updatedAt);
      return await new Promise((resolve) => {
        const tx  = d.transaction(STORE_NAME, 'readwrite');
        const st  = tx.objectStore(STORE_NAME);
        const req = st.get(key);
        req.onsuccess = () => {
          const rec = req.result;
          if (!rec) { resolve(null); return; }
          /* アクセス時刻を更新（LRU 用） */
          rec.accessed = Date.now();
          st.put(rec);
          resolve(rec.blob);
        };
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  }

  async function set(fileId, updatedAt, blob) {
    try {
      const d   = await open();
      const key = buildKey(fileId, updatedAt);
      const rec = { key, fileId, blob, size: blob.size ?? 0, accessed: Date.now() };

      await new Promise((resolve) => {
        const tx  = d.transaction(STORE_NAME, 'readwrite');
        const st  = tx.objectStore(STORE_NAME);
        /* 同じ fileId の旧バージョンキャッシュを削除 */
        const idx = st.openCursor();
        idx.onsuccess = e => {
          const cur = e.target.result;
          if (!cur) return;
          if (cur.value.fileId === fileId && cur.value.key !== key) cur.delete();
          cur.continue();
        };
        tx.oncomplete = () => resolve();
        tx.onerror    = () => resolve();
        st.put(rec);
      });

      await evictIfNeeded();
    } catch (e) { /* 容量不足エラーなどは静かに失敗 */ }
  }

  /* LRU 削除：上限超過時、accessed が古いものから削除 */
  async function evictIfNeeded() {
    const d = await open();
    return new Promise((resolve) => {
      const tx  = d.transaction(STORE_NAME, 'readwrite');
      const st  = tx.objectStore(STORE_NAME);
      const all = [];
      st.openCursor().onsuccess = e => {
        const cur = e.target.result;
        if (!cur) {
          /* 全件取得後に評価 */
          all.sort((a, b) => a.accessed - b.accessed);  // 古い順
          let totalBytes = all.reduce((s, r) => s + (r.size || 0), 0);
          let totalCount = all.length;
          for (const rec of all) {
            if (totalBytes <= MAX_BYTES && totalCount <= MAX_ITEMS) break;
            st.delete(rec.key);
            totalBytes -= (rec.size || 0);
            totalCount -= 1;
          }
          return;
        }
        all.push(cur.value);
        cur.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
    });
  }

  async function clear() {
    try {
      const d = await open();
      await new Promise((resolve) => {
        const tx = d.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror    = () => resolve();
      });
    } catch {}
  }

  return { get, set, clear };
})();
