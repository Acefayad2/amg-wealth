import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import pg from 'pg';

const shared = new URL('../netlify/functions/_shared/', import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(shared.href) && specifier.startsWith('./') && specifier.endsWith('.mjs')) {
      const source = new URL(specifier.replace(/\.mjs$/, '.mts'), context.parentURL);
      if (existsSync(source)) return nextResolve(source.href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { getInquiryPool } = await import(new URL('inquiry-db.mts', shared));
const { getPool } = await import(new URL('db.mts', shared));
const { SUPABASE_ROOT_CA } = await import(new URL('supabase-ca.mts', shared));
hooks.deregister();

function mockEnvironment(values) {
  const previous = globalThis.Netlify;
  globalThis.Netlify = { env: { get: key => values[key] } };
  return () => { if (previous === undefined) delete globalThis.Netlify; else globalThis.Netlify = previous; };
}

test('missing dedicated inquiry configuration uses the existing CRM pool', async () => {
  const restore = mockEnvironment({ AMG_CRM_DATABASE_PASSWORD: 'synthetic-only' });
  const pool = getInquiryPool();
  try {
    assert.equal(pool, getPool());
  } finally {
    await pool.end();
    restore();
  }
});

test('invalid dedicated configuration fails without silently using the CRM credential', () => {
  const restore = mockEnvironment({ AMG_INQUIRIES_DATABASE_URL: 'invalid-sensitive-value', AMG_CRM_DATABASE_PASSWORD: 'synthetic-only' });
  try {
    assert.throws(() => getInquiryPool(), { message: 'CRM storage URL is invalid.', status: 503 });
  } finally { restore(); }
});

test('dedicated inquiry credentials take priority and URL flags cannot disable certificate verification', async () => {
  const restore = mockEnvironment({
    AMG_INQUIRIES_DATABASE_URL: 'postgresql://inquiry_role:p%40ss@example.test:6543/postgres?sslmode=disable&ssl=no-verify&uselibpqcompat=true&application_name=inquiries',
    AMG_CRM_DATABASE_URL: 'invalid-crm-connection-that-must-not-be-used',
  });
  const pool = getInquiryPool();
  try {
    assert.equal(getInquiryPool(), pool);
    const client = new pg.Client(pool.options);
    assert.equal(client.connectionParameters.host, 'example.test');
    assert.equal(client.connectionParameters.user, 'inquiry_role');
    assert.equal(client.connectionParameters.password, 'p@ss');
    assert.equal(client.connectionParameters.application_name, 'inquiries');
    assert.equal(client.connectionParameters.ssl.ca, SUPABASE_ROOT_CA);
    assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
    assert.equal(client.connectionParameters.ssl.checkServerIdentity, undefined);
    assert.equal(pool.options.max, 2);
    assert.equal(pool.options.connectionTimeoutMillis, 3000);
    assert.equal(pool.options.idleTimeoutMillis, 10000);
  } finally {
    await pool.end();
    restore();
  }
});
