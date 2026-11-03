import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/admin.mjs", import.meta.url), "utf8");
const start = source.indexOf("async function sendMessageNow(event) {");
const end = source.indexOf('\n$("#login-form").addEventListener', start);
assert.ok(start >= 0 && end > start);
const production = `${source.slice(start, end)}\nthis.submit=sendMessageNow;`;

function setup({ loadImpl = async () => {}, apiImpl = async () => ({ status: "queued", recipientCount: 1 }) } = {}) {
  const dialog = () => ({ open: true, close() { this.open = false; } });
  const fields = {
    "#send-now-dialog": dialog(), "#composer": dialog(), "#conversation-dialog": dialog(),
    "#target-type": { value: "individual" }, "#target-id": { value: "contact-a" },
    "#message-body": { value: "Synthetic reply" }, "#message-timezone": { value: "America/New_York" },
    "#personalize-name": { checked: false }, "#confirm-send-now": { disabled: false },
    "#send-now-error": { textContent: "", focus() {} },
    "#transport-banner": { textContent: "", classList: { remove() {} } },
  };
  const state = { messageBusy: false, messageTargetPhone: "+12025550123", messageRequestKey: "same-request" };
  const calls = []; const notices = []; let loads = 0;
  const context = {
    $: (selector) => fields[selector], state,
    conversation: { view: { contactId: "contact-a" } },
    api: async (input) => { calls.push(input); return apiImpl(input); },
    load: async () => { loads += 1; return loadImpl(); }, toast: (message) => notices.push(message),
    updateRecipientNote() {}, renderConversation() {}, loadConversationPage: async () => { throw new Error("Cannot assume queued text was delivered"); },
  };
  vm.runInNewContext(production, context);
  return { ...context, fields, calls, notices, get loads() { return loads; } };
}

test("queued reply closes confirmation and composer without claiming provider acceptance", async () => {
  const app = setup();
  await app.submit({ preventDefault() {} });
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].expectedPhone, "+12025550123");
  assert.equal(app.fields["#composer"].open, false);
  assert.equal(app.fields["#send-now-dialog"].open, false);
  assert.equal(app.fields["#conversation-dialog"].open, true);
  assert.equal(app.fields["#send-now-error"].textContent, "");
  assert.match(app.notices[0], /queued for delivery.*Refresh the conversation/);
  assert.doesNotMatch(app.notices.join(" "), /accepted|sent/i);
  assert.equal(app.loads, 1);
  assert.match(app.state.conversationQueuedNotice.text, /queued for delivery/);
  assert.equal(app.state.messageBusy, false);
});

test("durable queued reply remains success when dashboard reload fails and never resubmits", async () => {
  const app = setup({ loadImpl: async () => { throw new Error("Synthetic read failure"); } });
  await app.submit({ preventDefault() {} });
  assert.equal(app.calls.length, 1);
  assert.equal(app.loads, 1);
  assert.equal(app.fields["#composer"].open, false);
  assert.equal(app.fields["#send-now-dialog"].open, false);
  assert.equal(app.fields["#send-now-error"].textContent, "");
  assert.match(app.state.conversationQueuedNotice.text, /queued for delivery.*Dashboard refresh failed/);
  assert.match(app.fields["#transport-banner"].textContent, /queued for delivery.*Dashboard refresh failed.*before sending again/);
  assert.equal(app.state.messageBusy, false);
  assert.equal(app.fields["#confirm-send-now"].disabled, false);
});

test("repeated confirmed reply clicks share the active submission rather than queueing twice", async () => {
  let release; const pending = new Promise((resolve) => { release = resolve; });
  const app = setup({ apiImpl: () => pending });
  const first = app.submit({ preventDefault() {} });
  await app.submit({ preventDefault() {} });
  assert.equal(app.calls.length, 1);
  release({ status: "queued", recipientCount: 1 });
  await first;
  assert.equal(app.calls.length, 1);
});

 test("closing or switching the thread during queue submission cannot label another contact as queued", async () => {
  for (const action of ["close", "switch"]) {
    let release; const pending = new Promise((resolve) => { release = resolve; });
    const app = setup({ apiImpl: () => pending });
    const submitting = app.submit({ preventDefault() {} });
    if (action === "close") app.fields["#conversation-dialog"].close();
    else app.conversation.view.contactId = "contact-b";
    release({ status: "queued", recipientCount: 1 });
    await submitting;
    assert.equal(app.state.conversationQueuedNotice, undefined);
    assert.equal(app.calls.length, 1);
  }
});
