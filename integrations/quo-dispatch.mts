import { getPool } from "../netlify/functions/_shared/db.mjs";

type Delivery = { id: string; message_id: string; phone_snapshot: string; body: string; contact_id: string };

async function markDelivery(id: string, status: "sent" | "failed" | "skipped_opt_out", details: { quoId?: string; error?: string }) {
  const pool = getPool();
  await pool.query(
    `UPDATE amg_crm_message_recipients
     SET status=$1, quo_message_id=$2, failure_reason=$3,
       sent_at=CASE WHEN $1='sent' THEN NOW() ELSE sent_at END
     WHERE id=$4 AND status='sending'`,
    [status, details.quoId ?? null, details.error ?? null, id],
  );
}

async function deliver(item: Delivery, apiKey: string, from: string) {
  const pool = getPool();
  const consent = await pool.query(
    "SELECT consent_status FROM amg_crm_contacts WHERE id=$1", [item.contact_id],
  );
  if (consent.rows[0]?.consent_status !== "opted_in") {
    await markDelivery(item.id, "skipped_opt_out", { error: "Recipient opted out before dispatch." });
    return;
  }
  try {
    const response = await fetch("https://api.quo.com/v1/messages", {
      method: "POST",
      headers: { Authorization: apiKey, "content-type": "application/json" },
      body: JSON.stringify({ content: item.body, from, to: [item.phone_snapshot] }),
    });
    const payload = await response.json().catch(() => ({})) as { data?: { id?: string }; message?: string };
    if (response.status !== 202 || !payload.data?.id) {
      throw new Error(`Quo rejected the message (${response.status}).`);
    }
    await markDelivery(item.id, "sent", { quoId: payload.data.id });
  } catch (error) {
    await markDelivery(item.id, "failed", {
      error: error instanceof Error ? error.message.slice(0, 300) : "Quo request failed.",
    });
  }
}

// Prepared integration only. Do not expose or schedule this function until a
// dedicated AMG key, sender approval, storage, and dispatch approval exist.
export async function dispatchDueMessages() {
  if (Netlify.env.get("AMG_QUO_SEND_ENABLED") !== "true") {
    return new Response("Quo dispatch is disabled.", { status: 503 });
  }
  const apiKey = Netlify.env.get("QUO_API_KEY");
  const from = Netlify.env.get("QUO_FROM_NUMBER");
  if (!apiKey || !from) return new Response("Quo configuration is incomplete.", { status: 503 });

  const pool = getPool();
  const client = await pool.connect();
  let messageId: string | null = null;
  let deliveries: Delivery[] = [];
  try {
    await client.query("BEGIN");
    const message = await client.query(
      `SELECT id,body FROM amg_crm_messages
       WHERE status='scheduled' AND scheduled_for <= NOW()
       ORDER BY scheduled_for FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    if (!message.rows[0]) {
      await client.query("COMMIT");
      return new Response("No due messages.");
    }
    messageId = message.rows[0].id;
    await client.query("UPDATE amg_crm_messages SET status='sending',updated_at=NOW() WHERE id=$1", [messageId]);
    const claimed = await client.query<Delivery>(
      `UPDATE amg_crm_message_recipients r SET status='sending',claimed_at=NOW()
       FROM amg_crm_messages m
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

  for (let offset = 0; offset < deliveries.length; offset += 5) {
    await Promise.all(deliveries.slice(offset, offset + 5).map((item) => deliver(item, apiKey, from)));
  }

  const summary = await pool.query(
    `SELECT count(*) FILTER (WHERE status='sent')::int AS sent,
      count(*) FILTER (WHERE status='failed')::int AS failed,
      count(*) FILTER (WHERE status='skipped_opt_out')::int AS skipped
     FROM amg_crm_message_recipients WHERE message_id=$1`, [messageId],
  );
  const { sent, failed, skipped } = summary.rows[0];
  const finalStatus = failed > 0 || sent === 0 ? "failed" : "sent";
  const reason = finalStatus === "failed"
    ? (sent === 0 && skipped > 0 ? "No recipients remained opted in at dispatch time." : `${failed} recipient delivery failed.`)
    : null;
  await pool.query(
    "UPDATE amg_crm_messages SET status=$1,failure_reason=$2,updated_at=NOW() WHERE id=$3 AND status='sending'",
    [finalStatus, reason, messageId],
  );
  return Response.json({ messageId, sent, failed, skipped, status: finalStatus });
}
