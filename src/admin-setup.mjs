import { createClient } from "@supabase/supabase-js";
import { authLinkError, normalizeEmail, passwordChecks, validateSetup } from "../admin/setup/core.mjs";

const $ = (selector) => document.querySelector(selector);
let authClient = null;
let recoveryMode = false;
let setupBusy = false;
let recoveryBusy = false;

function setBusy(value) {
  setupBusy = value;
  $("#setup-form").setAttribute("aria-busy", String(value));
  $("#setup-submit").disabled = value || !authClient;
  $("#send-recovery").disabled = value || recoveryBusy || !authClient;
}

function renderPasswordRules() {
  const checks = passwordChecks($("#new-password").value);
  Object.entries(checks).forEach(([rule, met]) => {
    $(`[data-rule="${rule}"]`).classList.toggle("met", met);
  });
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
  $("#setup-intro").textContent = "Choose and confirm a new password for the approved account shown below.";
  $("#recovery-panel").hidden = true;
  history.replaceState({}, document.title, "/admin/setup/");
}

async function verifyCrmAdmin() {
  const { data } = await authClient.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your secure setup session has expired. Request a new recovery email.");
  const response = await fetch("/api/admin/crm", { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  if (!response.ok) throw new Error(response.status === 403 ? "This account is not approved for the AMG dashboard." : "The dashboard could not verify this account. Try again.");
}

async function savePassword(event) {
  event.preventDefault();
  if (setupBusy) return;
  showError("");
  const email = normalizeEmail($("#setup-email").value);
  const currentPassword = $("#current-password").value;
  const password = $("#new-password").value;
  const confirmation = $("#confirm-password").value;
  const validation = validateSetup({ email, currentPassword, password, confirmation, recoveryMode });
  if (validation) return showError(validation);
  setBusy(true);
  try {
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
    $("#confirm-password").value = "";
  } catch (reason) {
    if (!recoveryMode) await authClient.auth.signOut({ scope: "local" }).catch(() => {});
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
    if (preview === "expired") { $("#link-error").textContent = "This setup link has expired or was already used. Request a new secure recovery email below."; $("#link-error").hidden = false; }
    return;
  }
  try {
    const response = await fetch("/api/admin/config", { headers: { accept: "application/json" } });
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || "Dashboard authentication is unavailable.");
    authClient = createClient(config.url, config.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    authClient.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session?.user?.email) enterRecoveryMode(session.user.email);
    });
    const linkError = authLinkError(location.href);
    if (linkError) { $("#link-error").textContent = linkError; $("#link-error").hidden = false; history.replaceState({}, document.title, "/admin/setup/"); }
    const { data } = await authClient.auth.getUser();
    const hashType = new URLSearchParams(location.hash.replace(/^#/, "")).get("type");
    if (hashType === "recovery" && data.user?.email) enterRecoveryMode(data.user.email);
    else if (data.user?.email) $("#setup-email").value = normalizeEmail(data.user.email);
    $("#setup-submit").disabled = false;
    $("#send-recovery").disabled = false;
  } catch (reason) {
    showError(reason.message || "Dashboard authentication is unavailable.");
  }
}

$("#setup-form").addEventListener("submit", savePassword);
$("#send-recovery").addEventListener("click", sendRecoveryEmail);
$("#new-password").addEventListener("input", renderPasswordRules);
init();
