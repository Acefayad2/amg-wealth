import type { Config, Context } from "@netlify/functions";
import { requireUuid } from "./_shared/crm.mjs";
import { getAuthenticatedUser } from "./_shared/supabase.mjs";
import { dispatchImmediateMessage } from "../../integrations/quo-dispatch.mjs";

export default async function handler(req: Request, _context: Context) {
  if (req.method !== "POST") throw new Error("Method not allowed.");
  const { user } = await getAuthenticatedUser(req);
  const input = await req.json() as Record<string, unknown>;
  const messageId = requireUuid(input.messageId, "Message");
  await dispatchImmediateMessage(messageId, user.id, input.personalizeName === true);
}

export const config: Config = {
  background: true,
  method: "POST",
};
