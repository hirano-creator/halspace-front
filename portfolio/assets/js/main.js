// Header scroll effect
const header = document.getElementById('header');
window.addEventListener('scroll', () => {
  header.classList.toggle('scrolled', window.scrollY > 40);
}, { passive: true });

// Hamburger menu
const hamburger = document.getElementById('hamburger');
const nav = document.getElementById('nav');

hamburger.addEventListener('click', () => {
  const isOpen = hamburger.classList.toggle('open');
  nav.classList.toggle('open', isOpen);
  document.body.style.overflow = isOpen ? 'hidden' : '';
});

nav.querySelectorAll('.nav__link').forEach(link => {
  link.addEventListener('click', () => {
    hamburger.classList.remove('open');
    nav.classList.remove('open');
    document.body.style.overflow = '';
  });
});

// Fade-in on scroll
const observer = new IntersectionObserver(entries => {
  entries.forEach((entry, i) => {
    if (entry.isIntersecting) {
      setTimeout(() => {
        entry.target.classList.add('visible');
      }, i * 80);
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

// Stagger work cards
const cards = document.querySelectorAll('.work-card');
const cardObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const idx = [...cards].indexOf(entry.target);
      setTimeout(() => {
        entry.target.classList.add('visible');
      }, (idx % 2) * 120);
      cardObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });

cards.forEach(card => cardObserver.observe(card));
