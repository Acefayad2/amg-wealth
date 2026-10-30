import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Execute the production contact-submit listener with the real EventTarget
// lifecycle, including currentTarget becoming null after dispatch. All DOM
// collaborators and API operations below are isolated in-memory test doubles.
const source = fs.readFileSync(new URL("../src/admin.mjs", import.meta.url), "utf8");
const start = source.indexOf('$("#contact-form").addEventListener("submit", async (event) => {');
const end = source.indexOf("\nasync function init()", start);
assert.ok(start >= 0 && end > start, "production contact-submit listener must be present");
const listener = source.slice(start, end);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class Form extends EventTarget {
  attributes = new Map();
  pending = [];
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, callback) {
    super.addEventListener(type, (event) => {
      const pending = Promise.resolve(callback(event));
      // Observe any production rejection in the assertion, never as an
      // unrelated unhandled rejection in the test runner.
      pending.catch(() => {});
      this.pending.push(pending);
    });
  }
}

function setup({ apiImpl = async () => ({ id: "contact-1" }), loadImpl = async () => {}, groups = [] } = {}) {
  const form = new Form();
  const button = { disabled: false };
  const error = { textContent: "", focusCount: 0, focus() { this.focusCount += 1; } };
  const dialog = { open: true, closeCount: 0, close() { this.open = false; this.closeCount += 1; } };
  const state = { contactBusy: false, contacts: [], groups };
  const calls = [];
  const notices = [];
  let loads = 0;
  const fields = {
    "#contact-form": form,
    "#contact-error": error,
    "#contact-dialog": dialog,
    "#contact-id": { value: "" },
    "#contact-name": { value: "Test Contact" },
    "#contact-phone": { value: "+12025550123" },
    "#contact-consent": { value: "pending" },
    "#consent-evidence": { value: "" },
    "#contact-timezone": { value: "America/New_York" },
  };
  for (const group of groups) fields[`#contact-groups input[value="${group.id}"]`] = { checked: true };
  vm.runInNewContext(listener, {
    $: (selector) => fields[selector],
    state,
    api: async (body) => { calls.push(body); return apiImpl(body); },
    load: async () => { loads += 1; return loadImpl(); },
    toast: (message) => notices.push(message),
  }, { filename: "src/admin.mjs:contact-submit" });

  function submit(submitter = button) {
    const event = new Event("submit", { cancelable: true });
    Object.defineProperty(event, "submitter", { value: submitter });
    form.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.currentTarget, null, "the DOM-like dispatch lifecycle clears currentTarget");
    return form.pending.at(-1);
  }
  function assertClean() {
    assert.equal(state.contactBusy, false);
    assert.equal(form.attributes.has("aria-busy"), false);
    assert.equal(button.disabled, false);
  }
  return { form, button, error, dialog, state, calls, notices, submit, assertClean, get loads() { return loads; } };
}

test("contact save success clears busy state after the event target is cleared", async () => {
  const pending = deferred();
  const app = setup({ apiImpl: () => pending.promise });
  const done = app.submit();
  assert.equal(app.state.contactBusy, true);
  assert.equal(app.form.attributes.get("aria-busy"), "true");
  assert.equal(app.button.disabled, true);
  pending.resolve({ id: "contact-1" });
  await done;
  app.assertClean();
  assert.equal(app.calls.length, 1);
  assert.equal(app.loads, 1);
  assert.equal(app.dialog.open, false);
  assert.deepEqual(app.notices, ["Contact saved."]);
});

test("failed contact save restores controls and allows a successful retry", async () => {
  let attempts = 0;
  const app = setup({ apiImpl: async () => {
    if (++attempts === 1) throw new Error("Temporary save failure");
    return { id: "contact-1" };
  } });
  await app.submit();
  app.assertClean();
  assert.equal(app.error.textContent, "Temporary save failure");
  assert.equal(app.error.focusCount, 1);
  assert.equal(app.dialog.open, true);
  assert.equal(app.loads, 0);
  assert.equal(app.notices.length, 0);
  await app.submit();
  app.assertClean();
  assert.equal(app.error.textContent, "");
  assert.equal(app.calls.length, 2);
  assert.equal(app.loads, 1);
});

test("repeated submission while saving is ignored and later submission works", async () => {
  const pending = deferred();
  const app = setup({ apiImpl: () => pending.promise });
  const first = app.submit();
  await app.submit();
  assert.equal(app.calls.length, 1);
  assert.equal(app.button.disabled, true);
  assert.equal(app.state.contactBusy, true);
  pending.resolve({ id: "contact-1" });
  await first;
  app.assertClean();
  await app.submit();
  app.assertClean();
  assert.equal(app.calls.length, 2);
});

for (const outcome of ["resolve", "reject"]) {
  test(`dismissal during contact save still cleans up when the request ${outcome}s`, async () => {
    const pending = deferred();
    const app = setup({ apiImpl: () => pending.promise });
    const done = app.submit();
    app.dialog.close();
    if (outcome === "resolve") pending.resolve({ id: "contact-1" });
    else pending.reject(new Error("Interrupted request failed"));
    await done;
    app.assertClean();
    assert.equal(app.dialog.open, false);
    assert.equal(app.calls.length, 1);
    assert.equal(app.notices.length, outcome === "resolve" ? 1 : 0);
  });
}

test("membership failure after contact creation restores the form controls", async () => {
  const app = setup({ groups: [{ id: "group-1" }], apiImpl: async (body) => {
    if (body.action === "set_membership") throw new Error("Membership update failed");
    return { id: "contact-1" };
  } });
  await app.submit();
  app.assertClean();
  assert.deepEqual(app.calls.map((body) => body.action), ["save_contact", "set_membership"]);
  assert.equal(app.error.textContent, "Membership update failed");
  assert.equal(app.dialog.open, true);
  assert.equal(app.loads, 0);
});

test("refresh failure after a saved contact still releases busy state", async () => {
  const app = setup({ loadImpl: async () => { throw new Error("Refresh failed"); } });
  await app.submit();
  app.assertClean();
  assert.equal(app.error.textContent, "Refresh failed");
  assert.equal(app.dialog.open, false);
  assert.equal(app.notices.length, 0);
});

test("submission without a submitter still cleans up the stable form", async () => {
  const app = setup();
  await app.submit(null);
  app.assertClean();
  assert.equal(app.loads, 1);
});
