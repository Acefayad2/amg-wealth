// Animated AMG buttons: magnetic lean, click ripple, in-view pulse.
// The top-bar CTA (.nav-cta) is left untouched.
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  const buttons = [...document.querySelectorAll('.btn:not(.nav-cta)')];

  buttons.forEach(btn => {
    // magnetic lean toward the cursor (max ~6px)
    btn.addEventListener('pointermove', e => {
      if (reduce.matches || !fine.matches) return;
      const r = btn.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      btn.style.setProperty('--mx', (dx * 6).toFixed(2) + 'px');
      btn.style.setProperty('--my', (dy * 4).toFixed(2) + 'px');
    });
    btn.addEventListener('pointerleave', () => {
      btn.style.setProperty('--mx', '0px');
      btn.style.setProperty('--my', '0px');
    });

    // ripple from the press point
    btn.addEventListener('pointerdown', e => {
      if (reduce.matches) return;
      const r = btn.getBoundingClientRect();
      const ripple = document.createElement('span');
      ripple.className = 'btn-ripple';
      ripple.style.setProperty('--d', Math.max(r.width, r.height) * 2.2 + 'px');
      ripple.style.setProperty('--rx', e.clientX - r.left + 'px');
      ripple.style.setProperty('--ry', e.clientY - r.top + 'px');
      btn.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove());
    });
  });

  // primary gold buttons pulse a soft ring when they first scroll into view
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting || reduce.matches) return;
    io.unobserve(entry.target);
    setTimeout(() => entry.target.classList.add('btn-pulse'), 450);
    entry.target.addEventListener('animationend', ev => {
      if (ev.animationName === 'btnpulsebox') entry.target.classList.remove('btn-pulse');
    });
  }), { threshold: 0.9 });
  buttons.filter(b => b.classList.contains('btn-gold')).forEach(b => io.observe(b));
})();
