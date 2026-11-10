import test from 'node:test';
import assert from 'node:assert/strict';
import { hash } from '../netlify/functions/_shared/learning-core.mjs';
import { eraseLearningHistory, learningIdentity, withLearningIdentity } from '../netlify/functions/_shared/learning-deletion.mjs';
import { deleteLicensingPerson } from '../netlify/functions/_shared/licensing-delete.mjs';

class Store {
  data = new Map(); revision = 0; fail = false;
  async get(key) { return structuredClone(this.data.get(key)?.data || null); }
  async getWithMetadata(key) { return structuredClone(this.data.get(key) || null); }
  async setJSON(key,data,options={}) {
    const old=this.data.get(key);
    if (options.onlyIfNew && old || options.onlyIfMatch && old?.etag!==options.onlyIfMatch) return {modified:false};
    const etag='v'+ ++this.revision; this.data.set(key,{data:structuredClone(data),etag});return {modified:true,etag};
  }
  async list({prefix}) { return {blobs:[...this.data.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))}; }
  async delete(key) { if(this.fail && key.includes('/records/')) { this.fail=false;throw Error('Temporary storage failure'); } this.data.delete(key); }
}
const a={id:'base-agent-a',name:'Agent A',email:'a@example.test'},b={id:'base-agent-b',name:'Agent B',email:'b@example.test'};
const deletion={email:a.email,baseUserId:a.id,deletionId:'11111111-1111-4111-8111-111111111111'};
async function seed(store,user) {
  const id=hash(user.id);
  await store.setJSON('learners/'+id,{learnerId:id,email:user.email,name:user.name});
  for(const key of ['amg-life-lesson-01-v1','amg-health-lesson-01-v1','amg-life-assessments-v1','amg-health-assessments-v1','reporting'])
    await store.setJSON(`users/${id}/${key==='reporting'?'': 'records/'}${key}`,{test:key});
}
test('deletion erases both courses, completed/unfinished exam records and index, and preserves another learner',async()=>{
  const store=new Store();await seed(store,a);await seed(store,b);
  const retained=[...store.data].filter(([key])=>key.includes(hash(b.id)));
  await eraseLearningHistory(store,deletion);
  assert(![...store.data.keys()].some(key=>key.includes(hash(a.id))));
  assert.deepEqual([...store.data].filter(([key])=>key.includes(hash(b.id))),retained);
  const identity=await learningIdentity(store,a);
  assert.notEqual(identity.id,a.id);assert.equal(identity.accountId,a.id);assert.equal(identity.deletionPending,false);
  assert.equal((await learningIdentity(store,b)).id,b.id);
});
test('a failed purge remains blocked and retry resumes the same reset before reporting success',async()=>{
  const store=new Store();await seed(store,a);store.fail=true;
  await assert.rejects(()=>eraseLearningHistory(store,deletion));
  const failed=await learningIdentity(store,a);assert.equal(failed.deletionPending,true);
  let ran=false;const response=await withLearningIdentity(store,a,async()=>{ran=true;return new Response('bad')});
  assert.equal(response.status,403);assert.equal(ran,false);
  await eraseLearningHistory(store,deletion);
  const retried=await learningIdentity(store,a);assert.equal(retried.id,failed.id);assert.equal(retried.deletionPending,false);
  assert(!store.data.has('learners/'+hash(a.id)));
});
test('a save already in flight at deletion cannot restore records or the coordinator index',async()=>{
  const store=new Store();await seed(store,a);await seed(store,b);
  const response=await withLearningIdentity(store,a,async user=>{
    await eraseLearningHistory(store,deletion);
    await seed(store,user); // Simulate the old request finishing after the purge.
    return new Response('saved');
  });
  assert.equal(response.status,403);
  assert(![...store.data.keys()].some(key=>key.includes(hash(a.id))));
  assert(store.data.has('learners/'+hash(b.id)));
});
test('returning learners use an empty new namespace and a later deletion also erases that generation',async()=>{
  const store=new Store();await seed(store,a);await eraseLearningHistory(store,deletion);
  const fresh=await learningIdentity(store,a);assert.equal((await store.list({prefix:`users/${hash(fresh.id)}/`})).blobs.length,0);
  await seed(store,fresh);
  await eraseLearningHistory(store,{...deletion,deletionId:'22222222-2222-4222-8222-222222222222'});
  assert(![...store.data.keys()].some(key=>key.includes(hash(fresh.id))));
  assert.notEqual((await learningIdentity(store,a)).id,fresh.id);
});
test('database row is locked and retained on storage failure; a stale version never touches learning records',async()=>{
  const store=new Store();await seed(store,a);const calls=[];let stale=true,released=0;
  const client={query:async(sql,params)=>{calls.push(sql);if(sql.startsWith('SELECT'))return {rows:stale?[]:[{id:deletion.deletionId,email:a.email}]};if(sql.startsWith('DELETE'))return {rows:[{id:deletion.deletionId}]};return {rows:[]};},release:()=>released++};
  const pool={connect:async()=>client};
  assert.equal(await deleteLicensingPerson(pool,store,deletion.deletionId,1,async()=>a.id),null);
  assert(store.data.has('learners/'+hash(a.id)));assert(calls.includes('ROLLBACK'));
  stale=false;store.fail=true;calls.length=0;
  await assert.rejects(()=>deleteLicensingPerson(pool,store,deletion.deletionId,1,async()=>a.id));
  assert(calls[1].endsWith('FOR UPDATE'));assert(calls.includes('ROLLBACK'));assert(!calls.some(sql=>sql.startsWith('DELETE')));
  calls.length=0;
  assert.deepEqual(await deleteLicensingPerson(pool,store,deletion.deletionId,1,async()=>a.id),{id:deletion.deletionId});
  assert(calls.includes('COMMIT'));assert.equal(released,3);
});
