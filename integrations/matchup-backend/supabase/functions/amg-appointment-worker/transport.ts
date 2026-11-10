export type SmsJob = { id: string; lease: string; phone: string; body: string; appointment_start: string };
export type SmsResult = { state: "accepted" | "failed" | "unknown"; providerId?: string; error?: string };

// Match the existing AMG Quo transport. This must be verified against the authorized
// production sender before enabling dispatch. No client may choose the sender.
export const AMG_PHONE = "+13017602910";
export const AMG_PHONE_ID = "PNqGQouhRT";

export async function sendAppointmentSms(apiKey: string, job: SmsJob, fetcher: typeof fetch = fetch): Promise<SmsResult> {
  if (!/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(job.phone) || !job.body.trim() || job.body.length > 480) return { state: "failed", error: "invalid_message" };
  let response: Response;
  try {
    response = await fetcher("https://api.quo.com/v1/messages", {
      method: "POST", headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ from: AMG_PHONE, to: [job.phone], content: job.body }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // An interrupted POST may already have reached Quo. Never automatically resend.
    return { state: "unknown", error: "provider_outcome_unknown" };
  }
  if (!response.ok) return { state: response.status >= 500 ? "unknown" : "failed", error: `provider_${response.status}` };
  const payload = await response.json().catch(() => null);
  if (!payload?.data?.id) return { state: "unknown", error: "provider_receipt_missing" };
  // HTTP 202 means accepted, not delivered. Receipt reconciliation is separate.
  return { state: "accepted", providerId: String(payload.data.id) };
}

export async function inspectReceipt(apiKey: string, id: string, fetcher: typeof fetch = fetch): Promise<"accepted" | "delivered" | "failed"> {
  const response = await fetcher(`https://api.quo.com/v1/messages/${encodeURIComponent(id)}`, { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) return "accepted";
  const payload = await response.json();
  if (payload.data?.status === "delivered") return "delivered";
  if (["failed", "undelivered"].includes(payload.data?.status)) return "failed";
  return "accepted";
}

export function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

