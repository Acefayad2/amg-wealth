import { calendarWorkerAuthorized } from "./authorization.ts";
import { reconcileCalendar, type CalendarDesired } from "./reconcile.ts";

Deno.serve(async request => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!calendarWorkerAuthorized(request.headers, Deno.env.get("AMG_CALENDAR_WORKER_SECRET") || "", Deno.env.get("AMG_APPOINTMENT_WORKER_SECRET") || "")) return new Response("Unauthorized", { status: 401 });
  if (Deno.env.get("AMG_CALENDAR_SYNC_ENABLED") !== "true") return Response.json({ enabled: false });
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID"), clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");
  if (!url || !key || !clientId || !clientSecret) return Response.json({ error: "Calendar sync is not configured" }, { status: 503 });
  const rpc = async (name: string, args: unknown) => {
    const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`database_${response.status}`);
    return await response.json();
  };
  const run = (action: string, payload: unknown = {}) => rpc("matchup_calendar_worker", { p_action: action, p_payload: payload });
  let reconciled = 0, failed = 0;
  try {
    for (let i = 0; i < 5; i++) {
      const jobs: Array<{ id: string; revision: number; lease: string; desired: CalendarDesired }> = await run("claim");
      const job = jobs[0]; if (!job) break;
      if (!await run("current", { id: job.id, revision: job.revision, lease: job.lease })) {
        await run("finish", { id: job.id, revision: job.revision, lease: job.lease, status: "superseded" }); continue;
      }
      try {
        const connections = await rpc("get_cft_calendar_token", { p_trainer_id: job.desired.trainer_id });
        const connection = Array.isArray(connections) ? connections[0] : connections;
        if (!connection?.refresh_token) {
          await run("finish", { id: job.id, revision: job.revision, lease: job.lease, status: "not_connected" }); continue;
        }
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: connection.refresh_token, grant_type: "refresh_token" }), signal: AbortSignal.timeout(10000) });
        const token = await tokenResponse.json();
        if (!tokenResponse.ok || !token.access_token) throw new Error("calendar_authorization_failed");
        const result = await reconcileCalendar(job.desired, String(token.access_token));
        await run("finish", { id: job.id, revision: job.revision, lease: job.lease, ...result });
        reconciled++;
      } catch (error) {
        const message = error instanceof Error && /^calendar_[a-z_0-9]+$/.test(error.message) ? error.message : "calendar_sync_failed";
        await run("finish", { id: job.id, revision: job.revision, lease: job.lease, status: "retry", error: message }); failed++;
      }
    }
    return Response.json({ enabled: true, reconciled, failed });
  } catch { return Response.json({ error: "Calendar worker needs attention", reconciled, failed }, { status: 503 }); }
});

