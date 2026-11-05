export const PASSWORD_MIN_LENGTH = 8;

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function validateSetup({ email, currentPassword, password, recoveryMode = false }) {
  if (!/^\S+@\S+\.\S+$/.test(normalizeEmail(email))) return "Enter a valid email address.";
  if (!recoveryMode && !String(currentPassword || "")) return "Enter your current password.";
  if (String(password || "").length < PASSWORD_MIN_LENGTH) return "Use at least 8 characters for your password.";
  if (!recoveryMode && password === currentPassword) return "Choose a new password that is different from your current password.";
  return "";
}

export function authLinkError(urlValue) {
  const url = new URL(urlValue, "https://example.test");
  const params = new URLSearchParams(url.hash.replace(/^#/, ""));
  const code = params.get("error_code") || params.get("error");
  if (!code) return "";
  if (["otp_expired", "access_denied"].includes(code)) return "This setup link has expired or was already used. Request a new secure setup email from an AMG administrator.";
  return "This setup link could not be verified. Request a new secure setup email from an AMG administrator.";
}
