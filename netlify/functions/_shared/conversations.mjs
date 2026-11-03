import { quoRequest } from "../../../integrations/quo-rate-limit.mjs";

const E164 = /^\+[1-9]\d{7,14}$/;
const unavailable = (message) => Object.assign(new Error(message), { status: 503 });

// The caller resolves participant from an admin-authorized CRM contact. Never
// accept a browser-supplied phone number or provider URL here.
export async function listContactMessages({ apiKey, fromNumber, phoneNumberId, participant, pageToken = "", fetchImpl = quoRequest }) {
  if (!apiKey || !E164.test(fromNumber || "") || !phoneNumberId) {
    throw unavailable("The approved AMG conversation service is not configured.");
  }
  if (!E164.test(participant || "") || participant === fromNumber) throw new Error("Contact phone number is invalid.");
  if (typeof pageToken !== "string" || pageToken.length > 2048 || /[\u0000-\u001f\u007f]/u.test(pageToken)) {
    throw new Error("Conversation page token is invalid.");
  }
  const url = new URL("https://api.quo.com/v1/messages");
  url.searchParams.set("phoneNumberId", phoneNumberId);
  // Quo specifies repeated participants keys without brackets.
  url.searchParams.append("participants", participant);
  url.searchParams.set("maxResults", "100");
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { authorization: apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw unavailable("Conversation history could not be reached. Refresh to try again.");
  }
  if (!response.ok) throw unavailable("Conversation history is temporarily unavailable. Refresh to try again.");
  let payload;
  try { payload = await response.json(); } catch {
    throw unavailable("Conversation history returned an invalid response. Refresh to try again.");
  }
  if (!Array.isArray(payload?.data) || (payload.nextPageToken != null && typeof payload.nextPageToken !== "string")) {
    throw unavailable("Conversation history returned an invalid response. Refresh to try again.");
  }
  const messages = new Map();
  for (const item of payload.data) {
    // Do not disclose other numbers' messages, group threads, or malformed rows
    // even if the upstream filter unexpectedly returns them.
    if (!item || item.phoneNumberId !== phoneNumberId || !Array.isArray(item.to) || item.to.length !== 1) continue;
    const incoming = item.direction === "incoming" && item.from === participant && item.to[0] === fromNumber;
    const outgoing = item.direction === "outgoing" && item.from === fromNumber && item.to[0] === participant;
    if (!incoming && !outgoing) continue;
    if (typeof item.id !== "string" || !item.id || typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt))) continue;
    messages.set(item.id, {
      id: item.id,
      text: typeof item.text === "string" ? item.text : "",
      direction: incoming ? "incoming" : "outgoing",
      status: typeof item.status === "string" ? item.status : "unknown",
      created_at: item.createdAt,
      has_media: Array.isArray(item.media) && item.media.length > 0,
    });
  }
  const nextToken = payload.nextPageToken || null;
  if (nextToken && (nextToken === pageToken || nextToken.length > 2048 || /[\u0000-\u001f\u007f]/u.test(nextToken))) {
    throw unavailable("Conversation history returned an invalid page token. Refresh to try again.");
  }
  return {
    messages: [...messages.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id)),
    next_page_token: nextToken,
    loaded_at: new Date().toISOString(),
  };
}
