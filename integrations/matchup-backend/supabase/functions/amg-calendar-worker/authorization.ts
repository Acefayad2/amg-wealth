import { constantTimeEqual } from "../amg-appointment-worker/transport.ts";

export function calendarWorkerAuthorized(headers: Headers, calendarSecret: string, legacyAppointmentSecret = "") {
  return (calendarSecret.length >= 32 && constantTimeEqual(headers.get("x-amg-calendar-key") || "", calendarSecret))
    || (legacyAppointmentSecret.length >= 32 && constantTimeEqual(headers.get("x-amg-appointment-key") || "", legacyAppointmentSecret));
}
