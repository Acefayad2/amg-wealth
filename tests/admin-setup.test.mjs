import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { authLinkError, normalizeEmail, validateSetup } from "../admin/setup/core.mjs";

test("normalizes the approved email without changing identity", () => {
  assert.equal(normalizeEmail("  AceFayad@Gmail.com "), "acefayad@gmail.com");
});

test("accepts one password field with a basic minimum length", () => {
  assert.match(validateSetup({ email: "approved@example.test", currentPassword: "Old!Password1", password: "short" }), /8 characters/);
  assert.match(validateSetup({ email: "approved@example.test", currentPassword: "SamePass1", password: "SamePass1" }), /different/);
  assert.equal(validateSetup({ email: "approved@example.test", currentPassword: "Old!Password1", password: "simplepass" }), "");
  assert.equal(validateSetup({ email: "approved@example.test", currentPassword: "", password: "simplepass", recoveryMode: true }), "");
});

test("expired or invalid auth links produce useful non-secret errors", () => {
  assert.match(authLinkError("https://example.test/admin/setup/#error=access_denied&error_code=otp_expired"), /expired/);
  assert.equal(authLinkError("https://example.test/admin/setup/"), "");
});

test("setup preserves CRM authorization and password recovery for existing accounts", () => {
  const source = fs.readFileSync(new URL("../src/admin-setup.mjs", import.meta.url), "utf8");
  assert.match(source, /signInWithPassword/);
  assert.match(source, /\/api\/admin\/crm/);
  assert.match(source, /updateUser\(\{ password \}\)/);
  assert.match(source, /resetPasswordForEmail/);
  assert.doesNotMatch(source, /auth\.verifyOtp|amg-admin-phone-otp/);
  assert.doesNotMatch(source, /\.signUp\(|auth\.admin|service_role/i);
  assert.match(source, /setupBusy/);
  assert.match(source, /PASSWORD_RECOVERY/);
});
