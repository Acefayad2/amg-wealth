import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { invitationCors } from "./cors.mjs";

serve(async (req) => {
  const { headers, response } = invitationCors(req);
  if (response) return response;
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ error: "Phone verification is unavailable." }, 503);
  try {
    const input = await req.json();
    const phone = String(input?.phone || "").trim();
    const token = String(input?.inviteToken || "");
    if (!/^\+[1-9][0-9]{7,14}$/.test(phone) || token.length < 32 || token.length > 128) {
      return json({ error: "Invitation details are invalid." }, 400);
    }
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data: claimed, error: claimError } = await admin.rpc("amg_crm_claim_phone_admin_otp", {
      p_token: token, p_phone: phone,
    });
    if (claimError || !claimed) return json({ error: "This invitation is invalid, expired, or has reached its verification-code limit." }, 429);
    const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { error } = await client.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } });
    if (error) return json({ error: "The verification code could not be sent." }, 503);
    return json({ ok: true });
  } catch {
    return json({ error: "Phone verification could not be started." }, 400);
  }
});
