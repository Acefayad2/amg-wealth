import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/amg-intro.js', import.meta.url), 'utf8');

function setup(settings = {}) {
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const classes = new Set();
  const stored = new Map(settings.seen ? [['amg:intro:2026-11-v1', 'seen']] : []);
  const target = () => {
    const value = new EventTarget();
    value.emit = (name, detail = {}) => value.dispatchEvent(Object.assign(new Event(name, { cancelable: true }), detail));
    return value;
  };
  const video = Object.assign(target(), {
    dataset: { src: 'assets/amg-intro-short.mp4' }, currentTime: 0, muted: false, pauses: 0, loads: 0,
    defaultPlaybackRate: 1, playbackRate: 1,
    pause() { this.pauses += 1; },
    load() { this.loads += 1; },
    removeAttribute(name) { if (name === 'src') this.src = ''; },
    play() { return new Promise((resolve, reject) => { this.resolvePlay = resolve; this.rejectPlay = reject; }); },
  });
  Object.defineProperty(video, 'src', {
    get() { return this.currentSource; },
    set(value) { this.currentSource = value; this.playbackRate = this.defaultPlaybackRate; },
  });
  const dialog = Object.assign(target(), {
    open: false, removed: false,
    classList: { add(name) { classes.add(name); } },
    querySelector(selector) { return selector === 'video' ? video : null; },
    showModal() { this.open = true; },
    close() { this.open = false; },
    remove() { this.removed = true; },
  });
  const reducedMotion = Object.assign(target(), { matches: !!settings.reducedMotion });
  const document = Object.assign(target(), { hidden: !!settings.hidden, getElementById: () => dialog });
  const window = Object.assign(target(), {
    location: { href: settings.url || 'https://anointedmoneygroup.com/' }, matchMedia: () => reducedMotion,
  });
  const context = {
    document, window, URL, AbortController, navigator: { connection: { saveData: !!settings.saveData } },
    sessionStorage: {
      getItem(key) { if (settings.storageDenied) throw new Error(); return stored.get(key); },
      setItem(key, value) { if (settings.storageDenied) throw new Error(); stored.set(key, value); },
    },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.runInNewContext(source, context, { filename: 'assets/amg-intro.js' });
  return { video, dialog, document, window, reducedMotion, stored, classes, timers,
    advance(milliseconds) {
      const until = now + milliseconds;
      while (true) {
        const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = until;
    },
  };
}

test('reduced motion, saved data, deep links and background tabs do not fetch the intro', () => {
  for (const settings of [{ reducedMotion: true }, { saveData: true }, { hidden: true },
    { url: 'https://anointedmoneygroup.com/#contact' },
    { url: 'https://anointedmoneygroup.com/?intro=play', reducedMotion: true }]) {
    const app = setup(settings);
    assert.equal(app.dialog.open, false);
    assert.equal(app.video.src, undefined);
    assert.equal(app.timers.size, 0);
  }
});

test('every eligible homepage load starts muted, including refreshes with a legacy seen flag', () => {
  for (const settings of [{}, { seen: true }, { seen: true, url: 'https://anointedmoneygroup.com/#top' },
    { storageDenied: true }, { seen: true, storageDenied: true },
    { seen: true, url: 'https://anointedmoneygroup.com/?intro=play' }]) {
    const app = setup(settings);
    assert.equal(app.dialog.open, true);
    assert.equal(app.video.src, 'assets/amg-intro-short.mp4');
    assert.equal(app.video.muted, true);
    assert.equal(app.video.defaultPlaybackRate, 1.6);
    assert.equal(app.video.playbackRate, 1.6);
    app.dialog.emit('cancel');
  }
});

test('loading failures and delayed or stalled playback release the page in under 2.5 seconds', () => {
  const loading = setup();
  loading.advance(1499);
  assert.equal(loading.dialog.open, true);
  loading.advance(1);
  assert.equal(loading.dialog.open, false);
  assert.equal(loading.timers.size, 0);
  assert.equal(loading.video.src, '');
  const stalled = setup();
  stalled.advance(1000);
  stalled.video.emit('playing');
  stalled.advance(699);
  assert.equal(stalled.dialog.open, true);
  assert.equal(stalled.classes.has('is-leaving'), false);
  stalled.advance(1);
  assert.equal(stalled.classes.has('is-leaving'), true);
  assert.equal(stalled.dialog.open, true);
  stalled.advance(709);
  assert.equal(stalled.dialog.open, true);
  stalled.advance(1);
  assert.equal(stalled.dialog.open, false);
  assert.equal(stalled.timers.size, 0);
});

test('a late video ending does not restart or extend the total intro budget', () => {
  const app = setup();
  app.video.emit('playing');
  app.advance(2000);
  assert.equal(app.classes.has('is-leaving'), true);
  app.video.emit('ended');
  assert.equal(app.dialog.open, true);
  assert.ok([...app.timers.values()].some(timer => timer.at === 2450));
  app.advance(409);
  assert.equal(app.dialog.open, true);
  app.advance(1);
  assert.equal(app.dialog.open, false);
  assert.equal(app.timers.size, 0);
});

test('the hard deadline remains effective during a late veil exit when the soft timer is delayed', () => {
  const app = setup();
  app.video.emit('playing');
  // Simulate a delayed soft-exit callback so a late media event starts the veil.
  const softExit = [...app.timers.values()].find(timer => timer.at === 1700);
  assert.ok(softExit);
  softExit.at = 3000;
  app.advance(2300);
  app.video.emit('ended');
  assert.equal(app.classes.has('is-leaving'), true);
  app.advance(149);
  assert.equal(app.dialog.open, true);
  app.advance(1);
  assert.equal(app.dialog.open, false);
  assert.equal(app.dialog.removed, true);
  assert.equal(app.video.src, '');
  assert.equal(app.timers.size, 0);
});

test('Escape, media errors, reduced-motion changes and backgrounding close immediately', () => {
  for (const exit of [a => a.dialog.emit('cancel'), a => a.video.emit('error'),
    a => a.reducedMotion.emit('change', { matches: true }),
    a => { a.document.hidden = true; a.document.emit('visibilitychange'); }, a => a.window.emit('pagehide')]) {
    const app = setup();
    exit(app);
    assert.equal(app.dialog.open, false);
    assert.equal(app.dialog.removed, true);
    assert.equal(app.timers.size, 0);
    assert.equal(app.video.src, '');
  }
});

test('autoplay rejection and a late resolution after Escape cannot trap or restart the intro', async () => {
  const rejected = setup();
  rejected.video.rejectPlay(new Error('Autoplay denied'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rejected.dialog.open, false);
  const escaped = setup();
  escaped.dialog.emit('cancel');
  escaped.video.resolvePlay();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(escaped.dialog.open, false);
  assert.ok(escaped.video.pauses >= 2);
});

test('subtitle follows the shorter video clock and the finished frame stays present throughout the veil reveal', () => {
  const app = setup();
  app.video.emit('playing');
  app.video.currentTime = 1.52;
  app.video.emit('timeupdate');
  assert.equal(app.classes.has('is-revealed'), false);
  app.video.currentTime = 1.53;
  app.video.emit('timeupdate');
  assert.equal(app.classes.has('is-revealed'), true);
  app.video.emit('ended');
  assert.equal(app.classes.has('is-leaving'), true);
  assert.equal(app.dialog.open, true);
  assert.equal(app.video.src, 'assets/amg-intro-short.mp4');
  app.advance(700);
  assert.equal(app.dialog.open, true);
  assert.equal(app.video.src, 'assets/amg-intro-short.mp4');
  app.advance(9);
  assert.equal(app.dialog.open, true);
  app.advance(1);
  assert.equal(app.dialog.open, false);
  assert.equal(app.video.src, '');
  assert.equal(app.timers.size, 0);
});

test('Escape still dismisses during the veil reveal without leaving a close timer', () => {
  const app = setup();
  app.video.emit('playing');
  app.video.emit('ended');
  app.advance(200);
  assert.equal(app.dialog.open, true);
  assert.equal(app.classes.has('is-leaving'), true);
  app.dialog.emit('cancel');
  assert.equal(app.dialog.open, false);
  assert.equal(app.dialog.removed, true);
  assert.equal(app.video.src, '');
  assert.equal(app.timers.size, 0);
});

test('leaving during the final veil reveal cannot restore a frozen dialog through browser Back', () => {
  const app = setup();
  app.video.emit('ended');
  app.window.emit('pagehide');
  assert.equal(app.dialog.open, false);
  assert.equal(app.timers.size, 0);
});

test('the intro runs without controls and remains muted through playback and completion', () => {
  const app = setup();
  assert.equal(app.dialog.open, true);
  assert.equal(app.video.muted, true);
  app.video.emit('playing');
  assert.equal(app.video.muted, true);
  app.video.currentTime = 1.53;
  app.video.emit('timeupdate');
  assert.equal(app.video.muted, true);
  app.video.emit('ended');
  assert.equal(app.video.muted, true);
  app.advance(710);
  assert.equal(app.dialog.open, false);
  assert.equal(app.video.muted, true);
  assert.equal(app.timers.size, 0);
});
