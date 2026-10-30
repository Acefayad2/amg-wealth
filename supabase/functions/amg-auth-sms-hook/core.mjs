export const AMG_FROM = "+13017602910";
export const AMG_PHONE_ID = "PNqGQouhRT";
const optOutWords = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);

export async function hasProviderOptOut(apiKey, phone, fetcher = fetch) {
  const deadline = Date.now() + 5000;
  let pageToken = "";
  for (let page = 0; page < 20; page += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Opt-out verification timed out.");
    const url = new URL("https://api.quo.com/v1/messages");
    url.searchParams.set("phoneNumberId", AMG_PHONE_ID);
    url.searchParams.append("participants", phone);
    url.searchParams.set("maxResults", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const provider = await fetcher(url, {
      headers: { authorization: apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(Math.min(remaining, 1500)),
    });
    if (!provider.ok) throw new Error("Opt-out verification failed.");
    const history = await provider.json();
    if (!Array.isArray(history?.data)) throw new Error("Opt-out history was invalid.");
    if (history.data.some((message) => message.direction === "incoming" && message.from === phone &&
      optOutWords.has(String(message.text || "").trim().toLowerCase()))) return true;
    if (!history.nextPageToken) return false;
    pageToken = String(history.nextPageToken);
  }
  throw new Error("Opt-out history exceeded the safe limit.");
}

const errorResult = (status, message) => ({ status, body: { error: { http_code: status, message } } });

export async function handleVerifiedSmsEvent(event, config, fetcher = fetch) {
  if (!config.quoKey || config.phoneNumberId !== AMG_PHONE_ID) {
    return errorResult(503, "Authentication SMS is not configured.");
  }
  const phone = String(event?.user?.phone || "");
  const otp = String(event?.sms?.otp || "");
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone) || !/^[0-9]{6}$/.test(otp)) {
    return errorResult(400, "Authentication SMS data is invalid.");
  }
  try {
    if (await hasProviderOptOut(config.quoKey, phone, fetcher)) {
      return errorResult(403, "This phone cannot receive AMG messages.");
    }
    const provider = await fetcher("https://api.quo.com/v1/messages", {
      method: "POST",
      headers: { authorization: config.quoKey, "content-type": "application/json" },
      body: JSON.stringify({
        from: AMG_FROM,
        to: [phone],
        content: `Your AMG verification code is: ${otp}. It expires soon. Do not share this code.`,
        setInboxStatus: "done",
      }),
      signal: AbortSignal.timeout(8000),
    });
    const receipt = await provider.json().catch(() => ({}));
    if (!provider.ok || typeof receipt?.data?.id !== "string") {
      return errorResult(503, "The verification text was not accepted.");
    }
    return { status: 200, body: {} };
  } catch {
    return errorResult(503, "Authentication SMS failed closed.");
  }
}
