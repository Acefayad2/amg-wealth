import { createClient } from "@supabase/supabase-js";

export function getSupabaseConfig() {
  const url = Netlify.env.get("SUPABASE_URL") || process.env.SUPABASE_URL;
  const key = Netlify.env.get("SUPABASE_PUBLISHABLE_KEY") || process.env.SUPABASE_PUBLISHABLE_KEY;
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
