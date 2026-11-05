// AMG spotlight: SoFi-style option pills drive the slides.
// - selected pill shows an autoplay progress bar; Pause/Play freezes it visibly
// - hovering the image pauses; picking a slide stops autoplay
// - "View" buttons and the image open an in-page flyer viewer
// - swipe left/right on the image; arrow keys move between pills or banners
// - story bars across the banner top show progress and jump to a slide
document.querySelectorAll('[data-amg-slideshow]').forEach(slideshow => {
  const slides = [...slideshow.querySelectorAll('[data-slide]')];
  const opts = [...slideshow.querySelectorAll('[data-slide-opt]')];
  const ctrl = slideshow.querySelector('[data-slideshow-controls]');
  const toggle = slideshow.querySelector('[data-slide-toggle]');
  const status = slideshow.querySelector('[data-slide-status]');
  const viewer = document.getElementById('flyer-viewer');
  const bars = [...slideshow.querySelectorAll('[data-bar]')];
  const SLIDE_MS = 8000;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let paused = reducedMotion.matches; // user's choice via the button
  let holds = new Set();               // temporary pauses: hover, viewer, hidden tab

  slideshow.style.setProperty('--slide-ms', SLIDE_MS + 'ms');
  if (ctrl) ctrl.hidden = false;
  slides.forEach((slide, i) => {
    slide.setAttribute('role', 'tabpanel');
    slide.setAttribute('aria-labelledby', opts[i]?.id || '');
    slide.hidden = i !== 0;
  });

  const progressOf = opt => opt.querySelector('.opt-progress');

  // "This month" badge for dated highlights
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  slides.forEach(slide => {
    if (slide.dataset.month !== thisMonth) return;
    const chips = slide.querySelector('.spot-chips');
    if (!chips) return;
    const hot = document.createElement('span');
    hot.className = 'chip chip-hot';
    hot.innerHTML = '<i aria-hidden="true"></i>This month';
    chips.prepend(hot);
  });

  // load every flyer once the slideshow is close to the viewport, so no slide fades in blank
  const imgs = slides.map(sl => sl.querySelector('.spot-img')).filter(Boolean);
  const preload = () => imgs.forEach(img => { img.loading = 'eager'; });
  if ('IntersectionObserver' in window) {
    const po = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { preload(); po.disconnect(); } }, { rootMargin: '600px 0px' });
    po.observe(slideshow);
  } else preload();

  function render() {
    const stopped = paused || holds.size > 0;
    slideshow.classList.toggle('is-paused', stopped);
    slideshow.classList.toggle('is-user-paused', paused);
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(paused));
      toggle.querySelector('[data-toggle-label]').textContent = paused ? 'Play slideshow' : 'Pause slideshow';
    }
  }

  function restartProgress() {
    opts.forEach(o => progressOf(o).classList.remove('run'));
    bars.forEach((b, i) => { b.classList.remove('current'); b.classList.toggle('done', i < current); });
    const bar = progressOf(opts[current]);
    void bar.offsetWidth; // restart CSS animations
    bar.classList.add('run');
    bars[current]?.classList.add('current');
  }

  function show(index, { manual = false, focus = false } = {}) {
    const next = (index + slides.length) % slides.length;
    if (manual) paused = true;
    slides[current].hidden = true;
    opts[current].setAttribute('aria-selected', 'false');
    opts[current].tabIndex = -1;
    current = next;
    slides[current].hidden = false;
    opts[current].setAttribute('aria-selected', 'true');
    opts[current].tabIndex = 0;
    if (focus) opts[current].focus();
    if (status) status.textContent = `${current + 1} of ${slides.length}`;
    bars.forEach((b, i) => b.setAttribute('aria-current', i === current ? 'true' : 'false'));
    restartProgress();
    render();
  }

  // autoplay is driven by the progress bar finishing
  opts.forEach(opt => progressOf(opt).addEventListener('animationend', () => {
    if (!paused && holds.size === 0 && opt === opts[current]) show(current + 1);
  }));

  bars.forEach((bar, i) => bar.addEventListener('click', () => show(i, { manual: true })));

  // arrow keys while a banner image has focus
  slides.forEach(slide => slide.querySelector('.spotlight-media')?.addEventListener('keydown', e => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    show(current + step, { manual: true });
    slides[current].querySelector('.spotlight-media')?.focus({ preventScroll: true });
  }));

  opts.forEach((opt, i) => {
    opt.addEventListener('click', () => show(i, { manual: true }));
    opt.addEventListener('keydown', e => {
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (e.key in keys) { e.preventDefault(); show(current + keys[e.key], { manual: true, focus: true }); }
      else if (e.key === 'Home') { e.preventDefault(); show(0, { manual: true, focus: true }); }
      else if (e.key === 'End') { e.preventDefault(); show(slides.length - 1, { manual: true, focus: true }); }
    });
  });

  toggle?.addEventListener('click', () => {
    paused = !paused;
    if (!paused) restartProgress();
    render();
  });

  // hover over the image pauses; leaving resumes (unless the user paused)
  slides.forEach(slide => {
    const media = slide.querySelector('.spotlight-media');
    media.addEventListener('mouseenter', () => { holds.add('hover'); render(); });
    media.addEventListener('mouseleave', () => { holds.delete('hover'); render(); });

    // swipe
    let x0 = null, y0 = null;
    media.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') { x0 = e.clientX; y0 = e.clientY; } });
    media.addEventListener('pointerup', e => {
      if (x0 === null) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        media.dataset.swiped = '1';
        setTimeout(() => delete media.dataset.swiped, 450);
        show(current + (dx < 0 ? 1 : -1), { manual: true });
      }
    });
  });

  document.addEventListener('visibilitychange', () => {
    document.hidden ? holds.add('tab') : holds.delete('tab');
    render();
  });
  reducedMotion.addEventListener('change', e => { if (e.matches) paused = true; render(); });

  // flyer viewer
  if (viewer && typeof viewer.showModal === 'function') {
    const vImg = viewer.querySelector('[data-fv-img]');
    const vTitle = viewer.querySelector('[data-fv-title]');
    const vOpen = viewer.querySelector('[data-fv-open]');
    const vDl = viewer.querySelector('[data-fv-download]');
    let opener = null;

    function openViewer(slide, trigger) {
      const view = slide.querySelector('[data-view]');
      const src = view?.getAttribute('href');
      if (!src) return;
      vImg.src = src;
      vImg.alt = view.dataset.alt || slide.dataset.title;
      vTitle.textContent = slide.dataset.title;
      vOpen.href = src;
      vDl.href = src;
      opener = trigger;
      holds.add('viewer');
      render();
      viewer.showModal();
    }
    viewer.addEventListener('close', () => {
      holds.delete('viewer');
      render();
      opener?.focus({ preventScroll: true });
    });
    viewer.addEventListener('click', e => { if (e.target === viewer) viewer.close(); });
    viewer.querySelector('[data-fv-close]').addEventListener('click', () => viewer.close());

    slides.forEach(slide => {
      // "View" link and the Enlarge button open the original flyer
      slide.querySelectorAll('[data-view], [data-enlarge]').forEach(link => {
        link.addEventListener('click', e => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // let new-tab clicks through
          e.preventDefault();
          e.stopPropagation();
          openViewer(slide, link);
        });
      });
      // clicking empty space on the banner does too (not its own buttons, and not after a swipe)
      const media = slide.querySelector('.spotlight-media');
      media?.addEventListener('click', e => {
        if (e.target.closest('button, a')) return;
        if (media.dataset.swiped) { delete media.dataset.swiped; return; }
        openViewer(slide, media);
      });
      media?.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === media) { e.preventDefault(); openViewer(slide, media); }
      });
    });
  }

  show(0);
});
