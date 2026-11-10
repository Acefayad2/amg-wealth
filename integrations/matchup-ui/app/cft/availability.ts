/** Generate complete, non-overlapping one-hour slots in the portal's Eastern timezone. */
export function buildAvailability(input: {
  weekStart: string; days: number[]; weeks: number; start: string; end: string;
  existing: { available_date: string; start_time: string }[]; now?: Date;
}) {
  const { weekStart, days, weeks, start, end, existing } = input;
  const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const validTime = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  if (!days.length || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6) || !Number.isInteger(weeks) || weeks < 1 || weeks > 8 || !validTime(start) || !validTime(end) || minute(end) - minute(start) < 60 || (minute(end) - minute(start)) % 60 !== 0) {
    throw new Error("Choose days and a time range containing complete one-hour appointments (for example, 9:00–12:00).");
  }
  const now = input.now ?? new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (key: string) => parts.find((item) => item.type === key)!.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const currentMinute = Number(part("hour")) * 60 + Number(part("minute"));
  const limit = new Date(`${today}T12:00:00Z`); limit.setUTCFullYear(limit.getUTCFullYear() + 1);
  const latest = limit.toISOString().slice(0, 10);
  const slots: { date: string; time: string }[] = [];
  let skipped = 0;
  for (let week = 0; week < weeks; week++) for (const day of Array.from(new Set(days))) {
    const date = new Date(`${weekStart}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + week * 7 + day);
    const key = date.toISOString().slice(0, 10);
    if (key > latest) throw new Error("Availability must be within the next year.");
    for (let value = minute(start); value + 60 <= minute(end); value += 60) {
      if (key < today || (key === today && value <= currentMinute)) continue;
      if (existing.some((slot) => slot.available_date === key && value < minute(slot.start_time) + 60 && value + 60 > minute(slot.start_time))) { skipped++; continue; }
      slots.push({ date: key, time: `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}` });
    }
  }
  if (!slots.length) throw new Error("No new future times remain. Existing open, blocked, and booked times are preserved.");
  if (slots.length > 200) throw new Error("Choose fewer days, hours, or repeat weeks. You can add up to 200 times at once.");
  return { slots, skipped };
}
