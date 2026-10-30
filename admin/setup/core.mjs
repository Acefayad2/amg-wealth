export const PASSWORD_MIN_LENGTH = 12;

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function passwordChecks(password) {
  const value = String(password || "");
  return {
    length: value.length >= PASSWORD_MIN_LENGTH,
    upper: /[A-Z]/.test(value),
    lower: /[a-z]/.test(value),
    number: /[0-9]/.test(value),
    symbol: /[^A-Za-z0-9]/.test(value),
  };
}

export function validateSetup({ email, currentPassword, password, confirmation, recoveryMode = false }) {
  const checks = passwordChecks(password);
  if (!/^\S+@\S+\.\S+$/.test(normalizeEmail(email))) return "Enter a valid email address.";
  if (!recoveryMode && !String(currentPassword || "")) return "Enter your current password.";
  if (!Object.values(checks).every(Boolean)) return "Use at least 12 characters with uppercase, lowercase, a number, and a symbol.";
  if (password !== confirmation) return "New password and confirmation must match.";
  if (!recoveryMode && password === currentPassword) return "Choose a new password that is different from your current password.";
  return "";
}

export function authLinkError(urlValue) {
  const url = new URL(urlValue, "https://example.test");
  const params = new URLSearchParams(url.hash.replace(/^#/, ""));
  const code = params.get("error_code") || params.get("error");
  if (!code) return "";
  if (["otp_expired", "access_denied"].includes(code)) return "This setup link has expired or was already used. Request a new secure recovery email below.";
  return "This setup link could not be verified. Request a new secure recovery email below.";
}
