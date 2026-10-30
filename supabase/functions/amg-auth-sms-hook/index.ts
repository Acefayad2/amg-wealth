import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { beforeDeadline, handleVerifiedSmsEvent } from "./core.mjs";

const responseHeaders = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: responseHeaders });

function verifyHook(payload: string, requestHeaders: Headers, configuredSecrets: string) {
  const headers = Object.fromEntries(requestHeaders);
  for (const configured of configuredSecrets.split("|").map((value) => value.trim()).filter(Boolean)) {
    const secret = configured.replace(/^v1,whsec_/, "");
    try {
      const wh = new Webhook(secret);
      return wh.verify(payload, headers) as { user?: { phone?: string }; sms?: { otp?: string } };
    } catch {
      // Try the next active rotation secret without revealing signature details.
    }
  }
  throw new Error("Hook signature verification failed.");
}

Deno.serve(async (req) => {
  const deadline = Date.now() + 4000;
  if (req.method !== "POST") return json({ error: { http_code: 405, message: "Method not allowed." } }, 405);
  const hookSecrets = Deno.env.get("SEND_SMS_HOOK_SECRET") || "";
  const quoKey = Deno.env.get("QUO_API_KEY") || "";
  const phoneNumberId = Deno.env.get("QUO_PHONE_NUMBER_ID") || "";
  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!hookSecrets || !url || !serviceKey) {
    return json({ error: { http_code: 503, message: "Authentication SMS is not configured." } }, 503);
  }
  try {
    const payload = await beforeDeadline(deadline, () => req.text());
    if (payload.length > 64_000) return json({ error: { http_code: 413, message: "Payload is too large." } }, 413);
    const event = verifyHook(payload, req.headers, hookSecrets);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const deliveryStore = {
      async claim({ webhookId, userId, phone }: { webhookId: string; userId: string; phone: string }, signal: AbortSignal) {
        const { data, error } = await admin.rpc("amg_crm_claim_admin_otp_delivery", {
          p_webhook_id: webhookId, p_user_id: userId, p_phone: phone,
        }).abortSignal(signal);
        if (error) throw new Error("OTP authorization is unavailable.");
        return data;
      },
      async record(webhookId: string, outcome: string, signal: AbortSignal) {
        const { error } = await admin.rpc("amg_crm_record_admin_otp_delivery", {
          p_webhook_id: webhookId, p_outcome: outcome,
        }).abortSignal(signal);
        if (error) throw new Error("OTP outcome could not be recorded.");
      },
    };
    const result = await handleVerifiedSmsEvent(event, {
      deadline, quoKey, phoneNumberId, webhookId: req.headers.get("webhook-id"), deliveryStore,
    }, fetch);
    return json(result.body, result.status);
  } catch {
    return json({ error: { http_code: 500, message: "Authentication SMS failed closed." } }, 500);
  }
});
