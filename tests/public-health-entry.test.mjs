import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Resources promotes the saved Health mock and labels the legacy drill separately', () => {
  const html = fs.readFileSync(new URL('../resources.html', import.meta.url), 'utf8');
  const health = html.match(/<article class="study-card"><span class="tag">Accident &amp; Health[\s\S]*?<\/article>/)?.[0];
  assert(health);
  assert.match(health, /class="button gold" href="\/course\/health\/assessments\/">Practice Health Exam/);
  assert.match(health, /href="\/course\/health\/">Enter Health Course/);
  assert.match(health, /href="\/practice\/health\/">Untimed Health drills · progress resets on reload/);
  assert.match(health, /saved progress/);
  assert.doesNotMatch(health, /70% target score/);
});
