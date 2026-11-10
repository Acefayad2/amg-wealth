import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../src/admin.mjs', import.meta.url), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return {promise,resolve,reject}; };
function fields() { const values = new Map(); return key => { if(!values.has(key)) values.set(key,{value:'',hidden:true,disabled:false,setAttribute(){},removeAttribute(){},close(){},focus(){}}); return values.get(key); }; }
test('old scheduled-save completion cannot unlock or close the new session composer', async () => {
  const $=fields(), old=deferred(), current=deferred(); let calls=0, closes=0;
  $('#composer').close=()=>closes++;
  const context=vm.createContext({$,sessionRevision:0,state:{messageBusy:false},api:()=> (++calls===1 ? old.promise : current.promise),load:async()=>{},toast(){},updateRecipientNote(){}});
  vm.runInContext(extract('async function saveMessage(status)','\nfunction openScheduleSaveConfirmation'),context);
  const previous=context.saveMessage('draft');
  context.sessionRevision++; context.state.messageBusy=false;
  const next=context.saveMessage('draft');
  old.reject(new Error('The admin session changed. Sign in again.')); await previous;
  assert.equal(context.state.messageBusy,true); assert.equal($('#save-draft').disabled,true); assert.equal(closes,0);
  await context.saveMessage('draft'); assert.equal(calls,2);
  current.resolve({}); await next;
  assert.equal(context.state.messageBusy,false); assert.equal(closes,1);
});
test('old successful mutation response cannot change the new session composer', async () => {
  const $=fields(), result=deferred();let closes=0,loads=0;
  $('#composer').close=()=>closes++;
  const context=vm.createContext({$,sessionRevision:0,state:{messageBusy:false},api:()=>result.promise,load:async()=>loads++,toast(){},updateRecipientNote(){}});
  vm.runInContext(extract('async function saveMessage(status)','\nfunction openScheduleSaveConfirmation'),context);
  const pending=context.saveMessage('draft');context.sessionRevision++;context.state.messageBusy=true;
  result.resolve({});await pending;
  assert.equal(closes,0);assert.equal(loads,0);assert.equal(context.state.messageBusy,true);
});
test('late calendar settings cannot restore a cleared private subscription URL', async () => {
  const $=fields(), response=deferred();
  const context=vm.createContext({$,sessionRevision:0,calendarUnlock:'synthetic',licensingCalendarRequest:()=>response.promise});
  vm.runInContext(extract('async function showCalendarConnection(', '\nasync function licensingApi('),context);
  const pending=context.showCalendarConnection();context.sessionRevision++;$('#calendar-feed-url').value='';$('#calendar-connect-panel').hidden=true;
  response.resolve({feedUrl:'https://example.invalid/private-synthetic-feed',googleUrl:'https://example.invalid'});await pending;
  assert.equal($('#calendar-feed-url').value,'');assert.equal($('#calendar-connect-panel').hidden,true);
});
test('CRM API does not send an action if auth changes while the session token is loading', async () => {
  const session=deferred();let requests=0;
  const context=vm.createContext({sessionRevision:0,authClient:{auth:{getSession:()=>session.promise}},fetch:async()=>{requests++;}});
  vm.runInContext(extract('async function api(body)', '\nfunction toast('),context);
  const pending=context.api({action:'save_message'});context.sessionRevision++;
  session.resolve({data:{session:{access_token:'synthetic'}},error:null});
  await assert.rejects(pending,/session changed/);assert.equal(requests,0);
});
