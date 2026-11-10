import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizeRegistrationCode } from '../integrations/matchup-backend/supabase/functions/amg-matchup/registration-code.ts';

test('copied signup codes tolerate surrounding spaces and invisible message formatting', () => {
  assert.equal(normalizeRegistrationCode(' \tshared-code\n'), 'shared-code');
  assert.equal(normalizeRegistrationCode('\u200bshared\u200d-code\u00a0'), 'shared-code');
  assert.equal(normalizeRegistrationCode(null), '');
});
test('signup code normalization preserves letter case and visible characters', () => {
  assert.equal(normalizeRegistrationCode('Shared-code'), 'Shared-code');
  assert.equal(normalizeRegistrationCode('shared code'), 'shared code');
  assert.notEqual(normalizeRegistrationCode('wrong-code'), 'shared-code');
});

const source=fs.readFileSync(new URL('../integrations/matchup-backend/supabase/functions/amg-matchup/index.ts',import.meta.url),'utf8');
const branch=source.slice(source.indexOf('    if (body.action === "cft-register")'),source.indexOf('    // A random booking reference'));
test('multiple CFT registrations from one connection are never rejected by an account-count cap',async()=>{
  const handler=vm.runInNewContext(`(async function(body){${branch}})`,{
    normalizeRegistrationCode,validEmail:email=>email.includes('@'),sha256:async value=>value==='valid-code'?'known-hash':'wrong-hash',
    constantTimeEqual:(a,b)=>a===b,CFT_REGISTRATION_CODE_HASH:'known-hash',origin:'https://anointedmoneygroup.com',
    json:(body,status)=>({body,status}),
    supabase:{from:table=>{assert.equal(table,'cft_contacts','Signup must not consult an IP account-count table');return {select:()=>({eq:()=>({maybeSingle:async()=>({data:{trainer_id:'existing'}})})})};}},
  });
  const registration={name:'Existing Trainer',email:'existing@example.invalid',phone:'2025550146',password:'valid-test-password',verificationPassword:'valid-code',bio:'Internal registration check; not a real trainer.'};
  for(let i=0;i<8;i++){const result=await handler({action:'cft-register',registration});assert.equal(result.status,409);}
  const denied=await handler({action:'cft-register',registration:{...registration,verificationPassword:'incorrect'}});
  assert.equal(denied.status,403);
});
