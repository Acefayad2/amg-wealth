// AMG top bar: mobile menu toggle (same behavior as the homepage).
(() => {
  const burger = document.querySelector('.amg-topbar .burger');
  const menu = document.getElementById('amg-menu');
  if (!burger || !menu) return;
  function setMenuOpen(open) {
    burger.classList.toggle('open', open);
    menu.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  }
  burger.addEventListener('click', () => setMenuOpen(!menu.classList.contains('open')));
  menu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMenuOpen(false)));
  window.matchMedia('(max-width:1120px)').addEventListener('change', () => setMenuOpen(false));
  window.addEventListener('pageshow', () => setMenuOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.classList.contains('open')) {
      setMenuOpen(false);
      burger.focus({ preventScroll: true });
    }
  });
})();
