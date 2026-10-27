import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { calendarCells, defaultScheduleValue, eligibleTarget, filterContacts, localDayKey } from "../admin/core.mjs";

test("calendar renders a stable six-week grid starting on Sunday", () => {
  const cells = calendarCells(new Date(2026, 9, 1));
  assert.equal(cells.length, 42);
  assert.equal(cells[0].getDay(), 0);
  assert.equal(localDayKey(cells[0]), "2026-09-27");
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
