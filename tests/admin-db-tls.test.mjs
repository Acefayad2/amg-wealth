import assert from 'node:assert/strict';
import test from 'node:test';
import { X509Certificate } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import pg from 'pg';

const dir = await mkdtemp(join(tmpdir(), 'amg-db-tls-'));
const output = join(dir, 'db.cjs');
await build({ entryPoints: [new URL('../netlify/functions/_shared/db.mts', import.meta.url).pathname], outfile: output, bundle: true, platform: 'node', format: 'cjs' });
const { getPool, secureDatabaseUrl } = createRequire(import.meta.url)(output);
const caSource = await readFile(new URL('../netlify/functions/_shared/supabase-ca.mts', import.meta.url), 'utf8');
const pem = caSource.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)[0];
await rm(dir, { recursive: true, force: true });

test('bundled Supabase public CA has the expected fingerprint, validity and root signature', () => {
  const ca = new X509Certificate(pem);
  assert.equal(ca.fingerprint256, '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
  assert.equal(ca.ca, true);
  assert.equal(ca.subject, ca.issuer);
  assert.equal(ca.verify(ca.publicKey), true);
  assert.ok(Date.parse(ca.validFrom) <= Date.now());
  assert.ok(Date.parse(ca.validTo) > Date.now());
});

test('URL options cannot override trusted CA or peer/hostname verification in node-postgres', () => {
  const original = 'postgresql://synthetic:p%40ss@example.test:6543/postgres?application_name=test&';
  for (const options of ['sslmode=require', 'sslmode=disable', 'ssl=no-verify', 'ssl=0', 'sslmode=verify-ca&uselibpqcompat=true', 'sslrootcert=/missing&sslkey=/missing&sslcert=/missing', 'sslnegotiation=direct', 'sslmode=disable&sslmode=no-verify']) {
    const connectionString = secureDatabaseUrl(original + options);
    const client = new pg.Client({ connectionString, ssl: { ca: pem, rejectUnauthorized: true } });
    assert.equal(client.connectionParameters.ssl.ca, pem);
    assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
    assert.equal(client.connectionParameters.ssl.checkServerIdentity, undefined);
    assert.equal(client.connectionParameters.host, 'example.test');
    assert.equal(client.connectionParameters.password, 'p@ss');
    assert.equal(client.connectionParameters.application_name, 'test');
  }
  assert.throws(() => secureDatabaseUrl('invalid-sensitive-value'), { message: 'CRM storage URL is invalid.' });
});

test('serverless pool stays bounded and verifies TLS with the public CA', async () => {
  globalThis.Netlify = { env: { get: key => key === 'AMG_CRM_DATABASE_PASSWORD' ? 'synthetic-only' : undefined } };
  const pool = getPool();
  try {
    assert.equal(pool.options.max, 1);
    assert.equal(pool.options.ssl.ca, pem);
    assert.equal(pool.options.ssl.rejectUnauthorized, true);
    assert.equal(pool.options.ssl.checkServerIdentity, undefined);
    assert.equal(pool.options.host, 'aws-1-us-east-2.pooler.supabase.com');
  } finally {
    await pool.end();
    delete globalThis.Netlify;
  }
});
