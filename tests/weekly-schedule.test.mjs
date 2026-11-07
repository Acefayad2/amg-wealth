import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const flyer = html.match(/<article[^>]*id="ss-weekly"[\s\S]*?<\/article>/)?.[0];
const events = [...(flyer || '').matchAll(/<li class="wk-ev"[^>]*>/g)].map(([tag]) =>
  Object.fromEntries([...tag.matchAll(/data-([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]))
);

test('weekly flyer contains BOM only on Thursday and Saturday at unchanged times', () => {
  assert.ok(flyer);
  assert.deepEqual(events.filter(event => event.name === 'BOM').map(({ dow, start, place }) => ({ dow, start, place })), [
    { dow: '4', start: '19:00', place: 'In office' },
    { dow: '6', start: '10:00', place: 'In person' },
    { dow: '6', start: '14:00', place: 'In person' },
  ]);
});

test('weekly flyer preserves all non-BOM events and the monthly call', () => {
  assert.deepEqual(events.filter(event => event.name !== 'BOM').map(({ dow, start, name }) => ({ dow, start, name })), [
    { dow: '1', start: '09:00', name: 'Builders Meeting' },
    { dow: '1', start: '18:00', name: 'Phone Zone' },
    { dow: '1', start: '21:00', name: 'CFT Academy & SOS After Hours' },
    { dow: '2', start: '12:00', name: 'Skills Training' },
    { dow: '3', start: '12:00', name: 'Writing Lab' },
    { dow: '4', start: '12:00', name: 'Skills Training' },
  ]);
  assert.match(flyer, /First Monday of every month/);
  assert.match(flyer, /SOS National Call/);
  assert.match(flyer, /No meetings/);
  assert.match(flyer, /href="assets\/resources\/amg-weekly-schedule.png"/);
});
