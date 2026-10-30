import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { defaultScheduleValue, eligibleTarget, filterContacts, localDayKey, recurringCalendarEntries, weekCells, weekRangeLabel, zonedDateTimeToUtc } from "../admin/core.mjs";
import { verifyQuoTransport } from "../netlify/functions/_shared/quo.mjs";
import { isOptOutKeyword, outboundContent, personalizeOutbound, withFirstContactOptOut } from "../integrations/message-content.mjs";
import { verifyStorageConnection } from "../netlify/functions/_shared/storage.mjs";

test("storage readiness succeeds, fails closed, and times out without leaking details", async () => {
  assert.equal(await verifyStorageConnection(async () => ({ rows: [{ one: 1 }] }), 20), true);
  assert.equal(await verifyStorageConnection(async () => { throw new Error("secret connection detail"); }, 20), false);
  assert.equal(await verifyStorageConnection(() => new Promise(() => {}), 5), false);
});

test("calendar renders one stable Sunday-through-Saturday week", () => {
  const cells = weekCells(new Date(2026, 9, 27));
  assert.equal(cells.length, 7);
  assert.equal(cells[0].getDay(), 0);
  assert.equal(localDayKey(cells[0]), "2026-10-25");
  assert.equal(localDayKey(cells[6]), "2026-10-31");
  assert.equal(weekRangeLabel(cells), "Oct 25–Oct 31, 2026");
});

test("schedule defaults one hour ahead on a quarter hour", () => {
  const value = defaultScheduleValue(new Date(2026, 9, 27, 10, 7));
  assert.equal(value, "2026-10-27T11:15");
});

test("contact filtering checks names and phone numbers", () => {
  const contacts = [
    { full_name: "Ada Carter", phone: "+12025550123" },
    { full_name: "Zoe Blake", phone: "+14105550199" },
  ];
  assert.deepEqual(filterContacts(contacts, "car"), [contacts[0]]);
  assert.deepEqual(filterContacts(contacts, "410"), [contacts[1]]);
  const phoneOnly = { full_name: null, phone: "+13015550111" };
  assert.deepEqual(filterContacts([phoneOnly], "301"), [phoneOnly]);
});

test("outbound copy personalizes safely and uses a general phone-only greeting", () => {
  assert.equal(
    personalizeOutbound("Good morning, AMG! It’s time for Book Club.", "  Safinat Jones  "),
    "Good morning, Safinat! It’s time for Book Club.",
  );
  assert.equal(personalizeOutbound("Tonight’s call starts at 8.", "Simisola Ade"), "Hi Simisola,\n\nTonight’s call starts at 8.");
  assert.equal(personalizeOutbound("Tonight’s call starts at 8.", "   "), "Hello,\n\nTonight’s call starts at 8.");
  assert.equal(personalizeOutbound("Hi Zamilah! Already personal.", "Zamilah Jones"), "Hi Zamilah! Already personal.");
  assert.doesNotMatch(personalizeOutbound("Reminder", undefined), /undefined|null/i);
});

test("first-contact notice is included once in composed content and length is enforced", () => {
  assert.equal(withFirstContactOptOut("Hello,\n\nWelcome.", true), "Hello,\n\nWelcome.\n\nReply STOP to opt out.");
  assert.equal(withFirstContactOptOut("Welcome. Reply STOP to opt out.", true), "Welcome. Reply STOP to opt out.");
  assert.equal(withFirstContactOptOut("Welcome.", false), "Welcome.");
  assert.throws(() => outboundContent("x".repeat(1590), "Safinat", true), /exceeds 1600/);
  for (const keyword of ["STOP", " stop ", "StopAll", "UNSUBSCRIBE", "cancel", "END", "quit"]) {
    assert.equal(isOptOutKeyword(keyword), true);
  }
  assert.equal(isOptOutKeyword("please stop by"), false);
});

test("only opted-in individuals or groups with opted-in members are eligible", () => {
  const contacts = [
    { id: "a", consent_status: "opted_in", group_ids: ["g"] },
    { id: "b", consent_status: "opted_out", group_ids: ["g"] },
  ];
  assert.equal(eligibleTarget("individual", contacts[0], contacts), true);
  assert.equal(eligibleTarget("individual", contacts[1], contacts), false);
  assert.equal(eligibleTarget("group", { id: "g" }, contacts), true);
  assert.equal(eligibleTarget("group", { id: "empty" }, contacts), false);
});

test("Quo validation is read-only and only verifies the approved sender identity", async () => {
  let request;
  const result = await verifyQuoTransport({
    apiKey: "test-key", fromNumber: "+13017602910", phoneNumberId: "PNqGQouhRT", enabled: false,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ data: [{ id: "PNqGQouhRT", number: "+13017602910" }] }) };
    },
  });
  assert.equal(request.url, "https://api.quo.com/v1/phone-numbers");
  assert.equal(request.options.method, "GET");
  assert.deepEqual(result, { provider: "Quo", configured: true, verified: true, enabled: false });
  const mismatch = await verifyQuoTransport({
    apiKey: "test-key", fromNumber: "+13017602910", phoneNumberId: "PN-other",
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ id: "PNqGQouhRT", number: "+13017602910" }] }) }),
  });
  assert.equal(mismatch.verified, false);
  assert.equal(mismatch.enabled, false);
});

test("recurring reminders stay at 9 AM New York across daylight saving time", () => {
  assert.equal(
    zonedDateTimeToUtc("2026-03-06", "09:00", "America/New_York").toISOString(),
    "2026-03-06T14:00:00.000Z",
  );
  assert.equal(
    zonedDateTimeToUtc("2026-03-10", "09:00", "America/New_York").toISOString(),
    "2026-03-10T13:00:00.000Z",
  );
});

test("recurring calendar entries include only configured weekdays", () => {
  const dates = [
    new Date(2026, 9, 26), new Date(2026, 9, 27), new Date(2026, 9, 28),
    new Date(2026, 9, 29), new Date(2026, 9, 30), new Date(2026, 9, 31),
  ];
  const entries = recurringCalendarEntries({
    name: "AMG Book Club", body: "Reminder", weekdays: [2, 3, 4, 5],
    local_time: "09:00:00", timezone: "America/New_York", start_date: "2026-10-01", status: "draft",
  }, dates);
  assert.deepEqual(entries.map((entry) => entry.dateKey), [
    "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30",
  ]);
  assert.equal(new Set(entries.map((entry) => entry.dateKey)).size, entries.length);
  assert.equal(entries[0].displayTime, "9:00 AM ET");
  const evening = recurringCalendarEntries({
    name: "BOM Saturday Reminder", body: "Reminder", weekdays: [5],
    local_time: "21:00:00", timezone: "America/New_York", start_date: "2026-10-01", status: "draft",
  }, dates);
  assert.equal(evening[0].displayTime, "9:00 PM ET");
});

test("migration creates requested groups and duplicate-send guardrails", () => {
  const sql = fs.readFileSync(new URL("../database/migrations/20261027183000_create_admin_sms_crm.sql", import.meta.url), "utf8");
  for (const group of ["Marketing Directors", "AMG Hierarchy", "AMG Baseshop"]) assert.match(sql, new RegExp(group));
  assert.match(sql, /idempotency_key UUID NOT NULL UNIQUE/);
  assert.match(sql, /consent_status IN \('pending', 'opted_in', 'opted_out'\)/);
});

test("CRM migration stays isolated from existing app tables and roles", () => {
  const sql = fs.readFileSync(new URL("../database/migrations/20261027183000_create_admin_sms_crm.sql", import.meta.url), "utf8");
  assert.match(sql, /amg_private\.crm_contacts/);
  assert.match(sql, /amg_private\.crm_admins/);
  assert.match(sql, /amg_private\.require_crm_admin/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.amg_app_/i);
  assert.doesNotMatch(sql, /UPDATE public\.amg_app_/i);
  assert.doesNotMatch(sql, /ALTER\s+.*auth\./i);
  assert.doesNotMatch(sql, /UPDATE\s+auth\./i);
});

test("recurring migration seeds inactive drafts and prevents duplicate occurrences", () => {
  const sql = fs.readFileSync(new URL("../database/migrations/20261027230000_add_recurring_reminders.sql", import.meta.url), "utf8");
  assert.match(sql, /'AMG Book Club'/);
  assert.match(sql, /ARRAY\[2,3,4,5\]::SMALLINT\[\]/);
  assert.match(sql, /'BOM Thursday Reminder'/);
  assert.match(sql, /TIME '11:00'/);
  assert.match(sql, /'BOM Saturday Reminder'/);
  assert.match(sql, /TIME '21:00'/);
  assert.match(sql, /UNIQUE \(reminder_id, occurrence_local_date\)/);
  assert.match(sql, /'draft'/);
  assert.doesNotMatch(sql, /AMG_QUO_SEND_ENABLED\s*=\s*true/i);
  const requirements = fs.readFileSync(new URL("../database/migrations/20261027233000_recurring_reminder_requirements.sql", import.meta.url), "utf8");
  assert.match(requirements, /meeting_url_required = TRUE[\s\S]*AMG Book Club/);
  assert.match(requirements, /NOT meeting_url_required OR zoom_url IS NOT NULL/);
});

test("dispatch control is fail-closed, admin-only, audited, and concurrency-safe", () => {
  const sql = fs.readFileSync(new URL("../database/migrations/20261028010000_add_dispatch_control.sql", import.meta.url), "utf8");
  assert.match(sql, /enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(sql, /PERFORM amg_private\.require_crm_admin\(\)/);
  assert.match(sql, /current_version <> p_expected_version/);
  assert.match(sql, /WHERE singleton = TRUE AND version=current_version/);
  assert.match(sql, /INSERT INTO amg_private\.crm_dispatch_audit/);
  assert.match(sql, /REVOKE ALL ON amg_private\.crm_dispatch_control, amg_private\.crm_dispatch_audit/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.amg_crm_set_dispatch_enabled\(BOOLEAN,BIGINT\) TO authenticated/);
  assert.doesNotMatch(sql, /amg_private\.(?:notification|cft_|push_|role_|ai_)/);
});

test("dispatch implementation rechecks the global switch before every recipient", () => {
  const source = fs.readFileSync(new URL("../integrations/quo-dispatch.mts", import.meta.url), "utf8");
  assert.match(source, /AMG_QUO_EMERGENCY_DISABLE/);
  assert.match(source, /SELECT enabled FROM amg_private\.crm_dispatch_control/);
  assert.ok((source.match(/!await dispatchEnabled/g) || []).length >= 2);
  assert.match(source, /consent_status !== "opted_in"/);
  assert.match(source, /providerOptOut/);
  assert.match(source, /first_outbound_accepted_at=COALESCE/);
  assert.match(source, /Promise\.allSettled\(deliveries\.map/);
  const handler = fs.readFileSync(new URL("../netlify/functions/admin-crm.mts", import.meta.url), "utf8");
  assert.match(handler, /input\.action === "set_dispatch_enabled"/);
  assert.match(handler, /if \(!verified\.verified\)/);
  assert.match(handler, /if \(!await verifyCrmStorage\(\)\)/);
  assert.match(handler, /storage_verified: await verifyCrmStorage\(\)/);
  assert.match(handler, /p_expected_version: expectedVersion/);
  assert.match(handler, /error\.code === "40001"[\s\S]*status: 409/);
  assert.match(handler, /\[401, 403, 409, 503\]/);
  const html = fs.readFileSync(new URL("../admin/index.html", import.meta.url), "utf8");
  assert.match(html, /Eligible scheduled messages may send when a dispatcher is running/);
  assert.match(html, /Incomplete reminders remain blocked/);
  const adminSource = fs.readFileSync(new URL("../src/admin.mjs", import.meta.url), "utf8");
  assert.match(adminSource, /!state\.storage_verified/);
  assert.match(adminSource, /scheduler storage is unavailable/i);
});

test("scheduled worker is serialized, bounded, and refuses stale backlogs", () => {
  const source = fs.readFileSync(new URL("../integrations/quo-dispatch.mts", import.meta.url), "utf8");
  const scheduler = fs.readFileSync(new URL("../netlify/functions/admin-crm-scheduler.mts", import.meta.url), "utf8");
  assert.match(scheduler, /schedule: "\* \* \* \* \*"/);
  assert.match(source, /pg_try_advisory_lock\(730301\)/);
  assert.match(source, /CLAIM_BATCH_SIZE = 10/);
  assert.match(source, /scheduled_for < NOW\(\) - INTERVAL '10 minutes'/);
  assert.match(source, /updated_at < NOW\(\) - INTERVAL '15 minutes'/);
  assert.match(source, /provider outcome remains uncertain and was not retried/);
  assert.match(source, /CRM sending is off; no reminders were materialized/);
  assert.ok((source.match(/!await dispatchEnabled/g) || []).length >= 3);
  assert.match(source, /status IN \('scheduled','sending'\) AND scheduled_for < NOW\(\) - INTERVAL '10 minutes'/);
  assert.match(source, /AbortSignal\.timeout\(PROVIDER_TIMEOUT_MS\)/);
  assert.match(source, /Promise\.allSettled\(deliveries\.map/);
});

test("recurring scheduler migration is DST-aware, idempotent, private, and fail-closed", () => {
  const sql = fs.readFileSync(new URL("../database/migrations/20261030130000_add_safe_recurring_scheduler.sql", import.meta.url), "utf8");
  assert.match(sql, /AT TIME ZONE reminder\.timezone/);
  assert.match(sql, /ON CONFLICT \(reminder_id,occurrence_local_date\) DO NOTHING/);
  assert.match(sql, /Missed the 10-minute safe dispatch window; no backlog was sent/);
  assert.match(sql, /eligible_count NOT BETWEEN 1 AND 100/);
  assert.match(sql, /reminder\.meeting_url_required AND reminder\.zoom_url IS NULL/);
  assert.match(sql, /REVOKE ALL ON FUNCTION amg_private\.materialize_due_recurring\(TIMESTAMPTZ\)/);
  assert.match(sql, /PERFORM amg_private\.require_crm_admin\(\)/);
  assert.match(sql, /Recurring reminder changed; refresh and try again/);
  assert.match(sql, /FOR UPDATE OF rr/);
  assert.doesNotMatch(sql, /UPDATE\s+auth\.|ALTER\s+.*auth\./i);
  assert.doesNotMatch(sql, /UPDATE\s+amg_private\.crm_dispatch_control\s+SET\s+enabled\s*=\s*TRUE/i);
});

test("admin readiness controls keep activation separate from global sending", () => {
  const source = fs.readFileSync(new URL("../src/admin.mjs", import.meta.url), "utf8");
  const handler = fs.readFileSync(new URL("../netlify/functions/admin-crm.mts", import.meta.url), "utf8");
  assert.match(source, /Occurrences can send only when the separate global sending switch is also on/);
  assert.match(source, /Complete the missing readiness items first/);
  assert.match(source, /state\.recurringStatusBusy/);
  assert.match(handler, /input\.action === "set_recurring_status"/);
  assert.match(handler, /p_expected_updated_at: expectedUpdatedAtRaw/);
  assert.doesNotMatch(handler, /p_expected_updated_at: expectedUpdatedAt\.toISOString\(\)/);
});

test("optional names and provider opt-outs are isolated to website CRM", () => {
  const sql = fs.readFileSync(new URL("../database/migrations/20261028020000_contact_opt_out_and_optional_name.sql", import.meta.url), "utf8");
  assert.match(sql, /ALTER COLUMN full_name DROP NOT NULL/);
  assert.match(sql, /first_outbound_accepted_at TIMESTAMPTZ/);
  assert.match(sql, /opted_out_at TIMESTAMPTZ/);
  assert.match(sql, /COALESCE\(full_name, phone\)/);
  assert.match(sql, /normalized_name TEXT := nullif\(btrim\(p_full_name\), ''\)/);
  assert.doesNotMatch(sql, /amg_private\.(?:notification|cft_|push_|role_|ai_)/);
  assert.doesNotMatch(sql, /ALTER\s+.*auth\./i);
});
