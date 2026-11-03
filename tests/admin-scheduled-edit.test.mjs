import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const admin = fs.readFileSync(new URL("../src/admin.mjs", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../admin/index.html", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../netlify/functions/admin-crm.mts", import.meta.url), "utf8");
const sql = fs.readFileSync(new URL("../database/migrations/20261103031632_scheduled_message_edit_conflicts.sql", import.meta.url), "utf8");

test("calendar entries open the correct one-time message or recurring series editor", () => {
  assert.match(admin, /data-edit-scheduled-message="\$\{message\.id\}"/);
  assert.match(admin, /data-edit-recurring-occurrence="\$\{message\.recurring_id\}"/);
  assert.match(admin, /editMessage\(button\.dataset\.editScheduledMessage\)/);
  assert.match(admin, /editRecurring\(button\.dataset\.editRecurringOccurrence\)/);
  assert.match(admin, /Inactive series/);
  assert.match(admin, /\["draft", "scheduled"\]\.includes\(message\.status\)/);
});

test("schedule changes require an explicit reusable confirmation and cancellation has no save action", () => {
  assert.match(html, /id="schedule-save-dialog"[\s\S]*Save this schedule\?[\s\S]*id="confirm-schedule-save"/);
  assert.match(admin, /openScheduleSaveConfirmation\("message"\)/);
  assert.match(admin, /openScheduleSaveConfirmation\("recurring"\)/);
  assert.match(admin, /if \(!kind \|\| state\.messageBusy \|\| state\.recurringBusy\) return/);
  assert.match(admin, /submitter\.disabled = true/);
  assert.match(admin, /if \(saved\) \$\("#schedule-save-dialog"\)\.close\(\)/);
  assert.doesNotMatch(html.match(/data-close="schedule-save-dialog">Cancel[\s\S]*?<\/button>/)?.[0] || "", /submit/);
});

test("scheduled message saves are admin-only, versioned, and cannot alter in-flight delivery", () => {
  assert.match(sql, /PERFORM amg_private\.require_crm_admin\(\)/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /current_status NOT IN \('draft','scheduled'\)/);
  assert.match(sql, /current_version IS DISTINCT FROM p_expected_updated_at/);
  assert.match(sql, /ERRCODE='40001'/);
  assert.match(sql, /crm_message_edit_version BEFORE UPDATE/);
  assert.match(sql, /m\.updated_at/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.amg_crm_save_message_versioned[\s\S]*FROM PUBLIC, anon/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.amg_crm_save_message_versioned[\s\S]*TO authenticated/);
  assert.match(sql, /consent_status='opted_in'/);
  assert.match(api, /amg_crm_save_message_versioned/);
  assert.match(api, /p_expected_updated_at: typeof input\.expectedUpdatedAt === "string" \? input\.expectedUpdatedAt : null/);
  assert.match(admin, /expectedUpdatedAt: state\.messageEditSnapshot\?\.updated_at \|\| null/);
});

test("sidebar group browsing is separate from composing a message", () => {
  assert.match(html, /id="group-members-dialog"[\s\S]*id="group-new-message"[\s\S]*New Message/);
  assert.match(admin, /data-view-group="\$\{group\.id\}"/);
  assert.match(admin, /openGroupMembers\(button\.dataset\.viewGroup\)/);
  assert.doesNotMatch(admin.match(/function renderGroups\(\)[\s\S]*?\n}/)?.[0] || "", /openComposer/);
  assert.match(admin, /state\.contacts\.filter\(\(contact\) => contact\.group_ids\?\.includes\(id\)\)/);
  assert.match(admin, /openComposer\("group", id, null, id\)/);
  assert.match(admin, /contactsForGroupContext\(state\.contacts, state\.composerGroupId\)/);
});
