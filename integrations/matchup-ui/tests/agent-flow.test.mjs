import { test } from "node:test";
import assert from "node:assert/strict";
import { appointmentDateKey, validateAnswer } from "../lib/agent-flow.ts";
const now = new Date("2026-11-05T15:30:00Z");
const check = (key, value, context = {}) => validateAnswer(key, value, { now, ...context });
test("Eastern date is independent of viewer timezone and handles rollover", () => {
  assert.equal(appointmentDateKey(0, new Date("2026-11-05T02:00:00Z")), "2026-11-04");
  assert.equal(appointmentDateKey(1, new Date("2026-12-31T18:00:00Z")), "2027-01-01");
  assert.equal(appointmentDateKey(1, new Date("2026-03-07T18:00:00Z")), "2026-03-08");
});
test("each required question rejects empty and whitespace-only answers", () => {
  for (const key of ["agentName", "agentEmail", "agentPhone", "clientName", "clientEmail", "clientPhone", "background", "appointmentType", "clientDescription", "date", "preferredTime"]) {
    assert.ok(check(key, "")); assert.ok(check(key, "   "));
  }
});
test("names preserve minimum length and emails are validated before advancing", () => {
  assert.ok(check("agentName", " A ")); assert.equal(check("clientName", " Ada "), "");
  for (const value of ["wrong", "a@b", "a b@c.com", "@example.com"]) assert.ok(check("agentEmail", value));
  assert.equal(check("clientEmail", "ada@example.com"), "");
});
test("phone validation requires actual digits, including international numbers", () => {
  assert.ok(check("clientPhone", "abcdefg")); assert.ok(check("agentPhone", "123-456"));
  assert.equal(check("agentPhone", "+1 (202) 555-0123"), "");
});
test("client context has meaningful bounds", () => {
  assert.ok(check("clientDescription", "short")); assert.ok(check("clientDescription", " ".repeat(20)));
  assert.equal(check("clientDescription", "Discuss family income protection."), "");
  assert.ok(check("clientDescription", "a".repeat(1001)));
});
test("dates must be real, current or future Eastern calendar dates", () => {
  for (const date of ["2026-11-04", "2026-02-30", "2026-13-01", "not-a-date"]) assert.ok(check("date", date));
  assert.equal(check("date", "2026-11-05"), ""); assert.equal(check("date", "2026-12-01"), "");
});
test("today's time must be after the current Eastern minute", () => {
  assert.ok(check("preferredTime", "10:30", { date: "2026-11-05" }));
  assert.ok(check("preferredTime", "09:00", { date: "2026-11-05" }));
  assert.equal(check("preferredTime", "10:31", { date: "2026-11-05" }), "");
  assert.equal(check("preferredTime", "09:00", { date: "2026-11-06" }), "");
  assert.ok(check("preferredTime", "24:00")); assert.ok(check("preferredTime", "12:99"));
});
