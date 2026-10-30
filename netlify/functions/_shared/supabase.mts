import { createClient } from "@supabase/supabase-js";

// These are public browser configuration values, never a service-role secret.
const publicSupabaseUrl = "https://jkwhoisuhcbkokwntrfg.supabase.co";
const publicSupabasePublishableKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imprd2hvaXN1aGNia29rd250cmZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU1Njc0NzMsImV4cCI6MjA4MDkyNzQ3M30.TbylFatKse3YAvRIEAJzuh2GczfxYEB4N2iAhy8XISY";

export function getSupabaseConfig() {
  const url = Netlify.env.get("SUPABASE_URL") || process.env.SUPABASE_URL || publicSupabaseUrl;
  const key =
    Netlify.env.get("SUPABASE_PUBLISHABLE_KEY") ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    publicSupabasePublishableKey;
  if (!url || !key) throw Object.assign(new Error("CRM backend is not configured."), { status: 503 });
  return { url, key };
}

export async function getUserClient(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) throw Object.assign(new Error("Sign in required."), { status: 401 });
  const { url, key } = getSupabaseConfig();
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw Object.assign(new Error("Sign in required."), { status: 401 });
  return client;
}
