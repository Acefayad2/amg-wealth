import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('homepage metrics follow the moving carrier bar', () => {
  const carriers = html.indexOf('class="carriers"');
  const stats = html.indexOf('id="stats"');
  const invitation = html.indexOf('id="build-with-amg"');

  assert.ok(carriers >= 0);
  assert.ok(stats > carriers);
  assert.ok(invitation > stats);
  assert.match(html, /#stats\{padding:2rem 6vw\}/);
  assert.match(html, /#stats \.wrap\{display:grid;grid-template-columns:minmax\(190px,/);
  assert.match(html, /#stats \.stat\{padding:1rem 1\.1rem;border-radius:16px\}/);
});

test('Save My Seat video autoplays muted in view and keeps native controls', () => {
  assert.match(html, /<video controls muted playsinline preload="metadata" data-autoplay-in-view/);
  assert.match(html, /querySelectorAll\('video\[data-autoplay-in-view\]'\)/);
  assert.match(html, /if\(entry\.isIntersecting\)/);
  assert.match(html, /video\.play\(\)\.catch/);
  assert.match(html, /video\.pause\(\)/);
});
