// Local-only SQL integration harness. Set PGLITE_MODULE to an installed PGlite
// module path. Nothing connects to Supabase or mutates production.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
CREATE SCHEMA auth; CREATE SCHEMA amg_private; CREATE SCHEMA extensions;
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE FUNCTION extensions.gen_random_uuid() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;
CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(convert_to($1,'UTF8')) $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY, phone text, email text, phone_confirmed_at timestamptz, email_confirmed_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
CREATE TABLE amg_private.crm_admins(user_id uuid PRIMARY KEY, granted_by uuid);
CREATE FUNCTION amg_private.require_crm_admin() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM amg_private.crm_admins WHERE user_id=auth.uid()) THEN RAISE EXCEPTION 'denied'; END IF; END $$;
`);
await db.exec(await fs.readFile(new URL('../database/migrations/20261030163547_admin_invitation_onboarding.sql', import.meta.url), 'utf8'));
const admin = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const token = 'synthetic-invitation-token-for-tests-only';
await db.query('INSERT INTO auth.users(id,email) VALUES ($1,$2)',[admin,'admin@example.test']);
await db.query('INSERT INTO amg_private.crm_admins VALUES ($1,$1)',[admin]);
await db.exec(`SET test.uid='${admin}'`);
const one = async (sql, args=[]) => (await db.query(sql,args)).rows[0];
const prepared = (await one(`SELECT public.amg_crm_prepare_phone_admin_invite('+12025550123',encode(extensions.digest($1,'sha256'),'hex')) AS result`,[token])).result;
assert.equal(prepared.should_send,true);
assert.equal((await one(`SELECT public.amg_crm_prepare_phone_admin_invite('+12025550123',repeat('a',64)) AS result`)).result.should_send,false);
await db.query(`UPDATE amg_private.crm_admin_invitations SET expires_at=now()-interval '1 hour' WHERE id=$1`,[prepared.id]);
assert.equal((await one(`SELECT public.amg_crm_prepare_phone_admin_invite('+12025550123',repeat('a',64)) AS result`)).result.should_send,false);
await db.query(`UPDATE amg_private.crm_admin_invitations SET status='uncertain' WHERE id=$1`,[prepared.id]);
assert.equal((await one(`SELECT public.amg_crm_prepare_phone_admin_invite('+12025550123',repeat('a',64)) AS result`)).result.should_send,false);
await db.query(`UPDATE amg_private.crm_admin_invitations SET status='prepared',expires_at=now()+interval '1 hour' WHERE id=$1`,[prepared.id]);
await db.query(`INSERT INTO auth.users(id,phone,email) VALUES ($1,'12025550123','')`,[user]);
assert.equal((await one(`SELECT public.amg_crm_find_auth_user_by_phone('+12025550123') AS id`)).id,user);
await db.query(`SELECT public.amg_crm_record_phone_admin_invite_user($1,$2)`,[prepared.id,user]);
assert.equal((await one(`SELECT public.amg_crm_invite_owns_auth_user($1,$2) AS owned`,[prepared.id,user])).owned,true);
await db.query(`SELECT public.amg_crm_record_phone_admin_invite_result($1,'sent',NULL)`,[prepared.id]);
assert.equal((await one(`SELECT public.amg_crm_claim_admin_otp_delivery('direct-auth',$1,'12025550123') AS decision`,[user])).decision,'blocked');
assert.equal((await one(`SELECT public.amg_crm_claim_phone_admin_otp($1,'+12025550123') AS claimed`,[token])).claimed,true);
assert.equal((await one(`SELECT public.amg_crm_claim_phone_admin_otp($1,'+12025550123') AS claimed`,[token])).claimed,false);
assert.equal((await one(`SELECT public.amg_crm_claim_admin_otp_delivery('hook-1',$1,'12025550123') AS decision`,[user])).decision,'send');
assert.equal((await one(`SELECT public.amg_crm_claim_admin_otp_delivery('hook-1',$1,'12025550123') AS decision`,[user])).decision,'blocked');
assert.equal((await one(`SELECT public.amg_crm_claim_admin_otp_delivery('hook-2',$1,'12025550123') AS decision`,[user])).decision,'blocked');
await db.query(`SELECT public.amg_crm_record_admin_otp_delivery('hook-1','sent')`);
assert.equal((await one(`SELECT public.amg_crm_claim_admin_otp_delivery('hook-1',$1,'12025550123') AS decision`,[user])).decision,'sent');
await db.query(`UPDATE amg_private.crm_admin_invitations SET last_otp_requested_at=now()-interval '61 seconds' WHERE id=$1`,[prepared.id]);
assert.equal((await one(`SELECT public.amg_crm_claim_phone_admin_otp($1,'+12025550123') AS claimed`,[token])).claimed,true);
const concurrent = await Promise.all([
  one(`SELECT public.amg_crm_claim_admin_otp_delivery('hook-3',$1,'12025550123') AS decision`,[user]),
  one(`SELECT public.amg_crm_claim_admin_otp_delivery('hook-4',$1,'12025550123') AS decision`,[user]),
]);
assert.deepEqual(concurrent.map(x=>x.decision).sort(),['blocked','send']);
await db.query(`SELECT public.amg_crm_record_admin_otp_delivery('hook-3','uncertain')`);
assert.equal((await one(`SELECT public.amg_crm_claim_admin_otp_delivery('hook-3',$1,'12025550123') AS decision`,[user])).decision,'blocked');
assert.equal((await one(`SELECT public.amg_crm_claim_admin_otp_delivery('wrong-phone',$1,'12025559999') AS decision`,[user])).decision,'blocked');
await db.exec(`SET test.uid='${user}'`);
await assert.rejects(db.query(`SELECT public.amg_crm_bind_verified_invite_phone($1)`,[token]),/Verified phone required/);
await db.query(`UPDATE auth.users SET phone_confirmed_at=now() WHERE id=$1`,[user]);
await db.query(`SELECT public.amg_crm_bind_verified_invite_phone($1)`,[token]);
await assert.rejects(db.query(`SELECT public.amg_crm_accept_phone_admin_invite($1)`,[token]),/Verified phone and email required/);
await db.query(`UPDATE auth.users SET email='chosen@example.test',email_confirmed_at=now() WHERE id=$1`,[user]);
await db.query(`SELECT public.amg_crm_accept_phone_admin_invite($1)`,[token]);
assert.equal((await one(`SELECT count(*)::int AS count FROM amg_private.crm_admins WHERE user_id=$1`,[user])).count,1);
await assert.rejects(db.query(`SELECT public.amg_crm_accept_phone_admin_invite($1)`,[token]),/does not match/);
assert.equal((await one(`SELECT has_function_privilege('anon','public.amg_crm_claim_admin_otp_delivery(text,uuid,text)','EXECUTE') AS allowed`)).allowed,false);
console.log('SQL integration: migration parses; digit-normalized provisioning, binding and verified-email grant; expired/prepared/uncertain resend guard; request quotas; direct-auth denial; durable repeated-hook claims and anonymous-denial checks all passed.');
await db.close();
