import type { Config, Context } from "@netlify/functions";
import { cleanText, E164, publicError, requireUuid, validTimezone, verifySameOrigin } from "./_shared/crm.mjs";
import { getUserClient } from "./_shared/supabase.mjs";

const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });

function rpcError(error: { code?: string; message?: string }): never {
  if (error.code === "42501") throw Object.assign(new Error("AMG CRM admin access required."), { status: 403 });
  throw new Error(error.message || "The CRM request could not be completed.");
}

export default async function handler(req: Request, _context: Context) {
  try {
    const client = await getUserClient(req);
    if (req.method === "GET") {
      const { data, error } = await client.rpc("amg_crm_get_state");
      if (error) rpcError(error);
      return json({ ...(data as Record<string, unknown>), transport: {
        provider: "Quo",
        configured: Boolean(Netlify.env.get("QUO_API_KEY") && Netlify.env.get("QUO_FROM_NUMBER")),
        enabled: Netlify.env.get("AMG_QUO_SEND_ENABLED") === "true",
      } });
    }
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
    verifySameOrigin(req);
    const input = await req.json() as Record<string, unknown>;

    if (input.action === "save_contact") {
      const fullName = cleanText(input.fullName, 160, "Contact name");
      const phone = cleanText(input.phone, 16, "Phone number");
      if (!E164.test(phone)) throw new Error("Phone number must use E.164 format, such as +12025550123.");
      const consentStatus = String(input.consentStatus);
      if (!["pending", "opted_in", "opted_out"].includes(consentStatus)) throw new Error("Consent status is invalid.");
      const evidence = typeof input.consentEvidence === "string" ? input.consentEvidence.trim() : "";
      if (consentStatus === "opted_in" && !evidence) throw new Error("Consent evidence is required before a contact can receive texts.");
      if (!validTimezone(input.timezone)) throw new Error("Timezone is invalid.");
      const id = input.id ? requireUuid(input.id, "Contact") : null;
      const { data, error } = await client.rpc("amg_crm_save_contact", {
        p_id: id, p_full_name: fullName, p_phone: phone, p_consent_status: consentStatus,
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

    return json({ error: "Action is invalid." }, 400);
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 400;
    return json({ error: [401, 403, 503].includes(status) ? (error as Error).message : publicError(error) }, status || 400);
  }
}

export const config: Config = {
  path: "/api/admin/crm",
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 120 },
};
