import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../src/admin.mjs',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('function scheduleLearningProgress()'),source.indexOf('\nfunction openLicensingPerson'));
function fixture() {
  const state={learners:[{learnerId:'one',completedLessons:1}],total:1,page:1,pageSize:25,loading:false,error:'',requestId:0,controller:null};
  const dialog={open:true},document={visibilityState:'visible'};
  const timers=new Map(),renders=[],requests=[];
  let sequence=0,payload={learners:structuredClone(state.learners),total:1,page_size:25},status=200;
  const context=vm.createContext({learningProgressState:state,learningProgressTimer:null,licensingState:{preview:false},document,AbortController,JSON,Error,
    $:()=>dialog,renderLearningProgress:(update=true)=>renders.push(update),
    setTimeout:(callback,delay)=>{assert.equal(delay,15000);timers.set(++sequence,callback);return sequence;},clearTimeout:id=>timers.delete(id),
    authClient:{auth:{getSession:async()=>({data:{session:{access_token:'test-token'}}})}},
    fetch:async(url,options)=>{requests.push({url,options});return {ok:status===200,json:async()=>structuredClone(payload)};},
  });
  vm.runInContext(functions,context);
  return {state,dialog,document,timers,renders,requests,load:(page=1,silent=false)=>context.loadLearningProgress(page,silent),
    response:(next,code=200)=>{payload=next;status=code;},tick:()=>{const [id,callback]=timers.entries().next().value;timers.delete(id);callback();}};
}
test('open progress views poll automatically and unchanged results keep the cards intact',async()=>{
  const f=fixture();await f.load();assert.equal(f.timers.size,1);
  await f.load(1,true);assert.equal(f.renders.at(-1),false);
  f.response({learners:[{learnerId:'one',completedLessons:2}],total:1,page_size:25});
  await f.load(1,true);assert.equal(f.state.learners[0].completedLessons,2);assert.equal(f.renders.at(-1),true);
  assert.equal(f.requests[0].options.cache,'no-store');
});
test('network failures keep the last saved view and schedule another automatic update',async()=>{
  const f=fixture();f.response({error:'Connection unavailable'},503);await f.load(1,true);
  assert.equal(f.state.learners[0].completedLessons,1);assert.equal(f.renders.at(-1),false);assert.equal(f.timers.size,1);
  f.response({learners:[{learnerId:'one',completedLessons:3}],total:1,page_size:25});await f.load(1,true);
  assert.equal(f.state.error,'');assert.equal(f.state.learners[0].completedLessons,3);
});
test('hidden views skip polling and closing stops scheduling requests',async()=>{
  const f=fixture();await f.load();const before=f.requests.length;
  f.document.visibilityState='hidden';f.tick();assert.equal(f.requests.length,before);assert.equal(f.timers.size,1);
  f.dialog.open=false;f.tick();assert.equal(f.timers.size,0);assert.equal(f.requests.length,before);
});
