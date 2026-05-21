'use strict';

// スクロール時ヘッダー
const header = document.getElementById('header');
window.addEventListener('scroll', () => {
  header.classList.toggle('scrolled', window.scrollY > 40);
}, { passive: true });

// ハンバーガーメニュー
const hamburger = document.getElementById('hamburger');
const nav = document.getElementById('nav');
hamburger.addEventListener('click', () => {
  hamburger.classList.toggle('active');
  nav.classList.toggle('open');
  document.body.style.overflow = nav.classList.contains('open') ? 'hidden' : '';
});
nav.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => {
    hamburger.classList.remove('active');
    nav.classList.remove('open');
    document.body.style.overflow = '';
  });
});

// スクロールアニメーション (Intersection Observer)
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -60px 0px' });

document.querySelectorAll('.reveal').forEach((el, i) => {
  el.style.transitionDelay = `${(i % 4) * 0.1}s`;
  revealObserver.observe(el);
});

// FAQ アコーディオン
document.querySelectorAll('.faq-question').forEach(btn => {
  btn.addEventListener('click', () => {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    // 全部閉じる
    document.querySelectorAll('.faq-question').forEach(b => {
      b.setAttribute('aria-expanded', 'false');
      b.nextElementSibling.classList.remove('open');
    });
    // クリックしたものを開く（すでに開いていれば閉じたまま）
    if (!expanded) {
      btn.setAttribute('aria-expanded', 'true');
      btn.nextElementSibling.classList.add('open');
    }
  });
});

// スムーズスクロール（ヘッダー高さ分オフセット）
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', e => {
    const target = document.querySelector(anchor.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    const offset = header.offsetHeight + 16;
    window.scrollTo({ top: target.offsetTop - offset, behavior: 'smooth' });
  });
});

// コンタクトフォーム送信ハンドリング（Formspree利用時）
const form = document.getElementById('contactForm');
if (form) {
  form.addEventListener('submit', async e => {
    const action = form.getAttribute('action');
    // Formspreeのデモ用IDならデフォルト動作のまま
    if (action.includes('your-form-id')) {
      e.preventDefault();
      alert('お問い合わせありがとうございます。\nFormspreeのフォームIDを設定してください。');
      return;
    }
    // 実際のFormspree送信時はブラウザデフォルトのPOSTに任せる
  });
}
