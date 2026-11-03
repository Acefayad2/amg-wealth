import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../admin/index.html", import.meta.url), "utf8");
const source = fs.readFileSync(new URL("../src/admin.mjs", import.meta.url), "utf8");
const start = source.indexOf("function showStartup(");
const end = source.indexOf("\nfunction render()", start);
assert.ok(start >= 0 && end > start, "session-loading production functions must be present");
const production = `let authClient=this.authClient;let startupBusy=false;const $=this.lookup;const load=this.load;${source.slice(start, end)}\nthis.verifyAdminSession=verifyAdminSession;`;

function setup({ user = { id: "admin" }, authError = null, loadImpl = async () => {} } = {}) {
  let signOutCalls = 0;
  const signOutOptions = [];
  const fields = Object.fromEntries([
    "#startup-view", "#auth-view", "#app", "#startup-title", "#startup-status",
    "#startup-error-actions", "#login-error",
  ].map((selector) => [selector, { hidden: selector !== "#startup-view", textContent: "" }]));
  const context = {
    authClient: { auth: {
      getUser: async () => ({ data: { user }, error: authError }),
      signOut: async (options) => { signOutCalls += 1; signOutOptions.push(options); return { error: null }; },
    } },
    lookup: (selector) => fields[selector],
    load: loadImpl,
  };
  vm.runInNewContext(production, context, { filename: "src/admin.mjs:session-loading" });
  return { ...context, fields, signOutOptions, get signOutCalls() { return signOutCalls; } };
}

test("HTML starts on the branded AMG verification page without flashing login or dashboard", () => {
  assert.match(html, /id="startup-view"[\s\S]*logo-mark\.webp[\s\S]*Verifying access/);
  assert.match(html, /id="auth-view" class="auth-view" hidden/);
  assert.match(html, /id="app" class="app" hidden/);
  assert.match(source, /await authClient\.auth\.getUser\(\)[\s\S]*await load\(\)[\s\S]*\$\("#app"\)\.hidden = false/);
  assert.doesNotMatch(source, /location\.reload\(\)/);
});

test("restored authorized session reveals dashboard only after admin state loads", async () => {
  let loaded = false;
  const app = setup({ loadImpl: async () => { loaded = true; } });
  await app.verifyAdminSession();
  assert.equal(loaded, true);
  assert.equal(app.fields["#startup-view"].hidden, true);
  assert.equal(app.fields["#auth-view"].hidden, true);
  assert.equal(app.fields["#app"].hidden, false);
});

test("expired session shows login and unauthorized session shows a useful access error", async () => {
  const expired = setup({ user: null });
  await expired.verifyAdminSession();
  assert.equal(expired.fields["#startup-view"].hidden, true);
  assert.equal(expired.fields["#auth-view"].hidden, false);
  assert.equal(expired.fields["#app"].hidden, true);

  const unauthorized = setup({ loadImpl: async () => { throw new Error("AMG CRM admin access required."); } });
  await unauthorized.verifyAdminSession();
  assert.equal(unauthorized.fields["#auth-view"].hidden, false);
  assert.equal(unauthorized.fields["#app"].hidden, true);
  assert.equal(unauthorized.fields["#login-error"].textContent, "This account does not have AMG CRM admin access.");
});

test("verification failure stays on branded retry state and never reveals dashboard", async () => {
  const app = setup({ authError: new Error("Network verification failed") });
  await app.verifyAdminSession();
  assert.equal(app.fields["#startup-view"].hidden, false);
  assert.equal(app.fields["#auth-view"].hidden, true);
  assert.equal(app.fields["#app"].hidden, true);
  assert.equal(app.fields["#startup-title"].textContent, "Verification paused");
  assert.equal(app.fields["#startup-status"].textContent, "Network verification failed");
  assert.equal(app.fields["#startup-error-actions"].hidden, false);
});

test("a fresh in-app browser without a Supabase session shows sign-in instead of verification paused", async () => {
  let loads = 0;
  const missing = Object.assign(new Error("Auth session missing!"), { name: "AuthSessionMissingError", status: 400 });
  const app = setup({ user: null, authError: missing, loadImpl: async () => { loads += 1; } });
  await app.verifyAdminSession();
  assert.equal(loads, 0);
  assert.equal(app.signOutCalls, 0);
  assert.equal(app.fields["#startup-view"].hidden, true);
  assert.equal(app.fields["#auth-view"].hidden, false);
  assert.equal(app.fields["#app"].hidden, true);
  assert.equal(app.fields["#login-error"].textContent, "");
});

test("similarly worded invalid-token errors are not classified as a missing session", async () => {
  const invalid = Object.assign(new Error("Auth session or user missing"), { name: "AuthInvalidTokenResponseError", status: 500 });
  const app = setup({ user: null, authError: invalid });
  await app.verifyAdminSession();
  assert.equal(app.fields["#startup-view"].hidden, false);
  assert.equal(app.fields["#auth-view"].hidden, true);
  assert.equal(app.fields["#app"].hidden, true);
  assert.equal(app.fields["#startup-title"].textContent, "Verification paused");
  assert.equal(app.signOutCalls, 0);
});

test("invalid stored refresh token is cleared and returns to sign in", async () => {
  const authError = Object.assign(new Error("Invalid Refresh Token: Refresh Token Not Found"), {
    code: "refresh_token_not_found",
  });
  const app = setup({ authError });
  await app.verifyAdminSession();
  assert.equal(app.signOutCalls, 1);
  assert.equal(app.signOutOptions[0].scope, "local");
  assert.equal(app.fields["#startup-view"].hidden, true);
  assert.equal(app.fields["#auth-view"].hidden, false);
  assert.equal(app.fields["#app"].hidden, true);
  assert.equal(app.fields["#login-error"].textContent, "Your saved session expired. Sign in again.");
});

test("expired session discovered during initial CRM load also clears only local state", async () => {
  const app = setup({ loadImpl: async () => { throw Object.assign(new Error("Stored token is invalid"), { code: "refresh_token_invalid" }); } });
  await app.verifyAdminSession();
  assert.equal(app.signOutCalls, 1);
  assert.equal(app.signOutOptions[0].scope, "local");
  assert.equal(app.fields["#app"].hidden, true);
  assert.equal(app.fields["#auth-view"].hidden, false);
  assert.equal(app.fields["#login-error"].textContent, "Your saved session expired. Sign in again.");
});

const apiStart = source.indexOf("async function api(");
const apiEnd = source.indexOf("\nfunction toast(", apiStart);
assert.ok(apiStart >= 0 && apiEnd > apiStart);
function apiHarness(session, fetchImpl) {
  const context = { authClient: { auth: { getSession: async () => session } }, fetch: fetchImpl };
  vm.runInNewContext(`${source.slice(apiStart, apiEnd)}\nthis.request=api;`, context);
  return context.request;
}

test("CRM requests surface session retrieval errors before reading history or submitting a write", async () => {
  const error = Object.assign(new Error("Refresh token is invalid"), { code: "refresh_token_invalid" });
  let fetched = 0;
  const request = apiHarness({ data: { session: { access_token: "synthetic-stale" } }, error }, async () => { fetched += 1; });
  for (const body of [null, { action: "send_message_now" }]) {
    await assert.rejects(request(body, { query: new URLSearchParams({ conversationContactId: "synthetic-contact" }) }), (actual) => actual === error);
  }
  assert.equal(fetched, 0);
});

test("valid restored sessions preserve authenticated conversation query and cancellation signal", async () => {
  const signal = new AbortController().signal;
  const query = new URLSearchParams({ conversationContactId: "synthetic-contact", pageToken: "opaque/+&" });
  let calls = 0;
  const request = apiHarness({ data: { session: { access_token: "synthetic-only" } }, error: null }, async (url, init) => {
    calls += 1;
    assert.equal(url, `/api/admin/crm?${query}`);
    assert.equal(init.signal, signal);
    assert.equal(init.method, "GET");
    assert.equal(init.headers.authorization, "Bearer synthetic-only");
    assert.equal(init.body, undefined);
    return { ok: true, json: async () => ({ messages: [] }) };
  });
  assert.deepEqual(await request(null, { query, signal }), { messages: [] });
  assert.equal(calls, 1);
});
