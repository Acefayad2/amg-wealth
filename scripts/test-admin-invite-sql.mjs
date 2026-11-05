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
await db.exec(await fs.readFile(new URL('../database/migrations/20261101153014_admin_invitation_twelve_hour_expiry.sql', import.meta.url), 'utf8'));
const admin = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const token = 'synthetic-invitation-token-for-tests-only';
await db.query('INSERT INTO auth.users(id,email) VALUES ($1,$2)',[admin,'admin@example.test']);
await db.query('INSERT INTO amg_private.crm_admins VALUES ($1,$1)',[admin]);
await db.exec(`SET test.uid='${admin}'`);
const one = async (sql, args=[]) => (await db.query(sql,args)).rows[0];
const prepared = (await one(`SELECT public.amg_crm_prepare_phone_admin_invite('+12025550123',encode(extensions.digest($1,'sha256'),'hex')) AS result`,[token])).result;
assert.equal(prepared.should_send,true);
const assertTwelveHours = async (id) => {
  const { remaining } = await one(`SELECT extract(epoch from expires_at-now())::float8 AS remaining FROM amg_private.crm_admin_invitations WHERE id=$1`,[id]);
  assert.ok(remaining > 43190 && remaining <= 43200, `Expected 12-hour expiry, got ${remaining}s`);
};
await assertTwelveHours(prepared.id);
// A safely failed invitation can be reissued; the old token cannot request codes.
const reissuedToken = 'synthetic-reissued-invitation-token-only';
await db.query(`SELECT public.amg_crm_record_phone_admin_invite_result($1,'failed',NULL)`,[prepared.id]);
const reissued = (await one(`SELECT public.amg_crm_prepare_phone_admin_invite('+12025550123',encode(extensions.digest($1,'sha256'),'hex')) AS result`,[reissuedToken])).result;
assert.equal(reissued.should_send,true);
await assertTwelveHours(reissued.id);
await db.query(`SELECT public.amg_crm_record_phone_admin_invite_result($1,'sent',NULL)`,[prepared.id]);
assert.equal((await one(`SELECT public.amg_crm_claim_phone_admin_otp($1,'+12025550123') AS claimed`,[token])).claimed,false);
await db.query(`UPDATE amg_private.crm_admin_invitations SET expires_at=now()-interval '1 second' WHERE id=$1`,[prepared.id]);
assert.equal((await one(`SELECT public.amg_crm_claim_phone_admin_otp($1,'+12025550123') AS claimed`,[reissuedToken])).claimed,false);
await db.query(`UPDATE amg_private.crm_admin_invitations SET status='failed' WHERE id=$1`,[prepared.id]);
await one(`SELECT public.amg_crm_prepare_phone_admin_invite('+12025550123',encode(extensions.digest($1,'sha256'),'hex')) AS result`,[token]);
await assertTwelveHours(prepared.id);
assert.equal((await one(`SELECT public.amg_crm_prepare_phone_admin_invite('+12025550123',repeat('a',64)) AS result`)).result.should_send,false);
await db.query(`UPDATE amg_private.crm_admin_invitations SET expires_at=now()-interval '1 hour' WHERE id=$1`,[prepared.id]);
assert.equal((await one(`SELECT public.amg_crm_prepare_phone_admin_invite('+12025550123',repeat('a',64)) AS result`)).result.should_send,false);
await db.query(`UPDATE amg_private.crm_admin_invitations SET status='uncertain' WHERE id=$1`,[prepared.id]);
assert.equal((await one(`SELECT public.amg_crm_prepare_phone_admin_invite('+12025550123',repeat('a',64)) AS result`)).result.should_send,false);
await db.query(`UPDATE amg_private.crm_admin_invitations SET status='prepared',expires_at=now()+interval '12 hours' WHERE id=$1`,[prepared.id]);
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
assert.equal((await one(`SELECT has_function_privilege('anon','public.amg_crm_prepare_phone_admin_invite(text,text)','EXECUTE') AS allowed`)).allowed,false);
assert.equal((await one(`SELECT has_function_privilege('authenticated','public.amg_crm_prepare_phone_admin_invite(text,text)','EXECUTE') AS allowed`)).allowed,true);
// Model the fields GoTrue uses for an email/password account. Apply the upgrade
// to a database that already contains a completed phone-based invitation.
await db.exec(`ALTER TABLE auth.users
  ADD COLUMN raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN encrypted_password text;
  CREATE UNIQUE INDEX auth_test_email_identity ON auth.users(lower(email)) WHERE email <> '';`);
await db.exec(await fs.readFile(new URL('../database/migrations/20261104230551_complete_admin_invite_without_sms.sql', import.meta.url), 'utf8'));
const passwordHash = '$2a$10$wh80SBB02/eVWXnneD4J3ed/Zs1gxGk.bvNqdB8gXqYJ7sXBiTk0K';
const hash = async value => (await one("SELECT encode(extensions.digest($1,'sha256'),'hex') AS hash", [value])).hash;
const available = async tokenHash => (await one('SELECT public.amg_crm_admin_invite_available($1) AS ok', [tokenHash])).ok;
const adminGrant = async id => Boolean(await one('SELECT 1 FROM amg_private.crm_admins WHERE user_id=$1', [id]));
const account = async id => one('SELECT * FROM auth.users WHERE id=$1', [id]);
async function issue(phone, secret, status = 'sent') {
  await db.exec(`SET test.uid='${admin}'`);
  const tokenHash = await hash(secret);
  const invitation = (await one('SELECT public.amg_crm_prepare_phone_admin_invite($1,$2) AS result', [phone, tokenHash])).result;
  assert.ok(invitation.should_send);
  await assertTwelveHours(invitation.id);
  await db.query("SELECT public.amg_crm_record_phone_admin_invite_result($1,$2,NULL)", [invitation.id, status]);
  return { id: invitation.id, tokenHash };
}
// Auth's Admin createUser inserts the account, assigns app metadata, then confirms
// the email inside one transaction. Exercise the trigger through those writes.
async function createPasswordAccount(id, email, tokenHash, { userMetadataOnly = false, confirm = true } = {}) {
  await db.transaction(async tx => {
    await tx.query('INSERT INTO auth.users(id,email,encrypted_password) VALUES ($1,$2,$3)', [id, email, passwordHash]);
    if (tokenHash) {
      const metadata = { amg_crm_invite_hash: tokenHash };
      if (userMetadataOnly) await tx.query('UPDATE auth.users SET raw_user_meta_data=$2 WHERE id=$1', [id, JSON.stringify(metadata)]);
      else await tx.query('UPDATE auth.users SET raw_app_meta_data=$2 WHERE id=$1', [id, JSON.stringify(metadata)]);
    }
    if (confirm) await tx.query('UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1', [id]);
  });
}
const personal = await issue('+12025550201', 'synthetic-unique-private-link-01');
// Historical links were bound to a pre-created phone-only Auth account.
const historicalStub = '66666666-6666-4666-8666-666666666666';
await db.query("INSERT INTO auth.users(id,phone,email) VALUES ($1,'12025550201','')", [historicalStub]);
await db.query('UPDATE amg_private.crm_admin_invitations SET provisioned_user_id=$1 WHERE id=$2', [historicalStub, personal.id]);
assert.equal(await available(personal.tokenHash), true);
assert.equal(await available(await hash('random-link')), false);
assert.equal(await available(await hash(token)), false, 'previously redeemed link stays consumed after upgrade');
for (const role of ['anon','authenticated','service_role']) {
  const granted = (await one("SELECT has_function_privilege($1,'public.amg_crm_admin_invite_available(text)','EXECUTE') AS ok", [role])).ok;
  assert.equal(granted, role === 'service_role');
  const legacyGrant = (await one("SELECT has_function_privilege($1,'public.amg_crm_admin_invite_legacy_user(text,text)','EXECUTE') AS ok", [role])).ok;
  assert.equal(legacyGrant, role === 'service_role');
}
// Unmarked registrations and ordinary metadata updates continue normally. A
// digest in user-editable metadata alone cannot grant a dashboard role.
const unrelated = '33333333-3333-4333-8333-333333333333';
await createPasswordAccount(unrelated, 'unrelated@example.test', personal.tokenHash, { userMetadataOnly: true });
await db.query("UPDATE auth.users SET raw_user_meta_data='{}',encrypted_password=$2 WHERE id=$1", [unrelated, passwordHash]);
assert.equal(await adminGrant(unrelated), false);
assert.equal(await available(personal.tokenHash), true);

const newcomer = '44444444-4444-4444-8444-444444444444';
await assert.rejects(createPasswordAccount(newcomer, 'unrelated@example.test', personal.tokenHash));
assert.equal(await account(newcomer), undefined);
assert.equal(await available(personal.tokenHash), true, 'email conflict leaves personal link usable');
assert.equal((await account(unrelated)).id, unrelated);
await assert.rejects(createPasswordAccount(newcomer, 'new-admin@example.test', personal.tokenHash, { confirm: false }));
assert.equal(await account(newcomer), undefined);
assert.equal(await adminGrant(newcomer), false);
assert.equal(await available(personal.tokenHash), true);

// Two independent attempts, including different email/password identities,
// must produce one grant and one Auth row for this particular link.
const racer = '55555555-5555-4555-8555-555555555555';
const candidates = [[newcomer,'new-admin@example.test'], [racer,'second@example.test']];
const results = await Promise.allSettled(candidates.map(([id, email]) => createPasswordAccount(id, email, personal.tokenHash)));
assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
const winner = candidates[results.findIndex(r => r.status === 'fulfilled')];
const loser = candidates[results.findIndex(r => r.status === 'rejected')];
const stored = await account(winner[0]);
assert.equal(stored.email, winner[1]);
assert.ok(stored.email_confirmed_at);
assert.ok(stored.encrypted_password);
assert.equal(stored.phone, null);
assert.equal(stored.phone_confirmed_at, null);
assert.equal(stored.raw_app_meta_data?.amg_crm_invite_hash, undefined);
assert.equal(await adminGrant(winner[0]), true);
assert.equal(await adminGrant(loser[0]), false);
assert.equal(await account(loser[0]), undefined);
assert.equal(await available(personal.tokenHash), false);
const redeemed = await one('SELECT * FROM amg_private.crm_admin_invitations WHERE id=$1', [personal.id]);
assert.equal(redeemed.status, 'accepted');
assert.equal(redeemed.verified_user_id, winner[0]);
assert.equal(redeemed.chosen_email, winner[1]);
assert.ok(redeemed.accepted_at);
assert.equal(redeemed.expires_at.getTime(), redeemed.accepted_at.getTime());
const oldAccount = await account(historicalStub);
assert.equal(oldAccount.email, '');
assert.equal(oldAccount.encrypted_password, null);
assert.equal(oldAccount.phone_confirmed_at, null);
assert.equal(await adminGrant(historicalStub), false);
await db.query("UPDATE auth.users SET raw_app_meta_data=jsonb_build_object('provider','email') WHERE id=$1", [winner[0]]);
assert.equal(await adminGrant(winner[0]), true, 'a normal account update preserves the registered admin');

const elapsed = await issue('+12025550202', 'synthetic-unique-private-link-02');
await db.query("UPDATE amg_private.crm_admin_invitations SET expires_at=now()-interval '1 second' WHERE id=$1", [elapsed.id]);
assert.equal(await available(elapsed.tokenHash), false);
await assert.rejects(createPasswordAccount(loser[0], loser[1], elapsed.tokenHash));
assert.equal(await account(loser[0]), undefined);
assert.equal(await adminGrant(loser[0]), false);

// If Auth puts the trusted marker directly on its initial insert, the same
// consumption runs at commit and removes only our marker from provider metadata.
const direct = await issue('+12025550204', 'synthetic-direct-insert-link');
const directId = '88888888-8888-4888-8888-888888888888';
await db.query(`INSERT INTO auth.users(id,email,email_confirmed_at,encrypted_password,raw_app_meta_data)
  VALUES ($1,'direct@example.test',now(),$2,$3)`, [directId, passwordHash, JSON.stringify({ provider: 'email', amg_crm_invite_hash: direct.tokenHash })]);
assert.equal(await adminGrant(directId), true);
assert.equal(await available(direct.tokenHash), false);
assert.deepEqual((await account(directId)).raw_app_meta_data, { provider: 'email' });

// A historical partially completed phone + confirmed-email link can recover
// only the exact account already bound to it, using the user's own password.
const legacy = await issue('+12025550203', 'synthetic-legacy-partial-link');
const legacyUser = '77777777-7777-4777-8777-777777777777';
await db.query("INSERT INTO auth.users(id,phone,email,phone_confirmed_at,email_confirmed_at,encrypted_password) VALUES ($1,'12025550203','previous@example.test',now(),now(),$2)", [legacyUser, passwordHash]);
await db.query("UPDATE amg_private.crm_admin_invitations SET status='phone_verified', verified_user_id=$1, provisioned_user_id=$1 WHERE id=$2", [legacyUser, legacy.id]);
const matchingUser = async email => (await one('SELECT public.amg_crm_admin_invite_legacy_user($1,$2) AS candidate', [legacy.tokenHash, email])).candidate;
assert.equal(await matchingUser('previous@example.test'), legacyUser);
assert.equal(await matchingUser('unrelated@example.test'), null);
await db.query("UPDATE amg_private.crm_admin_invitations SET status='revoked' WHERE id=$1", [legacy.id]);
assert.equal(await matchingUser('previous@example.test'), null);
assert.equal(await available(legacy.tokenHash), false);

console.log('SQL integration: historical and new invitations, twelve-hour expiration, grant rollback, duplicate email, replay, unrelated Auth accounts, marker cleanup, and service-only checks passed.');
await db.close();
