export const STATUS_LABELS = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
};

export function weekCells(reference) {
  const first = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  first.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(first);
    date.setDate(first.getDate() + index);
    return date;
  });
}

export function weekRangeLabel(dates) {
  const first = dates[0];
  const last = dates[dates.length - 1];
  const start = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", ...(first.getFullYear() !== last.getFullYear() ? { year: "numeric" } : {}),
  }).format(first);
  const end = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(last);
  return `${start}–${end}`;
}

export function localDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function defaultScheduleValue(now = new Date()) {
  const date = new Date(now.getTime() + 60 * 60 * 1000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return `${localDayKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function filterContacts(contacts, query) {
  const term = query.trim().toLowerCase();
  if (!term) return contacts;
  return contacts.filter((contact) =>
    [contact.full_name, contact.phone].some((value) => String(value).toLowerCase().includes(term)),
  );
}

export function eligibleTarget(targetType, target, contacts) {
  if (!target) return false;
  if (targetType === "individual") return target.consent_status === "opted_in";
  return contacts.some((contact) =>
    contact.consent_status === "opted_in" && contact.group_ids?.includes(target.id),
  );
}

function zonedParts(date, timeZone) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]),
  );
}

export function zonedDateTimeToUtc(dateKey, localTime, timeZone) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = localTime.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = new Date(desired);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(candidate, timeZone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const adjustment = desired - represented;
    if (!adjustment) break;
    candidate = new Date(candidate.getTime() + adjustment);
  }
  return candidate;
}

export function recurringCalendarEntries(reminder, dates) {
  if (!reminder.local_time) return [];
  const weekdays = new Set(reminder.weekdays || []);
  const localTime = String(reminder.local_time).slice(0, 5);
  const [hour, minute] = localTime.split(":").map(Number);
  const displayTime = new Intl.DateTimeFormat("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, 0, 1, hour, minute))) + " ET";
  return dates.flatMap((date) => {
    const dateKey = localDayKey(date);
    if (!weekdays.has(date.getDay()) || dateKey < reminder.start_date) return [];
    return [{
      dateKey,
      scheduledFor: zonedDateTimeToUtc(dateKey, localTime, reminder.timezone).toISOString(),
      displayTime,
      name: reminder.name,
      body: reminder.body,
      status: reminder.status,
    }];
  });
}
