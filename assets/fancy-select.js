// Animated dropdown for <select data-fancy>. The native select stays in the form
// (hidden) and keeps the value, so submissions and other scripts work unchanged.
// Keyboard: Enter/Space/Down/Up open; arrows, Home/End, typeahead move; Enter selects; Esc/Tab close.
(() => {
  const ICONS = {
    growth: '<path d="M3 17l5-5 4 4 8-8M15 8h5v5"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    book: '<path d="M4 19V6a2 2 0 012-2h13v13H6a2 2 0 00-2 2zm0 0a2 2 0 002 2h13"/><path d="M9 8h6M9 12h4"/>',
    heart: '<path d="M12 21s-7-4.6-9.5-9A5.5 5.5 0 0112 6a5.5 5.5 0 019.5 6c-2.5 4.4-9.5 9-9.5 9z"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  };
  const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.star}</svg>`;
  const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  let uid = 0;

  document.querySelectorAll('select[data-fancy]').forEach(select => {
    const id = `fs${++uid}`;
    const label = document.querySelector(`label[for="${select.id}"]`);
    if (label && !label.id) label.id = `${id}-label`;
    const options = [...select.options];

    const wrap = document.createElement('div');
    wrap.className = 'fs';
    wrap.innerHTML = `
      <button type="button" class="fs-btn" id="${id}-btn" aria-haspopup="listbox" aria-expanded="false"
        aria-labelledby="${label ? label.id + ' ' : ''}${id}-btn">
        <span class="fs-ico"></span><span class="fs-val"></span><span class="fs-chev">${CHEV}</span>
      </button>
      <div class="fs-pop" role="listbox" id="${id}-list" tabindex="-1" ${label ? `aria-labelledby="${label.id}"` : ''}>
        <span class="fs-hl" aria-hidden="true"></span>
        ${options.map((o, i) => `
          <div class="fs-opt" role="option" id="${id}-o${i}" data-i="${i}" style="--i:${i}" aria-selected="false">
            <span class="fs-ico">${svg(o.dataset.icon)}</span>
            <span class="fs-txt"><b>${o.text}</b>${o.dataset.desc ? `<small>${o.dataset.desc}</small>` : ''}</span>
            <span class="fs-check">${CHECK}</span>
          </div>`).join('')}
      </div>`;
    select.after(wrap);
    select.hidden = true;
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    if (label) label.htmlFor = `${id}-btn`;

    const btn = wrap.querySelector('.fs-btn');
    const pop = wrap.querySelector('.fs-pop');
    const hl = wrap.querySelector('.fs-hl');
    const opts = [...wrap.querySelectorAll('.fs-opt')];
    const btnIco = btn.querySelector('.fs-ico');
    const val = btn.querySelector('.fs-val');
    let active = -1;
    let typed = '', typedAt = 0;

    function paintValue(animate) {
      const i = select.selectedIndex;
      opts.forEach((o, k) => o.setAttribute('aria-selected', String(k === i)));
      const text = options[i]?.text || '';
      btnIco.innerHTML = svg(options[i]?.dataset.icon);
      if (!animate) { val.innerHTML = `<span>${text}</span>`; return; }
      const old = val.querySelector('span:not(.out)');
      old?.classList.add('out');
      old?.addEventListener('animationend', () => old.remove(), { once: true });
      const next = document.createElement('span');
      next.className = 'in';
      next.textContent = text;
      val.append(next);
      btnIco.classList.remove('swap'); void btnIco.offsetWidth; btnIco.classList.add('swap');
    }

    function setActive(i, scroll = true) {
      active = Math.max(0, Math.min(opts.length - 1, i));
      opts.forEach((o, k) => o.classList.toggle('active', k === active));
      const o = opts[active];
      pop.setAttribute('aria-activedescendant', o.id);
      pop.classList.add('has-active');
      hl.style.setProperty('--y', `${o.offsetTop}px`);
      hl.style.setProperty('--h', `${o.offsetHeight}px`);
      if (scroll) o.scrollIntoView({ block: 'nearest' });
    }

    function open() {
      if (wrap.classList.contains('open')) return;
      const r = btn.getBoundingClientRect();
      const below = window.innerHeight - r.bottom, above = r.top;
      wrap.classList.toggle('up', below < 360 && above > below);
      wrap.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(() => { setActive(Math.max(0, select.selectedIndex), false); pop.focus({ preventScroll: true }); });
    }
    function close(focusBtn = true) {
      if (!wrap.classList.contains('open')) return;
      wrap.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      pop.classList.remove('has-active');
      if (focusBtn) btn.focus({ preventScroll: true });
    }
    function choose(i) {
      const changed = select.selectedIndex !== i;
      select.selectedIndex = i;
      if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
      else paintValue(false);
      close();
    }

    btn.addEventListener('click', () => (wrap.classList.contains('open') ? close() : open()));
    btn.addEventListener('keydown', e => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); }
    });
    opts.forEach((o, i) => {
      o.addEventListener('pointermove', () => { if (active !== i) setActive(i, false); });
      o.addEventListener('click', () => choose(i));
    });
    pop.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
      else if (e.key === 'End') { e.preventDefault(); setActive(opts.length - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') { close(false); }
      else if (e.key.length === 1 && /\S/.test(e.key)) {
        const now = Date.now();
        typed = (now - typedAt > 700 ? '' : typed) + e.key.toLowerCase();
        typedAt = now;
        const hit = options.findIndex(op => op.text.toLowerCase().startsWith(typed));
        if (hit >= 0) setActive(hit);
      }
    });
    document.addEventListener('pointerdown', e => { if (!wrap.contains(e.target)) close(false); });
    select.addEventListener('change', () => paintValue(true));
    select.form?.addEventListener('reset', () => setTimeout(() => paintValue(false)));

    paintValue(false);
  });
})();
