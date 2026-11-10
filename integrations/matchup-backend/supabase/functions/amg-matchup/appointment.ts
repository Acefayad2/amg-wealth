export const APPOINTMENT_ZONE = "America/New_York";

export function databaseTime(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 12 || Number(match[2]) > 59) return null;
  const hour = Number(match[1]) % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${match[2]}:00`;
}

// Reject nonexistent and repeated wall-clock hours instead of guessing around DST.
export function appointmentInstant(date: string, time: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(?::00)?$/.test(time)) throw new Error("Invalid appointment date or time");
  const target = `${date}T${time.slice(0, 5)}`;
  const candidates = ["-04:00", "-05:00"].map(offset => new Date(`${target}:00${offset}`)).filter(candidate => {
    if (!Number.isFinite(candidate.getTime())) return false;
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: APPOINTMENT_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(candidate).map(part => [part.type, part.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` === target;
  });
  if (candidates.length !== 1) throw new Error("Choose an unambiguous appointment time in Eastern Time");
  return candidates[0];
}

export function slotIsFree(date: string, time: string, busy: Array<{ start: string; end: string }>): boolean {
  const start = appointmentInstant(date, time).getTime();
  const end = start + 60 * 60 * 1000;
  return !busy.some(range => {
    const busyStart = Date.parse(range.start), busyEnd = Date.parse(range.end);
    if (!Number.isFinite(busyStart) || !Number.isFinite(busyEnd) || busyEnd <= busyStart) throw new Error("Calendar returned invalid availability");
    return start < busyEnd && end > busyStart;
  });
}

export function normalizePhone(value: unknown): string | null {
  const digits = String(value || "").replace(/\D/g, "");
  const normalized = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits[0] === "1" ? `+${digits}` : "";
  return /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(normalized) ? normalized : null;
}

export function notificationConsent(value: unknown, agentPhone: unknown, clientPhone: unknown) {
  const consent = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (consent.version !== "appointment-sms-v1") return [];
  return (["agent", "client"] as const).flatMap(role => {
    if (consent[role] !== true) return [];
    const phone = normalizePhone(role === "agent" ? agentPhone : clientPhone);
    if (!phone) throw new Error(`Enter a valid US or Canadian ${role} mobile number for texts`);
    return [{ role, phone, version: "appointment-sms-v1", source: role === "client" ? "booking-agent-attestation" : "booking-agent-opt-in" }];
  });
}

