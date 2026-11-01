// Isolated synthetic SQL regression checks. Never connects to production.
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const root=new URL('../', import.meta.url).pathname;const db=new PGlite();
await db.exec(`CREATE SCHEMA auth;CREATE SCHEMA extensions;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE auth.users(id uuid primary key,email text);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;CREATE FUNCTION extensions.gen_random_uuid() RETURNS uuid LANGUAGE sql AS $$SELECT gen_random_uuid()$$;`);
for(const name of ['20261027183000_create_admin_sms_crm.sql','20261027230000_add_recurring_reminders.sql','20261027233000_recurring_reminder_requirements.sql','20261028010000_add_dispatch_control.sql','20261028020000_contact_opt_out_and_optional_name.sql','20261030130000_add_safe_recurring_scheduler.sql']){let sql=await fs.readFile(root+'/database/migrations/'+name,'utf8');sql=sql.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;/,'');await db.exec(sql);}
await db.exec(await fs.readFile(root+'/database/migrations/20261101154000_contact_edit_conflicts.sql','utf8'));
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
await db.exec(`INSERT INTO auth.users VALUES ('${A}','a@example.test'),('${B}','b@example.test');INSERT INTO amg_private.crm_admins(user_id) VALUES('${A}'),('${B}');`);
const uid=async id=>db.exec(`SET test.uid='${id}'`);const one=async(sql,args=[])=> (await db.query(sql,args)).rows[0];let count=0;const ok=(v,msg)=>{assert.ok(v,msg);count++;console.log('PASS '+msg)};
// Optionally include the separately reviewed predecessor migration without bundling it.
if(process.env.DRAFT_MIGRATION) await db.exec(await fs.readFile(process.env.DRAFT_MIGRATION,'utf8'));
// Include the preceding draft correction when present on the current release base.
for(const name of (await fs.readdir(root+'/database/migrations')).filter(n=>n.endsWith('_draft_edit_target_name.sql'))) await db.exec(await fs.readFile(root+'/database/migrations/'+name,'utf8'));
await uid(A);let serial=0;const key=()=>`33333333-3333-4333-8333-${String(++serial).padStart(12,'0')}`;
const oldSave=(id=null,body='initial',request=key(),status='draft')=>one(`SELECT public.amg_crm_save_recurring_reminder($1::uuid,'Synthetic '||COALESCE(($1::uuid)::text,($4::uuid)::text),$2,NULL,NULL,'America/New_York',NULL,ARRAY[1]::smallint[],'2026-11-01',$3,$4) id`,[id,body,status,request]);
const id=(await oldSave()).id;
const version=async(idArg=id)=>(await one('SELECT updated_at::text v FROM amg_private.crm_recurring_reminders WHERE id=$1',[idArg])).v;
const status=(v,s='paused',idArg=id)=>one('SELECT public.amg_crm_set_recurring_status($1,$2,$3)',[idArg,s,v]);
await uid(B);await oldSave(id,'B newer');await uid(A);await oldSave(id,'A stale');
ok((await one('SELECT body FROM amg_private.crm_recurring_reminders WHERE id=$1',[id])).body==='A stale','pre-fix stale content overwrite reproduced');
await status(null);ok((await one('SELECT status FROM amg_private.crm_recurring_reminders WHERE id=$1',[id])).status==='paused','pre-fix NULL status token bypass reproduced');
const migration=(await fs.readdir(root+'/database/migrations')).find(n=>n.endsWith('_recurring_edit_conflicts.sql'));await db.exec(await fs.readFile(root+'/database/migrations/'+migration,'utf8'));
const rejects=async(fn,code)=>{await assert.rejects(fn,e=>e.code===code);count++;console.log('PASS rejected '+code);};
const save=(v,body='edit',idArg=id,request=key(),nextStatus='draft')=>one(`SELECT public.amg_crm_save_recurring_reminder_versioned($1::uuid,'Synthetic '||COALESCE(($1::uuid)::text,($4::uuid)::text),$2,NULL,NULL,'America/New_York',NULL,ARRAY[1]::smallint[],'2026-11-01',$3,$4,$5) id`,[idArg,body,nextStatus,request,v]);
const stale=await version();await uid(B);await save(stale,'B newer');await uid(A);await rejects(()=>save(stale,'A stale'),'40001');
ok((await one('SELECT body FROM amg_private.crm_recurring_reminders WHERE id=$1',[id])).body==='B newer','newer shared-admin content preserved');
await rejects(()=>oldSave(id),'40001');await rejects(()=>save(null),'40001');await rejects(()=>status(null),'40001');
let v=await version();await status(v);await rejects(()=>save(v),'40001');
v=await version();await save(v);await rejects(()=>status(v),'40001');
const other=(await oldSave()).id, otherV=await version(other);await save(await version());await save(otherV,'other untouched',other);ok(true,'distinct reminder token unaffected');
await db.exec('BEGIN');
const first=(await one('UPDATE amg_private.crm_recurring_reminders SET body=$2 WHERE id=$1 RETURNING updated_at::text v',[id,'one'])).v;
const second=(await one('UPDATE amg_private.crm_recurring_reminders SET body=$2 WHERE id=$1 RETURNING updated_at::text v',[id,'two'])).v;
await db.exec('COMMIT');ok((await one('SELECT $1::timestamptz > $2::timestamptz newer',[second,first])).newer,'multiple same-transaction edits strictly advance version');
const state=(await one('SELECT public.amg_crm_get_state() state')).state;const token=state.recurring_reminders.find(r=>r.id===id).updated_at;
ok((await one('SELECT updated_at=$2::timestamptz same FROM amg_private.crm_recurring_reminders WHERE id=$1',[id,token])).same,'state JSON version preserves exact microseconds');await save(token);
const request=key();const created=(await save(null,'create',null,request)).id;ok((await save(null,'create retry',null,request)).id===created,'same-admin create retry idempotent');await uid(B);await rejects(()=>save(null,'cross-admin retry',null,request),'22023');await uid(A);
await rejects(async()=>status(await version(),'active'),'22023');
const contact=(await one(`SELECT public.amg_crm_save_contact(NULL,'Eligible','+12025550123','opted_in','synthetic','UTC') id`)).id;
const group=(await one('SELECT id FROM amg_private.crm_groups LIMIT 1')).id;
await one('INSERT INTO amg_private.crm_group_members(group_id,contact_id,added_by) VALUES($1,$2,$3)',[group,contact,A]);
await one(`UPDATE amg_private.crm_recurring_reminders SET target_group_id=$2,local_time='12:00' WHERE id=$1`,[id,group]);await status(await version(),'active');await rejects(async()=>save(await version()),'22023');
await status(await version(),'paused');await save(await version(),'paused editable');ok((await one('SELECT status FROM amg_private.crm_recurring_reminders WHERE id=$1',[id])).status==='draft','paused reminder can save inactive draft');
ok((await one('SELECT enabled FROM amg_private.crm_dispatch_control LIMIT 1')).enabled===false,'dispatch remains OFF');
await uid('');await rejects(async()=>save(await version()),'42501');
for(const sig of ['public.amg_crm_save_recurring_reminder(uuid,text,text,uuid,text,text,time,smallint[],date,text,uuid)','public.amg_crm_save_recurring_reminder_versioned(uuid,text,text,uuid,text,text,time,smallint[],date,text,uuid,timestamptz)','public.amg_crm_set_recurring_status(uuid,text,timestamptz)']){const p=await one("SELECT has_function_privilege('anon',$1,'EXECUTE') a,has_function_privilege('authenticated',$1,'EXECUTE') b",[sig]);ok(!p.a&&p.b,'RPC anonymous deny/authenticated execute preserved');}
console.log(`${count} isolated recurring SQL assertions passed; synthetic interleavings, not multi-session load tests.`);await db.close();
