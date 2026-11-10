import { appointmentInstant } from "../amg-matchup/appointment.ts";
export type CalendarDesired = { id: string; trainer_id: string; status: string; appointment_date: string; appointment_time: string; agent_name: string; client_name: string; appointment_format: string; event_id?: string | null; event_generation?: number; cleanup_event_ids?: string[] };
export type CalendarResult = { status: "synced" | "removed"; eventId: string | null; meetUrl: string | null };

/** PUT/PATCH/DELETE retries are reconciled against one deterministic event identity. */
export async function reconcileCalendar(desired: CalendarDesired, accessToken: string, fetcher: typeof fetch = fetch): Promise<CalendarResult> {
  const generation = desired.event_generation || 1;
  const deterministicId = desired.id.replace(/-/g, "") + (generation === 1 ? "" : `a${generation.toString(16)}`);
  const id = desired.event_id || deterministicId;
  const base = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  const deleteOwned = async (eventId: string) => {
    const existing = await fetcher(`${base}/${encodeURIComponent(eventId)}`, { headers, signal: AbortSignal.timeout(10000) });
    if (existing.status === 404 || existing.status === 410) return;
    if (!existing.ok) throw new Error(`calendar_read_${existing.status}`);
    const event = await existing.json();
    if (event.status === "cancelled") return;
    if (event.extendedProperties?.private?.amgAppointmentId !== desired.id) throw new Error("calendar_event_owner_mismatch");
    const deleted = await fetcher(`${base}/${encodeURIComponent(eventId)}`, { method: "DELETE", headers, signal: AbortSignal.timeout(15000) });
    if (!deleted.ok && deleted.status !== 404 && deleted.status !== 410) throw new Error(`calendar_delete_${deleted.status}`);
  };
  for (const previousId of [...new Set(desired.cleanup_event_ids || [])]) await deleteOwned(previousId);
  if (desired.status === "cancelled") {
    await deleteOwned(id);
    return { status: "removed", eventId: null, meetUrl: null };
  }
  const start = appointmentInstant(desired.appointment_date, desired.appointment_time);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const event = {
    summary: `AMG Matchup: ${desired.client_name} with ${desired.agent_name}`,
    description: `AMG appointment. Format: ${desired.appointment_format || "Video call"}.`,
    status: desired.status === "pending" ? "tentative" : "confirmed",
    start: { dateTime: start.toISOString(), timeZone: "America/New_York" },
    end: { dateTime: end.toISOString(), timeZone: "America/New_York" },
    extendedProperties: { private: { amgAppointmentId: desired.id } },
  };
  const existing = await fetcher(`${base}/${encodeURIComponent(id)}`, { headers, signal: AbortSignal.timeout(10000) });
  if (existing.ok) {
    const old = await existing.json();
    if (old.status === "cancelled") throw new Error("calendar_event_cancelled_requires_review");
    if (old.extendedProperties?.private?.amgAppointmentId !== desired.id) throw new Error("calendar_event_owner_mismatch");
    const updated = await fetcher(`${base}/${encodeURIComponent(id)}?conferenceDataVersion=1`, { method: "PATCH", headers, body: JSON.stringify(event), signal: AbortSignal.timeout(15000) });
    if (!updated.ok) throw new Error(`calendar_update_${updated.status}`);
    const payload = await updated.json();
    return { status: "synced", eventId: String(payload.id || id), meetUrl: payload.hangoutLink || old.hangoutLink || null };
  }
  if (existing.status !== 404 && existing.status !== 410) throw new Error(`calendar_read_${existing.status}`);
  // A known legacy ID disappearing may reflect an intentional manual calendar
  // deletion. Surface it instead of quietly creating a duplicate with another ID.
  if (desired.event_id) throw new Error("calendar_existing_event_missing");
  const created = await fetcher(`${base}?conferenceDataVersion=1`, { method: "POST", headers, body: JSON.stringify({ ...event, id: deterministicId, conferenceData: { createRequest: { requestId: deterministicId, conferenceSolutionKey: { type: "hangoutsMeet" } } } }), signal: AbortSignal.timeout(15000) });
  if (created.status === 409) {
    // Another attempt won the create race. Re-read and update that exact ID.
    return reconcileCalendar({ ...desired, event_id: deterministicId }, accessToken, fetcher);
  }
  if (!created.ok) throw new Error(`calendar_create_${created.status}`);
  const payload = await created.json();
  if (!payload.id) throw new Error("calendar_missing_receipt");
  return { status: "synced", eventId: String(payload.id), meetUrl: payload.hangoutLink || null };
}

