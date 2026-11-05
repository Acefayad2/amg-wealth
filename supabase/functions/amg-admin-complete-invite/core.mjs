import { invitationCors } from "../amg-admin-phone-otp/cors.mjs";

const invalidInvite = "This personal link has expired or has already been used. If you created your account, sign in to AMG Communications.";
const emailInUse = "This email already belongs to an account. Use another email, or sign in if you already completed setup.";
const unavailable = "Account setup could not be confirmed. Try signing in if you submitted your details, or try the link again.";

function validPassword(password) {
  return typeof password === "string" && password.length >= 8 &&
    new TextEncoder().encode(password).length <= 72;
}

export async function completeAdminInvite(req, { client, callerClient }) {
  const { headers, response } = invitationCors(req);
  if (response) return response;
  const json = (body, status) => new Response(JSON.stringify(body), { status, headers });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!client) return json({ error: unavailable }, 503);

  const input = await req.json().catch(() => null);
  const token = input?.inviteToken;
  if (typeof token !== "string" || token.length < 32 || token.length > 128) {
    return json({ error: invalidInvite }, 410);
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  const isAvailable = async () => {
    const { data, error } = await client.rpc("amg_crm_admin_invite_available", { p_token_hash: tokenHash });
    if (error) throw error;
    return data === true;
  };

  try {
    if (!await isAvailable()) return json({ error: invalidInvite }, 410);
    if (input.action === "check") return json({ ok: true }, 200);
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Enter a valid email address." }, 400);
    }
    if (!validPassword(input.password)) {
      return json({ error: "Use at least 8 characters for your password (72 bytes maximum)." }, 400);
    }

    const { data, error } = await client.auth.admin.createUser({
      email, password: input.password, email_confirm: true,
      app_metadata: { amg_crm_invite_hash: tokenHash },
    });
    if (!error && data?.user?.id) return json({ ok: true }, 201);
    // A concurrent winner (or expiry inside the Auth transaction) rolls back
    // the losing creation. Recheck before interpreting the Auth error.
    if (!await isAvailable()) return json({ error: invalidInvite }, 410);
    if (error?.code === "weak_password" || error?.code === "validation_failed") {
      return json({ error: "The account details were rejected. Check the email and choose a strong password." }, 400);
    }
    if (!["email_exists", "user_already_exists"].includes(error?.code)) {
      return json({ error: unavailable }, 503);
    }

    const legacy = await client.rpc("amg_crm_admin_invite_legacy_user", { p_token_hash: tokenHash, p_email: email });
    if (legacy.error) throw legacy.error;
    if (!legacy.data) return json({ error: emailInUse }, 409);
    // Only a legacy, already verified recipient can finish with their existing
    // password. Never change an existing account's password or email here.
    const login = await callerClient.auth.signInWithPassword({ email, password: input.password });
    if (login.error) {
      return json({ error: "Use the password you already set for this email during setup." }, 409);
    }
    try {
      if (login.data?.user?.id !== legacy.data) return json({ error: emailInUse }, 409);
      const accepted = await callerClient.rpc("amg_crm_accept_phone_admin_invite", { p_token: token });
      if (accepted.error) {
        if (!await isAvailable()) return json({ error: invalidInvite }, 410);
        throw accepted.error;
      }
      return json({ ok: true }, 201);
    } finally {
      await callerClient.auth.signOut({ scope: "local" }).catch(() => {});
    }
  } catch {
    return json({ error: unavailable }, 503);
  }
}
