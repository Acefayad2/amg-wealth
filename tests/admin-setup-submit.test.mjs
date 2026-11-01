import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { normalizeEmail, validateSetup } from "../admin/setup/core.mjs";

const source = fs.readFileSync(new URL("../src/admin-setup.mjs", import.meta.url), "utf8");
const start = source.indexOf("async function savePassword(event) {");
const end = source.indexOf("\nasync function sendRecoveryEmail", start);
assert.ok(start >= 0 && end > start, "production password-submit function must be present");
const functionSource = `${source.slice(start, end)}\nthis.savePassword = savePassword;`;

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

function setup({ signInImpl = async () => ({ error: null }), updateImpl = async () => ({ data: { user: { email: "approved@example.test", email_confirmed_at: "2026-10-30T00:00:00Z" } }, error: null }), recoveryMode = false, invitationMode = false } = {}) {
  const calls = { signIn: 0, verify: 0, pending: 0, accept: 0, update: 0, signOut: 0 };
  const fields = {
    "#setup-email": { value: "approved@example.test" },
    "#current-password": { value: "Existing!Password1" },
    "#new-password": { value: "Strong!Password2" },
    "#confirm-password": { value: "Strong!Password2" },
    "#setup-form": { hidden: false },
    "#recovery-panel": { hidden: false },
    "#setup-success": { hidden: true, focus() {} },
    "#setup-success-title": { textContent: "Password saved" },
    "#setup-success-copy": { textContent: "Existing account ready." },
  };
  const context = {
    setupBusy: false,
    recoveryMode,
    invitationMode,
    invitePhoneVerified: invitationMode,
    inviteToken: "synthetic-test-token-with-more-than-32-characters",
    location: { origin: "https://example.test" },
    normalizeEmail,
    validateSetup,
    $: (selector) => fields[selector],
    showError(message) { context.lastError = message; },
    setBusy(value) { context.setupBusy = value; },
    async verifyCrmAdmin() { calls.verify += 1; },
    async verifyPendingInvitation() { calls.pending += 1; },
    async acceptInvitation() { calls.accept += 1; },
    authClient: { auth: {
      async signInWithPassword(payload) { calls.signIn += 1; context.signInPayload = payload; return signInImpl(payload); },
      async updateUser(payload) { calls.update += 1; context.updatePayload = payload; return updateImpl(payload); },
      async signOut() { calls.signOut += 1; },
    } },
  };
  vm.runInNewContext(functionSource, context, { filename: "src/admin-setup.mjs:save-password" });
  return { context, calls, fields, submit: () => context.savePassword({ preventDefault() {} }) };
}

test("existing-account setup reauthenticates, verifies CRM access, then updates once", async () => {
  const app = setup();
  await app.submit();
  assert.deepEqual(app.calls, { signIn: 1, verify: 1, pending: 0, accept: 0, update: 1, signOut: 1 });
  assert.equal(app.context.signInPayload.email, "approved@example.test");
  assert.equal(app.context.updatePayload.password, "Strong!Password2");
  assert.equal(app.fields["#setup-success"].hidden, false);
  assert.equal(app.fields["#setup-form"].hidden, true);
});

test("repeated password submission is ignored while reauthentication is pending", async () => {
  const pending = deferred();
  const app = setup({ signInImpl: () => pending.promise });
  const first = app.submit();
  await app.submit();
  assert.equal(app.calls.signIn, 1);
  assert.equal(app.calls.update, 0);
  pending.resolve({ error: null });
  await first;
  assert.equal(app.calls.update, 1);
  assert.equal(app.context.setupBusy, false);
});

test("recovery setup does not require or transmit the old password", async () => {
  const app = setup({ recoveryMode: true });
  app.fields["#current-password"].value = "";
  await app.submit();
  assert.equal(app.calls.signIn, 0);
  assert.equal(app.calls.verify, 1);
  assert.equal(app.calls.update, 1);
});

test("invitation setup verifies exact eligibility, updates password, then accepts admin access", async () => {
  const app = setup({ recoveryMode: true, invitationMode: true });
  app.fields["#current-password"].value = "";
  await app.submit();
  assert.equal(app.calls.signIn, 0);
  assert.equal(app.calls.pending, 0);
  assert.equal(app.calls.update, 1);
  assert.equal(app.calls.accept, 1);
  assert.equal(app.calls.verify, 0);
  assert.equal(app.calls.signOut, 0);
});

test("failed reauthentication never reaches the password update", async () => {
  const app = setup({ signInImpl: async () => ({ error: new Error("bad credentials") }) });
  await app.submit();
  assert.equal(app.calls.verify, 0);
  assert.equal(app.calls.pending, 0);
  assert.equal(app.calls.update, 0);
  assert.equal(app.calls.signOut, 1);
  assert.equal(app.context.lastError, "Email or current password is incorrect.");
});
