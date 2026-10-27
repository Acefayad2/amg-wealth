import { createClient } from "@supabase/supabase-js";
import { STATUS_LABELS, calendarCells, defaultScheduleValue, eligibleTarget, filterContacts, localDayKey, recurringCalendarEntries } from "../admin/core.mjs";

const $ = (selector) => document.querySelector(selector);
const state = { contacts: [], groups: [], messages: [], recurring_reminders: [], transport: {}, month: new Date(), search: "", draftId: null, messageRequestKey: null, messageBusy: false, contactBusy: false, recurringDraftId: null, recurringRequestKey: null, recurringBusy: false };
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
let authClient = null;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const initials = (name) => name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
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
  renderGroups();
  renderContacts();
  renderRecurring();
  renderCalendar();
  renderMessages();
  renderStats();
  const { configured, enabled } = state.transport;
  const banner = $("#transport-banner");
  banner.classList.toggle("ready", configured && enabled);
  banner.textContent = !configured
    ? "Quo sending is locked: add the approved API key and AMG sender number before enabling dispatch. Drafts and schedules remain visible, but no texts will send."
    : !enabled
      ? "Quo is configured but dispatch is intentionally disabled. Set the send approval flag only after sender, carrier registration, credits, contacts, and consent are verified."
      : "Quo dispatch is enabled. Only opted-in contacts can be scheduled, and opt-outs are checked again immediately before send.";
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
    const missing = [
      !reminder.target_group_id && "recipient group",
      reminder.meeting_url_required && !reminder.zoom_url && "Zoom URL",
    ].filter(Boolean);
    const schedule = reminder.weekdays.map((day) => weekdayNames[day]).join(", ") + " · " + formatLocalTime(reminder.local_time) + " ET";
    const needs = missing.length ? "Needs " + missing.join(" and ") : "Ready for final provider approval";
    return '<article class="message-row">' +
      '<span class="status draft">Inactive draft</span>' +
      '<div class="message-copy"><strong>' + escapeHtml(reminder.name) + '</strong><span>' + escapeHtml(schedule) + '</span><span class="needs-input">' + escapeHtml(needs) + '</span></div>' +
      '<span class="message-meta">' + escapeHtml(reminder.target_group_name || "No audience selected") + '</span>' +
      '<button class="secondary" data-edit-recurring="' + reminder.id + '">Edit</button></article>';
  }).join("") : '<p class="empty">No recurring drafts yet.</p>';
  document.querySelectorAll("[data-edit-recurring]").forEach((button) =>
    button.addEventListener("click", () => editRecurring(button.dataset.editRecurring)));
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
      <span class="contact-copy"><strong>${escapeHtml(contact.full_name)}</strong><small>${escapeHtml(contact.phone)}</small></span>
      <span class="consent-dot ${contact.consent_status}" title="${escapeHtml(contact.consent_status.replace("_", " "))}"></span>
    </button>`).join("") : `<p class="empty">${state.search ? "No contacts match." : "No contacts yet. Add only verified AMG contacts."}</p>`;
  document.querySelectorAll("[data-contact]").forEach((button) => button.addEventListener("click", () => openContact(button.dataset.contact)));
}

function renderCalendar() {
  $("#month-title").textContent = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(state.month);
  const today = localDayKey(new Date());
  const cells = calendarCells(state.month);
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
      });
    }
  }
  $("#calendar").innerHTML = cells.map((date) => {
    const key = localDayKey(date);
    const messages = grouped[key] || [];
    const other = date.getMonth() !== state.month.getMonth();
    return `<button class="day${other ? " other" : ""}${key === today ? " today" : ""}" data-day="${key}">
      <span class="day-number">${date.getDate()}</span>
      ${messages.slice(0, 3).map((message) => `<span class="calendar-message ${message.status}" title="${escapeHtml(message.body)}">${escapeHtml(message.display_time || formatTime(message.scheduled_for))} · ${escapeHtml(message.target_name)}</span>`).join("")}
      ${messages.length > 3 ? `<span class="more">+${messages.length - 3} more</span>` : ""}
    </button>`;
  }).join("");
  document.querySelectorAll("[data-day]").forEach((button) => button.addEventListener("click", () => openComposer("individual", null, button.dataset.day)));
}

function renderMessages() {
  const list = $("#message-list");
  list.innerHTML = state.messages.length ? state.messages.map((message) => `
    <article class="message-row">
      <span class="status ${message.status}">${escapeHtml(STATUS_LABELS[message.status] || message.status)}</span>
      <div class="message-copy"><strong>${escapeHtml(message.body)}</strong><span>${escapeHtml(message.target_name)} · ${message.recipient_count} recipient${message.recipient_count === 1 ? "" : "s"}</span></div>
      <span class="message-meta">${escapeHtml(formatDateTime(message.scheduled_for || message.created_at))}</span>
      ${message.status === "draft" ? `<button class="secondary" data-edit-message="${message.id}">Edit</button>` : ""}
    </article>`).join("") : `<p class="empty">No messages yet. Draft or schedule the first communication.</p>`;
  document.querySelectorAll("[data-edit-message]").forEach((button) => button.addEventListener("click", () => editMessage(button.dataset.editMessage)));
}

function renderStats() {
  for (const status of ["draft", "scheduled", "sent", "failed"]) {
    $(`#${status}-count`).textContent = state.messages.filter((message) => message.status === status).length;
  }
}

function targetOptions(type, selected) {
  const source = type === "individual" ? state.contacts : state.groups;
  $("#target-id").innerHTML = `<option value="">Select ${type === "individual" ? "a contact" : "a group"}</option>` + source.map((item) => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.full_name || item.name)}</option>`).join("");
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
      ? eligible ? "Verified opt-in. Consent will be checked again at dispatch." : `This contact is ${target.consent_status.replace("_", " ")} and cannot be scheduled.`
      : eligible ? `${target.eligible_count} opted-in member${target.eligible_count === 1 ? "" : "s"} will be snapshotted for this schedule.` : "This group has no opted-in members and cannot be scheduled.";
  $("#schedule-message").disabled = Boolean(target && !eligible);
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
$("#composer-form").addEventListener("submit", (event) => { event.preventDefault(); saveMessage("scheduled"); });
$("#recurring-form").addEventListener("submit", saveRecurring);
$("#prev-month").addEventListener("click", () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); renderCalendar(); });
$("#next-month").addEventListener("click", () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); renderCalendar(); });
$("#today").addEventListener("click", () => { state.month = new Date(); renderCalendar(); });
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.close}`).close()));

$("#contact-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.contactBusy) return;
  const error = $("#contact-error");
  const submit = event.submitter;
  error.textContent = "";
  state.contactBusy = true;
  event.currentTarget.setAttribute("aria-busy", "true");
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
    event.currentTarget.removeAttribute("aria-busy");
    if (submit) submit.disabled = false;
  }
});

async function init() {
  const localPreview = ["127.0.0.1", "localhost"].includes(location.hostname) && new URLSearchParams(location.search).has("preview");
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
      transport: { provider: "Quo", configured: false, enabled: false },
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
