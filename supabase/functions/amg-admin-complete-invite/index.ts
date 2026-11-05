import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { completeAdminInvite } from "./core.mjs";

Deno.serve(async (req) => {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  return completeAdminInvite(req, {
    client: url && serviceKey ? createClient(url, serviceKey, options) : null,
    callerClient: url && anonKey ? createClient(url, anonKey, options) : null,
  });
});
