import { createClient } from "@supabase/supabase-js";
import { authLinkError, normalizeEmail, passwordChecks, validateSetup } from "../admin/setup/core.mjs";

const $ = (selector) => document.querySelector(selector);
let authClient = null;
let supabaseUrl = "";
let supabaseKey = "";
let recoveryMode = false;
let invitationMode = false;
let invitePhoneVerified = false;
let setupBusy = false;
let recoveryBusy = false;
let phoneBusy = false;
const inviteToken = new URLSearchParams(location.search).get("invite") || "";
const initialAuthType = new URLSearchParams(location.hash.replace(/^#/, "")).get("type");

function setBusy(value) {
  setupBusy = value;
  $("#setup-form").setAttribute("aria-busy", String(value));
  $("#setup-submit").disabled = value || !authClient;
  $("#send-recovery").disabled = value || recoveryBusy || !authClient;
}

function renderPasswordRules() {
  const checks = passwordChecks($("#new-password").value);
  Object.entries(checks).forEach(([rule, met]) => $(`[data-rule="${rule}"]`).classList.toggle("met", met));
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

function enterInvitationMode() {
  invitationMode = true;
  recoveryMode = true;
  $("#setup-email").value = "";
  $("#setup-email").readOnly = false;
  $("#current-password-field").hidden = true;
  $("#current-password").required = false;
  $("#setup-intro").textContent = "Verify the invited phone, then choose your own email and create a dashboard password.";
  $("#setup-submit").textContent = "Create admin account";
  $("#invitation-guidance").hidden = true;
  $("#recovery-panel").hidden = true;
  $("#phone-verification").hidden = invitePhoneVerified;
  $("#setup-form").hidden = !invitePhoneVerified;
}

async function verifyCrmAdmin() {
  const { data } = await authClient.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your secure setup session has expired. Request a new recovery email.");
  const response = await fetch("/api/admin/crm", { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  if (!response.ok) throw new Error(response.status === 403 ? "This account is not approved for the AMG dashboard." : "The dashboard could not verify this account. Try again.");
}

async function bindVerifiedPhone() {
  const { error } = await authClient.rpc("amg_crm_bind_verified_invite_phone", { p_token: inviteToken });
  if (error) throw new Error("This invitation does not match the verified phone or has expired.");
  invitePhoneVerified = true;
  enterInvitationMode();
}

async function acceptInvitation() {
  const { error } = await authClient.rpc("amg_crm_accept_phone_admin_invite", { p_token: inviteToken });
  if (error) throw new Error("Admin access could not be granted. Verify both the invited phone and chosen email, or ask an AMG administrator for a new invitation.");
  await verifyCrmAdmin();
  $("#setup-success-title").textContent = "Admin account ready";
  $("#setup-success-copy").textContent = "Your verified phone and chosen email are now approved for the AMG dashboard.";
  $("#phone-verification").hidden = true;
  $("#setup-form").hidden = true;
  $("#email-confirmation").hidden = true;
  $("#setup-success").hidden = false;
  $("#setup-success").focus();
  await authClient.auth.signOut({ scope: "local" });
  history.replaceState({}, document.title, "/admin/setup/");
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
  if (invitationMode && !invitePhoneVerified) return showError("Verify the invited phone before creating the account.");
  setBusy(true);
  try {
    if (!recoveryMode) {
      const { error } = await authClient.auth.signInWithPassword({ email, password: currentPassword });
      if (error) throw new Error("Email or current password is incorrect.");
    }
    if (invitationMode) {
      const redirectTo = `${location.origin}/admin/setup/?invite=${encodeURIComponent(inviteToken)}`;
      const { data, error } = await authClient.auth.updateUser({ email, password }, { emailRedirectTo: redirectTo });
      if (error) throw error;
      if (data.user?.email_confirmed_at && normalizeEmail(data.user.email) === email) await acceptInvitation();
      else {
        $("#setup-form").hidden = true;
        $("#email-confirmation").hidden = false;
        $("#email-confirmation").focus();
      }
      return;
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

async function requestPhoneCode() {
  if (phoneBusy || !authClient) return;
  const phone = $("#invite-phone").value.trim();
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) return showError("Enter the invited phone in E.164 format, such as +12025550123.");
  phoneBusy = true;
  $("#send-phone-code").disabled = true;
  $("#phone-status").textContent = "";
  showError("");
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/amg-admin-phone-otp`, {
      method: "POST",
      headers: { authorization: `Bearer ${supabaseKey}`, apikey: supabaseKey, "content-type": "application/json" },
      body: JSON.stringify({ phone, inviteToken }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The verification code could not be sent.");
    $("#phone-code-fields").hidden = false;
    $("#phone-status").textContent = "A one-time code was sent to the invited phone.";
    $("#phone-code").focus();
  } catch (reason) {
    showError(reason.message || "The verification code could not be sent.");
  } finally {
    phoneBusy = false;
    $("#send-phone-code").disabled = false;
  }
}

async function verifyPhoneCode() {
  if (phoneBusy || !authClient) return;
  const phone = $("#invite-phone").value.trim();
  const otp = $("#phone-code").value.trim();
  if (!/^[0-9]{6}$/.test(otp)) return showError("Enter the 6-digit verification code.");
  phoneBusy = true;
  $("#verify-phone-code").disabled = true;
  showError("");
  try {
    const { error } = await authClient.auth.verifyOtp({ phone, token: otp, type: "sms" });
    if (error) throw new Error("The phone verification code is invalid or expired.");
    await bindVerifiedPhone();
    $("#setup-email").focus();
  } catch (reason) {
    showError(reason.message || "The phone could not be verified.");
  } finally {
    phoneBusy = false;
    $("#verify-phone-code").disabled = false;
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
    if (preview === "invite") { invitePhoneVerified = new URLSearchParams(location.search).has("verified"); enterInvitationMode(); }
    if (preview === "expired") { $("#link-error").textContent = "This setup link has expired or was already used. Request a new private setup text from an AMG administrator."; $("#link-error").hidden = false; }
    return;
  }
  try {
    const response = await fetch("/api/admin/config", { headers: { accept: "application/json" } });
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || "Dashboard authentication is unavailable.");
    supabaseUrl = config.url;
    supabaseKey = config.key;
    authClient = createClient(config.url, config.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    authClient.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session?.user?.email && !inviteToken) enterRecoveryMode(session.user.email);
    });
    const linkError = authLinkError(location.href);
    if (linkError) { $("#link-error").textContent = linkError; $("#link-error").hidden = false; }
    const { data } = await authClient.auth.getUser();
    if (inviteToken) {
      if (data.user?.phone_confirmed_at) {
        try { await bindVerifiedPhone(); } catch { enterInvitationMode(); }
        if (data.user?.email_confirmed_at && data.user?.email) await acceptInvitation();
      } else enterInvitationMode();
    } else if (initialAuthType === "recovery" && data.user?.email) enterRecoveryMode(data.user.email);
    else if (data.user?.email) $("#setup-email").value = normalizeEmail(data.user.email);
    $("#setup-submit").disabled = false;
    $("#send-recovery").disabled = false;
  } catch (reason) {
    showError(reason.message || "Dashboard authentication is unavailable.");
  }
}

$("#setup-form").addEventListener("submit", savePassword);
$("#send-recovery").addEventListener("click", sendRecoveryEmail);
$("#send-phone-code").addEventListener("click", requestPhoneCode);
$("#verify-phone-code").addEventListener("click", verifyPhoneCode);
$("#new-password").addEventListener("input", renderPasswordRules);
init();
