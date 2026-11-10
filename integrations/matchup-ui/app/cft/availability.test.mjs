import assert from "node:assert/strict";
import test from "node:test";
import { buildAvailability } from "./availability.ts";

const base = { weekStart: "2026-11-09", days: [0], weeks: 1, start: "09:00", end: "12:00", existing: [], now: new Date("2026-11-05T12:00:00Z") };
test("creates only complete one-hour slots", () => {
  assert.deepEqual(buildAvailability(base).slots.map((slot) => slot.time), ["09:00", "10:00", "11:00"]);
  assert.throws(() => buildAvailability({ ...base, end: "11:30" }), /complete one-hour/);
  assert.throws(() => buildAvailability({ ...base, end: "09:30" }), /complete one-hour/);
});
test("preserves existing blocked or booked slots and skips partial overlaps", () => {
  const result = buildAvailability({ ...base, existing: [{ available_date: "2026-11-09", start_time: "09:30:00" }] });
  assert.deepEqual(result.slots, [{ date: "2026-11-09", time: "11:00" }]);
  assert.equal(result.skipped, 2);
});
test("uses Eastern time for same-day cutoff and never adds past times", () => {
  const result = buildAvailability({ ...base, now: new Date("2026-11-09T15:15:00Z") });
  assert.deepEqual(result.slots.map((slot) => slot.time), ["11:00"]);
});
test("caps batches at 200 and rejects dates beyond a year", () => {
  assert.throws(() => buildAvailability({ ...base, days: [0, 1, 2, 3, 4], weeks: 8, end: "17:00" }), /200/);
  assert.throws(() => buildAvailability({ ...base, weekStart: "2027-11-15" }), /next year/);
});
test("deduplicates days and allows adjacent one-hour appointments", () => {
  const result = buildAvailability({ ...base, days: [0, 0], existing: [{ available_date: "2026-11-09", start_time: "08:00:00" }] });
  assert.equal(result.slots.length, 3);
});
