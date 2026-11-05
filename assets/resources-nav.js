// Resources page: highlight the category chip for the section in view,
// and keep the active chip visible in the scrollable bar on phones.
(() => {
  const bar = document.querySelector('.category-nav');
  if (!bar) return;
  const chips = new Map([...bar.querySelectorAll('a[href^="#"]')].map(a => [a.getAttribute('href').slice(1), a]));
  const sections = [...chips.keys()].map(id => document.getElementById(id)).filter(Boolean);
  let current = null;
  function setActive(id) {
    if (id === current) return;
    current = id;
    chips.forEach((chip, key) => {
      if (key === id) chip.setAttribute('aria-current', 'true');
      else chip.removeAttribute('aria-current');
    });
    const chip = chips.get(id);
    if (chip && bar.scrollWidth > bar.clientWidth) {
      bar.scrollTo({ left: chip.offsetLeft - (bar.clientWidth - chip.offsetWidth) / 2, behavior: 'smooth' });
    }
  }
  const io = new IntersectionObserver(entries => {
    const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible.length) setActive(visible[0].target.id);
  }, { rootMargin: '-35% 0px -55% 0px' });
  sections.forEach(s => io.observe(s));
  // mark the bar as "stuck" once it reaches its sticky position
  const stickTop = () => parseFloat(getComputedStyle(bar).top) || 0;
  let ticking = false;
  function checkStuck() {
    ticking = false;
    bar.classList.toggle('stuck', bar.getBoundingClientRect().top <= stickTop() + 1 && window.scrollY > 0);
  }
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(checkStuck); } }, { passive: true });
  window.addEventListener('resize', checkStuck);
  checkStuck();
})();
