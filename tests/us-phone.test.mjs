import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeUsPhone } from '../netlify/functions/_shared/us-phone.mjs';

test('US phone inputs resolve to the same Quo destination', () => {
  for (const input of ['2025550123', '12025550123', '+12025550123', '(202) 555-0123', '1 (202) 555-0123', '202.555.0123']) {
    assert.equal(normalizeUsPhone(input), '+12025550123');
  }
});

test('rejects missing digits, extensions, non-US country codes, and malformed values', () => {
  for (const input of ['202555012', '20255501234', '+442071838750', '2025550123 ext 4', '++12025550123', '1234567890', '']) {
    assert.equal(normalizeUsPhone(input), null);
  }
});
