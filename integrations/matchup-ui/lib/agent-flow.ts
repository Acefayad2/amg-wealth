/** Appointment dates and times are interpreted in Eastern Time by the booking API. */
export function appointmentDateKey(offsetDays = 0, now = new Date()) {
  const eastern = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => eastern.find((item) => item.type === type)!.value;
  const calendarDate = new Date(`${part("year")}-${part("month")}-${part("day")}T12:00:00Z`);
  calendarDate.setUTCDate(calendarDate.getUTCDate() + offsetDays);
  return calendarDate.toISOString().slice(0, 10);
}

export function validateAnswer(key: string, raw: string, context: { date?: string; now?: Date } = {}) {
  const value = raw.trim();
  const now = context.now ?? new Date();
  if (!value) return "Please answer this question before continuing.";
  if (key.endsWith("Name") && value.length < 2) return "Please enter a name with at least 2 characters.";
  if (key.endsWith("Email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Please enter a valid email address.";
  if (key.endsWith("Phone") && value.replace(/\D/g, "").length < 7) return "Please enter a phone number with at least 7 digits.";
  if (key === "clientDescription" && (value.length < 10 || value.length > 1000)) return "Please include between 10 and 1000 characters about your client’s needs.";
  if (key === "date") {
    const parsed = new Date(`${value}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return "Please choose a valid appointment date.";
    if (value < appointmentDateKey(0, now)) return "Please choose today or a future date in Eastern Time.";
  }
  if (key === "preferredTime") {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return "Please choose a valid preferred time.";
    if (context.date === appointmentDateKey(0, now)) {
      const currentTime = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
      if (value <= currentTime) return "Please choose a later time today. Appointment times are Eastern Time.";
    }
  }
  return "";
}
