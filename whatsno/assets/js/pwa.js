'use strict';
/* What'sNo PWA 登録 + インストールプロンプト */

(function () {
  /* Service Worker 登録 */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/whatsno/sw.js', { scope: '/whatsno/' })
        .then(reg => {
          /* 更新検知 → トースト */
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateBanner();
              }
            });
          });
        })
        .catch(err => console.warn('[PWA] SW registration failed:', err));
    });
  }

  /* インストールプロンプト保存 */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBtn();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallBtn();
    if (typeof wnShowToast === 'function') wnShowToast('アプリをインストールしました', 'success');
  });

  /* インストールボタン表示 */
  function showInstallBtn() {
    const btn = document.getElementById('pwaInstallBtn');
    if (btn) {
      btn.style.display = '';
      btn.addEventListener('click', triggerInstall, { once: true });
    }
  }
  function hideInstallBtn() {
    const btn = document.getElementById('pwaInstallBtn');
    if (btn) btn.style.display = 'none';
  }

  async function triggerInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome !== 'accepted') showInstallBtn();
  }

  /* 更新バナー */
  function showUpdateBanner() {
    const existing = document.getElementById('pwaUpdateBanner');
    if (existing) return;
    const banner = document.createElement('div');
    banner.id = 'pwaUpdateBanner';
    banner.innerHTML = `
      <i class="fa-solid fa-rotate"></i>
      <span>アップデートがあります。</span>
      <button onclick="location.reload()">今すぐ更新</button>
      <button onclick="this.closest('#pwaUpdateBanner').remove()" style="background:none;border:none;color:inherit;cursor:pointer;padding:4px;">✕</button>
    `;
    Object.assign(banner.style, {
      position: 'fixed', bottom: '72px', left: '50%', transform: 'translateX(-50%)',
      background: '#1E3A5F', color: '#fff', padding: '10px 18px',
      borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '10px',
      fontSize: '13px', zIndex: '9999', boxShadow: '0 4px 12px rgba(0,0,0,.3)',
    });
    const updateBtn = banner.querySelector('button');
    Object.assign(updateBtn.style, {
      background: '#2196F3', border: 'none', color: '#fff',
      padding: '5px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
    });
    document.body.appendChild(banner);
  }

  /* オフライン状態バナー */
  function updateOfflineBanner(isOnline) {
    let el = document.getElementById('offlineBanner');
    if (isOnline) { if (el) el.remove(); return; }
    if (el) return;
    el = document.createElement('div');
    el.id = 'offlineBanner';
    el.innerHTML = '<i class="fa-solid fa-wifi-slash"></i> オフラインモードです。キャッシュされたデータを表示中。';
    Object.assign(el.style, {
      position: 'fixed', top: '0', left: '0', right: '0',
      background: '#546E7A', color: '#fff', textAlign: 'center',
      padding: '8px', fontSize: '12px', zIndex: '9999',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    });
    document.body.appendChild(el);
  }

  window.addEventListener('online',  () => updateOfflineBanner(true));
  window.addEventListener('offline', () => updateOfflineBanner(false));
  if (!navigator.onLine) updateOfflineBanner(false);
})();
