import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/admin.mjs", import.meta.url), "utf8");
const start = source.indexOf("function openDispatchConfirmation(channel)");
const end = source.indexOf("\nconst weekdayNames", start);
assert.ok(start >= 0 && end > start, "production delivery-control functions must be present");
const production = source.slice(start, end) + "\nthis.openDispatchConfirmation=openDispatchConfirmation;this.setDispatchChannel=setDispatchChannel;";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup({ apiImpl = async () => ({}), loadImpl = async () => {} } = {}) {
  const dialog = { open: false, showCount: 0, closeCount: 0, showModal() { this.open = true; this.showCount += 1; }, close() { this.open = false; this.closeCount += 1; } };
  const error = { textContent: "", focusCount: 0, focus() { this.focusCount += 1; } };
  const loading = { hidden: true };
  const app = { attributes: new Map(), setAttribute(name, value) { this.attributes.set(name, value); }, removeAttribute(name) { this.attributes.delete(name); } };
  const fields = {
    "#delivery-control-confirm-title": { textContent: "" },
    "#delivery-control-confirm-copy": { textContent: "" },
    "#delivery-control-confirm-warning": { textContent: "" },
    "#confirm-delivery-control": { textContent: "" },
    "#delivery-control-error": error,
    "#delivery-control-dialog": dialog,
    "#delivery-loading": loading,
    "#app": app,
  };
  const state = {
    dispatchBusy: false,
    pendingDispatchChange: null,
    dispatch_control: { individual_enabled: false, scheduled_enabled: false, version: 7 },
  };
  const calls = [];
  const notices = [];
  let renders = 0;
  let loads = 0;
  const context = {
    $: (selector) => fields[selector],
    state,
    api: async (body) => { calls.push(body); return apiImpl(body); },
    load: async () => { loads += 1; return loadImpl(); },
    toast: (message) => notices.push(message),
    renderDispatchControl: () => { renders += 1; },
  };
  vm.runInNewContext(production, context, { filename: "src/admin.mjs:dispatch-controls" });
  return { ...context, fields, dialog, error, loading, app, calls, notices, get renders() { return renders; }, get loads() { return loads; } };
}

test("individual and scheduled confirmations are independent and cancellation performs no write", () => {
  const app = setup();
  app.openDispatchConfirmation("individual");
  assert.equal(app.dialog.open, true);
  assert.equal(app.fields["#delivery-control-confirm-title"].textContent, "Turn Individual Texts ON?");
  assert.match(app.fields["#delivery-control-confirm-copy"].textContent, /Scheduled delivery stays unchanged/);
  assert.equal(JSON.stringify(app.state.pendingDispatchChange), JSON.stringify({ channel: "individual", enabled: true }));
  app.dialog.close();
  assert.equal(app.calls.length, 0);

  app.state.dispatch_control.scheduled_enabled = true;
  app.openDispatchConfirmation("scheduled");
  assert.equal(app.fields["#delivery-control-confirm-title"].textContent, "Turn Scheduled Texts OFF?");
  assert.match(app.fields["#delivery-control-confirm-copy"].textContent, /Individual delivery stays unchanged/);
  assert.equal(JSON.stringify(app.state.pendingDispatchChange), JSON.stringify({ channel: "scheduled", enabled: false }));
  assert.equal(app.calls.length, 0);
});

test("saving locks repeated clicks, refreshes authoritative state, and clears AMG loading state", async () => {
  const pending = deferred();
  const app = setup({ apiImpl: () => pending.promise });
  app.openDispatchConfirmation("individual");
  const first = app.setDispatchChannel("individual", true);
  const repeated = app.setDispatchChannel("individual", true);
  assert.equal(app.calls.length, 1);
  assert.equal(app.state.dispatchBusy, "individual");
  assert.equal(app.loading.hidden, false);
  assert.equal(app.app.attributes.get("aria-busy"), "true");
  await repeated;
  pending.resolve({});
  await first;
  assert.equal(JSON.stringify(app.calls[0]), JSON.stringify({ action: "set_dispatch_channel", channel: "individual", enabled: true, expectedVersion: 7 }));
  assert.equal(app.loads, 1);
  assert.equal(app.dialog.open, false);
  assert.equal(app.loading.hidden, true);
  assert.equal(app.app.attributes.has("aria-busy"), false);
  assert.equal(app.state.dispatchBusy, false);
  assert.equal(app.state.pendingDispatchChange, null);
  assert.deepEqual(app.notices, ["Individual Texts turned on."]);
});

test("stale or failed updates fail closed, refresh state, keep confirmation visible, and allow retry", async () => {
  let attempts = 0;
  const app = setup({ apiImpl: async () => {
    if (++attempts === 1) throw new Error("CRM state changed; refresh and try again.");
    return {};
  } });
  app.openDispatchConfirmation("scheduled");
  await app.setDispatchChannel("scheduled", true);
  assert.equal(app.error.textContent, "CRM state changed; refresh and try again.");
  assert.equal(app.error.focusCount, 1);
  assert.equal(app.dialog.open, true);
  assert.equal(app.loads, 1);
  assert.equal(app.loading.hidden, true);
  assert.equal(app.state.dispatchBusy, false);
  assert.equal(JSON.stringify(app.state.pendingDispatchChange), JSON.stringify({ channel: "scheduled", enabled: true }));

  await app.setDispatchChannel("scheduled", true);
  assert.equal(app.calls.length, 2);
  assert.equal(app.loads, 2);
  assert.equal(app.dialog.open, false);
});

test("successful write with failed refresh keeps returned control state and reports uncertainty clearly", async () => {
  const authoritative = { individual_enabled: true, scheduled_enabled: false, version: 8, audit: [] };
  const app = setup({
    apiImpl: async () => ({ dispatch_control: authoritative }),
    loadImpl: async () => { throw new Error("Refresh failed"); },
  });
  app.openDispatchConfirmation("individual");
  await app.setDispatchChannel("individual", true);
  assert.equal(app.state.dispatch_control, authoritative);
  assert.equal(app.dialog.open, false);
  assert.equal(app.error.textContent, "");
  assert.deepEqual(app.notices, ["Individual Texts changed, but the page could not refresh. Reload before making another change."]);
  assert.equal(app.loading.hidden, true);
});
