/* a.a 音声入力（Web Speech API / SpeechRecognition） */
'use strict';
(function () {
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

  function supported() {
    return !!SpeechRecognitionCtor;
  }

  // ページ内で同時に録音できるのは1つだけ（複数attach時は後から開始した方が優先）
  let active = null;

  // button: トグルボタン / target: input・textarea / interimEl: 認識途中テキストの表示先(任意) / onState: (listening)=>void
  function attach({ button, target, interimEl, onState }) {
    if (!button || !target) return null;
    if (!supported()) { button.hidden = true; return null; }

    let recognition = null;
    let listening = false;

    function insertAtCursor(text) {
      const start = target.selectionStart != null ? target.selectionStart : target.value.length;
      const end = target.selectionEnd != null ? target.selectionEnd : target.value.length;
      const val = target.value;
      target.value = val.slice(0, start) + text + val.slice(end);
      const pos = start + text.length;
      if (target.setSelectionRange) target.setSelectionRange(pos, pos);
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function setInterim(text) {
      if (interimEl) interimEl.textContent = text || '';
    }

    function setListening(v) {
      listening = v;
      button.classList.toggle('listening', v);
      if (!v) setInterim('');
      if (onState) onState(v);
    }

    function ensureRecognition() {
      if (recognition) return recognition;
      recognition = new SpeechRecognitionCtor();
      recognition.lang = 'ja-JP';
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (e) => {
        let interim = '';
        let final = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) final += e.results[i][0].transcript;
          else interim += e.results[i][0].transcript;
        }
        if (final) insertAtCursor(final);
        setInterim(interim);
      };
      recognition.onerror = (e) => {
        setInterim(e.error === 'not-allowed' ? 'マイクの使用が許可されていません' : '');
        stop();
      };
      // iOS Safari等は無音などで数秒〜十数秒ごとに自動終了するため、聞き続けたい間は再start
      recognition.onend = () => {
        if (!listening) return;
        try { recognition.start(); } catch (e) { setListening(false); }
      };
      return recognition;
    }

    function start() {
      if (active && active !== api) active.stop();
      ensureRecognition();
      try { recognition.start(); } catch (e) { /* 既に開始中などは無視 */ }
      setListening(true);
      active = api;
    }
    function stop() {
      if (recognition) { try { recognition.stop(); } catch (e) {} }
      setListening(false);
      if (active === api) active = null;
    }

    const api = {
      start,
      stop,
      toggle() { listening ? stop() : start(); },
    };

    button.addEventListener('click', () => api.toggle());
    return api;
  }

  // 認識中のDOM(textarea等)がまるごと差し替え/破棄される直前などに呼ぶ想定
  function stopActive() {
    if (active) active.stop();
  }

  window.AAVoice = { supported, attach, stopActive };
})();
