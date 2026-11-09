import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/admin.mjs", import.meta.url), "utf8");
const production = source.slice(source.indexOf("function resetInquiries()"), source.indexOf("function showStartup("));
const helpers = ["escapeHtml", "formatDateTime"].map((name) => source.split("\n").find((line) => line.startsWith(`const ${name} =`))).join("\n");

function setup({ token = "admin-token", fetchImpl } = {}) {
  const fields = new Map();
  const lookup = (selector) => {
    if (!fields.has(selector)) fields.set(selector, {
      hidden: false, disabled: false, textContent: "", innerHTML: "", attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      classList: { remove() {}, toggle() {} },
    });
    return fields.get(selector);
  };
  const buttons = ["communications", "inquiries"].map((view) => ({ dataset: { adminView: view }, setAttribute() {} }));
  const context = {
    resultState: { records: [], total: 0, page: 1, pageSize: 25, loading: false, error: "", requestId: 0, controller: null, preview: false },
    inquiryState: { records: [], total: 0, page: 1, pageSize: 25, loading: false, error: "", requestId: 0, controller: null, preview: false },
    authClient: { auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null }, error: null }) } },
    lookup, document: { querySelectorAll: () => buttons }, AbortController,
    fetch: fetchImpl || (async () => ({ ok: true, json: async () => ({ inquiries: [], total: 0, page: 1, page_size: 25 }) })),
  };
  vm.runInNewContext(`const $=this.lookup;const inquiryState=this.inquiryState;const resultState=this.resultState;const authClient=this.authClient;${helpers}\n${production}\nthis.loadInquiries=loadInquiries;this.renderInquiries=renderInquiries;this.resetInquiries=resetInquiries;this.showAdminView=showAdminView;`, context);
  return { ...context, fields, lookup };
}

const sample = { id: "sample", full_name: "Jordan Sample", email: "jordan@example.com", phone: "+12025550123", interest: "Retirement Planning", message: "Please contact me.\nAfternoons are best.", created_at: "2026-11-04T14:30:00Z" };

test("inquiries request uses the current access token and paginates without exposing credentials in the URL", async () => {
  let request;
  const app = setup({ fetchImpl: async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ inquiries: [sample], total: 26, page: 2, page_size: 25 }) };
  } });
  await app.loadInquiries(2);
  assert.equal(request.url, "/.netlify/functions/admin-inquiries?page=2");
  assert.equal(request.options.headers.authorization, "Bearer admin-token");
  assert.equal(request.options.cache, "no-store");
  assert.equal(app.lookup("#inquiries-page").textContent, "Page 2 of 2");
  assert.equal(app.lookup("#previous-inquiries").disabled, false);
  assert.equal(app.lookup("#next-inquiries").disabled, true);
  assert.equal(app.lookup("#inquiries-pagination").hidden, false);
});

test("untrusted names, interests, messages and contact fields render safely", () => {
  const app = setup();
  app.inquiryState.records = [{ ...sample, full_name: '<img src=x onerror="alert(1)">', interest: '<script>alert(1)</script>', message: '<a href="javascript:alert(1)">Click</a>', email: 'javascript:alert(1)', phone: '" onclick="alert(1)' }];
  app.inquiryState.total = 1;
  app.renderInquiries();
  const html = app.lookup("#inquiries-list").innerHTML;
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script/);
  assert.doesNotMatch(html, /<img|<script|href="javascript:|href="tel:/);
  app.inquiryState.records = [sample];
  app.renderInquiries();
  assert.match(app.lookup("#inquiries-list").innerHTML, /href="mailto:jordan%40example\.com"/);
  assert.match(app.lookup("#inquiries-list").innerHTML, /href="tel:\+12025550123"/);
  assert.match(app.lookup("#inquiries-list").innerHTML, /Please contact me\.\nAfternoons are best\./);
});

test("missing session and backend failures stay inside the inquiry panel", async () => {
  let called = false;
  const noSession = setup({ token: null, fetchImpl: async () => { called = true; } });
  await noSession.loadInquiries();
  assert.equal(called, false);
  assert.match(noSession.inquiryState.error, /Sign in again/);
  assert.equal(noSession.inquiryState.loading, false);
  const failure = setup({ fetchImpl: async () => ({ ok: false, json: async () => ({ error: "Temporarily unavailable" }) }) });
  await failure.loadInquiries();
  assert.equal(failure.lookup("#inquiries-error").textContent, "Temporarily unavailable");
  assert.equal(failure.fields.has("#communications-view"), false);
  assert.equal(failure.lookup("#refresh-inquiries").disabled, false);
});

test("sign-out clears inquiries and ignores an in-flight response from the old session", async () => {
  let finish;
  let signal;
  let started;
  const requestStarted = new Promise((resolve) => { started = resolve; });
  const app = setup({ fetchImpl: (_url, options) => {
    signal = options.signal;
    started();
    return new Promise((resolve) => { finish = resolve; });
  } });
  const pending = app.loadInquiries();
  await requestStarted;
  app.resetInquiries();
  assert.equal(signal.aborted, true);
  finish({ ok: true, json: async () => ({ inquiries: [sample], total: 1, page: 1, page_size: 25 }) });
  await pending;
  assert.equal(app.inquiryState.records.length, 0);
  assert.equal(app.inquiryState.total, 0);
  assert.equal(app.lookup("#inquiries-view").hidden, true);
  assert.doesNotMatch(app.lookup("#inquiries-list").innerHTML, /Jordan Sample/);
});

test("empty and malformed responses show useful states without leaving loading controls stuck", async () => {
  const empty = setup();
  await empty.loadInquiries();
  assert.match(empty.lookup("#inquiries-list").innerHTML, /No inquiries yet/);
  assert.equal(empty.lookup("#inquiries-pagination").hidden, true);
  const malformed = setup({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  await malformed.loadInquiries();
  assert.match(malformed.inquiryState.error, /response was incomplete/);
  assert.equal(malformed.lookup("#refresh-inquiries").disabled, false);
});
