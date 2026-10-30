export const INVITATION_ORIGIN = "https://anointedmoneygroup.com";
export function invitationCors(req) {
  const allowed = req.headers.get("origin") === INVITATION_ORIGIN;
  const headers = {
    "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "vary": "Origin",
    ...(allowed ? {
      "access-control-allow-origin": INVITATION_ORIGIN,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    } : {}),
  };
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
  if (!allowed) return { headers, response: json({ error: "Origin not allowed." }, 403) };
  if (req.method === "OPTIONS") return { headers, response: new Response(null, { status: 204, headers }) };
  return { headers, response: null };
}
