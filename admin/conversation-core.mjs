// Read-only conversation state. Every navigation invalidates older requests,
// including transports that ignore AbortSignal after a response has started.
export function createConversationController({ fetchPage, onChange = () => {} }) {
  const empty = () => ({ contactId: null, contactPhone: null, messages: [], nextPageToken: null, loadedAt: null, hasLoaded: false, busy: false, error: "", lastAttempt: "latest" });
  let view = empty();
  let generation = 0;
  let request = null;
  const publish = (changes) => { view = { ...view, ...changes }; onChange(view); };
  const invalidate = () => { generation += 1; request?.abort(); request = null; };

  async function load(kind) {
    if (!view.contactId || view.busy || (kind === "older" && !view.nextPageToken)) return false;
    const contactId = view.contactId;
    const contactPhone = view.contactPhone;
    const pageToken = kind === "older" ? view.nextPageToken : null;
    const version = ++generation;
    const controller = new AbortController();
    request = controller;
    publish({ busy: true, error: "", lastAttempt: kind });
    const current = () => version === generation && !controller.signal.aborted && view.contactId === contactId;
    try {
      const payload = await fetchPage({ contactId, pageToken, signal: controller.signal });
      if (!current()) return false;
      if (payload?.contact_id !== contactId || payload.contact_phone !== contactPhone || !Array.isArray(payload.messages) ||
          (payload.next_page_token != null && typeof payload.next_page_token !== "string") ||
          payload.messages.some((message) => !message || typeof message.id !== "string" || !message.id ||
            typeof message.text !== "string" || !["incoming", "outgoing"].includes(message.direction))) {
        throw new Error("Conversation response could not be verified. Refresh to try again.");
      }
      const byId = new Map((kind === "older" ? view.messages : []).map((message) => [message.id, message]));
      for (const message of payload.messages) byId.set(message.id, { ...message });
      const messages = [...byId.values()].sort((a, b) => {
        const timeA = Date.parse(a.created_at) || 0;
        const timeB = Date.parse(b.created_at) || 0;
        return timeA - timeB || a.id.localeCompare(b.id);
      });
      publish({ messages, nextPageToken: payload.next_page_token || null, loadedAt: payload.loaded_at || null, hasLoaded: true });
      return true;
    } catch (error) {
      if (current()) publish({ error: error?.message || "Conversation could not be loaded. Try again." });
      return false;
    } finally {
      if (current()) { request = null; publish({ busy: false }); }
    }
  }

  return {
    get view() { return view; },
    open(contact) {
      invalidate();
      view = { ...empty(), contactId: contact.id, contactPhone: contact.phone };
      onChange(view);
      return load("latest");
    },
    close() { invalidate(); view = empty(); onChange(view); },
    refresh() { return load("latest"); },
    loadOlder() { return load("older"); },
    retry() { return load(view.lastAttempt); },
  };
}

export function conversationReplyState(contact, state) {
  if (!contact) return { allowed: false, reason: "This contact is no longer available." };
  if (contact.consent_status !== "opted_in") return {
    allowed: false,
    reason: contact.consent_status === "opted_out"
      ? "This contact has opted out. You can view the conversation, but replies are blocked."
      : "Verified opt-in is required to reply. You can still view this conversation.",
  };
  if (state.messageBusy) return { allowed: false, reason: "Wait for the current message request to finish before replying." };
  if (!state.dispatch_control?.individual_enabled) return { allowed: false, reason: "Individual Texts are off. Turn them on before replying." };
  if (!state.storage_verified || !state.transport?.verified || !state.transport?.enabled || state.transport?.emergency_disabled) {
    return { allowed: false, reason: "Replies are locked until the approved AMG delivery connection is ready." };
  }
  return { allowed: true, reason: "Reply opens the message composer. You will review and confirm before sending. Consent and opt-outs are checked again." };
}

export function conversationDateTime(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date)
    : "Time unavailable";
}

// Never interpret provider text, message statuses, or contact content as markup.
export function renderConversationMessages(container, messages, document = globalThis.document) {
  const items = messages.map((message) => {
    const item = document.createElement("li");
    item.className = `conversation-message ${message.direction === "outgoing" ? "outgoing" : "incoming"}`;
    const heading = document.createElement("div");
    heading.className = "conversation-message-meta";
    const direction = document.createElement("strong");
    direction.textContent = message.direction === "outgoing" ? "AMG · Outgoing" : "Contact · Incoming";
    const timestamp = document.createElement("time");
    if (message.created_at && Number.isFinite(Date.parse(message.created_at))) timestamp.dateTime = message.created_at;
    timestamp.textContent = conversationDateTime(message.created_at);
    heading.append(direction, timestamp);
    const body = document.createElement("p");
    body.className = "conversation-message-text";
    body.textContent = message.text || (message.has_media ? "Media message" : "No text content");
    const status = document.createElement("span");
    status.className = "conversation-message-status";
    status.textContent = `Status: ${typeof message.status === "string" && message.status ? message.status.replaceAll("_", " ") : "unavailable"}`;
    item.append(heading, body, status);
    if (message.has_media) {
      const media = document.createElement("span");
      media.className = "conversation-media-note";
      media.textContent = "Contains media. Attachments are not displayed here.";
      item.append(media);
    }
    return item;
  });
  container.replaceChildren(...items);
}
