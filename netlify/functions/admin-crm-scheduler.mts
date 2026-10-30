import type { Config } from "@netlify/functions";
import { runScheduledDispatch } from "../../integrations/quo-dispatch.mjs";

export default async function handler() {
  try {
    return await runScheduledDispatch();
  } catch (error) {
    console.error("AMG CRM scheduler failed", error instanceof Error ? error.message : "Unknown error");
    return new Response("Scheduler failed closed.", { status: 500 });
  }
}

export const config: Config = { schedule: "* * * * *" };
