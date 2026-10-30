import type { Config } from "@netlify/functions";
import { getSupabaseConfig } from "./_shared/supabase.mjs";

const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };

export default async function handler(req: Request) {
  if (req.method !== "GET") return Response.json({ error: "Method not allowed." }, { status: 405, headers });
  try {
    return Response.json(getSupabaseConfig(), { headers });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
    return Response.json({ error: "CRM backend is not configured." }, { status, headers });
  }
}

export const config: Config = { path: "/api/admin/config" };
