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
await uid(A);const contact=(await one(`SELECT public.amg_crm_save_contact(NULL,'Initial','+12025550123','opted_in','synthetic consent','UTC') id`)).id;
const version=async (id=contact)=>(await one('SELECT updated_at::text v FROM amg_private.crm_contacts WHERE id=$1',[id])).v;
const save=(v,name='Edit',consent='opted_in',id=contact)=>one(`SELECT public.amg_crm_save_contact_versioned($1,$2,'+12025550123',$3,'synthetic consent','UTC',$4) id`,[id,name,consent,v]);
const old=await version();await uid(B);await save(old,'B newer','opted_out');await uid(A);
await assert.rejects(()=>save(old,'A stale'),e=>e.code==='40001' && /changed/.test(e.message));count++;console.log('PASS stale admin edit rejected');
ok((await one('SELECT consent_status FROM amg_private.crm_contacts WHERE id=$1',[contact])).consent_status==='opted_out','newer optout preserved');
await assert.rejects(()=>one(`SELECT public.amg_crm_save_contact($1,'legacy','+12025550123','opted_in','old evidence','UTC')`,[contact]),/version is required/);count++;console.log('PASS legacy update fails closed');
await assert.rejects(()=>save(null),e=>e.code==='40001');count++;console.log('PASS missing version fails closed');
const fresh=await version();await save(fresh,'Fresh','opted_out');ok((await version())!==fresh,'fresh same-row edit advances token');
const beforeProvider=await version();await db.query(`UPDATE amg_private.crm_contacts SET consent_status='opted_out',consent_evidence=NULL,opt_out_source='quo_inbound_keyword',updated_at=now() WHERE id=$1`,[contact]);await assert.rejects(()=>save(beforeProvider),/changed/);count++;console.log('PASS provider optout invalidates stale edit');
await db.exec('BEGIN');const before=await version();await save(before,'One','opted_out');const after=await version();ok(before!==after,'token advances inside same transaction');await save(after,'Two','opted_out');ok((await version())!==after,'second same-transaction update advances token');await db.exec('COMMIT');
const second=(await one(`SELECT public.amg_crm_save_contact(NULL,'Other','+12025550124','pending',NULL,'UTC') id`)).id;const unaffected=await version(second);await save(await version(),'Changed first','opted_out');ok((await version(second))===unaffected,'distinct contact token unaffected');
const state=(await one('SELECT public.amg_crm_get_state() s')).s;ok(state.contacts.every(c=>typeof c.updated_at==='string'),'state exposes precise edit timestamps');const token=state.contacts.find(c=>c.id===contact).updated_at;ok((await one('SELECT $1::timestamptz=updated_at exact FROM amg_private.crm_contacts WHERE id=$2',[token,contact])).exact,'JSON token preserves database microsecond precision');
await db.exec("SET test.uid=''");const deniedVersion=await version();await assert.rejects(()=>save(deniedVersion),/admin access/);count++;console.log('PASS unauthenticated caller denied');
for(const signature of ['public.amg_crm_save_contact(uuid,text,text,text,text,text)','public.amg_crm_save_contact_versioned(uuid,text,text,text,text,text,timestamptz)']){const perms=await one("SELECT has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') admin",[signature]);ok(!perms.anon && perms.admin,'RPC privileges unchanged: authenticated only '+signature);}
console.log(count+' isolated contact conflict SQL checks passed');await db.close();
