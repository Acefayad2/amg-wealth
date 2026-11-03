import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createConversationController, conversationDateTime, conversationReplyState, renderConversationMessages } from "../admin/conversation-core.mjs";

const source = fs.readFileSync(new URL("../src/admin.mjs", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../admin/index.html", import.meta.url), "utf8");
const alice = { id: "contact-a", phone: "+12025550101", consent_status: "opted_in" };
const bob = { id: "contact-b", phone: "+12025550102", consent_status: "opted_in" };
const ready = { dispatch_control: { individual_enabled: true }, storage_verified: true, transport: { enabled: true, verified: true } };
const message = (id, minute = 1, extra = {}) => ({ id, text: `Synthetic ${id}`, direction: "incoming", status: "received", created_at: `2026-11-03T07:${String(minute).padStart(2, "0")}:00Z`, has_media: false, ...extra });
const page = (contact = alice, messages = [], nextPageToken = null) => ({ contact_id: contact.id, contact_phone: contact.phone, messages, next_page_token: nextPageToken, loaded_at: "2026-11-03T07:30:00Z" });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const calls = [];
  const changes = [];
  const controller = createConversationController({
    fetchPage: (request) => { const pending = deferred(); calls.push({ ...request, ...pending }); return pending.promise; },
    onChange: (view) => changes.push(view),
  });
  return { controller, calls, changes };
}

test("history orders both directions chronologically and older pages merge without duplicates", async () => {
  const { controller, calls } = setup();
  const loading = controller.open(alice);
  assert.equal(controller.view.busy, true);
  calls[0].resolve(page(alice, [message("new", 20, { direction: "outgoing", status: "sent" }), message("middle", 10)], "older/+&?"));
  assert.equal(await loading, true);
  assert.deepEqual(controller.view.messages.map((m) => m.id), ["middle", "new"]);
  const older = controller.loadOlder();
  assert.equal(calls[1].pageToken, "older/+&?");
  calls[1].resolve(page(alice, [message("middle", 10), message("old", 2)], null));
  assert.equal(await older, true);
  assert.deepEqual(controller.view.messages.map((m) => m.id), ["old", "middle", "new"]);
  assert.equal(controller.view.nextPageToken, null);
  assert.equal(await controller.loadOlder(), false);
  assert.equal(calls.length, 2);
});

for (const outcome of ["resolve", "reject"]) {
  test(`switching contacts ignores an old ${outcome}, aborts it, and clears old history immediately`, async () => {
    const { controller, calls } = setup();
    const first = controller.open(alice);
    const second = controller.open(bob);
    assert.equal(calls[0].signal.aborted, true);
    assert.deepEqual(controller.view.messages, []);
    assert.equal(controller.view.contactId, bob.id);
    calls[1].resolve(page(bob, [message("bob-message")]));
    await second;
    if (outcome === "resolve") calls[0].resolve(page(alice, [message("private-alice-message")]));
    else calls[0].reject(new Error("Old failure"));
    assert.equal(await first, false);
    assert.equal(controller.view.contactId, bob.id);
    assert.deepEqual(controller.view.messages.map((m) => m.id), ["bob-message"]);
    assert.equal(controller.view.error, "");
  });

  test(`closing while loading ignores a late ${outcome} and leaves no retained contact history`, async () => {
    const { controller, calls } = setup();
    const loading = controller.open(alice);
    controller.close();
    assert.equal(calls[0].signal.aborted, true);
    if (outcome === "resolve") calls[0].resolve(page(alice, [message("late-private-message")]));
    else calls[0].reject(new Error("Late failure"));
    assert.equal(await loading, false);
    assert.equal(controller.view.contactId, null);
    assert.deepEqual(controller.view.messages, []);
    assert.equal(controller.view.busy, false);
    assert.equal(controller.view.error, "");
  });
}

test("reopening the same contact invalidates the original request even if the transport ignores cancellation", async () => {
  const { controller, calls } = setup();
  const old = controller.open(alice);
  controller.close();
  const current = controller.open(alice);
  calls[1].resolve(page(alice, [message("current")]));
  await current;
  calls[0].resolve(page(alice, [message("obsolete")]));
  await old;
  assert.equal(controller.view.messages[0].id, "current");
});

test("repeated refresh or pagination clicks issue only one active request", async () => {
  const { controller, calls } = setup();
  const loading = controller.open(alice);
  assert.equal(await controller.refresh(), false);
  assert.equal(await controller.loadOlder(), false);
  assert.equal(await controller.retry(), false);
  assert.equal(calls.length, 1);
  calls[0].resolve(page());
  await loading;
  const refreshing = controller.refresh();
  assert.equal(await controller.refresh(), false);
  assert.equal(calls.length, 2);
  calls[1].resolve(page());
  await refreshing;
});

test("initial fetch failure is not rendered as an empty conversation and requires explicit retry", async () => {
  const { controller, calls } = setup();
  const loading = controller.open(alice);
  calls[0].reject(new Error("Provider history unavailable"));
  assert.equal(await loading, false);
  assert.equal(controller.view.hasLoaded, false);
  assert.equal(controller.view.error, "Provider history unavailable");
  assert.equal(controller.view.busy, false);
  assert.equal(calls.length, 1);
  const retry = controller.retry();
  calls[1].resolve(page());
  assert.equal(await retry, true);
  assert.equal(controller.view.hasLoaded, true);
  assert.equal(controller.view.error, "");
});

test("failed refresh keeps known history with error; successful refresh replaces stale pages", async () => {
  const { controller, calls } = setup();
  const loading = controller.open(alice);
  calls[0].resolve(page(alice, [message("known")], "token"));
  await loading;
  const refreshing = controller.refresh();
  calls[1].reject(new Error("Offline"));
  await refreshing;
  assert.deepEqual(controller.view.messages.map((m) => m.id), ["known"]);
  assert.equal(controller.view.nextPageToken, "token");
  assert.equal(controller.view.error, "Offline");
  const retry = controller.retry();
  assert.equal(calls[2].pageToken, null);
  calls[2].resolve(page(alice, [message("updated", 20)]));
  await retry;
  assert.deepEqual(controller.view.messages.map((m) => m.id), ["updated"]);
});

test("older-page failure retries the same page without losing existing messages", async () => {
  const { controller, calls } = setup();
  const loading = controller.open(alice);
  calls[0].resolve(page(alice, [message("known")], "next"));
  await loading;
  const older = controller.loadOlder();
  calls[1].reject(new Error("Interrupted page"));
  await older;
  const retry = controller.retry();
  assert.equal(calls[2].pageToken, "next");
  assert.equal(controller.view.messages[0].id, "known");
  calls[2].resolve(page(alice, [message("older", 0)]));
  await retry;
  assert.deepEqual(controller.view.messages.map((m) => m.id), ["older", "known"]);
});

test("wrong-contact, changed-phone, and malformed payloads fail closed", async () => {
  for (const payload of [page(bob, [message("wrong")]), page({ ...alice, phone: bob.phone }, [message("changed")]), { ...page(), messages: null }, page(alice, [{ ...message("bad"), direction: "unknown" }])]) {
    const { controller, calls } = setup();
    const loading = controller.open(alice);
    calls[0].resolve(payload);
    assert.equal(await loading, false);
    assert.match(controller.view.error, /could not be verified/);
    assert.equal(controller.view.hasLoaded, false);
    assert.deepEqual(controller.view.messages, []);
  }
});

test("pending and opted-out contacts can view messages but cannot reply", async () => {
  for (const consent_status of ["pending", "opted_out"]) {
    const contact = { ...alice, consent_status };
    const { controller, calls } = setup();
    const loading = controller.open(contact);
    calls[0].resolve(page(contact, [message("STOP", 1, { text: "STOP" })]));
    assert.equal(await loading, true);
    assert.equal(controller.view.messages[0].text, "STOP");
    assert.equal(conversationReplyState(contact, ready).allowed, false);
  }
});

test("reply readiness respects every existing transport, busy, and individual dispatch lock", () => {
  assert.equal(conversationReplyState(alice, ready).allowed, true);
  for (const state of [
    { ...ready, messageBusy: true },
    { ...ready, storage_verified: false },
    { ...ready, dispatch_control: { individual_enabled: false } },
    ...["enabled", "verified"].map((key) => ({ ...ready, transport: { ...ready.transport, [key]: false } })),
    { ...ready, transport: { ...ready.transport, emergency_disabled: true } },
  ]) assert.equal(conversationReplyState(alice, state).allowed, false);
  assert.equal(conversationReplyState(null, ready).allowed, false);
});

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.textContent = ""; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  set innerHTML(_) { throw new Error("Message rendering must never use innerHTML"); }
}
const fakeDocument = { createElement: (tag) => new Element(tag) };
function allText(element) { return [element.textContent, ...element.children.map(allText)].join(" "); }

test("message text, status, markup, URLs, and media notices are rendered as plain text", () => {
  const container = new Element("ol");
  const unsafe = '<img src=x onerror=alert(1)>\n<script>bad()</script> https://example.test';
  renderConversationMessages(container, [message("untrusted", 1, { text: unsafe, status: '<svg onload=alert(1)>', has_media: true })], fakeDocument);
  assert.equal(container.children[0].children[1].textContent, unsafe);
  assert.match(allText(container), /Status: <svg onload=alert\(1\)>/);
  assert.match(allText(container), /Attachments are not displayed/);
  assert.equal(container.children[0].children[0].children[1].dateTime, "2026-11-03T07:01:00Z");
  renderConversationMessages(container, [], fakeDocument);
  assert.deepEqual(container.children, []);
  assert.equal(conversationDateTime("invalid"), "Time unavailable");
  assert.equal(conversationDateTime(null), "Time unavailable");
});

test("reply opens only the current eligible contact in the existing composer and never sends directly", () => {
  const start = source.indexOf("function replyToConversation() {");
  const end = source.indexOf("\nfunction renderCalendar()", start);
  const composeCalls = [], notices = [];
  let renders = 0, focuses = 0;
  const state = { ...ready, contacts: [alice, bob] };
  const context = {
    state, conversation: { view: { contactId: alice.id, contactPhone: alice.phone } },
    conversationReplyState, renderConversation: () => { renders++; }, toast: (message) => notices.push(message),
    $: () => ({ open: true, focus: () => { focuses++; } }),
    openComposer: (...args) => composeCalls.push(args),
  };
  vm.runInNewContext(source.slice(start, end) + "\nthis.reply = replyToConversation;", context);
  context.reply();
  assert.deepEqual(composeCalls, [["individual", alice.id]]);
  assert.equal(focuses, 1);
  state.contacts = [{ ...alice, consent_status: "opted_out" }, bob];
  context.reply();
  assert.equal(composeCalls.length, 1);
  state.contacts = [{ ...alice, phone: bob.phone }, bob];
  context.reply();
  assert.equal(composeCalls.length, 1);
  assert.equal(renders, 1);
  assert.match(notices[0], /phone changed/);
});

test("production uses authenticated read-only encoded conversation queries with cancellation", async () => {
  const start = source.indexOf("const conversation = createConversationController({");
  const end = source.indexOf("\nlet renderedConversationMessages", start);
  let configuration;
  const calls = [];
  const context = {
    URLSearchParams, createConversationController: (options) => { configuration = options; }, renderConversation() {},
    api: (...args) => calls.push(args),
  };
  vm.runInNewContext(source.slice(start, end), context);
  const signal = new AbortController().signal;
  await configuration.fetchPage({ contactId: alice.id, pageToken: "abc/+&?", signal });
  assert.equal(calls[0][0], null);
  assert.equal(calls[0][1].query.get("conversationContactId"), alice.id);
  assert.equal(calls[0][1].query.get("pageToken"), "abc/+&?");
  assert.equal(calls[0][1].signal, signal);
  assert.match(source, /authorization: `Bearer \$\{token\}`/);
  assert.match(source, /expectedPhone: \$\("#target-type"\)\.value === "individual" \? state\.messageTargetPhone : undefined/);
  assert.match(source, /action: "send_message_now"[\s\S]*idempotencyKey: state\.messageRequestKey/);
});

test("dialog provides accessible history, explicit retry, manual refresh, close/Escape invalidation, and first-time notice", () => {
  assert.match(html, /id="conversation-dialog"[^>]*aria-labelledby="conversation-title"[^>]*aria-describedby="conversation-contact"/);
  assert.match(html, /id="conversation-history"[^>]*tabindex="0"[^>]*role="region"/);
  assert.match(html, /id="conversation-error"[^>]*role="alert"/);
  assert.match(html, /id="conversation-retry"/);
  assert.match(html, /id="conversation-refresh"/);
  assert.match(source, /addEventListener\("cancel", \(\) => conversation\.close\(\)\)/);
  assert.match(source, /button\.dataset\.close === "conversation-dialog"\) conversation\.close\(\)/);
  assert.match(html, /This is Anointed Money Group’s communications number\. You can reply here to reach our team\. Reply STOP to opt out\./);
  assert.doesNotMatch(source, /setInterval\([^)]*conversation/);
});
