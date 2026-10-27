import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { defaultScheduleValue, eligibleTarget, filterContacts, localDayKey, recurringCalendarEntries, weekCells, weekRangeLabel, zonedDateTimeToUtc } from "../admin/core.mjs";
import { verifyQuoTransport } from "../netlify/functions/_shared/quo.mjs";

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
