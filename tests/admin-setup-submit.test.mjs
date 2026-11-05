import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as setupCore from "../admin/setup/core.mjs";

const html = fs.readFileSync(new URL("../admin/setup/index.html", import.meta.url), "utf8");
const source = fs.readFileSync(new URL("../src/admin-setup.mjs", import.meta.url), "utf8");
const production = source.replace(/^import .+;$/gm, "").replace(/\binit\(\);\s*$/, "this.ready = init();");
const token = "synthetic-invitation-token-for-local-tests-only";
const email = "approved@example.test";
const password = "Strong!Password2";
const confirmedUser = { email, email_confirmed_at: "2026-10-30T00:00:00Z" };
const completionUrl = "https://supabase.example.test/functions/v1/amg-admin-complete-invite";

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

async function setup({ search = "", hash = "", user = null, signIn = async () => ({ error: null }),
  check = async () => Response.json({ ok: true }), complete = async () => Response.json({ ok: true }, { status: 201 }) } = {}) {
  const fields = new Map();
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const element = {
      value: "", textContent: "", hidden: /\bhidden\b/.test(match[0]), disabled: /\bdisabled\b/.test(match[0]),
      focus() {}, setAttribute(name, value) { this[name] = value; },
      addEventListener(type, handler) { this[type] = handler; },
    };
    fields.set(`#${match[1]}`, element);
  }
  const get = (selector) => fields.get(selector);
  const calls = { signIn: [], update: [], signOut: 0, verify: 0, checks: [], complete: [], history: [] };
  const client = { auth: {
    onAuthStateChange() {},
    getUser: async () => ({ data: { user } }),
    getSession: async () => ({ data: { session: { access_token: "test-session" } } }),
    signInWithPassword: async (payload) => { calls.signIn.push({ ...payload }); return signIn(); },
    updateUser: async (payload) => { calls.update.push({ ...payload }); return { data: { user }, error: null }; },
    signOut: async () => { calls.signOut += 1; },
  } };
  const location = new URL(`https://example.test/admin/setup/${search}${hash}`);
  const context = {
    ...setupCore, URL, URLSearchParams, location,
    document: { querySelector: get, title: "AMG setup" },
    history: { replaceState(_state, _title, url) { calls.history.push(url); } },
    createClient: () => client,
    async fetch(url, options = {}) {
      if (url === "/api/admin/config") return Response.json({ url: "https://supabase.example.test", key: "public-test-key" });
      if (url === "/api/admin/crm") { calls.verify += 1; return Response.json({}); }
      assert.equal(url, completionUrl, "Setup should only contact its config, authorized CRM, or completion endpoint");
      assert.equal(options.method, "POST");
      const payload = JSON.parse(options.body);
      if (payload.action === "check") { calls.checks.push(payload); return check(); }
      calls.complete.push(payload);
      return complete();
    },
  };
  vm.runInNewContext(production, context, { filename: "src/admin-setup.mjs" });
  await context.ready;
  get("#setup-email").value = ` ${email.toUpperCase()} `;
  get("#new-password").value = password;
  return { calls, get, submit: () => get("#setup-form").submit({ preventDefault() {} }) };
}

test("existing-account setup reauthenticates, verifies CRM access, then updates once", async () => {
  const app = await setup();
  app.get("#current-password").value = "Existing!Password1";
  await app.submit();
  assert.deepEqual(app.calls.signIn, [{ email, password: "Existing!Password1" }]);
  assert.equal(app.calls.verify, 1);
  assert.deepEqual(app.calls.update, [{ password }]);
  assert.equal(app.calls.signOut, 1);
  assert.equal(app.get("#setup-success").hidden, false);
  assert.equal(app.get("#setup-form").hidden, true);
});

test("repeated password submission is ignored while reauthentication is pending", async () => {
  const pending = deferred();
  const app = await setup({ signIn: () => pending.promise });
  app.get("#current-password").value = "Existing!Password1";
  const first = app.submit();
  await app.submit();
  assert.equal(app.calls.signIn.length, 1);
  assert.equal(app.calls.update.length, 0);
  pending.resolve({ error: null });
  await first;
  assert.equal(app.calls.update.length, 1);
  assert.equal(app.get("#setup-submit").disabled, false);
});

test("recovery setup does not require or transmit the old password", async () => {
  const app = await setup({ hash: "#type=recovery", user: confirmedUser });
  await app.submit();
  assert.equal(app.calls.signIn.length, 0);
  assert.equal(app.calls.verify, 1);
  assert.deepEqual(app.calls.update, [{ password }]);
});

test("personal link opens the account form and completes once with the chosen credentials, even with another session", async () => {
  const pending = deferred();
  const app = await setup({ search: `?invite=${token}`, user: { email: "other@example.test" }, complete: () => pending.promise });
  assert.equal(app.get("#setup-form").hidden, false);
  assert.equal(app.get("#current-password-field").hidden, true);
  const first = app.submit();
  await app.submit();
  assert.deepEqual(app.calls.complete, [{ inviteToken: token, email, password }]);
  assert.equal(app.calls.update.length, 0);
  assert.equal(app.calls.signIn.length, 0);
  assert.equal(app.get("#setup-success").hidden, true);
  pending.resolve(Response.json({ ok: true }, { status: 201 }));
  await first;
  assert.equal(app.get("#setup-success").hidden, false);
  assert.equal(app.get("#setup-form").hidden, true);
  assert.equal(app.get("#new-password").value, "");
  assert.ok(app.calls.history.includes("/admin/setup/"));
});

test("a used fragment link is rejected on opening, before asking for credentials", async () => {
  const app = await setup({ hash: `#invite=${token}`,
    check: async () => Response.json({ error: "Already used." }, { status: 410 }) });
  assert.deepEqual(app.calls.checks, [{ inviteToken: token, action: "check" }]);
  assert.equal(app.calls.complete.length, 0);
  assert.equal(app.get("#setup-form").hidden, true);
  assert.equal(app.get("#link-error").hidden, false);
  assert.match(app.get("#link-error").textContent, /sign in/i);
});

test("an unusable invitation shows a link error instead of reporting account creation", async () => {
  const app = await setup({ search: `?invite=${token}`,
    complete: async () => Response.json({ error: "This setup link has expired or was already used." }, { status: 410 }) });
  await app.submit();
  assert.equal(app.get("#setup-success").hidden, true);
  assert.equal(app.get("#setup-form").hidden, true);
  assert.equal(app.get("#link-error").hidden, false);
  assert.match(app.get("#link-error").textContent, /expired|already used/i);
});

test("a correctable email conflict leaves the invitation form available for retry", async () => {
  const app = await setup({ search: `?invite=${token}`,
    complete: async () => Response.json({ error: "Choose a different email." }, { status: 409 }) });
  await app.submit();
  assert.equal(app.get("#setup-form").hidden, false);
  assert.equal(app.get("#setup-success").hidden, true);
  assert.equal(app.get("#setup-submit").disabled, false);
  assert.match(app.get("#setup-error").textContent, /email/i);
});

test("failed reauthentication never reaches the password update", async () => {
  const app = await setup({ signIn: async () => ({ error: new Error("bad credentials") }) });
  app.get("#current-password").value = "Existing!Password1";
  await app.submit();
  assert.equal(app.calls.verify, 0);
  assert.equal(app.calls.update.length, 0);
  assert.equal(app.calls.signOut, 1);
  assert.equal(app.get("#setup-error").textContent, "Email or current password is incorrect.");
});
