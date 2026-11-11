import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../assets/amg-portal-theme.css', import.meta.url), 'utf8');
const mark = css.match(/\.amg-learning-theme \.auth-heading::before\{([^}]+)\}/)?.[1];

test('course access heading uses the existing AMG mark instead of an arrow', () => {
  assert.ok(mark, 'course access heading decoration exists');
  assert.match(mark, /content:''/);
  assert.match(mark, /url\('\/course\/assets\/amg-mark\.webp'\)/);
  assert.match(mark, /center\/cover no-repeat/);
  assert.doesNotMatch(mark, /↗/);
  const image = readFileSync(new URL('../course/assets/amg-mark.webp', import.meta.url));
  assert.equal(image.toString('ascii', 0, 4), 'RIFF');
  assert.equal(image.toString('ascii', 8, 12), 'WEBP');
});

test('course access branding preserves the badge footprint and spacing', () => {
  assert.match(mark, /width:52px;height:52px/);
  assert.match(mark, /margin-bottom:25px/);
  assert.match(mark, /border-radius:50%/);
  assert.match(mark, /box-shadow:var\(--amg-soft\)/);
});
