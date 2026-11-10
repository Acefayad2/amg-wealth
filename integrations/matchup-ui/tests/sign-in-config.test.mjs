import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { signInErrorMessage } from '../lib/auth-message.ts';

test('the default browser key has a valid issuer, public role, and the configured project reference', () => {
  const source=fs.readFileSync(new URL('../lib/supabase.ts',import.meta.url),'utf8');
  const url=source.match(/supabaseUrl[^\n]*?\|\| "([^"]+)"/)[1];
  const key=source.match(/supabasePublishableKey[^\n]*?\|\| "([^"]+)"/)[1];
  const payload=JSON.parse(Buffer.from(key.split('.')[1],'base64url'));
  assert.equal(payload.iss,'supabase');
  assert.equal(payload.role,'anon');
  assert.equal(payload.ref,new URL(url).hostname.split('.')[0]);
  assert(payload.exp > Date.now()/1000);
});
test('connection configuration errors cannot masquerade as incorrect user credentials', () => {
  assert.match(signInErrorMessage({message:'Invalid API key',status:401}),/connection is unavailable/);
  assert.match(signInErrorMessage({code:'invalid_credentials',message:'Invalid login credentials',status:400}),/email or password/);
  assert.match(signInErrorMessage({status:429}),/Too many/);
  assert.match(signInErrorMessage({message:'Failed to fetch'}),/connection/);
  assert(!signInErrorMessage({message:'do not expose arbitrary server output'}).includes('arbitrary'));
});
