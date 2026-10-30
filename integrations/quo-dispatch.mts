import { getPool } from "../netlify/functions/_shared/db.mjs";
import { isOptOutKeyword, outboundContent } from "./message-content.mjs";

type Delivery = { id: string; message_id: string; phone_snapshot: string; body: string; contact_id: string };

async function dispatchEnabled(pool = getPool()) {
  if (Netlify.env.get("AMG_QUO_EMERGENCY_DISABLE") === "true") return false;
  const result = await pool.query(
    "SELECT enabled FROM amg_private.crm_dispatch_control WHERE singleton=TRUE",
  );
  return result.rows[0]?.enabled === true;
}

async function markDelivery(id: string, status: "failed" | "skipped_opt_out", details: { error?: string }, pool = getPool()) {
  await pool.query(
    `UPDATE amg_private.crm_message_recipients
     SET status=$1, quo_message_id=$2, failure_reason=$3,
       sent_at=CASE WHEN $1='sent' THEN NOW() ELSE sent_at END
     WHERE id=$4 AND status='sending'`,
    [status, null, details.error ?? null, id],
  );
}

async function providerOptOut(apiKey: string, phoneNumberId: string, participant: string) {
  let pageToken = "";
  for (let page = 0; page < 20; page += 1) {
    const url = new URL("https://api.quo.com/v1/messages");
    url.searchParams.set("phoneNumberId", phoneNumberId);
    url.searchParams.append("participants", participant);
    url.searchParams.set("maxResults", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { headers: { authorization: apiKey, accept: "application/json" } });
    if (!response.ok) throw new Error(`Quo opt-out check failed (${response.status}).`);
    const payload = await response.json() as {
      data?: Array<{ id?: string; direction?: string; from?: string; text?: string; createdAt?: string }>;
      nextPageToken?: string | null;
    };
    if (!Array.isArray(payload.data)) throw new Error("Quo opt-out history was invalid.");
    const match = payload.data.find((message) =>
      message.direction === "incoming" && message.from === participant && isOptOutKeyword(message.text),
    );
    if (match) return match;
    if (!payload.nextPageToken) return null;
    pageToken = payload.nextPageToken;
  }
  throw new Error("Quo opt-out history exceeded the safe verification limit.");
}

async function markAccepted(item: Delivery, quoId: string, noticeRequired: boolean, pool = getPool()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const recipient = await client.query(
      `UPDATE amg_private.crm_message_recipients
       SET status='sent', quo_message_id=$1, failure_reason=NULL, sent_at=NOW()
       WHERE id=$2 AND status='sending' RETURNING id`,
      [quoId, item.id],
    );
    if (!recipient.rows[0]) throw new Error("Delivery state changed before provider acceptance was recorded.");
    if (noticeRequired) {
      await client.query(
        `UPDATE amg_private.crm_contacts
         SET first_outbound_accepted_at=COALESCE(first_outbound_accepted_at,NOW()), updated_at=NOW()
         WHERE id=$1`,
        [item.contact_id],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deliver(item: Delivery, apiKey: string, from: string, phoneNumberId: string) {
  const pool = getPool();
  if (!await dispatchEnabled(pool)) {
    await markDelivery(item.id, "failed", { error: "Dispatch was disabled before this recipient." }, pool);
    return;
  }
  const consent = await pool.query(
    `SELECT consent_status,full_name,first_outbound_accepted_at
     FROM amg_private.crm_contacts WHERE id=$1`, [item.contact_id],
  );
  if (consent.rows[0]?.consent_status !== "opted_in") {
    await markDelivery(item.id, "skipped_opt_out", { error: "Recipient opted out before dispatch." }, pool);
    return;
  }
  let optOut;
  try {
    optOut = await providerOptOut(apiKey, phoneNumberId, item.phone_snapshot);
  } catch (error) {
    await markDelivery(item.id, "failed", {
      error: error instanceof Error ? error.message.slice(0, 300) : "Opt-out status could not be verified.",
    }, pool);
    return;
  }
  if (optOut) {
    await pool.query(
      `UPDATE amg_private.crm_contacts
       SET consent_status='opted_out', consent_evidence=NULL, opted_out_at=$1,
         opt_out_source='quo_inbound_keyword', opt_out_event_id=$2, updated_at=NOW()
       WHERE id=$3`,
      [optOut.createdAt ?? new Date().toISOString(), optOut.id ?? null, item.contact_id],
    );
    await markDelivery(item.id, "skipped_opt_out", { error: "Recipient replied with a Quo opt-out keyword." }, pool);
    return;
  }

  const noticeRequired = !consent.rows[0].first_outbound_accepted_at;
  let content: string;
  try {
    content = outboundContent(item.body, consent.rows[0].full_name, noticeRequired);
  } catch (error) {
    await markDelivery(item.id, "failed", {
      error: error instanceof Error ? error.message : "Personalized message is invalid.",
    }, pool);
    return;
  }

  // A network error has an uncertain provider outcome. Leave the recipient in
  // `sending` so it cannot be retried automatically or duplicate a text.
  const response = await fetch("https://api.quo.com/v1/messages", {
    method: "POST",
    headers: { Authorization: apiKey, "content-type": "application/json" },
    body: JSON.stringify({ content, from, to: [item.phone_snapshot] }),
  });
  const payload = await response.json().catch(() => ({})) as { data?: { id?: string }; message?: string };
  if (response.status !== 202 || !payload.data?.id) {
    await markDelivery(item.id, "failed", { error: `Quo rejected the message (${response.status}).` }, pool);
    return;
  }
  await markAccepted(item, payload.data.id, noticeRequired, pool);
}

// Prepared integration only. Do not expose or schedule this function until a
// dedicated AMG key, sender approval, storage, and dispatch approval exist.
export async function dispatchDueMessages() {
  if (!await dispatchEnabled()) {
    return new Response("Quo dispatch is disabled.", { status: 503 });
  }
  const apiKey = Netlify.env.get("QUO_API_KEY");
  const from = Netlify.env.get("QUO_FROM_NUMBER");
  const phoneNumberId = Netlify.env.get("QUO_PHONE_NUMBER_ID");
  if (!apiKey || !from || !phoneNumberId) return new Response("Quo configuration is incomplete.", { status: 503 });

  const pool = getPool();
  const client = await pool.connect();
  let messageId: string | null = null;
  let deliveries: Delivery[] = [];
  try {
    await client.query("BEGIN");
    const message = await client.query(
      `SELECT id,body FROM amg_private.crm_messages
       WHERE status='scheduled' AND scheduled_for <= NOW()
       ORDER BY scheduled_for FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    if (!message.rows[0]) {
      await client.query("COMMIT");
      return new Response("No due messages.");
    }
    messageId = message.rows[0].id;
    await client.query("UPDATE amg_private.crm_messages SET status='sending',updated_at=NOW() WHERE id=$1", [messageId]);
    const claimed = await client.query<Delivery>(
      `UPDATE amg_private.crm_message_recipients r SET status='sending',claimed_at=NOW()
       FROM amg_private.crm_messages m
       WHERE r.message_id=m.id AND m.id=$1 AND r.status='scheduled'
       RETURNING r.id,r.message_id,r.phone_snapshot,r.contact_id,m.body`, [messageId],
    );
    deliveries = claimed.rows;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  for (const item of deliveries) {
    await deliver(item, apiKey, from, phoneNumberId);
  }

  const summary = await pool.query(
    `SELECT count(*) FILTER (WHERE status='sent')::int AS sent,
      count(*) FILTER (WHERE status='failed')::int AS failed,
      count(*) FILTER (WHERE status='skipped_opt_out')::int AS skipped
     FROM amg_private.crm_message_recipients WHERE message_id=$1`, [messageId],
  );
  const { sent, failed, skipped } = summary.rows[0];
  const finalStatus = failed > 0 || sent === 0 ? "failed" : "sent";
  const reason = finalStatus === "failed"
    ? (sent === 0 && skipped > 0 ? "No recipients remained opted in at dispatch time." : `${failed} recipient delivery failed.`)
    : null;
  await pool.query(
    "UPDATE amg_private.crm_messages SET status=$1,failure_reason=$2,updated_at=NOW() WHERE id=$3 AND status='sending'",
    [finalStatus, reason, messageId],
  );
  return Response.json({ messageId, sent, failed, skipped, status: finalStatus });
}
