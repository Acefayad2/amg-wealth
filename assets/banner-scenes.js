// Live weekly schedule banner: today highlight, "Next up" ticker, next monthly call,
// and a day picker for narrow screens. All times are US Eastern.
(() => {
  const scene = document.querySelector('.scene-week');
  if (!scene) return;
  const slideshow = scene.closest('[data-amg-slideshow]');
  const slide = scene.closest('[data-slide]');
  const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // current time in New York
  function nowET() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
    }).formatToParts(new Date()).map(p => [p.type, p.value]));
    return {
      dow: SHORT.indexOf(parts.weekday), y: +parts.year, m: +parts.month, d: +parts.day,
      min: (+parts.hour) * 60 + (+parts.minute),
    };
  }

  const events = [...scene.querySelectorAll('.wk-ev')].map(el => {
    const [h, m] = el.dataset.start.split(':').map(Number);
    return { el, dow: +el.dataset.dow, start: h * 60 + m, label: el.dataset.label, name: el.dataset.name, place: el.dataset.place };
  }).sort((a, b) => a.dow - b.dow || a.start - b.start);

  // upcoming events from now, wrapping into next week
  function upcoming(n) {
    const t = nowET();
    const nowKey = t.dow * 1440 + t.min;
    const keyed = events.map(e => {
      let key = e.dow * 1440 + e.start;
      const live = key <= nowKey && nowKey < key + 60;      // started within the last hour
      if (!live && key <= nowKey) key += 7 * 1440;          // already passed this week
      return { ...e, key: live ? nowKey : key, live };
    }).sort((a, b) => a.key - b.key);
    return { list: keyed.slice(0, n), t };
  }

  function whenText(e, t) {
    if (e.live) return 'Happening now';
    const daysAhead = Math.floor(e.key / 1440) - t.dow;
    const day = daysAhead === 0 ? 'Today' : daysAhead === 1 ? 'Tomorrow' : DAY[e.dow];
    return `${day} ${e.label}`;
  }

  // today highlight + "Next" tag
  function paintToday() {
    const { list, t } = upcoming(1);
    scene.querySelectorAll('.wk-day').forEach(d => {
      const today = +d.dataset.dow === t.dow;
      d.classList.toggle('is-today', today);
      d.classList.toggle('lp', today);
      d.querySelector('.wk-today')?.remove();
      if (today) {
        const b = document.createElement('span');
        b.className = 'wk-today';
        b.textContent = 'Today';
        d.prepend(b);
      }
    });
    scene.querySelectorAll('.wk-chip').forEach(c => c.classList.toggle('is-today', +c.dataset.wkChip === t.dow));
    events.forEach(e => e.el.classList.toggle('is-next', e === events.find(x => x.el === list[0]?.el)));
    return t;
  }

  // next first-Monday 9:00 PM ET
  function paintMonthly() {
    const out = scene.querySelector('[data-wk-monthly]');
    if (!out) return;
    const t = nowET();
    const firstMonday = (y, m) => { const d = new Date(Date.UTC(y, m - 1, 1)); const off = (8 - d.getUTCDay()) % 7; return 1 + off; };
    let y = t.y, m = t.m, d = firstMonday(y, m);
    const passed = t.d > d || (t.d === d && t.min >= 22 * 60);
    if (passed) { m += 1; if (m > 12) { m = 1; y += 1; } d = firstMonday(y, m); }
    out.textContent = (t.d === d && t.m === m && !passed) ? 'Tonight' : `Next: Mon, ${MONTHS[m - 1]} ${d}`;
  }

  // ticker
  const item = scene.querySelector('[data-wk-next-item]');
  let tick = 0;
  function paintTicker() {
    if (!item) return;
    const { list, t } = upcoming(3);
    if (!list.length) return;
    const e = list[tick % list.length];
    item.textContent = `${whenText(e, t)} · ${e.name}`;
    item.title = `${whenText(e, t)} · ${e.name} · ${e.place}`;
    item.classList.remove('in'); void item.offsetWidth; item.classList.add('in');
    tick += 1;
  }

  // day picker (narrow banners)
  const chips = [...scene.querySelectorAll('.wk-chip')];
  function pickDay(dow) {
    scene.querySelectorAll('.wk-day').forEach(d => d.classList.toggle('on', +d.dataset.dow === dow));
    chips.forEach(c => c.setAttribute('aria-pressed', String(+c.dataset.wkChip === dow)));
  }
  chips.forEach(c => c.addEventListener('click', e => { e.stopPropagation(); pickDay(+c.dataset.wkChip); }));

  const t0 = paintToday();
  pickDay(t0.dow >= 1 && t0.dow <= 6 ? t0.dow : 1);
  paintMonthly();
  paintTicker();

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  setInterval(() => {
    const visible = slide && !slide.hidden && !document.hidden;
    const userPaused = slideshow?.classList.contains('is-user-paused');
    if (!visible || userPaused || reduce.matches) return;
    paintTicker();
  }, 3500);
  setInterval(() => { paintToday(); paintMonthly(); }, 60 * 1000);
})();

// Original-flyer banners: gentle 3D tilt toward the pointer (mouse/trackpad only).
(() => {
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelectorAll('.scene-flyer').forEach(scene => {
    const media = scene.closest('.spotlight-media');
    const card = scene.querySelector('.fl');
    if (!media || !card) return;
    media.addEventListener('pointermove', e => {
      if (!fine.matches || reduce.matches) return;
      const r = media.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      card.style.setProperty('--ry', (x * 6).toFixed(2) + 'deg');
      card.style.setProperty('--rx', (-y * 5).toFixed(2) + 'deg');
    });
    media.addEventListener('pointerleave', () => {
      card.style.setProperty('--ry', '0deg');
      card.style.setProperty('--rx', '0deg');
    });
  });
})();
