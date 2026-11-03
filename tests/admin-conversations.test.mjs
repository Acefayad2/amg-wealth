import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "esbuild";
import { listContactMessages } from "../netlify/functions/_shared/conversations.mjs";
import { FIRST_CONTACT_IDENTITY, withFirstContactOptOut, outboundContent } from "../integrations/message-content.mjs";

const participant = "+12025550123";
const fromNumber = "+12025550100";
const phoneNumberId = "PNsynthetic";
const contactId = "11111111-1111-4111-8111-111111111111";
const options = { apiKey: "synthetic-test-key", fromNumber, phoneNumberId, participant };
const incoming = { id: "in-1", phoneNumberId, from: participant, to: [fromNumber], direction: "incoming", text: "Thanks!", status: "received", createdAt: "2026-11-03T07:00:00Z" };
const outgoing = { id: "out-1", phoneNumberId, from: fromNumber, to: [participant], direction: "outgoing", text: "Welcome!", status: "delivered", createdAt: "2026-11-03T06:00:00Z" };
const reply = (data, nextPageToken = null) => new Response(JSON.stringify({ data, nextPageToken }));

test("first accepted text identifies AMG, allows replies, and supplies STOP without creating a second send", () => {
  const body = "Hello, welcome to the team.";
  const composed = withFirstContactOptOut(body, true);
  assert.equal(composed, `${body}\n\n${FIRST_CONTACT_IDENTITY}\n\nReply STOP to opt out.`);
  assert.equal(withFirstContactOptOut(composed, true), composed);
  assert.equal(withFirstContactOptOut(body, false), body);
  const alreadyHasStop = withFirstContactOptOut("Welcome. Reply STOP to unsubscribe.", true);
  assert.equal((alreadyHasStop.match(/Reply STOP/g) || []).length, 1);
  assert.match(alreadyHasStop, /Anointed Money Group/);
  assert.throws(() => outboundContent("x".repeat(1500), "", true), /exceeds 1600/);
  const dispatch = fs.readFileSync(new URL("../integrations/quo-dispatch.mts", import.meta.url), "utf8");
  assert.match(dispatch, /noticeRequired = !consent\.rows\[0\]\.first_outbound_accepted_at/);
  assert.match(dispatch, /await markAccepted\(item, payload\.data\.id, noticeRequired, pool\)/);
  assert.equal((dispatch.match(/method: "POST"/g) || []).length, 1);
});

test("history uses GET on the fixed provider with one server-resolved participant and opaque pagination", async () => {
  const result = await listContactMessages({ ...options, pageToken: "opaque+/=&page", fetchImpl: async (url, init) => {
    assert.equal(url.origin, "https://api.quo.com");
    assert.equal(url.pathname, "/v1/messages");
    assert.deepEqual(url.searchParams.getAll("participants"), [participant]);
    assert.equal(url.searchParams.has("participants[]"), false);
    assert.equal(url.searchParams.get("phoneNumberId"), phoneNumberId);
    assert.equal(url.searchParams.get("maxResults"), "100");
    assert.equal(url.searchParams.get("pageToken"), "opaque+/=&page");
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    return reply([incoming, outgoing], "older");
  }});
  assert.deepEqual(result.messages.map((item) => [item.id, item.direction]), [["out-1", "outgoing"], ["in-1", "incoming"]]);
  assert.equal(result.next_page_token, "older");
  assert.ok(Number.isFinite(Date.parse(result.loaded_at)));
});

test("history excludes other numbers, group messages, malformed dates, and duplicate IDs", async () => {
  const result = await listContactMessages({ ...options, fetchImpl: async () => reply([
    outgoing, incoming, incoming,
    { ...incoming, id: "foreign", from: "+12025550199" },
    { ...incoming, id: "other-line", phoneNumberId: "PNother" },
    { ...incoming, id: "group", to: [fromNumber, "+12025550198"] },
    { ...outgoing, id: "wrong-recipient", to: ["+12025550199"] },
    { ...incoming, id: "bad-time", createdAt: "unknown" },
    { ...incoming, id: "bad-direction", direction: "outgoing" },
    null,
  ]) });
  assert.deepEqual(result.messages.map((item) => item.id), ["out-1", "in-1"]);
  assert.equal(JSON.stringify(result).includes("synthetic-test-key"), false);
});

test("message text is data and media URLs or other provider fields never reach the client", async () => {
  const result = await listContactMessages({ ...options, fetchImpl: async () => reply([{ ...incoming,
    text: '<img src=x onerror="alert(1)">', media: [{ url: "https://private.example/secret", type: "image/png" }],
    userId: "provider-private-user", extra: "not-allowed",
  }]) });
  assert.equal(result.messages[0].text, '<img src=x onerror="alert(1)">');
  assert.equal(result.messages[0].has_media, true);
  assert.equal(JSON.stringify(result).includes("private.example"), false);
  assert.equal(JSON.stringify(result).includes("provider-private-user"), false);
});

test("provider failures fail closed without exposing provider secrets or claiming empty history", async () => {
  for (const fetchImpl of [
    async () => { throw new Error("sensitive connection detail"); },
    async () => new Response("sensitive rejected key", { status: 403 }),
    async () => new Response("not-json"),
    async () => reply(null),
    async () => reply([], 42),
    async () => reply([], "repeat"),
  ]) {
    await assert.rejects(listContactMessages({ ...options, pageToken: "repeat", fetchImpl }), (error) => {
      assert.equal(error.status, 503);
      assert.doesNotMatch(error.message, /sensitive/);
      return true;
    });
  }
});

test("invalid contact, missing service, and invalid tokens fail before any network request", async () => {
  let requests = 0;
  const fetchImpl = async () => { requests += 1; return reply([]); };
  for (const change of [{ apiKey: "" }, { fromNumber: "invalid" }, { phoneNumberId: "" }, { participant: "https://attacker.test" }, { participant: fromNumber }, { pageToken: "x".repeat(2049) }, { pageToken: "bad\nvalue" }]) {
    await assert.rejects(listContactMessages({ ...options, ...change, fetchImpl }));
  }
  assert.equal(requests, 0);
});

// Bundle the real handler with only auth/storage/send dependencies mocked. No
// credentials, database connection, SMS, or external network are used.
const output = await build({ entryPoints: [new URL("../netlify/functions/admin-crm.mts", import.meta.url).pathname],
  bundle: true, write: false, format: "esm", platform: "node", plugins: [{ name: "synthetic-only", setup(build) {
    build.onLoad({ filter: /[/\\]_shared[/\\]supabase\.mts$/ }, () => ({ contents: `export async function getAuthenticatedUser(req) { return globalThis.__amgConversationAuth(req); }`, loader: "js" }));
    build.onLoad({ filter: /[/\\]_shared[/\\]db\.mts$/ }, () => ({ contents: `export async function verifyCrmStorage() { throw new Error("Unexpected storage call"); }`, loader: "js" }));
    build.onLoad({ filter: /[/\\]quo-dispatch\.mts$/ }, () => ({ contents: `export async function sendImmediateMessage() { throw new Error("Unexpected SMS call"); }`, loader: "js" }));
  }}] });
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);

test("conversation endpoint authenticates and verifies CRM admin RPC before touching the provider", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Provider must not be reached"); };
  try {
    globalThis.__amgConversationAuth = async () => { throw Object.assign(new Error("Sign in required."), { status: 401 }); };
    let response = await handler(new Request(`https://amg.example/api/admin/crm?conversationContactId=${contactId}`), {});
    assert.equal(response.status, 401);
    globalThis.__amgConversationAuth = async () => ({ user: { id: "actor" }, client: { rpc: async (name) => {
      assert.equal(name, "amg_crm_get_state"); return { data: null, error: { code: "42501" } };
    }} });
    response = await handler(new Request(`https://amg.example/api/admin/crm?conversationContactId=${contactId}`), {});
    assert.equal(response.status, 403);
  } finally { globalThis.fetch = oldFetch; delete globalThis.__amgConversationAuth; }
});

test("conversation endpoint resolves phone from authorized CRM state, ignores supplied phones, and performs no mutation", async () => {
  const oldFetch = globalThis.fetch;
  const oldNetlify = globalThis.Netlify;
  const rpcCalls = [];
  let requests = 0;
  globalThis.__amgConversationAuth = async () => ({ user: { id: "actor" }, client: { rpc: async (name) => {
    rpcCalls.push(name); return { data: { contacts: [{ id: contactId, phone: participant, consent_status: "pending" }] }, error: null };
  }} });
  globalThis.Netlify = { env: { get: (key) => ({ QUO_API_KEY: options.apiKey, QUO_FROM_NUMBER: fromNumber, QUO_PHONE_NUMBER_ID: phoneNumberId })[key] } };
  globalThis.fetch = async (url, init) => { requests += 1; assert.equal(url.searchParams.get("participants"), participant); assert.equal(init.method, "GET"); return reply([incoming]); };
  try {
    const response = await handler(new Request(`https://amg.example/api/admin/crm?conversationContactId=${contactId}&phone=%2B12025550199`), {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const payload = await response.json();
    assert.equal(payload.contact_id, contactId);
    assert.equal(payload.contact_phone, participant);
    assert.equal(payload.messages[0].text, "Thanks!");
    assert.deepEqual(rpcCalls, ["amg_crm_get_state"]);
    assert.equal(requests, 1);
    const missing = await handler(new Request("https://amg.example/api/admin/crm?conversationContactId=22222222-2222-4222-8222-222222222222"), {});
    assert.equal(missing.status, 404);
    const invalid = await handler(new Request("https://amg.example/api/admin/crm?conversationContactId=not-a-contact"), {});
    assert.equal(invalid.status, 400);
    assert.equal(requests, 1);
  } finally { globalThis.fetch = oldFetch; globalThis.Netlify = oldNetlify; delete globalThis.__amgConversationAuth; }
});

test("replies guard the viewed phone against concurrent contact changes and keep existing dispatch safeguards", () => {
  const handlerSource = fs.readFileSync(new URL("../netlify/functions/admin-crm.mts", import.meta.url), "utf8");
  const dispatch = fs.readFileSync(new URL("../integrations/quo-dispatch.mts", import.meta.url), "utf8");
  assert.match(handlerSource, /expectedPhone !== undefined && !E164\.test\(expectedPhone\)/);
  assert.match(dispatch, /AND \(\$2::text IS NULL OR phone=\$2\)[\s\S]*FOR SHARE/);
  assert.match(dispatch, /input\.expectedPhone \?\? null/);
  assert.match(dispatch, /consent\.rows\[0\]\?\.consent_status !== "opted_in"/);
  assert.match(dispatch, /await providerOptOut\(apiKey, phoneNumberId, item\.phone_snapshot\)/);
  assert.match(dispatch, /idempotency_key/);
});
