import type { Config, Context } from "@netlify/functions";
import { cleanText, E164, publicError, requireUuid, validTimezone, verifySameOrigin } from "./_shared/crm.mjs";
import { verifyQuoTransport } from "./_shared/quo.mjs";
import { getAuthenticatedUser } from "./_shared/supabase.mjs";
import { verifyCrmStorage } from "./_shared/db.mjs";
import { sendImmediateMessage } from "../../integrations/quo-dispatch.mjs";

const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });

function rpcError(error: { code?: string; message?: string }): never {
  if (error.code === "42501") throw Object.assign(new Error("AMG CRM admin access required."), { status: 403 });
  if (error.code === "40001") throw Object.assign(new Error("CRM state changed; refresh and try again."), { status: 409 });
  throw new Error(error.message || "The CRM request could not be completed.");
}

export default async function handler(req: Request, _context: Context) {
  try {
    const { client, user } = await getAuthenticatedUser(req);
    if (req.method === "GET") {
      const { data, error } = await client.rpc("amg_crm_get_state");
      if (error) rpcError(error);
      const { data: dispatchControl, error: dispatchError } = await client.rpc("amg_crm_get_dispatch_control");
      if (dispatchError) rpcError(dispatchError);
      const { data: schedulerEvents, error: schedulerError } = await client.rpc("amg_crm_get_scheduler_events");
      if (schedulerError) rpcError(schedulerError);
      const emergencyDisabled = Netlify.env.get("AMG_QUO_EMERGENCY_DISABLE") === "true";
      const transport = await verifyQuoTransport({
        apiKey: Netlify.env.get("QUO_API_KEY"),
        fromNumber: Netlify.env.get("QUO_FROM_NUMBER"),
        phoneNumberId: Netlify.env.get("QUO_PHONE_NUMBER_ID"),
        enabled: Boolean((dispatchControl as { enabled?: boolean })?.enabled) && !emergencyDisabled,
      });
      return json({ ...(data as Record<string, unknown>), dispatch_control: dispatchControl, scheduler_events: schedulerEvents,
        storage_verified: await verifyCrmStorage(),
        transport: { ...transport, emergency_disabled: emergencyDisabled } });
    }
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
    verifySameOrigin(req);
    const input = await req.json() as Record<string, unknown>;

    if (input.action === "set_dispatch_enabled") {
      if (typeof input.enabled !== "boolean") throw new Error("Sending state is invalid.");
      const expectedVersion = Number(input.expectedVersion);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error("Sending state version is invalid.");
      if (input.enabled) {
        if (Netlify.env.get("AMG_QUO_EMERGENCY_DISABLE") === "true") {
          throw Object.assign(new Error("The emergency sending lock is active."), { status: 503 });
        }
        if (!await verifyCrmStorage()) {
          throw Object.assign(new Error("CRM scheduler storage is unavailable. Sending remains disabled."), { status: 503 });
        }
        const verified = await verifyQuoTransport({
          apiKey: Netlify.env.get("QUO_API_KEY"), fromNumber: Netlify.env.get("QUO_FROM_NUMBER"),
          phoneNumberId: Netlify.env.get("QUO_PHONE_NUMBER_ID"), enabled: false,
        });
        if (!verified.verified) throw Object.assign(new Error("The approved AMG Quo sender is not verified."), { status: 503 });
      }
      const { data, error } = await client.rpc("amg_crm_set_dispatch_enabled", {
        p_enabled: input.enabled, p_expected_version: expectedVersion,
      });
      if (error) rpcError(error);
      return json({ dispatch_control: data });
    }

    if (input.action === "save_contact") {
      const fullName = typeof input.fullName === "string" ? input.fullName.trim() : "";
      if ([...fullName].length > 160) throw new Error("Contact name must be 160 characters or fewer.");
      const phone = cleanText(input.phone, 16, "Phone number");
      if (!E164.test(phone)) throw new Error("Phone number must use E.164 format, such as +12025550123.");
      const consentStatus = String(input.consentStatus);
      if (!["pending", "opted_in", "opted_out"].includes(consentStatus)) throw new Error("Consent status is invalid.");
      const evidence = typeof input.consentEvidence === "string" ? input.consentEvidence.trim() : "";
      if (consentStatus === "opted_in" && !evidence) throw new Error("Consent evidence is required before a contact can receive texts.");
      if (!validTimezone(input.timezone)) throw new Error("Timezone is invalid.");
      const id = input.id ? requireUuid(input.id, "Contact") : null;
      const { data, error } = await client.rpc("amg_crm_save_contact", {
        p_id: id, p_full_name: fullName || null, p_phone: phone, p_consent_status: consentStatus,
        p_consent_evidence: evidence, p_timezone: input.timezone,
      });
      if (error) rpcError(error);
      return json({ id: data }, id ? 200 : 201);
    }

    if (input.action === "set_membership") {
      const { error } = await client.rpc("amg_crm_set_membership", {
        p_contact_id: requireUuid(input.contactId, "Contact"),
        p_group_id: requireUuid(input.groupId, "Group"), p_is_member: input.isMember === true,
      });
      if (error) rpcError(error);
      return json({ ok: true });
    }

    if (input.action === "save_message") {
      const body = cleanText(input.body, 1600, "Message");
      const targetType = input.targetType;
      if (targetType !== "individual" && targetType !== "group") throw new Error("Recipient type is invalid.");
      const status = input.status;
      if (status !== "draft" && status !== "scheduled") throw new Error("Message status is invalid.");
      if (!validTimezone(input.timezone)) throw new Error("Timezone is invalid.");
      const scheduledFor = status === "scheduled" ? new Date(String(input.scheduledFor)) : null;
      if (scheduledFor && (!Number.isFinite(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now())) {
        throw new Error("Scheduled time must be in the future.");
      }
      const { data, error } = await client.rpc("amg_crm_save_message", {
        p_message_id: input.messageId ? requireUuid(input.messageId, "Message") : null,
        p_body: body, p_target_type: targetType, p_target_id: requireUuid(input.targetId, "Recipient"),
        p_status: status, p_scheduled_for: scheduledFor?.toISOString() ?? null,
        p_timezone: input.timezone, p_idempotency_key: requireUuid(input.idempotencyKey, "Request key"),
      });
      if (error) rpcError(error);
      return json({ id: data }, input.messageId ? 200 : 201);
    }

    if (input.action === "send_message_now") {
      if (Netlify.env.get("AMG_QUO_EMERGENCY_DISABLE") === "true") {
        throw Object.assign(new Error("The emergency sending lock is active."), { status: 503 });
      }
      if (!await verifyCrmStorage()) {
        throw Object.assign(new Error("CRM delivery storage is unavailable. Nothing was sent."), { status: 503 });
      }
      const body = cleanText(input.body, 1600, "Message");
      const targetType = input.targetType;
      if (targetType !== "individual" && targetType !== "group") throw new Error("Recipient type is invalid.");
      if (!validTimezone(input.timezone)) throw new Error("Timezone is invalid.");
      const result = await sendImmediateMessage({
        messageId: input.messageId ? requireUuid(input.messageId, "Message") : null,
        body,
        targetType,
        targetId: requireUuid(input.targetId, "Recipient"),
        timezone: String(input.timezone),
        idempotencyKey: requireUuid(input.idempotencyKey, "Request key"),
        actorId: user.id,
      });
      return json(result, 200);
    }

    if (input.action === "save_recurring_reminder") {
      const name = cleanText(input.name, 160, "Reminder name");
      const body = cleanText(input.body, 1600, "Message");
      if (input.status !== "draft") throw new Error("Recurring reminders stay inactive until delivery is approved.");
      if (input.timezone !== "America/New_York") throw new Error("AMG recurring reminders use America/New_York.");
      const localTime = typeof input.localTime === "string" ? input.localTime.trim() : "";
      if (localTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) throw new Error("Send time is invalid.");
      const weekdays = Array.isArray(input.weekdays) ? input.weekdays.map(Number) : [];
      if (!weekdays.length || weekdays.some((day, index) =>
        !Number.isInteger(day) || day < 0 || day > 6 || weekdays.indexOf(day) !== index
      )) throw new Error("Recurring weekdays are invalid.");
      const startDate = String(input.startDate || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error("Start date is invalid.");
      const targetGroupId = input.targetGroupId ? requireUuid(input.targetGroupId, "Recipient group") : null;
      const zoomUrl = typeof input.zoomUrl === "string" ? input.zoomUrl.trim() : "";
      if (zoomUrl) {
        const parsed = new URL(zoomUrl);
        if (parsed.protocol !== "https:") throw new Error("Zoom URL must use HTTPS.");
      }
      const { data, error } = await client.rpc("amg_crm_save_recurring_reminder", {
        p_id: input.id ? requireUuid(input.id, "Recurring reminder") : null,
        p_name: name,
        p_body: body,
        p_target_group_id: targetGroupId,
        p_zoom_url: zoomUrl || null,
        p_timezone: input.timezone,
        p_local_time: localTime || null,
        p_weekdays: weekdays,
        p_start_date: startDate,
        p_status: "draft",
        p_idempotency_key: requireUuid(input.idempotencyKey, "Request key"),
      });
      if (error) rpcError(error);
      return json({ id: data }, input.id ? 200 : 201);
    }

    if (input.action === "set_recurring_status") {
      const status = String(input.status);
      if (!["active", "paused", "draft"].includes(status)) throw new Error("Recurring reminder status is invalid.");
      const expectedUpdatedAtRaw = String(input.expectedUpdatedAt);
      const expectedUpdatedAt = new Date(expectedUpdatedAtRaw);
      if (!Number.isFinite(expectedUpdatedAt.getTime())) throw new Error("Reminder version is invalid.");
      const { data, error } = await client.rpc("amg_crm_set_recurring_status", {
        p_id: requireUuid(input.id, "Recurring reminder"), p_status: status,
        // Keep PostgreSQL microseconds intact; Date#toISOString truncates them.
        p_expected_updated_at: expectedUpdatedAtRaw,
      });
      if (error) rpcError(error);
      return json({ recurring_reminder: data });
    }

    return json({ error: "Action is invalid." }, 400);
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 400;
    return json({ error: [401, 403, 409, 503].includes(status) ? (error as Error).message : publicError(error) }, status || 400);
  }
}

export const config: Config = {
  path: "/api/admin/crm",
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 120 },
};
