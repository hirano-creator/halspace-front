'use strict';
/* チャットの返信まわりで chat.html と project-detail.html が共用する小さなヘルパー。
   LINE と同じ操作感を狙っている:
     - スマホ: メッセージを右へスワイプすると返信、長押しで操作ボタンを出す
     - PC   : ホバーで出る操作ボタン（各ページのCSS側）
     - 引用ブロックをタップすると元のメッセージまでスクロールして光らせる */

/**
 * スワイプ返信と長押しメニューをコンテナに仕込む（メッセージは再描画されるのでイベント委譲）。
 * @param {HTMLElement} container スクロールするメッセージ一覧
 * @param {{item:string, onReply:(el:HTMLElement)=>void, onLongPress?:(el:HTMLElement)=>void}} opts
 *   item は1メッセージのセレクタ。要素には data-id を付けておくこと
 */
function initChatGestures(container, opts) {
  const { item, onReply, onLongPress } = opts;
  const THRESHOLD = 56;   // ここまで引いたら返信確定
  const MAX = 80;         // これ以上は動かさない
  const LONG_PRESS = 500;

  let el = null, x0 = 0, y0 = 0, dx = 0;
  let horizontal = null;  // null=未判定 / true=横スワイプ / false=縦スクロール
  let timer = null;
  let readyVibrated = false;

  const reset = () => {
    clearTimeout(timer);
    if (el) {
      const t = el;
      t.style.transition = 'transform .18s ease';
      t.style.transform = '';
      t.classList.remove('swiping', 'swipe-ready');
      setTimeout(() => { t.style.transition = ''; }, 200);
    }
    el = null; horizontal = null; dx = 0; readyVibrated = false;
  };

  container.addEventListener('touchstart', e => {
    /* 長押しで開いた操作ボタンは、他の場所を触ったら閉じる */
    const open = container.querySelector('.acts-open');
    if (open && !open.contains(e.target)) open.classList.remove('acts-open');

    if (e.touches.length !== 1) return;
    const target = e.target.closest(item);
    if (!target || !container.contains(target)) return;
    /* ボタン・入力欄の上から始まった操作はそちらに任せる */
    if (e.target.closest('button, a, textarea, input, select')) return;

    el = target;
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
    dx = 0; horizontal = null; readyVibrated = false;

    if (onLongPress) {
      timer = setTimeout(() => {
        if (el && horizontal === null) {
          onLongPress(el);
          if (navigator.vibrate) navigator.vibrate(10);
          el = null;   // 長押し後の指の動きはスワイプ扱いにしない
        }
      }, LONG_PRESS);
    }
  }, { passive: true });

  container.addEventListener('touchmove', e => {
    if (!el) return;
    const x = e.touches[0].clientX - x0;
    const y = e.touches[0].clientY - y0;
    if (horizontal === null) {
      if (Math.abs(x) < 8 && Math.abs(y) < 8) return;
      horizontal = Math.abs(x) > Math.abs(y);
      clearTimeout(timer);
      if (!horizontal) return;           // 縦スクロール中はブラウザに任せる
      el.classList.add('swiping');
    }
    if (!horizontal) return;
    dx = Math.max(0, Math.min(MAX, x));
    el.style.transform = `translateX(${dx}px)`;
    const ready = dx >= THRESHOLD;
    el.classList.toggle('swipe-ready', ready);
    if (ready && !readyVibrated && navigator.vibrate) {
      navigator.vibrate(8);
      readyVibrated = true;
    }
  }, { passive: true });

  container.addEventListener('touchend', () => {
    if (!el) { clearTimeout(timer); return; }
    const target = el;
    const ok = horizontal === true && dx >= THRESHOLD;
    reset();
    if (ok) onReply(target);
  });
  container.addEventListener('touchcancel', reset);
}

/**
 * 引用元のメッセージまでスクロールして一瞬光らせる。
 * 見つからなければ false（削除済み・まだ読み込んでいない等）。
 */
function jumpToChatMessage(container, id) {
  const el = container.querySelector(`[data-id="${CSS.escape(String(id))}"]`);
  if (!el) return false;

  /* scrollIntoView だとページ全体まで動いてしまうので、一覧の中だけをスクロールする */
  const cRect = container.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  const top = container.scrollTop + (eRect.top - cRect.top) - (container.clientHeight - eRect.height) / 2;
  container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });

  el.classList.remove('flash');
  void el.offsetWidth;   // アニメーションを取り直す
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1600);
  return true;
}
