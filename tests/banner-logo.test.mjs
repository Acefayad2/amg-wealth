import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const css = fs.readFileSync(new URL('../assets/banner-scenes.css', import.meta.url), 'utf8');

test('schedule logo overrides generic wide slideshow-image dimensions', () => {
  const rule = css.match(/\.spot \.spotlight-media \.wk-logo img\{([^}]+)\}/)?.[1];
  assert.ok(rule, 'The logo rule must outrank .spot .spotlight-media img');
  assert.match(rule, /(?:^|;)width:100%(?:;|$)/);
  assert.match(rule, /(?:^|;)height:100%(?:;|$)/);
  assert.match(rule, /(?:^|;)aspect-ratio:1(?:;|$)/);
  assert.match(rule, /(?:^|;)object-fit:contain(?:;|$)/);
  assert.match(rule, /(?:^|;)border-radius:50%(?:;|$)/);
});
