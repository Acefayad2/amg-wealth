export const STATUS_LABELS = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
};

export function calendarCells(month) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const first = new Date(start);
  first.setDate(1 - start.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setDate(first.getDate() + index);
    return date;
  });
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
