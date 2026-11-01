import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../database/migrations/20261030163547_admin_invitation_onboarding.sql", import.meta.url), "utf8");
const inviteFunction = fs.readFileSync(new URL("../supabase/functions/amg-admin-invite/index.ts", import.meta.url), "utf8");
const otpFunction = fs.readFileSync(new URL("../supabase/functions/amg-admin-phone-otp/index.ts", import.meta.url), "utf8");
const smsHook = fs.readFileSync(new URL("../supabase/functions/amg-auth-sms-hook/index.ts", import.meta.url), "utf8");
const smsHookCore = fs.readFileSync(new URL("../supabase/functions/amg-auth-sms-hook/core.mjs", import.meta.url), "utf8");
const { handleVerifiedSmsEvent } = await import("../supabase/functions/amg-auth-sms-hook/core.mjs");
const setupSource = fs.readFileSync(new URL("../src/admin-setup.mjs", import.meta.url), "utf8");
const adminSource = fs.readFileSync(new URL("../src/admin.mjs", import.meta.url), "utf8");
const handler = fs.readFileSync(new URL("../netlify/functions/admin-crm.mts", import.meta.url), "utf8");
const setupHtml = fs.readFileSync(new URL("../admin/setup/index.html", import.meta.url), "utf8");
const setupDocs = fs.readFileSync(new URL("../docs/admin-crm-setup.md", import.meta.url), "utf8");

test("admin access requires the exact invited phone plus confirmed phone and chosen email", () => {
  assert.match(migration, /phone TEXT NOT NULL UNIQUE/);
  assert.match(migration, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(migration, /SELECT amg_private\.canonical_invite_phone\(phone\), NULLIF\(lower\(email\), ''\), phone_confirmed_at, email_confirmed_at/);
  assert.match(migration, /phone = current_phone AND verified_user_id = auth\.uid\(\)/);
  assert.match(migration, /INSERT INTO amg_private\.crm_admins \(user_id, granted_by\) VALUES \(auth\.uid\(\), invite\.invited_by\)/);
  assert.doesNotMatch(migration, /raw_user_meta_data|user_metadata|p_role/i);
  assert.match(migration, /amg_crm_accept_phone_admin_invite\(p_token TEXT\)/);
  assert.doesNotMatch(migration.match(/amg_crm_accept_phone_admin_invite[\s\S]*?\n\$\$;/)?.[0] || "", /p_user_id/i);
  assert.doesNotMatch(migration, /UPDATE\s+auth\.users|ALTER\s+.*auth\./i);
});

test("only CRM admins prepare phone invites and repeated clicks cannot duplicate them", () => {
  assert.match(migration, /amg_crm_prepare_phone_admin_invite[\s\S]*PERFORM amg_private\.require_crm_admin\(\)/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(normalized_phone, 0\)\)/);
  assert.match(migration, /REVOKE ALL ON amg_private\.crm_admin_invitations FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.amg_crm_record_phone_admin_invite_result\(UUID, TEXT, TEXT\) TO service_role/);
  assert.match(migration, /provisioned_user_id UUID REFERENCES auth\.users\(id\) ON DELETE SET NULL/);
  assert.match(migration, /amg_crm_record_phone_admin_invite_user[\s\S]*canonical_invite_phone\(u\.phone\) = i\.phone AND NULLIF\(u\.email, ''\) IS NULL/);
  assert.match(migration, /amg_crm_invite_owns_auth_user[\s\S]*i\.provisioned_user_id = p_user_id/);
  assert.match(inviteFunction, /amg_crm_invite_owns_auth_user/);
  assert.match(inviteFunction, /amg_crm_record_phone_admin_invite_user/);
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
  assert.match(migration, /otp_request_count INTEGER NOT NULL DEFAULT 0 CHECK \(otp_request_count BETWEEN 0 AND 5\)/);
  assert.match(migration, /amg_crm_claim_phone_admin_otp[\s\S]*otp_request_count < 5[\s\S]*INTERVAL '60 seconds'/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.amg_crm_claim_phone_admin_otp\(TEXT, TEXT\) TO service_role/);
  assert.match(otpFunction, /amg_crm_claim_phone_admin_otp/);
  assert.match(otpFunction, /signInWithOtp\(\{ phone, options: \{ shouldCreateUser: false \} \}\)/);
  assert.doesNotMatch(otpFunction, /shouldCreateUser: true|createUser/);
});

test("signed SMS hook reuses only the fixed AMG Quo sender and fails closed", () => {
  assert.match(smsHook, /standardwebhooks@1\.0\.0/);
  assert.match(smsHook, /const headers = Object\.fromEntries\(requestHeaders\)/);
  assert.match(smsHook, /wh\.verify\(payload, headers\)/);
  assert.match(smsHookCore, /export const AMG_PHONE_ID = "PNqGQouhRT"/);
  assert.match(smsHookCore, /export const AMG_FROM = "\+13017602910"/);
  assert.match(smsHookCore, /Your AMG verification code is: \$\{otp\}/);
  assert.match(smsHookCore, /hasProviderOptOut/);
  assert.doesNotMatch(`${smsHook}\n${smsHookCore}`, /console\.(?:log|error)\([^)]*(?:otp|phone|payload)/i);
});

test("Quo Auth hook accepts a verified OTP event with the fixed sender", async () => {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/v1/messages?") || url instanceof URL) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    return new Response(JSON.stringify({ data: { id: "msg_test" } }), { status: 202 });
  };
  const result = await handleVerifiedSmsEvent(
    { user: { id: "11111111-1111-4111-8111-111111111111", phone: "+12025550123" }, sms: { otp: "123456" } },
    { quoKey: "test-key", phoneNumberId: "PNqGQouhRT", webhookId: "hook-test", deliveryStore: { claim: async () => "send", record: async () => {} } }, fetcher,
  );
  assert.equal(result.status, 200);
  assert.equal(calls.length, 2);
  const sent = JSON.parse(calls[1].options.body);
  assert.deepEqual(sent.to, ["+12025550123"]);
  assert.equal(sent.from, "+13017602910");
  assert.match(sent.content, /123456/);
});

test("Quo Auth hook suppresses opted-out phones and provider failures", async () => {
  let calls = 0;
  const optedOut = await handleVerifiedSmsEvent(
    { user: { id: "11111111-1111-4111-8111-111111111111", phone: "+12025550123" }, sms: { otp: "123456" } },
    { quoKey: "test-key", phoneNumberId: "PNqGQouhRT", webhookId: "hook-test", deliveryStore: { claim: async () => "send", record: async () => {} } },
    async () => { calls += 1; return new Response(JSON.stringify({ data: [{ direction: "incoming", from: "+12025550123", text: "STOP" }] }), { status: 200 }); },
  );
  assert.equal(optedOut.status, 403);
  assert.equal(calls, 1);
  const unavailable = await handleVerifiedSmsEvent(
    { user: { id: "11111111-1111-4111-8111-111111111111", phone: "+12025550123" }, sms: { otp: "123456" } },
    { quoKey: "", phoneNumberId: "PNqGQouhRT" }, async () => { throw new Error("must not call"); },
  );
  assert.equal(unavailable.status, 503);
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
