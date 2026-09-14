'use strict';
/* チャットの返信・リアクションまわりで chat.html と project-detail.html が共用する小さなヘルパー。
   LINE と同じ操作感を狙っている:
     - スマホ: メッセージを右へスワイプすると返信、長押しで操作ボタンを出す
     - PC   : ホバーで出る操作ボタン（各ページのCSS側）
     - 引用ブロックをタップすると元のメッセージまでスクロールして光らせる
     - リアクションボタン(😊)で絵文字ピッカーを開閉、ピッカーの絵文字タップで自分の反応を
       追加・差し替え・解除する。チップ（絵文字＋人数）のタップは自分の反応の切り替えではなく、
       誰が反応したかの名前ポップオーバーを開閉する（各ページ側でAPIを叩くのはピッカー選択時のみ） */

/** リアクションで選べる絵文字。バックエンド（CommentController/SolidChatController の
 *  ALLOWED_REACTIONS）と同じ6種で揃えておくこと */
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/* chat.html は esc()、project-detail.html は escapeHtml() と名前が異なるため、
   このファイル単体で完結する専用のエスケープを持つ */
const escChatText = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 絵文字ごとに集計済みのリアクション一覧（{emoji,count,mine,users}[]）をチップ行のHTMLにする。
 *  チップをタップすると users（反応した人の名前）を吹き出しで表示する。0件なら何も出さない */
function reactionsHtml(reactions) {
  if (!reactions || !reactions.length) return '';
  return `<div class="msg-reactions">${reactions.map(r => `
    <span class="msg-reaction-wrap">
      <button type="button" class="msg-reaction${r.mine ? ' mine' : ''}" data-react-emoji="${r.emoji}">${r.emoji}<span>${r.count}</span></button>
      <div class="msg-react-names hidden">${escChatText((r.users || []).join('、'))}</div>
    </span>`
  ).join('')}</div>`;
}

/** 絵文字選択ポップオーバー（既定では非表示）。react ボタンの隣に置く想定 */
function reactionPickerHtml() {
  return `<div class="msg-react-picker hidden">${REACTION_EMOJIS.map(e =>
    `<button type="button" data-pick-emoji="${e}">${e}</button>`).join('')}</div>`;
}

/**
 * リアクションのクリックをコンテナに仕込む（イベント委譲。メッセージは再描画されるため1回だけ呼べばよい）。
 * @param {HTMLElement} container メッセージ一覧
 * @param {(id:string, emoji:string)=>void} onPick ピッカーで絵文字を選んだときの処理
 *   （id は closest('[data-id]') から拾う。呼び出し側でAPIを叩いてから再描画する）
 */
function initChatReactions(container, onPick) {
  container.addEventListener('click', e => {
    const pick = e.target.closest('[data-pick-emoji]');
    if (pick) {
      const id = pick.closest('[data-id]')?.dataset.id;
      pick.closest('.msg-react-picker')?.classList.add('hidden');
      if (id) onPick(id, pick.dataset.pickEmoji);
      return;
    }
    const chip = e.target.closest('[data-react-emoji]');
    if (chip) {
      const names = chip.parentElement.querySelector('.msg-react-names');
      const wasHidden = names?.classList.contains('hidden');
      container.querySelectorAll('.msg-react-names').forEach(n => n.classList.add('hidden'));
      if (names && wasHidden) names.classList.remove('hidden');
      return;
    }
    const opener = e.target.closest('[data-react-open]');
    if (opener) {
      const picker = opener.closest('[data-id]')?.querySelector('.msg-react-picker');
      const wasHidden = picker?.classList.contains('hidden');
      container.querySelectorAll('.msg-react-picker').forEach(p => p.classList.add('hidden'));
      if (picker && wasHidden) picker.classList.remove('hidden');
      return;
    }
    /* ピッカー・名前ポップオーバーの外をクリックしたら閉じる */
    if (!e.target.closest('.msg-react-picker') && !e.target.closest('.msg-react-names')) {
      container.querySelectorAll('.msg-react-picker, .msg-react-names').forEach(p => p.classList.add('hidden'));
    }
  });
}

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
