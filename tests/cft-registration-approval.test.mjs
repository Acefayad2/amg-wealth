import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { transform } from 'esbuild';

const root = new URL('../integrations/matchup-backend/supabase/functions/amg-matchup/', import.meta.url);
// Fixture code is substituted only in this isolated handler harness. Production
// retains its existing verification-password hash unchanged.
const code = 'qa-test-only';
const fixtureHash = createHash('sha256').update(code).digest('hex');
const source = (await readFile(new URL('index.ts', root), 'utf8')).replace(/^import .*;\n/gm, '').replace(/const CFT_REGISTRATION_CODE_HASH = "[a-f0-9]+";/, `const CFT_REGISTRATION_CODE_HASH = "${fixtureHash}";`);
const compiled = (await transform(source, { loader: 'ts' })).code;

async function register(verificationPassword = code, applicationFails = false) {
  const writes = [], rpcs = [], deletions = [], deliveries = [];
  let created = 0, handler;
  const db = {
    auth: { admin: {
      async createUser(value) { created++; writes.push(['auth', value]); return {data:{user:{id:'qa-user'}},error:null}; },
      async deleteUser(value) { deletions.push(['auth',value]); return {error:null}; },
    } },
    from(table) {
      const query = {
        select() { return query; }, eq() { return query; },
        upsert(value) { writes.push([table,value]); return Promise.resolve({error:null}); },
        insert(value) { writes.push([table,value]); return table === 'cft_directory' ? query : Promise.resolve({error:null}); },
        delete() { deletions.push([table]); return query; },
        async single() { return {data:{id:'qa-trainer'},error:null}; },
        async maybeSingle() { return {data:table==='amg_organizations'?{id:'qa-org'}:null,error:null}; },
      };
      return query;
    },
    async rpc(name,args) { rpcs.push([name,args]); return {data:'qa-application',error:applicationFails?new Error('failed to record application'):null}; },
  };
  vm.runInNewContext(compiled, {
    createClient:()=>db, crypto:webcrypto, TextEncoder, Response, URLSearchParams,
    normalizeRegistrationCode:value=>String(value).trim(), registrationAuthFailure:()=>({error:'auth error',status:400}),
    console:{error(){},warn(){}}, fetch:async(...args)=>{deliveries.push(args);return Response.json({});},
    Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://example.invalid':key==='SUPABASE_SERVICE_ROLE_KEY'?'fixture':undefined},serve:fn=>{handler=fn;}},
  });
  const response=await handler(new Request('https://example.invalid',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://anointedmoneygroup.com'},body:JSON.stringify({action:'cft-register',registration:{name:'QA Applicant',email:'qa@example.invalid',phone:'2025550100',password:'Fixture-password-123',verificationPassword,bio:'Fictional trainer profile for isolated registration testing.'}})}));
  return {status:response.status,body:await response.json(),writes,rpcs,deletions,deliveries,created};
}

test('valid CFT registration creates inactive records and records an approval application without delivery',async()=>{
  const result=await register();
  assert.equal(result.writes.find(([name])=>name==='auth')[1].app_metadata.cft_approval_required,true);
  assert.equal(result.status,201); assert.equal(result.body.approvalStatus,'pending');
  for(const table of ['profiles','amg_organization_memberships']) assert.equal(result.writes.find(([name])=>name===table)[1].is_active,false);
  const trainer=result.writes.find(([name])=>name==='cft_directory')[1];
  assert.equal(trainer.active,false); assert.equal(trainer.is_available,false);
  assert.equal(result.rpcs[0][0],'amg_record_cft_application');
  assert.equal(result.rpcs[0][1].p_user_id,'qa-user');
  assert.equal(result.rpcs[0][1].p_trainer_id,'qa-trainer');
  assert.deepEqual(result.deliveries,[]);
});

test('incorrect signup verification never creates an account',async()=>{
  const result=await register('wrong-code'); assert.equal(result.status,403); assert.equal(result.created,0); assert.deepEqual(result.writes,[]);
});

test('a failed application record cannot return successful registration',async()=>{
  const result=await register(code,true); assert.equal(result.status,500); assert.notEqual(result.body.ok,true);
  assert.ok(result.deletions.some(([name])=>name==='auth'));
});
