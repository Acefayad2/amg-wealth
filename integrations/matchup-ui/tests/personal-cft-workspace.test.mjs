import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { personalCftWorkspace } from '../lib/personal-cft-workspace.ts';

const workspace={trainers:[{id:'a',user_id:'owner-a'},{id:'b',user_id:'owner-b'},{id:'unlinked',user_id:null}],appointments:[{trainer_id:'a',id:'a-appointment'},{trainer_id:'b',id:'private-b'}],slots:[{trainer_id:'a',id:'a-time'},{trainer_id:'b',id:'private-b-time'}]};
test('a personal CFT view only keeps its signed-in owner and associated records',()=>{
  const a=personalCftWorkspace('owner-a',workspace),b=personalCftWorkspace('owner-b',workspace);
  assert.deepEqual(a.trainers.map(t=>t.id),['a']);
  assert.deepEqual(a.appointments.map(t=>t.id),['a-appointment']);
  assert.deepEqual(a.slots.map(t=>t.id),['a-time']);
  assert.deepEqual(b.trainers.map(t=>t.id),['b']);
  assert(!JSON.stringify(a).includes('private-b'));
});
test('an account with no linked trainer never falls back to another trainer',()=>{
  for(const id of ['administrator-without-profile',''])assert.deepEqual(personalCftWorkspace(id,workspace),{trainers:[],appointments:[],slots:[]});
});
test('personal CFT dashboards have no cross-trainer selector',()=>{
  const source=fs.readFileSync(new URL('../app/cft/CFTWorkspace.tsx',import.meta.url),'utf8');
  assert(!source.includes('Viewing trainer'));
  assert(!source.includes('className="trainer-switcher"'));
  assert(source.includes('personalCftWorkspace(userId || ""'));
});
