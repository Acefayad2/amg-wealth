import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../admin/index.html", import.meta.url), "utf8");
const source = fs.readFileSync(new URL("../src/admin.mjs", import.meta.url), "utf8");
const start = source.indexOf("function showStartup(");
const end = source.indexOf("\nfunction render()", start);
assert.ok(start >= 0 && end > start, "session-loading production functions must be present");
const profileStart = source.indexOf("function renderAccountProfile(");
const profileEnd = source.indexOf("\nconst inquiryState", profileStart);
const production = `let authClient=this.authClient;let startupBusy=false;let sessionRevision=0;let accountUserId=null;const state=this.state;const initialState=this.initialState;const resetInquiries=this.resetInquiries;const resetLicensing=this.resetLicensing;const document=this.document;const render=this.render;const $=this.lookup;const load=this.load;const initials=(name)=>name.split(/\\s+/).map(part=>part[0]).join("").slice(0,2).toUpperCase();${source.slice(profileStart, profileEnd)}${source.slice(start, end)}\nthis.verifyAdminSession=verifyAdminSession;this.showLogin=showLogin;`;

function setup({ user = { id: "admin" }, profile = null, profileResult = null, authError = null, loadImpl = async () => {} } = {}) {
  let signOutCalls = 0;
  const fields = Object.fromEntries([
    "#startup-view", "#auth-view", "#app", "#startup-title", "#startup-status",
    "#startup-error-actions", "#login-error", "#delivery-loading", "#confirm-schedule-save", "#licensing-delete-confirm", "#login-submit", "#login-email", "#login-password", "#account-profile", "#account-name", "#account-email", "#account-avatar",
  ].map((selector) => [selector, { hidden: selector !== "#startup-view", textContent: "", removeAttribute() {} }]));
  const context = {
    state: { contacts: [{ full_name: "Private contact" }], messages: [{ body: "Private text" }] },
    initialState: () => ({ contacts: [], messages: [] }),
    resetInquiries() {}, resetLicensing() {}, render() {},
    document: { querySelectorAll: () => [] },
    authClient: { from: () => ({ select: () => {
      const query = { eq: (field, id) => {
        if (field !== "is_active") assert.equal(id, user.id, "profile query must target the authenticated user");
        return query;
      }, limit: () => query, maybeSingle: () => profileResult || Promise.resolve({ data: profile }) };
      return query;
    } }), auth: {
      getUser: async () => ({ data: { user }, error: authError }),
      signOut: async () => { signOutCalls += 1; return { error: null }; },
    } },
    lookup: (selector) => fields[selector],
    load: loadImpl,
  };
  vm.runInNewContext(production, context, { filename: "src/admin.mjs:session-loading" });
  return { ...context, context, fields, get signOutCalls() { return signOutCalls; } };
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

test("invalid stored refresh token is cleared and returns to sign in", async () => {
  const authError = Object.assign(new Error("Invalid Refresh Token: Refresh Token Not Found"), {
    code: "refresh_token_not_found",
  });
  const app = setup({ authError });
  await app.verifyAdminSession();
  assert.equal(app.signOutCalls, 1);
  assert.equal(app.fields["#startup-view"].hidden, true);
  assert.equal(app.fields["#auth-view"].hidden, false);
  assert.equal(app.fields["#app"].hidden, true);
  assert.equal(app.fields["#login-error"].textContent, "Your saved session expired. Sign in again.");
});

test("the account badge shows the signed-in admin’s saved name and auth email", async () => {
  const app = setup({ user: { id: "admin", email: "admin@example.com", user_metadata: { full_name: "Old Name" } }, profile: { first_name: "Natasha", last_name: "Brown" } });
  await app.verifyAdminSession();
  assert.equal(app.fields["#account-name"].textContent, "Natasha Brown");
  assert.equal(app.fields["#account-email"].textContent, "admin@example.com");
  assert.equal(app.fields["#account-profile"].hidden, false);
});

test("a late profile response cannot restore another account’s details after sign-out", async () => {
  let resolve;
  const profileResult = new Promise((done) => { resolve = done; });
  const app = setup({ user: { id: "admin", email: "admin@example.com", user_metadata: { full_name: "Natasha Brown" } }, profileResult });
  await app.verifyAdminSession();
  app.showLogin();
  resolve({ data: { first_name: "Natasha", last_name: "Brown" } });
  await profileResult;
  assert.equal(app.fields["#account-profile"].hidden, true);
  assert.equal(app.fields["#account-name"].textContent, "");
  assert.equal(app.fields["#account-email"].textContent, "");
});



test("sign-out while the CRM startup read is pending cannot reopen private data", async () => {
  let finish, started;
  const begun = new Promise(resolve => started = resolve);
  const app = setup({ loadImpl: () => { started(); return new Promise(resolve => finish = resolve); } });
  const pending = app.verifyAdminSession();
  await begun;
  app.showLogin();
  assert.equal(app.state.contacts.length, 0);
  assert.equal(app.state.messages.length, 0);
  finish();
  await pending;
  assert.equal(app.fields["#app"].hidden, true);
  assert.equal(app.fields["#auth-view"].hidden, false);
  assert.equal(app.fields["#account-profile"].hidden, true);
});

test("a stale failed verification cannot replace the signed-out login screen", async () => {
  let fail, started;
  const begun = new Promise(resolve => started = resolve);
  const app = setup({ loadImpl: () => { started(); return new Promise((resolve, reject) => fail = reject); } });
  const pending = app.verifyAdminSession();
  await begun;
  app.showLogin();
  fail(new Error("old network failure"));
  await pending;
  assert.equal(app.fields["#auth-view"].hidden, false);
  assert.equal(app.fields["#startup-view"].hidden, true);
});

test("sign-out closes private dialogs and resets their forms", () => {
  const app = setup();
  let closed = 0, reset = 0;
  app.document.querySelectorAll = selector => selector === "dialog[open]"
    ? [{ close: () => closed++ }]
    : selector === "dialog form" ? [{ reset: () => reset++ }] : [];
  app.showLogin();
  assert.equal(closed, 1);
  assert.equal(reset, 1);
});

test("late CRM responses cannot repopulate state after the session changes", async () => {
  const block = source.slice(source.indexOf("async function load()"), source.indexOf("function resetInquiries()"));
  let finish;
  const context = vm.createContext({ sessionRevision: 0, state: { contacts: [] }, api: () => new Promise(resolve => finish = resolve), render: () => { throw Error("Stale data rendered"); } });
  vm.runInContext(block, context);
  const pending = context.load();
  context.sessionRevision++;
  finish({ contacts: [{ full_name: "Private contact" }] });
  await pending;
  assert.equal(context.state.contacts.length, 0);
});


test("a rejected admin account leaves sign-in available for another attempt", async () => {
  const app = setup({ loadImpl: async () => { throw new Error("AMG CRM admin access required."); } });
  let submit, attempts = 0;
  app.fields["#login-form"] = { addEventListener: (_event, callback) => { submit = callback; } };
  app.authClient.auth.signInWithPassword = async () => { attempts++; return { error: null }; };
  const listener = source.slice(source.indexOf('$("#login-form").addEventListener'), source.indexOf('$("#sign-out").addEventListener'));
  vm.runInContext(listener, app.context);
  await submit({ preventDefault() {} });
  assert.equal(app.fields["#login-submit"].disabled, false);
  assert.match(app.fields["#login-error"].textContent, /does not have AMG CRM admin access/);
  await submit({ preventDefault() {} });
  assert.equal(attempts, 2);
  assert.equal(app.fields["#login-submit"].disabled, false);
});
