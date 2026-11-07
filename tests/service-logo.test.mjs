import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('portfolio monogram does not depend on CSS raster luminance-mask support', () => {
  const css = html.match(/\.service-monogram\{([^}]+)\}/)?.[1];
  assert.ok(css);
  assert.doesNotMatch(css, /(?:mask|background)\s*:/);
  assert.match(css, /aspect-ratio:1/);
  assert.match(html, /\.service-monogram svg\{display:block;width:100%;height:100%;overflow:hidden\}/);
});

test('portfolio monogram retains the original logo, crop and gold treatment in SVG', () => {
  const markup = html.match(/<div class="service-monogram reveal"[\s\S]*?<\/div>/)?.[0];
  assert.ok(markup);
  assert.match(markup, /<svg viewBox="0 0 100 100" focusable="false"/);
  assert.match(markup, /<mask id="service-logo-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100" mask-type="luminance">/);
  assert.match(markup, /<image href="assets\/logo.webp" xlink:href="assets\/logo.webp" x="-52.5" y="-26.875" width="205" height="153.75" preserveAspectRatio="none"/);
  assert.match(markup, /<rect width="100" height="100" fill="url\(#service-logo-gold\)" mask="url\(#service-logo-mask\)"/);
  assert.equal((html.match(/id="service-logo-mask"/g) || []).length, 1);
  assert.equal((html.match(/id="service-logo-gold"/g) || []).length, 1);
  assert.ok(fs.existsSync(new URL('../assets/logo.webp', import.meta.url)));
});
