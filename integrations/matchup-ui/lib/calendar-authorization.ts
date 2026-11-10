import type { SupabaseClient, User } from "@supabase/supabase-js";

export const calendarConnectUserKey = "amg-calendar-connect-user";

export function authorizeGoogleCalendar(auth: Pick<SupabaseClient["auth"], "signInWithOAuth" | "linkIdentity">, user: Pick<User, "identities">, origin: string) {
  const linkedGoogle = user.identities?.find((identity) => identity.provider === "google");
  const request = {
    provider: "google" as const,
    options: {
      redirectTo: new URL("/matchups/cft/", origin).href,
      scopes: "openid email profile https://www.googleapis.com/auth/calendar.events.freebusy https://www.googleapis.com/auth/calendar.events.owned",
      queryParams: { access_type: "offline", prompt: "consent", ...(linkedGoogle?.identity_data?.email ? { login_hint: String(linkedGoogle.identity_data.email) } : {}) },
    },
  };
  // Linking an existing identity returns an OAuth error instead of fresh calendar tokens.
  return linkedGoogle ? auth.signInWithOAuth(request) : auth.linkIdentity(request);
}

export function calendarCallbackError(search: string, hash: string) {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const error = query.get("error") || fragment.get("error");
  const description = query.get("error_description") || fragment.get("error_description") || "";
  if (!error && !description) return "";
  if (/identity.*already.*link/i.test(description)) return "Your Google account is already linked. Choose Connect Google Calendar again to refresh its calendar access.";
  if (error === "access_denied") return "Google Calendar wasn’t connected because access was declined. You can try again.";
  return "Google Calendar couldn’t be connected. Try again from this workspace.";
}
