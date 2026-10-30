import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { authLinkError, normalizeEmail, passwordChecks, validateSetup } from "../admin/setup/core.mjs";

test("normalizes the approved email without changing identity", () => {
  assert.equal(normalizeEmail("  AceFayad@Gmail.com "), "acefayad@gmail.com");
});

test("requires a strong new password and matching confirmation", () => {
  assert.match(validateSetup({ email: "approved@example.test", currentPassword: "Old!Password1", password: "short", confirmation: "short" }), /12 characters/);
  assert.match(validateSetup({ email: "approved@example.test", currentPassword: "Old!Password1", password: "Strong!Password2", confirmation: "Strong!Password3" }), /must match/);
  assert.match(validateSetup({ email: "approved@example.test", currentPassword: "Strong!Password2", password: "Strong!Password2", confirmation: "Strong!Password2" }), /different/);
  assert.equal(validateSetup({ email: "approved@example.test", currentPassword: "Old!Password1", password: "Strong!Password2", confirmation: "Strong!Password2" }), "");
});

test("recovery mode does not require the previous password", () => {
  assert.equal(validateSetup({ email: "approved@example.test", currentPassword: "", password: "Strong!Password2", confirmation: "Strong!Password2", recoveryMode: true }), "");
});

test("password checklist covers every required category", () => {
  assert.deepEqual(passwordChecks("Strong!Password2"), { length: true, upper: true, lower: true, number: true, symbol: true });
});

test("expired or invalid auth links produce useful non-secret errors", () => {
  assert.match(authLinkError("https://example.test/admin/setup/#error=access_denied&error_code=otp_expired"), /expired/);
  assert.equal(authLinkError("https://example.test/admin/setup/"), "");
});

test("setup source updates only an authenticated existing admin account", () => {
  const source = fs.readFileSync(new URL("../src/admin-setup.mjs", import.meta.url), "utf8");
  assert.match(source, /signInWithPassword/);
  assert.match(source, /\/api\/admin\/crm/);
  assert.match(source, /updateUser\(\{ password \}\)/);
  assert.match(source, /resetPasswordForEmail/);
  assert.doesNotMatch(source, /\.signUp\(|auth\.admin|service_role/i);
  assert.match(source, /setupBusy/);
  assert.match(source, /PASSWORD_RECOVERY/);
});
