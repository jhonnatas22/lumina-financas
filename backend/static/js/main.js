// Landing page — menu mobile + animações suaves
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.style.display === 'flex';
      nav.style.display = open ? 'none' : 'flex';
      nav.style.position = 'absolute';
      nav.style.top = '72px';
      nav.style.left = '0';
      nav.style.right = '0';
      nav.style.background = '#101627';
      nav.style.flexDirection = 'column';
      nav.style.padding = '20px 24px';
      nav.style.gap = '18px';
      nav.style.borderBottom = '1px solid rgba(255,255,255,.08)';
    });
  }

  // Reveal on scroll
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.style.opacity = 1; e.target.style.transform = 'none'; io.unobserve(e.target); } });
  }, { threshold: .12 });
  document.querySelectorAll('.step-card,.feature-card,.obj-card,.price-card,.quote-card,.stat-tile').forEach(el => {
    el.style.opacity = 0; el.style.transform = 'translateY(22px)'; el.style.transition = 'opacity .6s ease, transform .6s ease';
    io.observe(el);
  });
});
