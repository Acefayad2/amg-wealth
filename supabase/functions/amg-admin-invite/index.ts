import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
const setupUrl = "https://anointedmoneygroup.com/admin/setup/";
const optOutWords = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

async function hasProviderOptOut(apiKey: string, phoneNumberId: string, phone: string) {
  const deadline = Date.now() + 5000;
  let pageToken = "";
  for (let page = 0; page < 20; page += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Provider opt-out verification timed out.");
    const url = new URL("https://api.quo.com/v1/messages");
    url.searchParams.set("phoneNumberId", phoneNumberId);
    url.searchParams.append("participants", phone);
    url.searchParams.set("maxResults", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, {
      headers: { authorization: apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(Math.min(remaining, 1500)),
    });
    if (!response.ok) throw new Error("Provider opt-out verification failed.");
    const payload = await response.json();
    if (!Array.isArray(payload?.data)) throw new Error("Provider history was invalid.");
    if (payload.data.some((message: { direction?: string; from?: string; text?: string }) =>
      message.direction === "incoming" && message.from === phone && optOutWords.has(String(message.text || "").trim().toLowerCase()))) return true;
    if (!payload.nextPageToken) return false;
    pageToken = String(payload.nextPageToken);
  }
  throw new Error("Provider history exceeded the safe verification limit.");
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Sign in required." }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const quoKey = Deno.env.get("QUO_API_KEY");
  const quoFrom = Deno.env.get("QUO_FROM_NUMBER");
  const quoPhoneNumberId = Deno.env.get("QUO_PHONE_NUMBER_ID");
  if (!url || !anonKey || !serviceKey || !quoKey || !quoFrom || !quoPhoneNumberId) {
    return json({ error: "Phone invitation service is not configured." }, 503);
  }

  try {
    const input = await req.json();
    const phone = String(input?.phone || "").trim();
    if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) return json({ error: "Enter a valid E.164 phone number." }, 400);
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = base64url(tokenBytes);
    const tokenHash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));

    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: prepared, error: prepareError } = await caller.rpc("amg_crm_prepare_phone_admin_invite", {
      p_phone: phone, p_token_hash: tokenHash,
    });
    if (prepareError) {
      const status = prepareError.code === "42501" ? 403 : prepareError.code === "23505" ? 409 : 400;
      return json({ error: status === 403 ? "AMG CRM admin access required." : prepareError.message }, status);
    }
    if (!prepared?.should_send) return json({ invitation: prepared, already_pending: true });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    let optedOut = false;
    try {
      optedOut = await hasProviderOptOut(quoKey, quoPhoneNumberId, phone);
    } catch {
      await admin.rpc("amg_crm_record_phone_admin_invite_result", {
        p_id: prepared.id, p_outcome: "failed", p_failure_reason: "Provider opt-out verification failed closed.",
      });
      return json({ error: "Opt-out history could not be verified, so no invitation was sent." }, 503);
    }
    if (optedOut) {
      await admin.rpc("amg_crm_record_phone_admin_invite_result", {
        p_id: prepared.id, p_outcome: "failed", p_failure_reason: "The invited phone has opted out of AMG messages.",
      });
      return json({ error: "This phone has opted out of AMG messages." }, 409);
    }
    const { data: existingId, error: lookupError } = await admin.rpc("amg_crm_find_auth_user_by_phone", { p_phone: phone });
    if (lookupError) throw new Error("Existing account state could not be checked.");
    if (existingId) {
      const { data: owned, error: ownershipError } = await admin.rpc("amg_crm_invite_owns_auth_user", {
        p_id: prepared.id, p_user_id: existingId,
      });
      if (ownershipError || !owned) {
        await admin.rpc("amg_crm_record_phone_admin_invite_result", {
          p_id: prepared.id, p_outcome: "failed", p_failure_reason: "An unrelated existing phone account requires administrator review.",
        });
        return json({ error: "An account already uses this phone. Review it without changing its credentials before inviting." }, 409);
      }
    } else {
      const { data: created, error: createError } = await admin.auth.admin.createUser({ phone, phone_confirm: false });
      if (createError || !created.user?.id) {
        await admin.rpc("amg_crm_record_phone_admin_invite_result", {
          p_id: prepared.id, p_outcome: "failed", p_failure_reason: "Supabase Auth did not create the phone account.",
        });
        throw new Error("The phone account could not be prepared.");
      }
      const { error: recordUserError } = await admin.rpc("amg_crm_record_phone_admin_invite_user", {
        p_id: prepared.id, p_user_id: created.user.id,
      });
      if (recordUserError) {
        await admin.rpc("amg_crm_record_phone_admin_invite_result", {
          p_id: prepared.id, p_outcome: "failed", p_failure_reason: "The prepared phone account could not be bound to its invitation.",
        });
        throw new Error("The phone account could not be safely bound to this invitation.");
      }
    }
    const privateUrl = `${setupUrl}?invite=${encodeURIComponent(token)}`;
    const content = `AMG admin invitation: Open this private link to verify your phone, choose your email, and create your dashboard password: ${privateUrl}\n\nThis link expires in 1 hour and can be used once. Reply STOP to opt out.`;
    let providerResponse: Response;
    try {
      providerResponse = await fetch("https://api.quo.com/v1/messages", {
        method: "POST",
        headers: { authorization: quoKey, "content-type": "application/json" },
        body: JSON.stringify({ content, from: quoFrom, to: [phone] }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      await admin.rpc("amg_crm_record_phone_admin_invite_result", {
        p_id: prepared.id, p_outcome: "uncertain", p_failure_reason: "Provider outcome is uncertain; do not retry automatically.",
      });
      return json({ error: "The provider outcome is uncertain. The invitation was not retried." }, 503);
    }
    const providerPayload = await providerResponse.json().catch(() => ({}));
    const accepted = providerResponse.status === 202 && Boolean(providerPayload?.data?.id);
    const { error: recordError } = await admin.rpc("amg_crm_record_phone_admin_invite_result", {
      p_id: prepared.id, p_outcome: accepted ? "sent" :
        (providerResponse.status >= 400 && providerResponse.status < 500 ? "failed" : "uncertain"),
      p_failure_reason: accepted ? null : `Quo rejected the invitation (${providerResponse.status}).`,
    });
    if (recordError) return json({ error: "The invitation outcome could not be recorded and must not be retried." }, 503);
    if (!accepted) return json({ error: "The invitation text was not accepted by Quo." }, 503);
    return json({ invitation: { id: prepared.id, phone, status: "sent", provider_status: "accepted" } }, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "The invitation request could not be completed." }, 400);
  }
});
