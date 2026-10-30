import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { handleVerifiedSmsEvent } from "./core.mjs";

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
  if (req.method !== "POST") return json({ error: { http_code: 405, message: "Method not allowed." } }, 405);
  const hookSecrets = Deno.env.get("SEND_SMS_HOOK_SECRET") || "";
  const quoKey = Deno.env.get("QUO_API_KEY") || "";
  const phoneNumberId = Deno.env.get("QUO_PHONE_NUMBER_ID") || "";
  if (!hookSecrets) {
    return json({ error: { http_code: 503, message: "Authentication SMS is not configured." } }, 503);
  }
  try {
    const payload = await req.text();
    if (payload.length > 64_000) return json({ error: { http_code: 413, message: "Payload is too large." } }, 413);
    const event = verifyHook(payload, req.headers, hookSecrets);
    const result = await handleVerifiedSmsEvent(event, { quoKey, phoneNumberId }, fetch);
    return json(result.body, result.status);
  } catch {
    return json({ error: { http_code: 500, message: "Authentication SMS failed closed." } }, 500);
  }
});
