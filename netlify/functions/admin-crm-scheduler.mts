import type { Config, Context } from "@netlify/functions";

export default async function handler(req: Request, _context: Context) {
  try {
    const background = await fetch(new URL("/.netlify/functions/admin-crm-scheduled-background", req.url), { method: "POST" });
    return background.status === 202
      ? new Response("Scheduled delivery worker queued.", { status: 202 })
      : new Response("Scheduled delivery worker could not be queued.", { status: 503 });
  } catch (error) {
    console.error("AMG CRM scheduler failed", error instanceof Error ? error.message : "Unknown error");
    return new Response("Scheduler failed closed.", { status: 500 });
  }
}

export const config: Config = { schedule: "* * * * *" };
