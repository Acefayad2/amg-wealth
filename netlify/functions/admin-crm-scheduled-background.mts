import type { Config, Context } from "@netlify/functions";
import { runScheduledDispatch } from "../../integrations/quo-dispatch.mjs";

export default async function handler(_req: Request, _context: Context) {
  await runScheduledDispatch();
}

export const config: Config = {
  background: true,
  method: "POST",
};
