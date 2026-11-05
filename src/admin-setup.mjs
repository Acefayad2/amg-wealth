import { createClient } from "@supabase/supabase-js";
import { authLinkError, normalizeEmail, validateSetup } from "../admin/setup/core.mjs";

const $ = (selector) => document.querySelector(selector);
let authClient = null;
let supabaseUrl = "";
let supabaseKey = "";
let recoveryMode = false;
let invitationMode = false;
let setupBusy = false;
let recoveryBusy = false;
const query = new URLSearchParams(location.search);
const fragment = new URLSearchParams(location.hash.slice(1));
const inviteToken = fragment.get("invite") ?? query.get("invite");
const initialAuthType = fragment.get("type");

function setBusy(value) {
  setupBusy = value;
  $("#setup-form").setAttribute("aria-busy", String(value));
  $("#setup-submit").disabled = value || (invitationMode ? !supabaseKey : !authClient);
  $("#send-recovery").disabled = value || recoveryBusy || !authClient;
}

function showError(message) {
  const error = $("#setup-error");
  error.textContent = message;
  if (message) error.focus();
}

function enterRecoveryMode(email) {
  recoveryMode = true;
  $("#setup-email").value = normalizeEmail(email);
  $("#setup-email").readOnly = true;
  $("#current-password-field").hidden = true;
  $("#current-password").required = false;
  $("#setup-intro").textContent = "Choose a new password for the approved account shown below.";
  $("#recovery-panel").hidden = true;
  history.replaceState({}, document.title, "/admin/setup/");
}

function enterInvitationMode() {
  invitationMode = true;
  $("#setup-title").textContent = "Create your admin account";
  $("#setup-intro").textContent = "Choose the email and password you will use to sign in to AMG Communications. This personal link works once.";
  $("#setup-email").readOnly = false;
  $("#current-password-field").hidden = true;
  $("#current-password").required = false;
  $("#setup-submit").textContent = "Create admin account";
  $("#invitation-guidance").hidden = true;
  $("#recovery-panel").hidden = true;
}

async function verifyCrmAdmin() {
  const { data } = await authClient.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your secure setup session has expired. Request a new recovery email.");
  const response = await fetch("/api/admin/crm", { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  if (!response.ok) throw new Error(response.status === 403 ? "This account is not approved for the AMG dashboard." : "The dashboard could not verify this account. Try again.");
}

function showInvitationNotice(message) {
  $("#setup-form").hidden = true;
  $("#setup-intro").hidden = true;
  $("#new-password").value = "";
  const error = $("#link-error");
  error.textContent = message;
  error.hidden = false;
  error.focus();
}

function showExpiredInvitation() {
  showInvitationNotice("This personal link has expired or was already used. If you created your account, sign in below. Otherwise, ask an AMG administrator for a new link.");
}

async function requestInvitation(fields) {
  const response = await fetch(`${supabaseUrl}/functions/v1/amg-admin-complete-invite`, {
    method: "POST",
    headers: { authorization: `Bearer ${supabaseKey}`, apikey: supabaseKey, "content-type": "application/json" },
    body: JSON.stringify({ inviteToken, ...fields }),
  });
  if (response.status === 410) {
    showExpiredInvitation();
    return false;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.error || "Account setup is temporarily unavailable. Try again.");
  }
  return true;
}

async function acceptInvitation(email, password) {
  if (!await requestInvitation({ email, password })) return;
  $("#new-password").value = "";
  $("#setup-form").hidden = true;
  $("#setup-intro").hidden = true;
  $("#setup-success-title").textContent = "Admin account created";
  $("#setup-success-copy").textContent = `Sign in to AMG Communications with ${email} and the password you chose. This personal link has been used.`;
  history.replaceState({}, document.title, "/admin/setup/");
  $("#setup-success").hidden = false;
  $("#setup-success").focus();
}

async function savePassword(event) {
  event.preventDefault();
  if (setupBusy) return;
  showError("");
  const email = normalizeEmail($("#setup-email").value);
  const currentPassword = $("#current-password").value;
  const password = $("#new-password").value;
  const validation = validateSetup({ email, currentPassword, password, recoveryMode: recoveryMode || invitationMode });
  if (validation) return showError(validation);
  setBusy(true);
  try {
    if (invitationMode) {
      await acceptInvitation(email, password);
      return;
    }
    if (!recoveryMode) {
      const { error } = await authClient.auth.signInWithPassword({ email, password: currentPassword });
      if (error) throw new Error("Email or current password is incorrect.");
    }
    await verifyCrmAdmin();
    const { error } = await authClient.auth.updateUser({ password });
    if (error) throw error;
    await authClient.auth.signOut({ scope: "local" });
    $("#setup-form").hidden = true;
    $("#recovery-panel").hidden = true;
    $("#setup-success").hidden = false;
    $("#setup-success").focus();
    $("#current-password").value = "";
    $("#new-password").value = "";
    } catch (reason) {
    if (!invitationMode && !recoveryMode) await authClient.auth.signOut({ scope: "local" }).catch(() => {});
    showError(reason.message || "The password could not be saved.");
  } finally {
    setBusy(false);
  }
}

async function sendRecoveryEmail() {
  if (recoveryBusy || setupBusy || !authClient) return;
  const email = normalizeEmail($("#setup-email").value);
  if (!/^\S+@\S+\.\S+$/.test(email)) return showError("Enter a valid email address first.");
  recoveryBusy = true;
  $("#send-recovery").disabled = true;
  $("#recovery-status").textContent = "";
  showError("");
  try {
    const { error } = await authClient.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/admin/setup/` });
    if (error) throw error;
    $("#recovery-status").textContent = "If this email belongs to an approved account, a secure recovery email is on the way.";
    $("#recovery-status").focus();
  } catch {
    showError("A recovery email could not be requested. Try again later or contact the AMG administrator.");
  } finally {
    recoveryBusy = false;
    $("#send-recovery").disabled = !authClient;
  }
}

async function init() {
  const preview = ["127.0.0.1", "localhost"].includes(location.hostname) ? new URLSearchParams(location.search).get("preview") : "";
  if (preview) {
    authClient = {};
    $("#setup-submit").disabled = false;
    $("#send-recovery").disabled = false;
    if (preview === "recovery") enterRecoveryMode("approved@example.test");
    if (preview === "invite") enterInvitationMode();
    if (preview === "expired") { enterInvitationMode(); showExpiredInvitation(); }
    return;
  }
  if (inviteToken !== null) {
    enterInvitationMode();
    $("#setup-form").hidden = true;
    if (!inviteToken) {
      showExpiredInvitation();
      return;
    }
    if (query.has("invite")) {
      history.replaceState({}, document.title, `/admin/setup/#invite=${encodeURIComponent(inviteToken)}`);
    }
  }
  try {
    const response = await fetch("/api/admin/config", { headers: { accept: "application/json" } });
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || "Dashboard authentication is unavailable.");
    supabaseUrl = config.url;
    supabaseKey = config.key;
    if (invitationMode) {
      if (await requestInvitation({ action: "check" })) {
        $("#setup-form").hidden = false;
        $("#setup-submit").disabled = false;
      }
      return;
    }
    authClient = createClient(config.url, config.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    authClient.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session?.user?.email) enterRecoveryMode(session.user.email);
    });
    const linkError = authLinkError(location.href);
    if (linkError) { $("#link-error").textContent = linkError; $("#link-error").hidden = false; }
    const { data } = await authClient.auth.getUser();
    if (initialAuthType === "recovery" && data.user?.email) enterRecoveryMode(data.user.email);
    else if (data.user?.email) $("#setup-email").value = normalizeEmail(data.user.email);
    $("#setup-submit").disabled = false;
    $("#send-recovery").disabled = false;
  } catch (reason) {
    if (invitationMode) {
      showInvitationNotice("The setup service could not check this link. Reload this page to try again.");
    } else {
      showError(reason.message || "Dashboard authentication is unavailable.");
    }
  }
}

$("#setup-form").addEventListener("submit", savePassword);
$("#send-recovery").addEventListener("click", sendRecoveryEmail);
init();
