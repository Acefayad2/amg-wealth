import { licensingReminderLinks } from "../admin/licensing-reminders.mjs";
import { licensingSteps, licensingProgress, selectedStepsForStage } from "../licensing-progress/steps.js";
import { normalizeUsPhone } from "../netlify/functions/_shared/us-phone.mjs";
import { createClient } from "@supabase/supabase-js";
import { STATUS_LABELS, contactsForGroupContext, defaultScheduleValue, eligibleTarget, filterContacts, localDayKey, personalizationHint, recurringCalendarEntries, scheduleInputValue, weekCells, weekRangeLabel } from "../admin/core.mjs";

const $ = (selector) => document.querySelector(selector);
const state = { contacts: [], groups: [], messages: [], recurring_reminders: [], scheduler_events: [], admin_invitations: [], dispatch_control: { individual_enabled: false, scheduled_enabled: false, version: 1, audit: [] }, storage_verified: false, transport: {}, week: new Date(), search: "", selectedGroupId: null, composerGroupId: null, draftId: null, messageEditSnapshot: null, messageRequestKey: null, messageBusy: false, pendingScheduleSave: null, contactBusy: false, contactEditVersion: null, recurringDraftId: null, recurringEditSnapshot: null, recurringRequestKey: null, recurringBusy: false, recurringStatusBusy: false, dispatchBusy: false, pendingDispatchChange: null, adminInviteBusy: false };
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
let authClient = null;
let startupBusy = false;
const inquiryState = { records: [], total: 0, page: 1, pageSize: 25, loading: false, error: "", requestId: 0, controller: null, preview: false };
const licensingState = { people: [], learners: [], total: 0, preLicense: 0, onboarding: 0, appointed: 0, overdue: 0, page: 1, pageSize: 25, query: "", status: "", loading: false, error: "", requestId: 0, controller: null, preview: false };
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const initials = (name) => String(name || "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
const contactLabel = (contact) => contact.full_name || contact.phone;
const formatTime = (value) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
const formatDateTime = (value) => value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not scheduled";

async function api(body) {
  const { data: sessionData, error: sessionError } = await authClient.auth.getSession();
  if (sessionError) throw sessionError;
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

function resetInquiries() {
  inquiryState.controller?.abort();
  inquiryState.requestId += 1;
  Object.assign(inquiryState, { records: [], total: 0, page: 1, loading: false, error: "", controller: null });
  renderInquiries();
  $("#communications-view").hidden = false;
  $("#inquiries-view").hidden = true;
  $("#licensing-view").hidden = true;
  $(".sidebar").classList.remove("focused-mode");
  document.querySelectorAll("[data-admin-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.adminView === "communications")));
}

function resetLicensing() {
  licensingState.controller?.abort();
  licensingState.requestId += 1;
  Object.assign(licensingState, { people: [], learners: [], total: 0, preLicense: 0, onboarding: 0, appointed: 0, overdue: 0, page: 1, loading: false, error: "", controller: null });
  $("#licensing-activity-list").innerHTML = "";
  renderLicensing();
}

function inquiryContact(value, kind) {
  const text = String(value || "").trim();
  if (!text) return '<span class="muted">Not provided</span>';
  const phone = text.replace(/[().\s-]/g, "");
  const href = kind === "email" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)
    ? `mailto:${encodeURIComponent(text)}`
    : kind === "phone" && /^\+?\d{7,15}$/.test(phone) ? `tel:${phone}` : null;
  return href ? `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>` : escapeHtml(text);
}

function renderInquiries() {
  const { records, total, page, pageSize, loading, error } = inquiryState;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  $("#inquiries-list").setAttribute("aria-busy", String(loading));
  $("#inquiries-summary").textContent = loading ? "Loading inquiries…" : error ? "Inquiries could not be refreshed." : `${total.toLocaleString()} submitted ${total === 1 ? "inquiry" : "inquiries"}`;
  $("#inquiries-error").hidden = !error;
  $("#inquiries-error").textContent = error;
  $("#refresh-inquiries").disabled = loading;
  $("#previous-inquiries").disabled = loading || page <= 1;
  $("#next-inquiries").disabled = loading || page >= pages;
  $("#inquiries-pagination").hidden = pages <= 1;
  $("#inquiries-page").textContent = `Page ${page} of ${pages}`;
  $("#inquiries-list").innerHTML = records.length ? records.map((inquiry) => {
    const received = Number.isFinite(Date.parse(inquiry.created_at)) ? formatDateTime(inquiry.created_at) : "Date unavailable";
    return `<article class="inquiry-card">
      <header><div><p class="eyebrow">${escapeHtml(inquiry.interest || "Consultation request")}</p><h2>${escapeHtml(inquiry.full_name)}</h2></div><span class="inquiry-date">Received ${escapeHtml(received)}</span></header>
      <dl class="inquiry-contacts"><div><dt>Email</dt><dd>${inquiryContact(inquiry.email, "email")}</dd></div><div><dt>Phone</dt><dd>${inquiryContact(inquiry.phone, "phone")}</dd></div></dl>
      <div class="inquiry-message"><h3>Goals &amp; message</h3><p>${escapeHtml(inquiry.message || "No additional message provided.")}</p></div>
    </article>`;
  }).join("") : loading ? '<p class="empty">Retrieving website inquiries…</p>' : error ? '<p class="empty">Use Refresh inquiries to try again.</p>' : '<div class="inquiry-empty"><h2>No inquiries yet</h2><p>New consultation requests from the website will appear here. Use Refresh inquiries to check for new submissions.</p></div>';
}

async function loadInquiries(page = 1) {
  if (inquiryState.loading) return;
  if (inquiryState.preview) { renderInquiries(); return; }
  const requestId = ++inquiryState.requestId;
  const controller = new AbortController();
  Object.assign(inquiryState, { loading: true, error: "", controller });
  renderInquiries();
  try {
    const { data, error } = await authClient.auth.getSession();
    if (error) throw error;
    if (requestId !== inquiryState.requestId) return;
    const token = data.session?.access_token;
    if (!token) throw new Error("Sign in again to view submitted inquiries.");
    const response = await fetch(`/.netlify/functions/admin-inquiries?page=${page}`, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      cache: "no-store", signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Unable to load inquiries. Try refreshing again.");
    if (requestId !== inquiryState.requestId) return;
    if (!Array.isArray(payload.inquiries) || !Number.isInteger(payload.total) || payload.total < 0
      || !Number.isInteger(payload.page) || payload.page < 1 || !Number.isInteger(payload.page_size) || payload.page_size < 1) {
      throw new Error("The inquiry response was incomplete. Try refreshing again.");
    }
    Object.assign(inquiryState, { records: payload.inquiries, total: payload.total, page: payload.page, pageSize: payload.page_size });
  } catch (error) {
    if (requestId !== inquiryState.requestId || error.name === "AbortError") return;
    inquiryState.error = error.message || "Unable to load inquiries. Try refreshing again.";
  } finally {
    if (requestId === inquiryState.requestId) {
      inquiryState.loading = false;
      inquiryState.controller = null;
      renderInquiries();
    }
  }
}

async function licensingApi(body = null, page = 1) {
  const { data, error } = await authClient.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in again to manage licensing.");
  const params = new URLSearchParams({ page: String(page) });
  if (licensingState.query) params.set("q", licensingState.query);
  if (licensingState.status) params.set("status", licensingState.status);
  const response = await fetch(`/api/licensing-pipeline?${params}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Licensing could not be updated.");
  return payload;
}

const licensingStageLabel = (stage) => stage === 6 ? 'Licensing complete' : `Step ${stage} of 5 · ${licensingSteps[stage - 1].label}`;
function licensingSlider(person, editor = false) {
  const progress = licensingProgress(person || {});
  const stage = progress.current < 0 ? 6 : progress.current + 1;
  const id = editor ? 'license-stage-editor' : `license-stage-${person.id}`;
  return `<div class="licensing-slider stage-${stage}"><div class="licensing-slider-heading"><label for="${id}">Current step</label><output for="${id}" data-stage-label>${escapeHtml(licensingStageLabel(stage))}</output></div><input id="${id}" type="range" min="1" max="6" step="1" value="${stage}" aria-label="Current licensing step${editor ? '' : ` for ${escapeHtml(person.name)}`}" aria-valuetext="${escapeHtml(licensingStageLabel(stage))}" ${editor ? 'data-stage-editor' : `data-license-stage="${person.id}"`}><ol class="licensing-slider-stops" aria-hidden="true">${[...licensingSteps.map(step => step.label), 'Complete'].map((label, index) => `<li${index + 1 === stage ? ' class="selected"' : ''}><span>${index === 5 ? '✓' : index + 1}</span><small>${label}</small></li>`).join('')}</ol><p class="licensing-slider-hint" role="status" aria-live="polite">${editor ? 'Earlier steps will be marked complete when you save.' : 'Drag to their current step. Release to save.'}</p></div>`;
}
function updateLicensingSlider(input) {
  const stage = Number(input.value);
  const box = input.closest('.licensing-slider');
  box.className = `licensing-slider stage-${stage}`;
  box.querySelector('[data-stage-label]').textContent = licensingStageLabel(stage);
  input.setAttribute('aria-valuetext', licensingStageLabel(stage));
  box.querySelectorAll('li').forEach((item, index) => item.classList.toggle('selected', index + 1 === stage));
}

function renderLicensing() {
  const { people, total, page, pageSize, loading, error } = licensingState;
  const metrics = [["People tracked", total], ["Before license", licensingState.preLicense], ["Onboarding", licensingState.onboarding], ["Appointed", licensingState.appointed], ["Follow ups overdue", licensingState.overdue]];
  $("#licensing-metrics").innerHTML = metrics.map(([label, value], index) => `<div class="licensing-metric${index === 4 && value ? " urgent" : ""}"><strong>${Number(value).toLocaleString()}</strong><span>${label}</span></div>`).join("");
  $("#licensing-list").setAttribute("aria-busy", String(loading));
  $("#licensing-summary").textContent = loading ? "Loading the pipeline…" : error ? "The pipeline could not be refreshed." : `${total.toLocaleString()} ${total === 1 ? "person" : "people"} in this view`;
  $("#licensing-error").hidden = !error;
  $("#licensing-error").textContent = error;
  $("#refresh-licensing").disabled = loading;
  $("#previous-licensing").disabled = loading || page <= 1;
  $("#next-licensing").disabled = loading || page * pageSize >= total;
  $("#licensing-pagination").hidden = total <= pageSize;
  $("#licensing-page").textContent = `Page ${page} of ${Math.max(1, Math.ceil(total / pageSize))}`;
  $("#licensing-list").innerHTML = people.length ? people.map((person) => {
    const progress = licensingProgress(person);
    const due = person.follow_up_date && person.follow_up_date < new Date().toISOString().slice(0, 10) && progress.current >= 0;
    const stage = progress.label;
    const reminders = licensingReminderLinks(person, navigator);
    return `<article class="licensing-person" data-person-id="${person.id}"><div class="licensing-person-main"><div class="licensing-avatar">${escapeHtml(initials(person.name))}</div><div class="licensing-person-title"><p class="eyebrow">${escapeHtml(stage)} · ${escapeHtml(person.track === "both" ? "Life + Health" : person.track)}</p><h2>${escapeHtml(person.name)}</h2><p>${person.email ? escapeHtml(person.email) : '<span class="licensing-missing">Add email to connect their checklist</span>'}${person.phone ? ` · ${escapeHtml(person.phone)}` : ""}${person.recruiter ? ` · Upline: ${escapeHtml(person.recruiter)}` : ""}</p></div><span class="licensing-due${due ? " overdue" : ""}">${person.follow_up_date ? `${due ? "Overdue · " : "Follow up · "}${escapeHtml(person.follow_up_date)}` : "No follow up date"}</span></div>${licensingSlider(person)}${person.next_action || person.blocker ? `<div class="licensing-notes">${person.next_action ? `<p><strong>Next:</strong> ${escapeHtml(person.next_action)}</p>` : ""}${person.blocker ? `<p><strong>Blocker:</strong> ${escapeHtml(person.blocker)}</p>` : ""}</div>` : ""}<div class="licensing-person-actions"><button class="secondary" type="button" data-license-edit="${person.id}">Edit person & progress</button>${reminders.text ? `<a class="secondary" data-license-text-link href="${escapeHtml(reminders.text)}" title="Open a personalized draft in your Messages app">Text reminder</a>` : '<button class="secondary" type="button" disabled title="Add a phone number first">Text reminder</button>'}${reminders.email ? `<a class="secondary" data-license-email-link href="${escapeHtml(reminders.email)}" title="Open a personalized draft in your email app">Email reminder</a>` : '<button type="button" class="secondary" disabled title="Add an email first">Email reminder</button>'}</div><p class="licensing-reminder-help">Reminders are written for this step. Open a draft in Messages or your email app, then review and send.</p></article>`;
  }).join("") : loading ? '<p class="empty">Loading people…</p>' : error ? '<p class="empty">Refresh to try again.</p>' : '<div class="learner-empty"><h2>No one in this view yet</h2><p>Add a person to track their licensing steps, or clear the filters to see everyone.</p></div>';
}

async function loadLicensing(page = 1) {
  if (licensingState.preview) { renderLicensing(); return; }
  const requestId = ++licensingState.requestId;
  licensingState.loading = true; licensingState.error = ""; renderLicensing();
  try {
    const payload = await licensingApi(null, page);
    if (requestId !== licensingState.requestId) return;
    if (!Array.isArray(payload.people) || !Number.isInteger(payload.total)) throw new Error("Licensing data was incomplete.");
    Object.assign(licensingState, { people: payload.people, total: payload.total, preLicense: payload.pre_license, onboarding: payload.onboarding, appointed: payload.appointed, overdue: payload.overdue, page, pageSize: payload.page_size });
    if (page === 1 && !licensingState.query && !licensingState.status) void loadLicensingActivity(requestId);
  } catch (reason) {
    if (requestId !== licensingState.requestId) return;
    licensingState.error = reason.message || "Licensing progress could not be loaded.";
  } finally {
    if (requestId === licensingState.requestId) { licensingState.loading = false; renderLicensing(); }
  }
}

async function loadLicensingActivity(requestId) {
  try {
    const { data } = await authClient.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const response = await fetch('/.netlify/functions/admin-learning?page=1', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json();
    if (requestId !== licensingState.requestId) return;
    $("#licensing-activity-list").innerHTML = (payload.learners || []).map((learner) => {
      const unfinished = (learner.attempts || []).filter((item) => item.status === 'in_progress').length;
      const completed = (learner.attempts || []).filter((item) => item.status === 'completed').length;
      return `<div class="licensing-activity-row"><strong>${escapeHtml(learner.name || learner.email)}</strong><span>${escapeHtml(learner.email)} · ${learner.completedLessons} lessons · ${completed} finished exams · ${unfinished} unfinished</span><button type="button" class="secondary" data-license-learner="${encodeURIComponent(JSON.stringify({ name: learner.name, email: learner.email }))}">Track person</button></div>`;
    }).join('') || '<p>No course activity yet.</p>';
  } catch { if (requestId === licensingState.requestId) $("#licensing-activity-list").textContent = 'Course activity could not load. Refresh to try again.'; }
}

function openLicensingPerson(person = null) {
  $("#licensing-person-form").reset();
  $("#licensing-person-title").textContent = person?.id ? "Edit licensing progress" : "Add a person";
  $("#licensing-person-id").value = person?.id || "";
  $("#licensing-person-version").value = person?.version || "";
  for (const [id, key] of [["license-name", "name"], ["license-email", "email"], ["license-phone", "phone"], ["license-recruiter", "recruiter"], ["license-state", "state"], ["license-track", "track"], ["license-exam-status", "exam_status"], ["license-exam-date", "exam_date"], ["license-follow-up", "follow_up_date"], ["license-first-check", "first_check_date"], ["license-next-action", "next_action"], ["license-blocker", "blocker"]]) $("#" + id).value = person?.[key] || (id === "license-track" ? "both" : id === "license-exam-status" ? "studying" : "");
  $("#license-steps").innerHTML = licensingSlider(person, true);
  $("#licensing-person-error").textContent = "";
  $("#licensing-person-dialog").showModal();
}

function showAdminView(view) {
  const inquiries = view === "inquiries";
  const licensing = view === "licensing";
  $("#communications-view").hidden = inquiries || licensing;
  $("#inquiries-view").hidden = !inquiries;
  $("#licensing-view").hidden = !licensing;
  $(".sidebar").classList.toggle("focused-mode", inquiries || licensing);
  document.querySelectorAll("[data-admin-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.adminView === view)));
  if (inquiries) void loadInquiries();
  if (licensing) void loadLicensing();
}

function showStartup(message = "Restoring your secure AMG session and checking CRM admin access…") {
  $("#startup-view").hidden = false;
  $("#auth-view").hidden = true;
  $("#app").hidden = true;
  $("#startup-title").textContent = "Verifying access";
  $("#startup-status").textContent = message;
  $("#startup-error-actions").hidden = true;
}

function showStartupError(message) {
  $("#startup-view").hidden = false;
  $("#auth-view").hidden = true;
  $("#app").hidden = true;
  $("#startup-title").textContent = "Verification paused";
  $("#startup-status").textContent = message;
  $("#startup-error-actions").hidden = false;
}

function showLogin(message = "") {
  $("#startup-view").hidden = true;
  $("#app").hidden = true;
  $("#auth-view").hidden = false;
  $("#login-error").textContent = message;
}

function isExpiredSessionError(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return ["refresh_token_not_found", "refresh_token_already_used", "refresh_token_invalid"].includes(code)
    || /invalid refresh token|refresh token.*not found|auth session missing|session.*expired|sign in required/.test(message);
}

async function verifyAdminSession() {
  if (startupBusy) return;
  startupBusy = true;
  showStartup();
  try {
    const { data, error } = await authClient.auth.getUser();
    if (error) throw error;
    if (!data.user) {
      showLogin();
      return;
    }
    await load();
    $("#startup-view").hidden = true;
    $("#auth-view").hidden = true;
    $("#app").hidden = false;
  } catch (error) {
    if (error.message === "AMG CRM admin access required.") {
      showLogin("This account does not have AMG CRM admin access.");
    } else if (isExpiredSessionError(error)) {
      await authClient.auth.signOut({ scope: "local" }).catch(() => {});
      showLogin("Your saved session expired. Sign in again.");
    } else {
      showStartupError(error.message || "AMG could not verify this session. Retry when your connection is ready.");
    }
  } finally {
    startupBusy = false;
  }
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
  const individualEnabled = Boolean(state.dispatch_control?.individual_enabled && enabled);
  const scheduledEnabled = Boolean(state.dispatch_control?.scheduled_enabled && enabled);
  banner.classList.toggle("ready", configured && verified && state.storage_verified);
  banner.textContent = !configured
    ? "Quo sending is locked: add the approved API key and AMG sender number before enabling dispatch. Drafts and schedules remain visible, but no texts will send."
    : !verified
      ? "Quo credentials are stored, but the approved AMG sender could not be verified. Dispatch remains disabled."
    : !state.storage_verified
      ? "Quo is connected, but scheduler storage is unavailable. Sending is locked until the server-only database connection is verified."
    : `Quo is connected to the approved AMG sender. Individual Texts are ${individualEnabled ? "ON" : "OFF"}; Scheduled Texts are ${scheduledEnabled ? "ON" : "OFF"}. Opt-outs are checked again before every recipient.`;
  renderDispatchControl();
}

function renderAdminInvitations() {
  const invitations = state.admin_invitations || [];
  $("#admin-invitations").innerHTML = invitations.length ? invitations.map((invitation) => `
    <article class="message-row">
      <div class="message-copy"><strong>${escapeHtml(invitation.phone)}</strong><span>${escapeHtml(invitation.status === "accepted" ? `Admin access accepted${invitation.chosen_email ? ` · ${invitation.chosen_email}` : ""}` : invitation.status === "sent" ? "Private setup text accepted by Quo" : invitation.status === "phone_verified" ? "Account setup pending" : invitation.status === "uncertain" ? "Provider outcome uncertain — do not retry" : invitation.status === "expired" ? "Expired — a new invitation is required" : invitation.status)}</span></div>
      <span class="message-meta">${escapeHtml(invitation.accepted_at ? formatDateTime(invitation.accepted_at) : invitation.expires_at ? `Expires ${formatDateTime(invitation.expires_at)}` : formatDateTime(invitation.created_at))}</span>
    </article>`).join("") : '<p class="empty">No admin invitations have been prepared.</p>';
}

async function createAdminInvitation(event) {
  event.preventDefault();
  if (state.adminInviteBusy) return;
  const phone = normalizeUsPhone($("#admin-invite-phone").value);
  const submit = $("#admin-invite-submit");
  const error = $("#admin-invite-error");
  error.textContent = "";
  if (!phone) {
    error.textContent = "Enter a valid US phone number.";
    error.focus();
    return;
  }
  if (!window.confirm(`Send one private, single-use AMG admin setup link to ${phone}? Anyone with this link can create an AMG admin account. The link expires when used or after 12 hours.`)) return;
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
  const control = state.dispatch_control || { individual_enabled: false, scheduled_enabled: false, version: 1, audit: [] };
  for (const channel of ["individual", "scheduled"]) {
    const label = channel === "individual" ? "Individual Texts" : "Scheduled Texts";
    const enabled = Boolean(control[`${channel}_enabled`]);
    const effectiveEnabled = Boolean(enabled && state.transport?.enabled);
    const card = document.querySelector(`[data-delivery-card="${channel}"]`);
    card.classList.toggle("enabled", effectiveEnabled);
    $(`#${channel}-control-title`).textContent = `${label} ${effectiveEnabled ? "ON" : "OFF"}`;
    $(`#${channel}-control-detail`).textContent = enabled && state.transport?.emergency_disabled
      ? "The portal control is on, but the emergency lock is blocking delivery."
      : enabled && !state.storage_verified
        ? "The portal control is on, but delivery storage is unavailable. Delivery remains blocked."
      : enabled && !state.transport?.verified
        ? "The portal control is on, but the approved Quo sender is not verified. Delivery remains blocked."
      : effectiveEnabled
        ? channel === "individual"
          ? "Confirmed Send now requests to one contact or a group may dispatch. Scheduled delivery is controlled separately."
          : "Eligible future and active recurring messages may dispatch when due. Individual delivery is controlled separately."
        : channel === "individual"
          ? "Send now is blocked. Drafts and scheduled delivery are unchanged."
          : "Future and recurring delivery is blocked. Send now is unchanged.";
    const latest = control.audit?.find((item) => item.channel === channel);
    $(`#${channel}-control-audit`).textContent = latest
      ? `Last turned ${latest.new_enabled ? "on" : "off"} by ${latest.changed_by || "an AMG CRM admin"} · ${formatDateTime(latest.changed_at)}`
      : `No ${label.toLowerCase()} control changes have been recorded.`;
    const button = document.querySelector(`[data-toggle-channel="${channel}"]`);
    button.textContent = `Turn ${label} ${enabled ? "OFF" : "ON"}`;
    button.disabled = Boolean(state.dispatchBusy) || (!enabled && (!state.storage_verified || !state.transport?.verified || state.transport?.emergency_disabled));
  }
}

function openDispatchConfirmation(channel) {
  if (state.dispatchBusy) return;
  const label = channel === "individual" ? "Individual Texts" : "Scheduled Texts";
  const enabled = Boolean(state.dispatch_control?.[`${channel}_enabled`]);
  const nextEnabled = !enabled;
  state.pendingDispatchChange = { channel, enabled: nextEnabled };
  $("#delivery-control-confirm-title").textContent = `Turn ${label} ${nextEnabled ? "ON" : "OFF"}?`;
  $("#delivery-control-confirm-copy").textContent = channel === "individual"
    ? nextEnabled
      ? "Confirmed Send now requests to one contact or a group may deliver immediately through the approved AMG number. Scheduled delivery stays unchanged."
      : "New Send now requests will be blocked immediately. Scheduled delivery stays unchanged."
    : nextEnabled
      ? "Eligible future one-time messages and active weekly reminders may deliver when due. Individual delivery stays unchanged."
      : "Future and recurring delivery will stop immediately. Individual delivery stays unchanged.";
  $("#delivery-control-confirm-warning").textContent = nextEnabled
    ? channel === "individual"
      ? "This control does not send anything by itself. Each direct or group message still requires its own final Send now confirmation."
      : "This control does not activate draft reminders. Incomplete audiences, missing links, consent and opt-outs remain enforced."
    : "A provider request already accepted cannot be recalled. No failed or uncertain message is retried automatically.";
  $("#confirm-delivery-control").textContent = `Turn ${label} ${nextEnabled ? "ON" : "OFF"}`;
  $("#delivery-control-error").textContent = "";
  $("#delivery-control-dialog").showModal();
}

async function setDispatchChannel(channel, enabled) {
  if (state.dispatchBusy) return;
  state.dispatchBusy = channel;
  renderDispatchControl();
  const error = $("#delivery-control-error");
  error.textContent = "";
  $("#delivery-loading").hidden = false;
  $("#app").setAttribute("aria-busy", "true");
  try {
    let result;
    try {
      result = await api({ action: "set_dispatch_channel", channel, enabled, expectedVersion: state.dispatch_control.version });
    } catch (reason) {
      error.textContent = reason.message;
      error.focus();
      await load().catch(() => {});
      return;
    }
    if (result.dispatch_control) state.dispatch_control = result.dispatch_control;
    if ($("#delivery-control-dialog").open) $("#delivery-control-dialog").close();
    state.pendingDispatchChange = null;
    const label = channel === "individual" ? "Individual Texts" : "Scheduled Texts";
    try {
      await load();
      toast(`${label} turned ${enabled ? "on" : "off"}.`);
    } catch {
      renderDispatchControl();
      toast(`${label} changed, but the page could not refresh. Reload before making another change.`);
    }
  } finally {
    state.dispatchBusy = false;
    $("#delivery-loading").hidden = true;
    $("#app").removeAttribute("aria-busy");
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
    ? `Activate ${reminder.name}? Occurrences can send only when Scheduled Texts are also on.`
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
    <button class="group-button" data-view-group="${group.id}">
      <span>${escapeHtml(group.name)}</span><small>${group.eligible_count}/${group.member_count}</small>
    </button>`).join("");
  document.querySelectorAll("[data-view-group]").forEach((button) => button.addEventListener("click", () => openGroupMembers(button.dataset.viewGroup)));
}

function openGroupMembers(id) {
  const group = state.groups.find((item) => item.id === id);
  if (!group) return;
  state.selectedGroupId = id;
  const members = state.contacts.filter((contact) => contact.group_ids?.includes(id));
  $("#group-members-title").textContent = group.name;
  $("#group-members-summary").textContent = `${members.length} member${members.length === 1 ? "" : "s"}; ${group.eligible_count} currently opted in.`;
  $("#group-members-list").innerHTML = members.length ? members.map((contact) => `
    <div class="group-member"><div><strong>${escapeHtml(contactLabel(contact))}</strong><span>${escapeHtml(contact.phone)}</span></div><span class="status ${escapeHtml(contact.consent_status)}">${escapeHtml(contact.consent_status.replace("_", " "))}</span></div>`).join("")
    : '<p class="empty">No contacts are assigned to this group.</p>';
  $("#group-new-message").disabled = group.eligible_count < 1;
  $("#group-new-message").title = group.eligible_count < 1 ? "This group has no opted-in recipients." : "Compose a message to this group.";
  $("#group-members-dialog").showModal();
}

function composeSelectedGroup() {
  const id = state.selectedGroupId;
  if (!id) return;
  $("#group-members-dialog").close();
  openComposer("group", id, null, id);
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
        recurring_id: reminder.id,
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
    return `<div class="day${key === today ? " today" : ""}">
      <button class="day-number" type="button" data-day="${key}" aria-label="Compose a message for ${escapeHtml(dateLabel)}"><span class="day-weekday">${dayName}</span><span class="day-date">${escapeHtml(dateLabel)}</span></button>
      ${messages.map((message) => {
        const content = `${message.inactive_recurring ? '<strong>Inactive series</strong> · ' : ''}${escapeHtml(message.display_time || formatTime(message.scheduled_for))} · ${escapeHtml(message.target_name)}`;
        if (message.inactive_recurring) return `<button type="button" class="calendar-message ${message.status}" title="${escapeHtml(message.body)}" data-edit-recurring-occurrence="${message.recurring_id}">${content}</button>`;
        if (["draft", "scheduled"].includes(message.status)) return `<button type="button" class="calendar-message ${message.status}" title="${escapeHtml(message.body)}" data-edit-scheduled-message="${message.id}">${content}</button>`;
        return `<span class="calendar-message ${message.status}" title="${escapeHtml(message.body)}">${content}</span>`;
      }).join("")}
    </div>`;
  }).join("");
  document.querySelectorAll("[data-day]").forEach((button) => button.addEventListener("click", () => openComposer("individual", null, button.dataset.day)));
  document.querySelectorAll("[data-edit-scheduled-message]").forEach((button) => button.addEventListener("click", () => editMessage(button.dataset.editScheduledMessage)));
  document.querySelectorAll("[data-edit-recurring-occurrence]").forEach((button) => button.addEventListener("click", () => editRecurring(button.dataset.editRecurringOccurrence)));
}

function renderMessages() {
  const list = $("#message-list");
  list.innerHTML = state.messages.length ? state.messages.map((message) => `
    <article class="message-row">
      <span class="status ${message.status}">${escapeHtml(STATUS_LABELS[message.status] || message.status)}</span>
      <div class="message-copy"><strong>${escapeHtml(message.body)}</strong><span>${escapeHtml(message.target_name)} · ${message.recipient_count} recipient${message.recipient_count === 1 ? "" : "s"}</span>${message.failure_reason ? `<span class="needs-input">${escapeHtml(message.failure_reason)}</span>` : ""}</div>
      <span class="message-meta">${escapeHtml(formatDateTime(message.scheduled_for || message.created_at))}</span>
      ${["draft", "scheduled"].includes(message.status) ? `<button class="secondary" data-edit-message="${message.id}">Edit</button>` : ""}
    </article>`).join("") : `<p class="empty">No messages yet. Draft, send now, or schedule the first communication.</p>`;
  document.querySelectorAll("[data-edit-message]").forEach((button) => button.addEventListener("click", () => editMessage(button.dataset.editMessage)));
}

function renderStats() {
  for (const status of ["draft", "scheduled", "sent", "failed"]) {
    $(`#${status}-count`).textContent = state.messages.filter((message) => message.status === status).length;
  }
}

function targetOptions(type, selected) {
  const source = type === "individual" ? contactsForGroupContext(state.contacts, state.composerGroupId) : state.groups;
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
  const contextGroup = state.groups.find((group) => group.id === state.composerGroupId);
  note.textContent = !target ? (type === "individual" && contextGroup
    ? `Choose an individual member of ${contextGroup.name}.`
    : "Choose a recipient. Drafts can be saved before consent is verified.")
    : type === "individual"
      ? eligible ? "Verified opt-in. Consent will be checked again before immediate or scheduled delivery." : `This contact is ${target.consent_status.replace("_", " ")} and cannot receive a text.`
      : eligible ? `${target.eligible_count} opted-in member${target.eligible_count === 1 ? "" : "s"} will receive separate messages.` : "This group has no opted-in members and cannot receive a text.";
  const personalization = $("#personalize-name");
  const individual = type === "individual";
  $("#personalize-name-choice").hidden = !individual;
  personalization.disabled = !individual;
  if (!individual) personalization.checked = false;
  $("#personalization-note").textContent = personalizationHint(type, target, individual && personalization.checked);
  $("#schedule-message").disabled = Boolean(target && !eligible);
  const sendNow = $("#send-now");
  const immediateReady = Boolean(target && eligible && state.dispatch_control?.individual_enabled && state.storage_verified &&
    state.transport?.verified && state.transport?.enabled && !state.transport?.emergency_disabled && !state.messageBusy);
  sendNow.disabled = !immediateReady;
  sendNow.title = immediateReady ? "Send immediately through the approved AMG Quo number."
    : !state.dispatch_control?.individual_enabled ? "Turn Individual Texts on before using Send now."
      : "Choose an eligible opted-in recipient and verify the delivery connection.";
}

function openComposer(type = "individual", id = null, day = null, groupContextId = null) {
  state.draftId = null;
  state.messageEditSnapshot = null;
  state.composerGroupId = groupContextId;
  state.messageRequestKey = crypto.randomUUID();
  $("#composer-form").reset();
  $("#target-type").value = type;
  $("#message-timezone").value = timezone;
  $("#scheduled-for").value = day ? `${day}T09:00` : defaultScheduleValue();
  $("#char-count").textContent = "0 / 1600";
  $("#composer-error").textContent = "";
  $("#save-draft").hidden = false;
  targetOptions(type, id);
  $("#composer").showModal();
}

function editMessage(id) {
  const message = state.messages.find((item) => item.id === id);
  if (!message || !["draft", "scheduled"].includes(message.status)) return;
  openComposer(message.target_type, message.target_id);
  state.draftId = id;
  state.messageEditSnapshot = { id: message.id, updated_at: message.updated_at, status: message.status };
  $("#save-draft").hidden = message.status === "scheduled";
  $("#message-body").value = message.body;
  $("#message-timezone").value = message.timezone;
  if (message.scheduled_for) $("#scheduled-for").value = scheduleInputValue(message.scheduled_for, message.timezone);
  $("#char-count").textContent = `${message.body.length} / 1600`;
}

function editRecurring(id) {
  const reminder = (state.recurring_reminders || []).find((item) => item.id === id);
  if (!reminder) return;
  state.recurringDraftId = id;
  state.recurringEditSnapshot = { ...reminder, weekdays: [...reminder.weekdays] };
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
  const reminder = state.recurringEditSnapshot;
  const error = $("#recurring-error");
  const submit = event.submitter;
  error.textContent = "";
  state.recurringBusy = true;
  submit.disabled = true;
  let saved = false;
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
      expectedUpdatedAt: reminder.updated_at,
    });
    $("#recurring-dialog").close();
    saved = true;
    try {
      await load();
      toast("Inactive recurring draft saved.");
    } catch {
      toast("Reminder saved, but the dashboard could not refresh. Reload before editing again.");
    }
  } catch (reason) {
    error.textContent = reason.message;
    error.focus();
  } finally {
    state.recurringBusy = false;
    submit.disabled = false;
  }
  return saved;
}

function openContact(id = null) {
  const contact = state.contacts.find((item) => item.id === id);
  $("#contact-form").reset();
  $("#contact-title").textContent = contact ? "Edit contact" : "Add contact";
  $("#contact-id").value = contact?.id || "";
  state.contactEditVersion = contact?.updated_at || null;
  $("#contact-name").value = contact?.full_name || "";
  $("#contact-phone").value = contact?.phone || "";
  $("#contact-consent").value = contact?.consent_status || "opted_in";
  $("#consent-evidence").value = contact?.consent_evidence || "";
  $("#contact-timezone").value = contact?.timezone || timezone;
  $("#contact-groups").innerHTML = state.groups.map((group) => `<label><input type="checkbox" value="${group.id}" ${contact?.group_ids?.includes(group.id) ? "checked" : ""}>${escapeHtml(group.name)}</label>`).join("");
  $("#contact-error").textContent = "";
  updateManualOptInConfirmation();
  $("#contact-dialog").showModal();
}

function updateManualOptInConfirmation() {
  const confirmation = $("#manual-opt-in-confirmation");
  const checkbox = $("#manual-opt-in-confirmed");
  const required = !$("#contact-id").value && $("#contact-consent").value === "opted_in";
  confirmation.hidden = !required;
  checkbox.required = required;
  if (!required) checkbox.checked = false;
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
  let saved = false;
  try {
    const payload = {
      action: "save_message", messageId: state.draftId,
      body: $("#message-body").value, targetType: $("#target-type").value,
      targetId: $("#target-id").value, status,
      scheduledFor: status === "scheduled" ? new Date($("#scheduled-for").value).toISOString() : null,
      timezone: $("#message-timezone").value,
      idempotencyKey: state.messageRequestKey,
      expectedUpdatedAt: state.messageEditSnapshot?.updated_at || null,
    };
    await api(payload);
    $("#composer").close();
    saved = true;
    try {
      await load();
      toast(status === "draft" ? "Draft saved." : "Message scheduled.");
    } catch {
      toast("Message saved, but the dashboard could not refresh. Reload before editing again.");
    }
  } catch (reason) {
    error.textContent = reason.message;
    error.focus();
  } finally {
    state.messageBusy = false;
    form.removeAttribute("aria-busy");
    $("#save-draft").disabled = false;
    updateRecipientNote();
  }
  return saved;
}

function openScheduleSaveConfirmation(kind) {
  const form = kind === "message" ? $("#composer-form") : $("#recurring-form");
  if (!form.reportValidity()) return;
  state.pendingScheduleSave = kind;
  $("#schedule-save-summary").textContent = kind === "message"
    ? `${state.messageEditSnapshot?.status === "scheduled" ? "Update" : "Save"} this one-time scheduled message? Contact names will not be added automatically.`
    : "Update this recurring series draft? Future calendar occurrences will reflect the saved series content.";
  $("#schedule-save-error").textContent = "";
  $("#schedule-save-dialog").showModal();
}

async function confirmScheduleSave(event) {
  event.preventDefault();
  const kind = state.pendingScheduleSave;
  if (!kind || state.messageBusy || state.recurringBusy) return;
  const submitter = $("#confirm-schedule-save");
  const submitLabel = submitter.textContent;
  submitter.disabled = true;
  submitter.textContent = "Saving…";
  try {
    const saved = kind === "message"
      ? await saveMessage("scheduled")
      : await saveRecurring({ preventDefault() {}, submitter });
    if (saved) $("#schedule-save-dialog").close();
    else {
      $("#schedule-save-error").textContent = kind === "message"
        ? $("#composer-error").textContent
        : $("#recurring-error").textContent;
      $("#schedule-save-error").focus();
    }
  } catch (reason) {
    $("#schedule-save-error").textContent = reason.message;
    $("#schedule-save-error").focus();
  } finally {
    submitter.disabled = false;
    submitter.textContent = submitLabel;
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
  if (!state.dispatch_control?.individual_enabled || !state.storage_verified || !state.transport?.verified ||
    !state.transport?.enabled || state.transport?.emergency_disabled) {
    $("#composer-error").textContent = "Send now is unavailable until the verified delivery connection and Individual Texts are on.";
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
      personalizeName: $("#target-type").value === "individual" && $("#personalize-name").checked,
    });
    await load();
    if (result.status === "queued") {
      $("#send-now-dialog").close();
      $("#composer").close();
      toast(`${result.recipientCount} message${result.recipientCount === 1 ? "" : "s"} queued for delivery.`);
      return;
    }
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
  if (startupBusy) return;
  $("#login-error").textContent = "";
  $("#login-submit").disabled = true;
  resetInquiries();
  resetLicensing();
  try {
    if (!authClient) throw new Error("Sign-in service is still loading. Try again in a moment.");
    const { error } = await authClient.auth.signInWithPassword({ email: $("#login-email").value, password: $("#login-password").value });
    if (error) throw error;
    await verifyAdminSession();
  }
  catch (error) { $("#login-error").textContent = error.message || "Sign in failed."; }
  finally { $("#login-submit").disabled = !authClient; }
});
$("#sign-out").addEventListener("click", async () => {
  if (startupBusy) return;
  resetInquiries();
  resetLicensing();
  showStartup("Signing out securely…");
  await authClient.auth.signOut();
  showLogin();
});
$("#startup-retry").addEventListener("click", () => authClient ? verifyAdminSession() : init());
$("#startup-sign-in").addEventListener("click", () => showLogin());
document.querySelectorAll("[data-admin-view]").forEach((button) => button.addEventListener("click", () => showAdminView(button.dataset.adminView)));
$("#refresh-inquiries").addEventListener("click", () => loadInquiries(1));
$("#previous-inquiries").addEventListener("click", () => loadInquiries(inquiryState.page - 1));
$("#next-inquiries").addEventListener("click", () => loadInquiries(inquiryState.page + 1));
$("#refresh-licensing").addEventListener("click", () => loadLicensing(1));
$("#previous-licensing").addEventListener("click", () => loadLicensing(licensingState.page - 1));
$("#next-licensing").addEventListener("click", () => loadLicensing(licensingState.page + 1));
$("#add-license-person").addEventListener("click", () => openLicensingPerson());
let licensingSearchTimer;
$("#licensing-search").addEventListener("input", (event) => { clearTimeout(licensingSearchTimer); licensingSearchTimer = setTimeout(() => { licensingState.query = event.target.value.trim(); void loadLicensing(1); }, 250); });
$("#licensing-filter").addEventListener("change", (event) => { licensingState.status = event.target.value; void loadLicensing(1); });
$("#license-exam-status").addEventListener("change", (event) => {
  const slider = $("#license-stage-editor");
  if (event.target.value === 'passed' && Number(slider.value) < 3) slider.value = '3';
  else if (event.target.value !== 'passed' && Number(slider.value) >= 3) slider.value = ['scheduled', 'rescheduled', 'failed'].includes(event.target.value) ? '2' : '1';
  else if (['scheduled', 'rescheduled', 'failed'].includes(event.target.value)) slider.value = '2';
  else if (event.target.value === 'studying') slider.value = '1';
  updateLicensingSlider(slider);
});
$("#license-steps").addEventListener("input", (event) => {
  if (!event.target.matches('[data-stage-editor]')) return;
  updateLicensingSlider(event.target);
  const stage = Number(event.target.value);
  $("#license-exam-status").value = stage >= 3 ? 'passed' : stage === 2 ? 'scheduled' : 'studying';
});
$("#licensing-person-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true;
  $("#licensing-person-error").textContent = "";
  try {
    await licensingApi({ action: "save_person", id: $("#licensing-person-id").value || null, expectedVersion: Number($("#licensing-person-version").value) || null,
      name: $("#license-name").value, email: $("#license-email").value, phone: $("#license-phone").value,
      recruiter: $("#license-recruiter").value, state: $("#license-state").value, track: $("#license-track").value,
      examStatus: $("#license-exam-status").value, examDate: $("#license-exam-date").value,
      followUpDate: $("#license-follow-up").value, firstCheckDate: $("#license-first-check").value,
      nextAction: $("#license-next-action").value, blocker: $("#license-blocker").value,
      completedSteps: selectedStepsForStage(Number($("#license-stage-editor").value)) });
    $("#licensing-person-dialog").close();
    await loadLicensing(1);
    toast("Licensing progress saved.");
  } catch (reason) { $("#licensing-person-error").textContent = reason.message; } finally { button.disabled = false; }
});
$("#licensing-list").addEventListener("input", (event) => {
  if (event.target.matches('[data-license-stage]')) updateLicensingSlider(event.target);
});
$("#licensing-list").addEventListener("change", async (event) => {
  const input = event.target.closest('[data-license-stage]');
  if (!input) return;
  const person = licensingState.people.find(item => item.id === input.dataset.licenseStage);
  if (!person) return;
  const box = input.closest('.licensing-slider');
  input.disabled = true;
  box.querySelector('[role="status"]').textContent = 'Saving…';
  try {
    const payload = await licensingApi({ action: "set_stage", id: person.id, expectedVersion: person.version, stage: Number(input.value) });
    const updated = payload.person;
    const appointed = item => item.tasks?.appointed?.done === true;
    const before = item => item.exam_status !== 'passed';
    const onboard = item => !before(item) && !appointed(item);
    const overdue = item => !!item.follow_up_date && item.follow_up_date < new Date().toISOString().slice(0,10) && !appointed(item);
    for (const [key, match] of [['preLicense', before], ['onboarding', onboard], ['appointed', appointed], ['overdue', overdue]]) licensingState[key] += Number(match(updated)) - Number(match(person));
    licensingState.people = licensingState.people.map(item => item.id === person.id ? updated : item);
    renderLicensing();
    const saved = document.getElementById(`license-stage-${person.id}`);
    saved.closest('.licensing-slider').querySelector('[role="status"]').textContent = 'Saved. Earlier steps are marked complete.';
    saved.focus({ preventScroll: true });
  } catch (reason) {
    const progress = licensingProgress(person);
    input.value = String(progress.current < 0 ? 6 : progress.current + 1);
    updateLicensingSlider(input);
    input.disabled = false;
    box.querySelector('[role="status"]').textContent = reason.message || 'Could not save. Try again.';
    toast(reason.message || 'Could not update step.');
  }
});
$("#licensing-list").addEventListener("click", (event) => {
  const edit = event.target.closest('[data-license-edit]');
  if (edit) { openLicensingPerson(licensingState.people.find((person) => person.id === edit.dataset.licenseEdit)); return; }

});
$("#licensing-activity-list").addEventListener("click", (event) => {
  const button = event.target.closest('[data-license-learner]');
  if (!button) return;
  try { openLicensingPerson(JSON.parse(decodeURIComponent(button.dataset.licenseLearner))); } catch { toast("Could not open learner."); }
});
$("#new-message").addEventListener("click", () => openComposer());
$("#group-new-message").addEventListener("click", composeSelectedGroup);
$("#add-contact").addEventListener("click", () => openContact());
$("#contact-search").addEventListener("input", (event) => { state.search = event.target.value; renderContacts(); });
$("#contact-consent").addEventListener("change", updateManualOptInConfirmation);
$("#target-type").addEventListener("change", (event) => {
  $("#personalize-name").checked = false;
  targetOptions(event.target.value);
});
$("#target-id").addEventListener("change", updateRecipientNote);
$("#personalize-name").addEventListener("change", updateRecipientNote);
$("#message-body").addEventListener("input", (event) => { $("#char-count").textContent = `${event.target.value.length} / 1600`; });
$("#save-draft").addEventListener("click", () => saveMessage("draft"));
$("#send-now").addEventListener("click", openSendNowConfirmation);
$("#composer-form").addEventListener("submit", (event) => { event.preventDefault(); openScheduleSaveConfirmation("message"); });
$("#send-now-form").addEventListener("submit", sendMessageNow);
$("#recurring-form").addEventListener("submit", (event) => { event.preventDefault(); openScheduleSaveConfirmation("recurring"); });
$("#schedule-save-form").addEventListener("submit", confirmScheduleSave);
$("#schedule-save-dialog").addEventListener("close", () => { state.pendingScheduleSave = null; });
document.querySelectorAll("[data-toggle-channel]").forEach((button) =>
  button.addEventListener("click", () => openDispatchConfirmation(button.dataset.toggleChannel)));
$("#delivery-control-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const change = state.pendingDispatchChange;
  if (change) setDispatchChannel(change.channel, change.enabled);
});
$("#delivery-control-dialog").addEventListener("close", () => {
  if (!state.dispatchBusy) state.pendingDispatchChange = null;
});
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
      expectedUpdatedAt: state.contactEditVersion,
      fullName: $("#contact-name").value, phone: $("#contact-phone").value,
      consentStatus: $("#contact-consent").value,
      consentConfirmed: $("#manual-opt-in-confirmed").checked,
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
    const previewMode = previewParams.get("preview");
    if (previewMode === "loading") { showStartup(); return; }
    if (previewMode === "verification-error") { showStartupError("The secure session could not be verified. Retry verification or return to sign in."); return; }
    if (previewMode === "login") { showLogin("Your session expired. Sign in again."); return; }
    $("#startup-view").hidden = true;
    $("#auth-view").hidden = true;
    $("#app").hidden = false;
    Object.assign(state, {
      contacts: [{ id: "preview-contact", full_name: "Test Contact", phone: "+12025550123", consent_status: "opted_in", timezone, group_ids: ["00000000-0000-4000-8000-000000000000"] }],
      groups: ["Marketing Directors", "AMG Hierarchy", "AMG Baseshop"].map((name, index) => ({ id: `00000000-0000-4000-8000-00000000000${index}`, name, member_count: index === 0 ? 1 : 0, eligible_count: index === 0 ? 1 : 0 })),
      messages: [{ id: "preview-scheduled", body: "Synthetic scheduled preview.", target_type: "individual", target_id: "preview-contact", target_name: "Test Contact", status: "scheduled", scheduled_for: "2026-11-03T14:30:00.000Z", timezone: "America/New_York", updated_at: "2026-11-03T12:00:00.000Z", recipient_count: 1, created_at: "2026-11-03T12:00:00.000Z" }],
      recurring_reminders: [
        { id: "preview-book", name: "AMG Book Club", body: "Good morning, AMG! It’s time for AMG Book Club.", target_group_id: null, target_group_name: null, zoom_url: null, meeting_url_required: true, timezone: "America/New_York", local_time: "09:00:00", weekdays: [2, 3, 4, 5], start_date: "2026-10-01", status: "draft", idempotency_key: "00000000-0000-4000-8000-000000000010" },
        { id: "preview-thursday", name: "BOM Thursday Reminder", body: "Good morning, AMG! Tonight’s BOM starts at 7 PM.", target_group_id: null, target_group_name: null, zoom_url: null, meeting_url_required: false, timezone: "America/New_York", local_time: "11:00:00", weekdays: [4], start_date: "2026-10-01", status: "draft", idempotency_key: "00000000-0000-4000-8000-000000000011" },
        { id: "preview-friday", name: "BOM Saturday Reminder", body: "Good evening, AMG! Tomorrow’s BOM starts at 9 AM.", target_group_id: null, target_group_name: null, zoom_url: null, meeting_url_required: false, timezone: "America/New_York", local_time: "21:00:00", weekdays: [5], start_date: "2026-10-01", status: "draft", idempotency_key: "00000000-0000-4000-8000-000000000012" },
      ],
      transport: { provider: "Quo", configured: true, verified: true,
        enabled: previewParams.has("individual-on") || previewParams.has("scheduled-on"), emergency_disabled: false },
      storage_verified: !previewParams.has("storage-off"),
      dispatch_control: {
        individual_enabled: previewParams.has("individual-on"),
        scheduled_enabled: previewParams.has("scheduled-on"),
        version: 1, changed_at: null, changed_by: null, audit: [],
      },
      admin_invitations: [],
    });
    render();
    if (previewMode === "inquiries" || previewMode === "inquiries-empty" || previewMode === "inquiries-error") {
      Object.assign(inquiryState, {
        preview: true, total: previewMode === "inquiries" ? 1 : 0,
        records: previewMode === "inquiries" ? [{ id: "preview-inquiry", full_name: "Jordan Sample", email: "jordan@example.com", phone: "+12025550123", interest: "Retirement Planning", message: "I would like to learn more about retirement planning.\nPlease contact me in the afternoon to discuss next steps.", created_at: "2026-11-04T14:30:00.000Z" }] : [],
        error: previewMode === "inquiries-error" ? "Unable to load inquiries. Try refreshing again." : "",
      });
      showAdminView("inquiries");
    } else if (previewMode === "licensing") {
      Object.assign(licensingState, { preview: true, total: 0, people: [], learners: [] });
      showAdminView("licensing");
    }
    return;
  }
  try {
    showStartup();
    const response = await fetch("/api/admin/config", { headers: { accept: "application/json" } });
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || "CRM backend is not configured.");
    authClient = createClient(config.url, config.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    authClient.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") { resetInquiries(); resetLicensing(); } });
    $("#login-submit").disabled = false;
    await verifyAdminSession();
  } catch (error) {
    showStartupError(error.message || "AMG could not start secure verification. Retry when your connection is ready.");
  }
}

init();
