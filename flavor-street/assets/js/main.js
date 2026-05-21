/**
 * Flavor Street - Main JavaScript
 *
 * @package FlavorStreet
 */

(function () {
  'use strict';

  /* ==========================================================================
     Header Scroll Effect
     ========================================================================== */
  const header = document.getElementById('fs-header');

  function handleHeaderScroll() {
    if (!header) return;
    if (window.scrollY > 50) {
      header.classList.add('is-scrolled');
    } else {
      header.classList.remove('is-scrolled');
    }
  }

  window.addEventListener('scroll', handleHeaderScroll, { passive: true });
  handleHeaderScroll();

  /* ==========================================================================
     Mobile Menu
     ========================================================================== */
  const hamburger = document.getElementById('fs-hamburger');
  const mobileMenu = document.getElementById('fs-mobile-menu');

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', function () {
      const isOpen = mobileMenu.classList.contains('is-open');
      hamburger.classList.toggle('is-active');
      mobileMenu.classList.toggle('is-open');
      hamburger.setAttribute('aria-expanded', !isOpen);
      document.body.style.overflow = isOpen ? '' : 'hidden';
    });

    // Overlay click to close
    mobileMenu.addEventListener('click', function (e) {
      if (e.target === mobileMenu) {
        hamburger.classList.remove('is-active');
        mobileMenu.classList.remove('is-open');
        hamburger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      }
    });
  }

  /* ==========================================================================
     Flow Tab Switching
     ========================================================================== */
  const tabs = document.querySelectorAll('.fs-flow__tab');
  const contents = document.querySelectorAll('.fs-flow__content');

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      const target = this.getAttribute('data-tab');

      // Remove active from all
      tabs.forEach(function (t) { t.classList.remove('is-active'); });
      contents.forEach(function (c) { c.classList.remove('is-active'); });

      // Activate selected
      this.classList.add('is-active');
      var targetContent = document.querySelector('[data-content="' + target + '"]');
      if (targetContent) {
        targetContent.classList.add('is-active');
      }
    });
  });

  /* ==========================================================================
     Back to Top Button
     ========================================================================== */
  const backToTop = document.getElementById('fs-back-to-top');

  if (backToTop) {
    window.addEventListener('scroll', function () {
      if (window.scrollY > 400) {
        backToTop.classList.add('is-visible');
      } else {
        backToTop.classList.remove('is-visible');
      }
    }, { passive: true });

    backToTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ==========================================================================
     Scroll Animation (Intersection Observer)
     ========================================================================== */
  function initScrollAnimations() {
    var animElements = document.querySelectorAll(
      '.fs-service-card, .fs-recommend__card, .fs-flow__step, ' +
      '.fs-gallery__item, .fs-traction__item, .fs-features__item, ' +
      '.fs-merit__card, .fs-testimonials__card, .fs-invite-cases__card'
    );

    if (!animElements.length || !('IntersectionObserver' in window)) return;

    // Add animation class
    animElements.forEach(function (el) {
      el.classList.add('fs-animate');
    });

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.15,
      rootMargin: '0px 0px -50px 0px'
    });

    animElements.forEach(function (el) {
      observer.observe(el);
    });
  }

  /* ==========================================================================
     Traction Number Counter Animation
     ========================================================================== */
  function initCounterAnimation() {
    var counters = document.querySelectorAll('.fs-traction__number[data-count]');

    if (!counters.length || !('IntersectionObserver' in window)) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    counters.forEach(function (counter) {
      observer.observe(counter);
    });
  }

  function animateCounter(el) {
    var target = parseInt(el.getAttribute('data-count'), 10);
    var duration = 2000;
    var start = 0;
    var startTime = null;

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      var current = Math.floor(eased * target);
      el.textContent = current.toLocaleString();

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = target.toLocaleString();
      }
    }

    requestAnimationFrame(step);
  }

  /* ==========================================================================
     Smooth Scroll for Anchor Links
     ========================================================================== */
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      var targetId = this.getAttribute('href');
      if (targetId === '#') return;

      var targetEl = document.querySelector(targetId);
      if (targetEl) {
        e.preventDefault();
        var headerHeight = header ? header.offsetHeight : 0;
        var targetPos = targetEl.getBoundingClientRect().top + window.scrollY - headerHeight;
        window.scrollTo({ top: targetPos, behavior: 'smooth' });

        // Close mobile menu if open
        if (mobileMenu && mobileMenu.classList.contains('is-open')) {
          hamburger.classList.remove('is-active');
          mobileMenu.classList.remove('is-open');
          document.body.style.overflow = '';
        }
      }
    });
  });

  /* ==========================================================================
     Initialize
     ========================================================================== */
  document.addEventListener('DOMContentLoaded', function () {
    initScrollAnimations();
    initCounterAnimation();
  });

})();
