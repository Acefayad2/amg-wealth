import { getUser, verifyRequestOrigin } from "@netlify/identity";
import type { Config, Context } from "@netlify/functions";
import { cleanText, E164, publicError, requireUuid, validTimezone } from "./_shared/crm.mjs";
import { getPool } from "./_shared/db.mjs";

const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });

async function requireAdmin() {
  const user = await getUser();
  if (!user) throw Object.assign(new Error("Sign in required."), { status: 401 });
  if (!user.roles?.includes("admin")) {
    throw Object.assign(new Error("AMG admin access required."), { status: 403 });
  }
  return user;
}

export default async function handler(req: Request, _context: Context) {
  try {
    const user = await requireAdmin();
    const pool = getPool();

    if (req.method === "GET") {
      const [contacts, groups, messages] = await Promise.all([
        pool.query(`
          SELECT c.id, c.full_name, c.phone, c.consent_status, c.consent_evidence,
            c.timezone, COALESCE(array_agg(g.id) FILTER (WHERE g.id IS NOT NULL), '{}') AS group_ids
          FROM amg_crm_contacts c
          LEFT JOIN amg_crm_group_members gm ON gm.contact_id = c.id
          LEFT JOIN amg_crm_groups g ON g.id = gm.group_id
          GROUP BY c.id ORDER BY c.full_name
        `),
        pool.query(`
          SELECT g.id, g.name, count(gm.contact_id)::int AS member_count,
            count(gm.contact_id) FILTER (WHERE c.consent_status = 'opted_in')::int AS eligible_count
          FROM amg_crm_groups g
          LEFT JOIN amg_crm_group_members gm ON gm.group_id = g.id
          LEFT JOIN amg_crm_contacts c ON c.id = gm.contact_id
          GROUP BY g.id ORDER BY g.name
        `),
        pool.query(`
          SELECT m.id, m.body, m.target_type, m.target_id, m.target_name, m.status,
            m.scheduled_for, m.timezone, m.failure_reason, m.created_at,
            count(r.id)::int AS recipient_count
          FROM amg_crm_messages m
          LEFT JOIN amg_crm_message_recipients r ON r.message_id = m.id
          GROUP BY m.id ORDER BY COALESCE(m.scheduled_for, m.created_at) DESC
          LIMIT 500
        `),
      ]);
      const key = Netlify.env.get("QUO_API_KEY");
      const from = Netlify.env.get("QUO_FROM_NUMBER");
      return json({
        contacts: contacts.rows,
        groups: groups.rows,
        messages: messages.rows,
        transport: {
          provider: "Quo",
          configured: Boolean(key && from),
          enabled: Netlify.env.get("AMG_QUO_SEND_ENABLED") === "true",
        },
      });
    }

    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
    verifyRequestOrigin(req);
    const input = await req.json() as Record<string, unknown>;

    if (input.action === "save_contact") {
      const fullName = cleanText(input.fullName, 160, "Contact name");
      const phone = cleanText(input.phone, 16, "Phone number");
      if (!E164.test(phone)) throw new Error("Phone number must use E.164 format, such as +12025550123.");
      const consentStatus = input.consentStatus;
      if (!["pending", "opted_in", "opted_out"].includes(String(consentStatus))) throw new Error("Consent status is invalid.");
      const evidence = typeof input.consentEvidence === "string" ? input.consentEvidence.trim() : "";
      if (consentStatus === "opted_in" && !evidence) throw new Error("Consent evidence is required before a contact can receive texts.");
      if (!validTimezone(input.timezone)) throw new Error("Timezone is invalid.");
      const id = input.id ? requireUuid(input.id, "Contact") : null;
      const result = id
        ? await pool.query(
          `UPDATE amg_crm_contacts SET full_name=$1, phone=$2, consent_status=$3,
             consent_evidence=$4, timezone=$5, updated_by=$6, updated_at=NOW()
           WHERE id=$7 RETURNING id`,
          [fullName, phone, consentStatus, evidence || null, input.timezone, user.id, id],
        )
        : await pool.query(
          `INSERT INTO amg_crm_contacts
             (full_name, phone, consent_status, consent_evidence, timezone, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
          [fullName, phone, consentStatus, evidence || null, input.timezone, user.id],
        );
      return json({ id: result.rows[0]?.id }, id ? 200 : 201);
    }

    if (input.action === "set_membership") {
      const contactId = requireUuid(input.contactId, "Contact");
      const groupId = requireUuid(input.groupId, "Group");
      if (input.isMember === true) {
        await pool.query(
          `INSERT INTO amg_crm_group_members (group_id, contact_id, added_by)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [groupId, contactId, user.id],
        );
      } else {
        await pool.query(
          `DELETE FROM amg_crm_group_members WHERE group_id=$1 AND contact_id=$2`,
          [groupId, contactId],
        );
      }
      return json({ ok: true });
    }

    if (input.action === "save_message") {
      const body = cleanText(input.body, 1600, "Message");
      const targetType = input.targetType;
      if (targetType !== "individual" && targetType !== "group") throw new Error("Recipient type is invalid.");
      const targetId = requireUuid(input.targetId, "Recipient");
      const status = input.status;
      if (status !== "draft" && status !== "scheduled") throw new Error("Message status is invalid.");
      if (!validTimezone(input.timezone)) throw new Error("Timezone is invalid.");
      const requestKey = requireUuid(input.idempotencyKey, "Request key");
      const messageId = input.messageId ? requireUuid(input.messageId, "Message") : null;
      const scheduledFor = status === "scheduled" ? new Date(String(input.scheduledFor)) : null;
      if (scheduledFor && (!Number.isFinite(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now())) {
        throw new Error("Scheduled time must be in the future.");
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const target = targetType === "individual"
          ? await client.query("SELECT id, full_name AS name FROM amg_crm_contacts WHERE id=$1", [targetId])
          : await client.query("SELECT id, name FROM amg_crm_groups WHERE id=$1", [targetId]);
        if (!target.rows[0]) throw new Error("Recipient is invalid.");
        let saved;
        if (messageId) {
          saved = await client.query(
            `UPDATE amg_crm_messages SET body=$1,target_type=$2,target_id=$3,target_name=$4,
               status=$5,scheduled_for=$6,timezone=$7,idempotency_key=$8,updated_at=NOW()
             WHERE id=$9 AND created_by=$10 AND status='draft' RETURNING id`,
            [body, targetType, targetId, target.rows[0].name, status, scheduledFor?.toISOString() ?? null, input.timezone, requestKey, messageId, user.id],
          );
          if (!saved.rows[0]) throw new Error("Only your draft messages can be edited.");
          await client.query("DELETE FROM amg_crm_message_recipients WHERE message_id=$1", [messageId]);
        } else {
          saved = await client.query(
            `INSERT INTO amg_crm_messages
               (body,target_type,target_id,target_name,status,scheduled_for,timezone,idempotency_key,created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (idempotency_key) DO UPDATE SET updated_at=amg_crm_messages.updated_at
             RETURNING id`,
            [body, targetType, targetId, target.rows[0].name, status, scheduledFor?.toISOString() ?? null, input.timezone, requestKey, user.id],
          );
        }
        if (status === "scheduled") {
          const recipients = targetType === "individual"
            ? await client.query(
              "SELECT id,phone FROM amg_crm_contacts WHERE id=$1 AND consent_status='opted_in'", [targetId],
            )
            : await client.query(
              `SELECT c.id,c.phone FROM amg_crm_contacts c
               JOIN amg_crm_group_members gm ON gm.contact_id=c.id
               WHERE gm.group_id=$1 AND c.consent_status='opted_in'`, [targetId],
            );
          if (!recipients.rowCount) throw new Error("No opted-in recipients are eligible for this schedule.");
          if (recipients.rowCount > 100) throw new Error("A scheduled group is limited to 100 opted-in recipients.");
          for (const recipient of recipients.rows) {
            await client.query(
              `INSERT INTO amg_crm_message_recipients (message_id,contact_id,phone_snapshot)
               VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
              [saved.rows[0].id, recipient.id, recipient.phone],
            );
          }
        }
        await client.query("COMMIT");
        return json({ id: saved.rows[0].id }, messageId ? 200 : 201);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    return json({ error: "Action is invalid." }, 400);
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 400;
    return json({ error: [401, 403, 503].includes(status) ? (error as Error).message : publicError(error) }, status || 400);
  }
}

export const config: Config = {
  path: "/api/admin/crm",
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 120 },
};
