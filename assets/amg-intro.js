(() => {
  const dialog = document.getElementById('amg-intro');
  if (!dialog || typeof dialog.showModal !== 'function') return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const address = new URL(window.location.href);
  if (reducedMotion.matches || navigator.connection?.saveData || document.hidden
      || (address.hash && address.hash !== '#top')) return;

  const video = dialog.querySelector('video');
  if (!video || !video.dataset.src) return;

  const events = new AbortController();
  const options = { signal: events.signal };
  let finished = false;
  let started = false;
  let startupTimer;
  let revealTimer;
  let deadlineTimer;
  let closeTimer;

  const close = () => {
    clearTimeout(startupTimer);
    clearTimeout(revealTimer);
    clearTimeout(deadlineTimer);
    clearTimeout(closeTimer);
    window.removeEventListener('pagehide', forceClose);
    if (dialog.open) dialog.close();
    dialog.remove();
    video.removeAttribute('src');
    video.load();
  };

  const finish = (immediate = false) => {
    if (finished) {
      if (immediate) close();
      return;
    }
    finished = true;
    clearTimeout(startupTimer);
    clearTimeout(revealTimer);
    events.abort();
    video.pause();
    if (immediate || reducedMotion.matches) close();
    else {
      dialog.classList.add('is-leaving');
      closeTimer = setTimeout(close, 710);
    }
  };
  const forceClose = () => finish(true);

  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    finish(true);
  });
  video.addEventListener('error', () => finish(true), options);
  video.addEventListener('ended', () => finish(), options);
  video.addEventListener('playing', () => {
    if (finished) { video.pause(); return; }
    if (started) return;
    started = true;
    clearTimeout(startupTimer);
  }, options);
  video.addEventListener('timeupdate', () => {
    if (video.currentTime >= 1.53) dialog.classList.add('is-revealed');
  }, options);
  reducedMotion.addEventListener('change', event => {
    if (event.matches) finish(true);
  }, options);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) finish(true);
  }, options);
  window.addEventListener('pagehide', forceClose);

  try {
    dialog.showModal();
    startupTimer = setTimeout(() => finish(true), 1500);
    revealTimer = setTimeout(() => finish(), 1700);
    deadlineTimer = setTimeout(() => finish(true), 2450);
    video.muted = true;
    video.src = video.dataset.src;
    video.defaultPlaybackRate = 1.6;
    video.playbackRate = 1.6;
    const playback = video.play();
    playback?.then(() => {
      if (finished) video.pause();
    }).catch(() => finish(true));
  } catch {
    finish(true);
  }
})();
