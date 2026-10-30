import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../database/migrations/20261030163547_admin_invitation_onboarding.sql", import.meta.url), "utf8");
const inviteFunction = fs.readFileSync(new URL("../supabase/functions/amg-admin-invite/index.ts", import.meta.url), "utf8");
const otpFunction = fs.readFileSync(new URL("../supabase/functions/amg-admin-phone-otp/index.ts", import.meta.url), "utf8");
const setupSource = fs.readFileSync(new URL("../src/admin-setup.mjs", import.meta.url), "utf8");
const adminSource = fs.readFileSync(new URL("../src/admin.mjs", import.meta.url), "utf8");
const handler = fs.readFileSync(new URL("../netlify/functions/admin-crm.mts", import.meta.url), "utf8");
const setupHtml = fs.readFileSync(new URL("../admin/setup/index.html", import.meta.url), "utf8");
const setupDocs = fs.readFileSync(new URL("../docs/admin-crm-setup.md", import.meta.url), "utf8");

test("admin access requires the exact invited phone plus confirmed phone and chosen email", () => {
  assert.match(migration, /phone TEXT NOT NULL UNIQUE/);
  assert.match(migration, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(migration, /SELECT phone, lower\(email\), phone_confirmed_at, email_confirmed_at/);
  assert.match(migration, /phone = current_phone AND verified_user_id = auth\.uid\(\)/);
  assert.match(migration, /INSERT INTO amg_private\.crm_admins \(user_id, granted_by\) VALUES \(auth\.uid\(\), invite\.invited_by\)/);
  assert.doesNotMatch(migration, /raw_user_meta_data|user_metadata|p_user_id|p_role/i);
  assert.doesNotMatch(migration, /UPDATE\s+auth\.users|ALTER\s+.*auth\./i);
});

test("only CRM admins prepare phone invites and repeated clicks cannot duplicate them", () => {
  assert.match(migration, /amg_crm_prepare_phone_admin_invite[\s\S]*PERFORM amg_private\.require_crm_admin\(\)/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(normalized_phone, 0\)\)/);
  assert.match(migration, /REVOKE ALL ON amg_private\.crm_admin_invitations FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.amg_crm_record_phone_admin_invite_result\(UUID, TEXT, TEXT\) TO service_role/);
});

test("private text uses a random single-use token, checks opt-outs, and never returns the token", () => {
  assert.match(inviteFunction, /crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
  assert.match(inviteFunction, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(inviteFunction, /amg_crm_prepare_phone_admin_invite/);
  assert.match(inviteFunction, /hasProviderOptOut/);
  assert.match(inviteFunction, /const deadline = Date\.now\(\) \+ 5000/);
  assert.match(inviteFunction, /Provider opt-out verification failed closed/);
  assert.match(inviteFunction, /Reply STOP to opt out/);
  assert.match(inviteFunction, /provider outcome is uncertain/i);
  assert.doesNotMatch(inviteFunction, /return json\(\{[^}]*privateUrl|return json\(\{[^}]*token[,}]/s);
});

test("phone OTP endpoint validates the private invitation and cannot create arbitrary users", () => {
  assert.match(otpFunction, /amg_crm_validate_phone_admin_invite/);
  assert.match(otpFunction, /signInWithOtp\(\{ phone, options: \{ shouldCreateUser: false \} \}\)/);
  assert.doesNotMatch(otpFunction, /shouldCreateUser: true|createUser/);
});

test("browser requires phone OTP and verified email before server-side acceptance", () => {
  assert.match(setupSource, /auth\.verifyOtp\(\{ phone, token: otp, type: "sms" \}\)/);
  assert.match(setupSource, /amg_crm_bind_verified_invite_phone/);
  assert.match(setupSource, /auth\.updateUser\(\{ email, password \}/);
  assert.match(setupSource, /amg_crm_accept_phone_admin_invite/);
  assert.match(setupHtml, /<meta name="referrer" content="no-referrer">/);
  assert.match(setupDocs, /email confirmation is required for email changes/);
  assert.doesNotMatch(setupSource, /\.signUp\(|auth\.admin|service_role|role\s*:/i);
});

test("portal invitation action uses only an approved phone and stays separate from normal messages", () => {
  assert.match(adminSource, /if \(state\.adminInviteBusy\) return/);
  assert.match(adminSource, /window\.confirm\(`Send one private, single-use AMG admin setup link/);
  assert.match(adminSource, /action: "create_admin_invitation", phone\s*}/);
  assert.match(handler, /input\.action === "create_admin_invitation"/);
  assert.match(handler, /client\.functions\.invoke\("amg-admin-invite"/);
  assert.doesNotMatch(handler.match(/input\.action === "create_admin_invitation"[\s\S]*?\n    }/)?.[0] || "", /send_message_now/);
});
