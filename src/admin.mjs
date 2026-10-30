import { createClient } from "@supabase/supabase-js";
import { STATUS_LABELS, defaultScheduleValue, eligibleTarget, filterContacts, localDayKey, recurringCalendarEntries, weekCells, weekRangeLabel } from "../admin/core.mjs";

const $ = (selector) => document.querySelector(selector);
const state = { contacts: [], groups: [], messages: [], recurring_reminders: [], scheduler_events: [], admin_invitations: [], dispatch_control: { enabled: false, version: 1, audit: [] }, storage_verified: false, transport: {}, week: new Date(), search: "", draftId: null, messageRequestKey: null, messageBusy: false, contactBusy: false, recurringDraftId: null, recurringRequestKey: null, recurringBusy: false, recurringStatusBusy: false, dispatchBusy: false, adminInviteBusy: false };
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
let authClient = null;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const initials = (name) => String(name || "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
const contactLabel = (contact) => contact.full_name || contact.phone;
const formatTime = (value) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
const formatDateTime = (value) => value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not scheduled";

async function api(body) {
  const { data: sessionData } = await authClient.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Sign in required.");
  const response = await fetch("/api/admin/crm", {
    method: body ? "POST" : "GET",
    headers: { ...(body ? { "content-type": "application/json" } : {}), authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The CRM request failed.");
  return payload;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2800);
}

async function load() {
  const payload = await api();
  Object.assign(state, payload);
  render();
}

function render() {
  renderAdminInvitations();
  renderGroups();
  renderContacts();
  renderRecurring();
  renderCalendar();
  renderMessages();
  renderStats();
  const { configured, verified, enabled } = state.transport;
  const banner = $("#transport-banner");
  banner.classList.toggle("ready", configured && state.storage_verified && enabled);
  banner.textContent = !configured
    ? "Quo sending is locked: add the approved API key and AMG sender number before enabling dispatch. Drafts and schedules remain visible, but no texts will send."
    : !verified
      ? "Quo credentials are stored, but the approved AMG sender could not be verified. Dispatch remains disabled."
    : !state.storage_verified
      ? "Quo is connected, but scheduler storage is unavailable. Sending is locked until the server-only database connection is verified."
    : !enabled
      ? "Quo is connected to the approved AMG sender, but dispatch is intentionally disabled. Contacts, consent, audience, and each activation still require approval."
      : "Quo dispatch is enabled. Only opted-in contacts can receive immediate or scheduled texts, and opt-outs are checked again before every send.";
  renderDispatchControl();
}

function renderAdminInvitations() {
  const invitations = state.admin_invitations || [];
  $("#admin-invitations").innerHTML = invitations.length ? invitations.map((invitation) => `
    <article class="message-row">
      <div class="message-copy"><strong>${escapeHtml(invitation.phone)}</strong><span>${escapeHtml(invitation.status === "accepted" ? `Admin access accepted${invitation.chosen_email ? ` · ${invitation.chosen_email}` : ""}` : invitation.status === "sent" ? "Private setup text accepted by Quo" : invitation.status === "phone_verified" ? "Phone verified · email verification pending" : invitation.status === "uncertain" ? "Provider outcome uncertain — do not retry" : invitation.status === "expired" ? "Expired — a new invitation is required" : invitation.status)}</span></div>
      <span class="message-meta">${escapeHtml(invitation.accepted_at ? formatDateTime(invitation.accepted_at) : invitation.expires_at ? `Expires ${formatDateTime(invitation.expires_at)}` : formatDateTime(invitation.created_at))}</span>
    </article>`).join("") : '<p class="empty">No admin invitations have been prepared.</p>';
}

async function createAdminInvitation(event) {
  event.preventDefault();
  if (state.adminInviteBusy) return;
  const phone = $("#admin-invite-phone").value.trim();
  const submit = $("#admin-invite-submit");
  const error = $("#admin-invite-error");
  error.textContent = "";
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) {
    error.textContent = "Enter the approved phone in E.164 format, such as +12025550123.";
    error.focus();
    return;
  }
  if (!window.confirm(`Send one private, single-use AMG admin setup link to ${phone}? The recipient must separately verify this phone and their chosen email before access is granted.`)) return;
  state.adminInviteBusy = true;
  submit.disabled = true;
  try {
    const result = await api({ action: "create_admin_invitation", phone });
    $("#admin-invite-form").reset();
    await load();
    toast(result.already_pending ? "A valid invitation is already pending for that phone." : "Private setup text accepted by Quo.");
  } catch (reason) {
    error.textContent = reason.message;
    error.focus();
  } finally {
    state.adminInviteBusy = false;
    submit.disabled = false;
  }
}

function renderDispatchControl() {
  const control = state.dispatch_control || { enabled: false, version: 1, audit: [] };
  const card = $(".transport-control");
  const effectiveEnabled = Boolean(control.enabled && state.transport?.enabled);
  card.classList.toggle("enabled", effectiveEnabled);
  $("#sending-control-title").textContent = effectiveEnabled ? "Sending enabled" : "Sending disabled";
  $("#sending-control-detail").textContent = control.enabled && state.transport?.emergency_disabled
    ? "The portal switch is on, but the emergency lock is blocking delivery."
    : control.enabled && !state.storage_verified
      ? "The portal switch is on, but scheduler storage is unavailable. Delivery remains blocked."
    : control.enabled && !state.transport?.verified
      ? "The portal switch is on, but the approved Quo sender is not verified. Delivery remains blocked."
      : effectiveEnabled
        ? "Send now and eligible scheduled messages may dispatch. Opt-outs are checked again before every recipient."
        : "The global CRM delivery switch is off. Immediate and scheduled messages cannot dispatch.";
  const latest = control.audit?.[0];
  $("#sending-control-audit").textContent = latest
    ? `Last ${latest.new_enabled ? "enabled" : "disabled"} by ${latest.changed_by || "an AMG CRM admin"} · ${formatDateTime(latest.changed_at)}`
    : "No sending-control changes have been recorded.";
  const button = $("#toggle-sending");
  button.textContent = control.enabled ? "Disable sending" : "Enable sending";
  button.disabled = state.dispatchBusy || (!control.enabled && (!state.storage_verified || !state.transport?.verified || state.transport?.emergency_disabled));
}

async function setDispatchEnabled(enabled) {
  if (state.dispatchBusy) return;
  state.dispatchBusy = true;
  renderDispatchControl();
  const error = $("#enable-sending-error");
  error.textContent = "";
  try {
    await api({ action: "set_dispatch_enabled", enabled, expectedVersion: state.dispatch_control.version });
    if ($("#enable-sending-dialog").open) $("#enable-sending-dialog").close();
    await load();
    toast(enabled ? "Sending enabled." : "Sending disabled immediately.");
  } catch (reason) {
    error.textContent = reason.message;
    if (enabled) error.focus(); else toast(reason.message);
    await load().catch(() => {});
  } finally {
    state.dispatchBusy = false;
    renderDispatchControl();
  }
}

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function formatLocalTime(value) {
  if (!value) return "Time needed";
  const [hour, minute] = String(value).split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
    .format(new Date(Date.UTC(2026, 0, 1, hour, minute)));
}

function renderRecurring() {
  const reminders = state.recurring_reminders || [];
  $("#recurring-list").innerHTML = reminders.length ? reminders.map((reminder) => {
    const group = state.groups.find((item) => item.id === reminder.target_group_id);
    const lastEvent = (state.scheduler_events || []).find((item) => item.reminder_id === reminder.id);
    const missing = [
      !reminder.target_group_id && "recipient group",
      reminder.target_group_id && !(group?.eligible_count > 0) && "opted-in recipients",
      (group?.eligible_count || 0) > 100 && "an audience of 100 or fewer",
      !reminder.local_time && "send time",
      reminder.meeting_url_required && !reminder.zoom_url && "Zoom URL",
    ].filter(Boolean);
    const schedule = reminder.weekdays.map((day) => weekdayNames[day]).join(", ") + " · " + formatLocalTime(reminder.local_time) + " ET";
    const needs = missing.length ? "Needs " + missing.join(" and ") : reminder.status === "active" ? "Active schedule" : "Ready to activate";
    const statusLabel = reminder.status === "active" ? "Active" : reminder.status === "paused" ? "Paused" : "Inactive draft";
    const nextStatus = reminder.status === "active" ? "paused" : "active";
    const actionLabel = reminder.status === "active" ? "Pause" : "Activate";
    return '<article class="message-row">' +
      '<span class="status ' + escapeHtml(reminder.status) + '">' + statusLabel + '</span>' +
      '<div class="message-copy"><strong>' + escapeHtml(reminder.name) + '</strong><span>' + escapeHtml(schedule) + '</span><span class="needs-input">' + escapeHtml(needs) + '</span>' + (lastEvent?.failure_reason ? '<span class="needs-input">Last run: ' + escapeHtml(lastEvent.failure_reason) + '</span>' : '') + '</div>' +
      '<span class="message-meta">' + escapeHtml(reminder.target_group_name || "No audience selected") + '</span>' +
      '<span class="row-actions">' + (reminder.status === "active" ? '' : '<button class="secondary" data-edit-recurring="' + reminder.id + '">Edit</button>') +
      '<button class="secondary" data-recurring-status="' + reminder.id + '" data-next-status="' + nextStatus + '" ' + (nextStatus === "active" && missing.length ? 'disabled title="Complete the missing readiness items first."' : '') + '>' + actionLabel + '</button></span></article>';
  }).join("") : '<p class="empty">No recurring drafts yet.</p>';
  document.querySelectorAll("[data-edit-recurring]").forEach((button) =>
    button.addEventListener("click", () => editRecurring(button.dataset.editRecurring)));
  document.querySelectorAll("[data-recurring-status]").forEach((button) =>
    button.addEventListener("click", () => setRecurringStatus(button.dataset.recurringStatus, button.dataset.nextStatus)));
}

async function setRecurringStatus(id, status) {
  if (state.recurringStatusBusy) return;
  const reminder = (state.recurring_reminders || []).find((item) => item.id === id);
  if (!reminder) return;
  const activating = status === "active";
  if (!window.confirm(activating
    ? `Activate ${reminder.name}? Occurrences can send only when the separate global sending switch is also on.`
    : `Pause ${reminder.name}? Future occurrences will not be created.`)) return;
  state.recurringStatusBusy = true;
  try {
    await api({ action: "set_recurring_status", id, status, expectedUpdatedAt: reminder.updated_at });
    await load();
    toast(activating ? "Recurring reminder activated." : "Recurring reminder paused.");
  } catch (reason) {
    toast(reason.message);
  } finally {
    state.recurringStatusBusy = false;
  }
}

function renderGroups() {
  $("#groups").innerHTML = state.groups.map((group) => `
    <button class="group-button" data-compose-group="${group.id}">
      <span>${escapeHtml(group.name)}</span><small>${group.eligible_count}/${group.member_count}</small>
    </button>`).join("");
  document.querySelectorAll("[data-compose-group]").forEach((button) => button.addEventListener("click", () => openComposer("group", button.dataset.composeGroup)));
}

function renderContacts() {
  const contacts = filterContacts(state.contacts, state.search);
  $("#contact-count").textContent = state.contacts.length;
  $("#contacts").innerHTML = contacts.length ? contacts.map((contact) => `
    <button class="contact-button" data-contact="${contact.id}">
      <span class="avatar">${escapeHtml(initials(contact.full_name))}</span>
      <span class="contact-copy"><strong>${escapeHtml(contactLabel(contact))}</strong><small>${contact.full_name ? escapeHtml(contact.phone) : "Phone-only contact"}</small></span>
      <span class="consent-dot ${contact.consent_status}" title="${escapeHtml(contact.consent_status.replace("_", " "))}"></span>
    </button>`).join("") : `<p class="empty">${state.search ? "No contacts match." : "No contacts yet. Add only verified AMG contacts."}</p>`;
  document.querySelectorAll("[data-contact]").forEach((button) => button.addEventListener("click", () => openContact(button.dataset.contact)));
}

function renderCalendar() {
  const cells = weekCells(state.week);
  $("#week-title").textContent = weekRangeLabel(cells);
  const today = localDayKey(new Date());
  const grouped = state.messages.filter((message) => message.scheduled_for).reduce((days, message) => {
    const key = localDayKey(message.scheduled_for);
    (days[key] ||= []).push(message);
    return days;
  }, {});
  for (const reminder of state.recurring_reminders || []) {
    for (const occurrence of recurringCalendarEntries(reminder, cells)) {
      (grouped[occurrence.dateKey] ||= []).push({
        body: occurrence.body,
        status: "draft",
        target_name: occurrence.name,
        display_time: occurrence.displayTime,
        inactive_recurring: true,
      });
    }
  }
  $("#calendar").innerHTML = cells.map((date) => {
    const key = localDayKey(date);
    const messages = grouped[key] || [];
    const dayName = weekdayNames[date.getDay()];
    const dateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
    return `<button class="day${key === today ? " today" : ""}" data-day="${key}">
      <span class="day-number"><span class="day-weekday">${dayName}</span><span class="day-date">${escapeHtml(dateLabel)}</span></span>
      ${messages.map((message) => `<span class="calendar-message ${message.status}" title="${escapeHtml(message.body)}">${message.inactive_recurring ? '<strong>Inactive</strong> · ' : ''}${escapeHtml(message.display_time || formatTime(message.scheduled_for))} · ${escapeHtml(message.target_name)}</span>`).join("")}
    </button>`;
  }).join("");
  document.querySelectorAll("[data-day]").forEach((button) => button.addEventListener("click", () => openComposer("individual", null, button.dataset.day)));
}

function renderMessages() {
  const list = $("#message-list");
  list.innerHTML = state.messages.length ? state.messages.map((message) => `
    <article class="message-row">
      <span class="status ${message.status}">${escapeHtml(STATUS_LABELS[message.status] || message.status)}</span>
      <div class="message-copy"><strong>${escapeHtml(message.body)}</strong><span>${escapeHtml(message.target_name)} · ${message.recipient_count} recipient${message.recipient_count === 1 ? "" : "s"}</span>${message.failure_reason ? `<span class="needs-input">${escapeHtml(message.failure_reason)}</span>` : ""}</div>
      <span class="message-meta">${escapeHtml(formatDateTime(message.scheduled_for || message.created_at))}</span>
      ${message.status === "draft" ? `<button class="secondary" data-edit-message="${message.id}">Edit</button>` : ""}
    </article>`).join("") : `<p class="empty">No messages yet. Draft, send now, or schedule the first communication.</p>`;
  document.querySelectorAll("[data-edit-message]").forEach((button) => button.addEventListener("click", () => editMessage(button.dataset.editMessage)));
}

function renderStats() {
  for (const status of ["draft", "scheduled", "sent", "failed"]) {
    $(`#${status}-count`).textContent = state.messages.filter((message) => message.status === status).length;
  }
}

function targetOptions(type, selected) {
  const source = type === "individual" ? state.contacts : state.groups;
  $("#target-id").innerHTML = `<option value="">Select ${type === "individual" ? "a contact" : "a group"}</option>` + source.map((item) => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.full_name || item.name || item.phone)}</option>`).join("");
  updateRecipientNote();
}

function updateRecipientNote() {
  const type = $("#target-type").value;
  const id = $("#target-id").value;
  const target = (type === "individual" ? state.contacts : state.groups).find((item) => item.id === id);
  const eligible = eligibleTarget(type, target, state.contacts);
  const note = $("#recipient-note");
  note.classList.toggle("warning", target && !eligible);
  note.textContent = !target ? "Choose a recipient. Drafts can be saved before consent is verified."
    : type === "individual"
      ? eligible ? "Verified opt-in. Consent will be checked again before immediate or scheduled delivery." : `This contact is ${target.consent_status.replace("_", " ")} and cannot receive a text.`
      : eligible ? `${target.eligible_count} opted-in member${target.eligible_count === 1 ? "" : "s"} will receive separate messages.` : "This group has no opted-in members and cannot receive a text.";
  $("#schedule-message").disabled = Boolean(target && !eligible);
  const sendNow = $("#send-now");
  const immediateReady = Boolean(target && eligible && state.dispatch_control?.enabled && state.storage_verified &&
    state.transport?.verified && state.transport?.enabled && !state.transport?.emergency_disabled && !state.messageBusy);
  sendNow.disabled = !immediateReady;
  sendNow.title = immediateReady ? "Send immediately through the approved AMG Quo number."
    : !state.dispatch_control?.enabled ? "Enable the global sending control before using Send now."
      : "Choose an eligible opted-in recipient and verify the delivery connection.";
}

function openComposer(type = "individual", id = null, day = null) {
  state.draftId = null;
  state.messageRequestKey = crypto.randomUUID();
  $("#composer-form").reset();
  $("#target-type").value = type;
  $("#message-timezone").value = timezone;
  $("#scheduled-for").value = day ? `${day}T09:00` : defaultScheduleValue();
  $("#char-count").textContent = "0 / 1600";
  $("#composer-error").textContent = "";
  targetOptions(type, id);
  $("#composer").showModal();
}

function editMessage(id) {
  const message = state.messages.find((item) => item.id === id);
  if (!message) return;
  openComposer(message.target_type, message.target_id);
  state.draftId = id;
  $("#message-body").value = message.body;
  $("#message-timezone").value = message.timezone;
  $("#char-count").textContent = `${message.body.length} / 1600`;
}

function editRecurring(id) {
  const reminder = (state.recurring_reminders || []).find((item) => item.id === id);
  if (!reminder) return;
  state.recurringDraftId = id;
  state.recurringRequestKey = reminder.idempotency_key;
  $("#recurring-form").reset();
  $("#recurring-id").value = id;
  $("#recurring-title").textContent = reminder.name;
  $("#recurring-name").value = reminder.name;
  $("#recurring-body").value = reminder.body;
  $("#recurring-url").value = reminder.zoom_url || "";
  $("#recurring-url-note").textContent = reminder.meeting_url_required
    ? "Required before activation. No Zoom link has been inferred."
    : "Optional for this reminder; no meeting link was requested.";
  $("#recurring-time").value = reminder.local_time ? String(reminder.local_time).slice(0, 5) : "";
  $("#recurring-timezone").value = reminder.timezone;
  $("#recurring-group").innerHTML = '<option value="">Choose later</option>' + state.groups.map((group) =>
    '<option value="' + group.id + '" ' + (group.id === reminder.target_group_id ? "selected" : "") + '>' + escapeHtml(group.name) + '</option>'
  ).join("");
  $("#recurring-days").textContent = "Repeats " + reminder.weekdays.map((day) => weekdayNames[day]).join(", ") + " in " + reminder.timezone + ".";
  $("#recurring-error").textContent = "";
  $("#recurring-dialog").showModal();
}

async function saveRecurring(event) {
  event.preventDefault();
  if (state.recurringBusy) return;
  const reminder = (state.recurring_reminders || []).find((item) => item.id === state.recurringDraftId);
  const error = $("#recurring-error");
  const submit = event.submitter;
  error.textContent = "";
  state.recurringBusy = true;
  submit.disabled = true;
  try {
    await api({
      action: "save_recurring_reminder",
      id: reminder.id,
      name: $("#recurring-name").value,
      body: $("#recurring-body").value,
      targetGroupId: $("#recurring-group").value || null,
      zoomUrl: $("#recurring-url").value,
      timezone: reminder.timezone,
      localTime: $("#recurring-time").value,
      weekdays: reminder.weekdays,
      startDate: reminder.start_date,
      status: "draft",
      idempotencyKey: state.recurringRequestKey,
    });
    $("#recurring-dialog").close();
    await load();
    toast("Inactive recurring draft saved.");
  } catch (reason) {
    error.textContent = reason.message;
    error.focus();
  } finally {
    state.recurringBusy = false;
    submit.disabled = false;
  }
}

function openContact(id = null) {
  const contact = state.contacts.find((item) => item.id === id);
  $("#contact-form").reset();
  $("#contact-title").textContent = contact ? "Edit contact" : "Add contact";
  $("#contact-id").value = contact?.id || "";
  $("#contact-name").value = contact?.full_name || "";
  $("#contact-phone").value = contact?.phone || "";
  $("#contact-consent").value = contact?.consent_status || "pending";
  $("#consent-evidence").value = contact?.consent_evidence || "";
  $("#contact-timezone").value = contact?.timezone || timezone;
  $("#contact-groups").innerHTML = state.groups.map((group) => `<label><input type="checkbox" value="${group.id}" ${contact?.group_ids?.includes(group.id) ? "checked" : ""}>${escapeHtml(group.name)}</label>`).join("");
  $("#contact-error").textContent = "";
  $("#contact-dialog").showModal();
}

async function saveMessage(status) {
  if (state.messageBusy) return;
  const error = $("#composer-error");
  const form = $("#composer-form");
  error.textContent = "";
  state.messageBusy = true;
  form.setAttribute("aria-busy", "true");
  $("#save-draft").disabled = true;
  $("#send-now").disabled = true;
  $("#schedule-message").disabled = true;
  try {
    const payload = {
      action: "save_message", messageId: state.draftId,
      body: $("#message-body").value, targetType: $("#target-type").value,
      targetId: $("#target-id").value, status,
      scheduledFor: status === "scheduled" ? new Date($("#scheduled-for").value).toISOString() : null,
      timezone: $("#message-timezone").value,
      idempotencyKey: state.messageRequestKey,
    };
    await api(payload);
    $("#composer").close();
    await load();
    toast(status === "draft" ? "Draft saved." : "Message scheduled.");
  } catch (reason) {
    error.textContent = reason.message;
    error.focus();
  } finally {
    state.messageBusy = false;
    form.removeAttribute("aria-busy");
    $("#save-draft").disabled = false;
    updateRecipientNote();
  }
}

function openSendNowConfirmation() {
  const form = $("#composer-form");
  if (!form.reportValidity()) return;
  const type = $("#target-type").value;
  const id = $("#target-id").value;
  const target = (type === "individual" ? state.contacts : state.groups).find((item) => item.id === id);
  if (!eligibleTarget(type, target, state.contacts)) {
    $("#composer-error").textContent = "Choose an eligible opted-in recipient before sending.";
    return;
  }
  if (!state.dispatch_control?.enabled || !state.storage_verified || !state.transport?.verified ||
    !state.transport?.enabled || state.transport?.emergency_disabled) {
    $("#composer-error").textContent = "Send now is unavailable until the verified delivery connection and global sending control are on.";
    return;
  }
  const count = type === "individual" ? 1 : target.eligible_count;
  const label = target.full_name || target.name || target.phone;
  $("#send-now-summary").textContent = `Send now to ${label} as ${count} separate message${count === 1 ? "" : "s"}?`;
  $("#send-now-error").textContent = "";
  $("#send-now-dialog").showModal();
}

async function sendMessageNow(event) {
  event.preventDefault();
  if (state.messageBusy) return;
  state.messageBusy = true;
  const submit = $("#confirm-send-now");
  const error = $("#send-now-error");
  submit.disabled = true;
  error.textContent = "";
  try {
    const result = await api({
      action: "send_message_now",
      messageId: state.draftId,
      body: $("#message-body").value,
      targetType: $("#target-type").value,
      targetId: $("#target-id").value,
      timezone: $("#message-timezone").value,
      idempotencyKey: state.messageRequestKey,
    });
    await load();
    if (result.status !== "sent") throw new Error(result.uncertain > 0
      ? "The provider outcome is uncertain. The portal will not retry this message automatically."
      : "The message was not accepted. Review its status before trying anything else.");
    $("#send-now-dialog").close();
    $("#composer").close();
    toast("Message accepted by Quo.");
  } catch (reason) {
    error.textContent = reason.message;
    error.focus();
    await load().catch(() => {});
  } finally {
    state.messageBusy = false;
    submit.disabled = false;
    updateRecipientNote();
  }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#login-error").textContent = "";
  try {
    if (!authClient) throw new Error("Sign-in service is still loading. Try again in a moment.");
    const { error } = await authClient.auth.signInWithPassword({ email: $("#login-email").value, password: $("#login-password").value });
    if (error) throw error;
    location.reload();
  }
  catch (error) { $("#login-error").textContent = error.message || "Sign in failed."; }
});
$("#sign-out").addEventListener("click", async () => { await authClient.auth.signOut(); location.reload(); });
$("#new-message").addEventListener("click", () => openComposer());
$("#add-contact").addEventListener("click", () => openContact());
$("#contact-search").addEventListener("input", (event) => { state.search = event.target.value; renderContacts(); });
$("#target-type").addEventListener("change", (event) => targetOptions(event.target.value));
$("#target-id").addEventListener("change", updateRecipientNote);
$("#message-body").addEventListener("input", (event) => { $("#char-count").textContent = `${event.target.value.length} / 1600`; });
$("#save-draft").addEventListener("click", () => saveMessage("draft"));
$("#send-now").addEventListener("click", openSendNowConfirmation);
$("#composer-form").addEventListener("submit", (event) => { event.preventDefault(); saveMessage("scheduled"); });
$("#send-now-form").addEventListener("submit", sendMessageNow);
$("#recurring-form").addEventListener("submit", saveRecurring);
$("#toggle-sending").addEventListener("click", () => {
  if (state.dispatch_control.enabled) setDispatchEnabled(false);
  else { $("#enable-sending-error").textContent = ""; $("#enable-sending-dialog").showModal(); }
});
$("#enable-sending-form").addEventListener("submit", (event) => { event.preventDefault(); setDispatchEnabled(true); });
$("#prev-week").addEventListener("click", () => { state.week = new Date(state.week.getFullYear(), state.week.getMonth(), state.week.getDate() - 7); renderCalendar(); });
$("#next-week").addEventListener("click", () => { state.week = new Date(state.week.getFullYear(), state.week.getMonth(), state.week.getDate() + 7); renderCalendar(); });
$("#today").addEventListener("click", () => { state.week = new Date(); renderCalendar(); });
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.close}`).close()));
$("#admin-invite-form").addEventListener("submit", createAdminInvitation);

$("#contact-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.contactBusy) return;
  const form = event.currentTarget;
  const error = $("#contact-error");
  const submit = event.submitter;
  error.textContent = "";
  state.contactBusy = true;
  form.setAttribute("aria-busy", "true");
  if (submit) submit.disabled = true;
  try {
    const previous = state.contacts.find((item) => item.id === $("#contact-id").value);
    const result = await api({
      action: "save_contact", id: $("#contact-id").value || null,
      fullName: $("#contact-name").value, phone: $("#contact-phone").value,
      consentStatus: $("#contact-consent").value,
      consentEvidence: $("#consent-evidence").value, timezone: $("#contact-timezone").value,
    });
    const contactId = result.id;
    for (const group of state.groups) {
      const isMember = Boolean($(`#contact-groups input[value="${group.id}"]`)?.checked);
      const wasMember = previous?.group_ids?.includes(group.id) || false;
      if (isMember !== wasMember) await api({ action: "set_membership", contactId, groupId: group.id, isMember });
    }
    $("#contact-dialog").close();
    await load();
    toast("Contact saved.");
  } catch (reason) {
    error.textContent = reason.message;
    error.focus();
  } finally {
    state.contactBusy = false;
    form.removeAttribute("aria-busy");
    if (submit) submit.disabled = false;
  }
});

async function init() {
  const previewParams = new URLSearchParams(location.search);
  const localPreview = ["127.0.0.1", "localhost"].includes(location.hostname) && previewParams.has("preview");
  if (localPreview) {
    $("#auth-view").hidden = true;
    $("#app").hidden = false;
    Object.assign(state, {
      groups: ["Marketing Directors", "AMG Hierarchy", "AMG Baseshop"].map((name, index) => ({ id: `00000000-0000-4000-8000-00000000000${index}`, name, member_count: 0, eligible_count: 0 })),
      recurring_reminders: [
        { id: "preview-book", name: "AMG Book Club", body: "Good morning, AMG! It’s time for AMG Book Club.", target_group_id: null, target_group_name: null, zoom_url: null, meeting_url_required: true, timezone: "America/New_York", local_time: "09:00:00", weekdays: [2, 3, 4, 5], start_date: "2026-10-01", status: "draft", idempotency_key: "00000000-0000-4000-8000-000000000010" },
        { id: "preview-thursday", name: "BOM Thursday Reminder", body: "Good morning, AMG! Tonight’s BOM starts at 7 PM.", target_group_id: null, target_group_name: null, zoom_url: null, meeting_url_required: false, timezone: "America/New_York", local_time: "11:00:00", weekdays: [4], start_date: "2026-10-01", status: "draft", idempotency_key: "00000000-0000-4000-8000-000000000011" },
        { id: "preview-friday", name: "BOM Saturday Reminder", body: "Good evening, AMG! Tomorrow’s BOM starts at 9 AM.", target_group_id: null, target_group_name: null, zoom_url: null, meeting_url_required: false, timezone: "America/New_York", local_time: "21:00:00", weekdays: [5], start_date: "2026-10-01", status: "draft", idempotency_key: "00000000-0000-4000-8000-000000000012" },
      ],
      transport: { provider: "Quo", configured: true, verified: true, enabled: false, emergency_disabled: false },
      storage_verified: !previewParams.has("storage-off"),
      dispatch_control: { enabled: false, version: 1, changed_at: null, changed_by: null, audit: [] },
      admin_invitations: [],
    });
    render();
    return;
  }
  try {
    const response = await fetch("/api/admin/config", { headers: { accept: "application/json" } });
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || "CRM backend is not configured.");
    authClient = createClient(config.url, config.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    $("#login-submit").disabled = false;
    const { data } = await authClient.auth.getUser();
    if (!data.user) return;
    await load();
    $("#auth-view").hidden = true;
    $("#app").hidden = false;
  } catch (error) {
    $("#login-error").textContent = error.message === "AMG CRM admin access required."
      ? "This account does not have AMG CRM admin access."
      : error.message;
  }
}

init();
