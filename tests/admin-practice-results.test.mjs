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
  const buttons = ["communications", "results"].map((view) => ({ dataset: { adminView: view }, setAttribute() {} }));
  const context = {
    inquiryState: { records: [], total: 0, page: 1, pageSize: 25, loading: false, error: "", requestId: 0, controller: null, preview: false },
    resultState: { records: [], total: 0, page: 1, pageSize: 25, loading: false, error: "", requestId: 0, controller: null, preview: false },
    authClient: { auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null }, error: null }) } },
    lookup, document: { querySelectorAll: () => buttons }, AbortController,
    fetch: fetchImpl || (async () => ({ ok: true, json: async () => ({ results: [], total: 0, page: 1, page_size: 25 }) })),
  };
  vm.runInNewContext(`const $=this.lookup;const inquiryState=this.inquiryState;const resultState=this.resultState;const authClient=this.authClient;${helpers}\n${production}\nthis.loadResults=loadResults;this.renderResults=renderResults;this.resetResults=resetInquiries;this.showAdminView=showAdminView;`, context);
  return { ...context, fields, lookup };
}

const sample = { id: "sample", full_name: "Jordan Sample", email: "jordan@example.com", phone: "+12025550123", exam_type: "Health", score: 80, total:90, percentage:89, wrong:10,skipped:0,passed:true, created_at: "2026-11-04T14:30:00Z" };

test("results request uses the current access token and paginates without exposing credentials in the URL", async () => {
  let request;
  const app = setup({ fetchImpl: async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ results: [sample], total: 26, page: 2, page_size: 25 }) };
  } });
  await app.loadResults(2);
  assert.equal(request.url, "/api/admin/practice-results?page=2");
  assert.equal(request.options.headers.authorization, "Bearer admin-token");
  assert.equal(request.options.cache, "no-store");
  assert.equal(app.lookup("#results-page").textContent, "Page 2 of 2");
  assert.equal(app.lookup("#previous-results").disabled, false);
  assert.equal(app.lookup("#next-results").disabled, true);
  assert.equal(app.lookup("#results-pagination").hidden, false);
});

test("untrusted names, interests, messages and contact fields render safely", () => {
  const app = setup();
  app.resultState.records = [{ ...sample, full_name: '<img src=x onerror="alert(1)">', exam_type: '<script>alert(1)</script>', message: '<a href="javascript:alert(1)">Click</a>', email: 'javascript:alert(1)', phone: '" onclick="alert(1)' }];
  app.resultState.total = 1;
  app.renderResults();
  const html = app.lookup("#results-list").innerHTML;
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script/);
  assert.doesNotMatch(html, /<img|<script|href="javascript:|href="tel:/);
  app.resultState.records = [sample];
  app.renderResults();
  assert.match(app.lookup("#results-list").innerHTML, /jordan@example.com/);
  assert.match(app.lookup("#results-list").innerHTML, /80 \/ 90/);
});

test("missing session and backend failures stay inside the result panel", async () => {
  let called = false;
  const noSession = setup({ token: null, fetchImpl: async () => { called = true; } });
  await noSession.loadResults();
  assert.equal(called, false);
  assert.match(noSession.resultState.error, /Sign in again/);
  assert.equal(noSession.resultState.loading, false);
  const failure = setup({ fetchImpl: async () => ({ ok: false, json: async () => ({ error: "Temporarily unavailable" }) }) });
  await failure.loadResults();
  assert.equal(failure.lookup("#results-error").textContent, "Temporarily unavailable");
  assert.equal(failure.fields.has("#communications-view"), false);
  assert.equal(failure.lookup("#refresh-results").disabled, false);
});

test("sign-out clears results and ignores an in-flight response from the old session", async () => {
  let finish;
  let signal;
  let started;
  const requestStarted = new Promise((resolve) => { started = resolve; });
  const app = setup({ fetchImpl: (_url, options) => {
    signal = options.signal;
    started();
    return new Promise((resolve) => { finish = resolve; });
  } });
  const pending = app.loadResults();
  await requestStarted;
  app.resetResults();
  assert.equal(signal.aborted, true);
  finish({ ok: true, json: async () => ({ results: [sample], total: 1, page: 1, page_size: 25 }) });
  await pending;
  assert.equal(app.resultState.records.length, 0);
  assert.equal(app.resultState.total, 0);
  assert.equal(app.lookup("#results-view").hidden, true);
  assert.doesNotMatch(app.lookup("#results-list").innerHTML, /Jordan Sample/);
});

test("empty and malformed responses show useful states without leaving loading controls stuck", async () => {
  const empty = setup();
  await empty.loadResults();
  assert.match(empty.lookup("#results-list").innerHTML, /No results saved yet/);
  assert.equal(empty.lookup("#results-pagination").hidden, true);
  const malformed = setup({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  await malformed.loadResults();
  assert.match(malformed.resultState.error, /response was incomplete/);
  assert.equal(malformed.lookup("#refresh-results").disabled, false);
});
