import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/admin.mjs',import.meta.url),'utf8');
const start=source.indexOf('function editRecurring(id) {');
const end=source.indexOf('\nfunction ',source.indexOf('async function saveRecurring',start));
const code=source.slice(start,end);
function setup(apiImpl=async()=>({})) {
 const reminder={id:'one',name:'Reminder',body:'old',updated_at:'2026-11-01T00:00:00.123456Z',idempotency_key:'key',weekdays:[1],timezone:'America/New_York',start_date:'2026-11-01'};
 const state={recurring_reminders:[reminder],groups:[]};const fields=new Map(),calls=[];
 const $=key=>{if(!fields.has(key)) fields.set(key,{value:'',textContent:'',disabled:false,open:false,reset(){},focus(){},showModal(){this.open=true},close(){this.open=false}});return fields.get(key)};
 const ctx={sessionRevision:0,weekdayNames:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],state,$,escapeHtml:String,api:async body=>{calls.push(body);return apiImpl(body)},load:async()=>{},toast(){}};vm.createContext(ctx);vm.runInContext(code,ctx);
 ctx.editRecurring('one');const button={disabled:false};const submit=()=>ctx.saveRecurring({preventDefault(){},submitter:button});
 return {state,ctx,$,calls,submit,button};
}
test('recurring save captures exact editor-open version and copies schedule fields',async()=>{
 const app=setup();app.state.recurring_reminders[0].weekdays.push(4);app.state.recurring_reminders=[{id:'one',updated_at:'new',weekdays:[6],timezone:'UTC',start_date:'2027-01-01'}];
 await app.submit();const sent=app.calls[0];assert.equal(sent.expectedUpdatedAt,'2026-11-01T00:00:00.123456Z');assert.deepEqual([...sent.weekdays],[1]);assert.equal(sent.timezone,'America/New_York');assert.equal(sent.startDate,'2026-11-01');assert.equal(sent.status,'draft');assert.equal(app.button.disabled,false);
});
test('conflict leaves draft open and controls reusable; reopen captures refreshed token',async()=>{
 const app=setup(async()=>{throw new Error('Recurring reminder changed; refresh and try again')});await app.submit();assert.equal(app.$('#recurring-dialog').open,true);assert.match(app.$('#recurring-error').textContent,/changed/);assert.equal(app.button.disabled,false);assert.equal(app.state.recurringBusy,false);
 app.state.recurring_reminders[0].updated_at='2026-11-01T00:00:01.654321Z';app.ctx.editRecurring('one');assert.equal(app.state.recurringEditSnapshot.updated_at,'2026-11-01T00:00:01.654321Z');
});
test('busy recurring save suppresses duplicate submission',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const app=setup(()=>pending);const first=app.submit();await app.submit();assert.equal(app.calls.length,1);resolve({});await first;assert.equal(app.state.recurringBusy,false);assert.equal(app.button.disabled,false);
});
test('recurring API forwards raw timestamp and still allows only inactive draft saves',()=>{
 const api=fs.readFileSync(new URL('../netlify/functions/admin-crm.mts',import.meta.url),'utf8');const block=api.slice(api.indexOf('if (input.action === "save_recurring_reminder")'),api.indexOf('if (input.action === "set_recurring_status")'));
 assert.match(block,/amg_crm_save_recurring_reminder_versioned/);assert.match(block,/p_expected_updated_at: typeof input.expectedUpdatedAt === "string" \? input.expectedUpdatedAt : null/);assert.match(block,/input.status !== "draft"/);
});
