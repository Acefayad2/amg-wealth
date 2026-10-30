export const AMG_FROM = "+13017602910";
export const AMG_PHONE_ID = "PNqGQouhRT";
const optOutWords = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);

// One absolute request budget, including response bodies and DB operations.
export async function beforeDeadline(deadline, operation) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("SMS hook deadline exceeded.");
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(new Error("SMS hook deadline exceeded."));
      }, remaining); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function hasProviderOptOut(apiKey, phone, fetcher = fetch, deadline = Date.now() + 3000) {
  let pageToken = "";
  for (let page = 0; page < 20; page += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Opt-out verification timed out.");
    const url = new URL("https://api.quo.com/v1/messages");
    url.searchParams.set("phoneNumberId", AMG_PHONE_ID);
    url.searchParams.append("participants", phone);
    url.searchParams.set("maxResults", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const provider = await beforeDeadline(deadline, (signal) => fetcher(url, {
      headers: { authorization: apiKey, accept: "application/json" },
      signal,
    }));
    if (!provider.ok) throw new Error("Opt-out verification failed.");
    const history = await beforeDeadline(deadline, () => provider.json());
    if (!Array.isArray(history?.data)) throw new Error("Opt-out history was invalid.");
    if (history.data.some((message) => message.direction === "incoming" && message.from === phone &&
      optOutWords.has(String(message.text || "").trim().toLowerCase()))) return true;
    if (!history.nextPageToken) return false;
    pageToken = String(history.nextPageToken);
  }
  throw new Error("Opt-out history exceeded the safe limit.");
}

const errorResult = (status, message) => ({ status, body: { error: { http_code: status, message } } });

export function canonicalPhone(value) {
  const phone = String(value || "").trim();
  return /^\+?[1-9][0-9]{7,14}$/.test(phone) ? `+${phone.replace(/^\+/, "")}` : null;
}

export async function handleVerifiedSmsEvent(event, config, fetcher = fetch) {
  if (!config.quoKey || config.phoneNumberId !== AMG_PHONE_ID || !config.deliveryStore) {
    return errorResult(503, "Authentication SMS is not configured.");
  }
  const phone = canonicalPhone(event?.user?.phone);
  const userId = String(event?.user?.id || "");
  const otp = String(event?.sms?.otp || "");
  const webhookId = String(config.webhookId || "");
  if (!phone || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) ||
    !/^[0-9]{6}$/.test(otp) || !webhookId || webhookId.length > 200) {
    return errorResult(400, "Authentication SMS data is invalid.");
  }
  const deadline = Math.min(config.deadline || Date.now() + 4000, Date.now() + 4000);
  // Leave 500ms for the durable outcome write after provider timeout.
  const sendDeadline = deadline - 500;
  const record = (outcome) => beforeDeadline(deadline,
    (signal) => config.deliveryStore.record(webhookId, outcome, signal));
  let claimed = false;
  let providerStarted = false;
  try {
    const claim = await beforeDeadline(sendDeadline, (signal) => config.deliveryStore.claim({ webhookId, userId, phone }, signal));
    if (claim === "sent") return { status: 200, body: {} };
    if (claim !== "send") return errorResult(403, "No active verification request is available.");
    claimed = true;
    if (await hasProviderOptOut(config.quoKey, phone, fetcher, sendDeadline)) {
      await record("failed");
      return errorResult(403, "This phone cannot receive AMG messages.");
    }
    if (sendDeadline - Date.now() < 500) throw new Error("Insufficient SMS send budget.");
    providerStarted = true;
    const provider = await beforeDeadline(sendDeadline, (signal) => fetcher("https://api.quo.com/v1/messages", {
      method: "POST",
      headers: { authorization: config.quoKey, "content-type": "application/json" },
      body: JSON.stringify({
        from: AMG_FROM,
        to: [phone],
        content: `Your AMG verification code is: ${otp}. It expires soon. Do not share this code.`,
        setInboxStatus: "done",
      }),
      signal,
    }));
    const receipt = await beforeDeadline(sendDeadline, () => provider.json().catch(() => ({})));
    if (!provider.ok || typeof receipt?.data?.id !== "string") {
      // A timeout, 5xx or malformed successful response may follow acceptance.
      const outcome = !provider.ok && provider.status >= 400 && provider.status < 500 ? "failed" : "uncertain";
      await record(outcome);
      return errorResult(503, "The verification text outcome could not be confirmed.");
    }
    await record("sent");
    return { status: 200, body: {} };
  } catch {
    if (claimed) {
      // If this write also fails, the durable 'sending' claim still blocks retries.
      try { await record(providerStarted ? "uncertain" : "failed"); } catch { /* fail closed */ }
    }
    return errorResult(503, "Authentication SMS failed closed.");
  }
}
