import { normalizeRegistrationCode } from "./registration-code.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { appointmentInstant, databaseTime, notificationConsent, slotIsFree } from "./appointment.ts";

const CFT_REGISTRATION_CODE_HASH = "e1ab80a54103d5333ce75f1441a49313be73b41dc0f2f781280ce5ceb491acb4";

const allowedOrigins = new Set([
  "https://amg-matchup-portal.netlify.app",
  "https://amg-app.netlify.app",
  "https://anointedmoneygroup.com",
  "https://www.anointedmoneygroup.com",
  "http://127.0.0.1:8771",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:4174",
]);

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://amg-matchup-portal.netlify.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(data: unknown, status: number, origin: string | null) {
  return Response.json(data, { status, headers: corsHeaders(origin) });
}

function formatSlot(value: string) {
  const [hourValue, minute] = value.split(":");
  const hour = Number(hourValue);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${minute} ${suffix}`;
}

function timeMinutes(value: string) {
  const twelveHour = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (twelveHour) {
    let hour = Number(twelveHour[1]);
    if (twelveHour[3].toUpperCase() === "PM" && hour !== 12) hour += 12;
    if (twelveHour[3].toUpperCase() === "AM" && hour === 12) hour = 0;
    return hour * 60 + Number(twelveHour[2]);
  }
  const twentyFourHour = value.match(/^(\d{1,2}):(\d{2})/);
  return twentyFourHour ? Number(twentyFourHour[1]) * 60 + Number(twentyFourHour[2]) : null;
}

function scoreTrainer(trainer: Record<string, unknown>, context: string) {
  const keywords = Array.isArray(trainer.match_keywords) ? trainer.match_keywords as string[] : [];
  const specialties = Array.isArray(trainer.specialties) ? trainer.specialties as string[] : [];
  const searchable = `${keywords.join(" ")} ${specialties.join(" ")} ${trainer.bio || ""}`.toLowerCase();
  return context.split(/[^a-z0-9]+/).filter((word) => word.length > 3).reduce((score, word) => score + (searchable.includes(word) ? 4 : 0), 70);
}

function easternDate() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function easternTimeMinutes() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(value.hour) * 60 + Number(value.minute);
}

function validEmail(value: unknown) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function escapeHtml(value: unknown) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character] || character));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function initialsFor(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 3).map((part) => part[0].toUpperCase()).join("");
  if (initials.length >= 2) return initials;

  // A single-word display name still needs to satisfy the directory's
  // two-to-three-character initials constraint.
  return name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();
}

function easternOffset(date: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(new Date(`${date}T12:00:00Z`));
  const zone = parts.find((part) => part.type === "timeZoneName")?.value || "GMT-5";
  const match = zone.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return "-05:00";
  return `${match[1]}${match[2].padStart(2, "0")}:${match[3] || "00"}`;
}

function nextDate(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function easternDateTime(date: string, time: string) {
  return `${date}T${time.slice(0, 8)}${easternOffset(date)}`;
}

async function googleAccessToken(refreshToken: string) {
  const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Google Calendar credentials are not configured");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Error("Google Calendar authorization needs to be renewed");
  return String(payload.access_token);
}

async function calendarConnection(supabase: any, trainerId: string) {
  const { data, error } = await supabase.rpc("get_cft_calendar_token", { p_trainer_id: trainerId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.refresh_token ? row as { trainer_id: string; google_email: string; refresh_token: string; status: string } : null;
}

async function googleBusyRangesForRange(supabase: any, trainerId: string, firstDate: string, lastDate: string) {
  const connection = await calendarConnection(supabase, trainerId);
  if (!connection) return null;
  const accessToken = await googleAccessToken(connection.refresh_token);
  const followingDate = nextDate(lastDate);
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      timeMin: `${firstDate}T00:00:00${easternOffset(firstDate)}`,
      timeMax: `${followingDate}T00:00:00${easternOffset(followingDate)}`,
      timeZone: "America/New_York",
      items: [{ id: "primary" }],
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.calendars?.primary || payload.calendars.primary.errors?.length || !Array.isArray(payload.calendars.primary.busy)) throw new Error("Google Calendar availability could not be checked");
  return payload.calendars.primary.busy as Array<{ start: string; end: string }>;
}

async function googleBusyRanges(supabase: any, trainerId: string, date: string) {
  return googleBusyRangesForRange(supabase, trainerId, date, date);
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return json({ error: "Origin not allowed" }, 403, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Backend configuration is incomplete" }, 503, origin);
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const body = await request.json();
    if (["calendar-connect", "calendar-status", "calendar-preferences", "calendar-conflicts"].includes(body.action)) {
      const authorization = request.headers.get("authorization") || "";
      const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (!accessToken) return json({ error: "Sign in to connect a trainer calendar." }, 401, origin);
      const { data: userResult, error: userError } = await supabase.auth.getUser(accessToken);
      if (userError || !userResult.user) return json({ error: "Your trainer login has expired. Sign in again." }, 401, origin);

      if (body.action === "calendar-status") {
        const { data: trainer, error: trainerError } = await supabase.from("cft_directory")
          .select("id").eq("user_id", userResult.user.id).eq("active", true).maybeSingle();
        if (trainerError) throw trainerError;
        if (!trainer) return json({ connected: false, googleEmail: "", showBusyEvents: false }, 200, origin);
        const { data: connection, error: connectionError } = await supabase.from("cft_calendar_connections")
          .select("google_email,status,show_busy_events").eq("trainer_id", trainer.id).maybeSingle();
        if (connectionError) throw connectionError;
        return json({
          connected: connection?.status === "connected",
          googleEmail: connection?.google_email || "",
          showBusyEvents: Boolean(connection?.show_busy_events),
        }, 200, origin);
      }

      if (body.action === "calendar-preferences") {
        const [{ data: profile }, { data: trainer }] = await Promise.all([
          supabase.from("profiles").select("role,is_active").eq("id", userResult.user.id).maybeSingle(),
          supabase.from("cft_directory").select("id").eq("user_id", userResult.user.id).eq("active", true).maybeSingle(),
        ]);
        if (!profile?.is_active || !["cft", "admin"].includes(profile.role) || !trainer) {
          return json({ error: "No active trainer calendar is linked to this login." }, 403, origin);
        }
        const showBusyEvents = body.showBusyEvents === true;
        const { data: connection, error } = await supabase.from("cft_calendar_connections")
          .update({ show_busy_events: showBusyEvents, updated_at: new Date().toISOString() })
          .eq("trainer_id", trainer.id).eq("status", "connected").select("trainer_id").maybeSingle();
        if (error) throw error;
        if (!connection) return json({ error: "Connect Google Calendar before changing this option." }, 409, origin);
        return json({ showBusyEvents }, 200, origin);
      }

      if (body.action === "calendar-conflicts") {
        const requestedSlots = Array.isArray(body.slots) ? body.slots.slice(0, 200) : [];
        const normalizedSlots = requestedSlots.map((slot: Record<string, unknown>) => ({
          date: String(slot.date || ""),
          time: String(slot.time || "").slice(0, 5),
        }));
        if (!normalizedSlots.length || normalizedSlots.some((slot: { date: string; time: string }) => !/^\d{4}-\d{2}-\d{2}$/.test(slot.date) || !/^\d{2}:\d{2}$/.test(slot.time))) {
          return json({ error: "Choose valid availability times to check." }, 400, origin);
        }

        const trainerId = String(body.trainerId || "");
        const [{ data: profile }, { data: trainer }] = await Promise.all([
          supabase.from("profiles").select("role,is_active").eq("id", userResult.user.id).maybeSingle(),
          supabase.from("cft_directory").select("id,user_id,active").eq("id", trainerId).maybeSingle(),
        ]);
        const canCheck = trainer?.active && profile?.is_active && (trainer.user_id === userResult.user.id || profile.role === "admin");
        if (!canCheck) return json({ error: "You cannot check that trainer calendar." }, 403, origin);

        const dates = normalizedSlots.map((slot: { date: string }) => slot.date).sort();
        const busyRanges = await googleBusyRangesForRange(supabase, trainerId, dates[0], dates[dates.length - 1]);
        if (!busyRanges) return json({ connected: false, busySlotKeys: [] }, 200, origin);
        const busySlotKeys = normalizedSlots
          .filter((slot: { date: string; time: string }) => !slotIsFree(slot.date, `${slot.time}:00`, busyRanges))
          .map((slot: { date: string; time: string }) => `${slot.date}|${slot.time}`);
        return json({ connected: true, busySlotKeys }, 200, origin);
      }

      const refreshToken = String(body.providerRefreshToken || "");
      const googleEmail = String(body.googleEmail || userResult.user.email || "").trim().toLowerCase();
      const scopes = String(body.scopes || "").split(/\s+/).filter(Boolean);
      if (!refreshToken) return json({ error: "Google did not return an offline connection. Please reconnect and approve calendar access." }, 400, origin);
      const { error } = await supabase.rpc("save_cft_calendar_connection", {
        p_user_id: userResult.user.id,
        p_google_email: googleEmail,
        p_refresh_token: refreshToken,
        p_scopes: scopes,
      });
      if (error) throw error;
      return json({ connected: true, googleEmail }, 200, origin);
    }

    if (body.action === "cft-register") {
      const registration = body.registration || {};
      const displayName = String(registration.name || "").trim().replace(/\s+/g, " ");
      const nameParts = displayName.split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ");
      const email = String(registration.email || "").trim().toLowerCase();
      const phone = String(registration.phone || "").trim();
      const password = String(registration.password || "");
      const verificationPassword = normalizeRegistrationCode(registration.verificationPassword);
      const bio = String(registration.bio || "").trim();
      const matchKeywords = [...new Set(bio.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3))].slice(0, 30);

      if (
        displayName.length < 3 || displayName.length > 100 ||
        !validEmail(email) || phone.length < 7 || phone.length > 30 ||
        password.length < 8 || password.length > 72 ||
        bio.length < 20 || bio.length > 800
      ) return json({ error: "Enter a valid name, email, phone number, and trainer description." }, 400, origin);

      const submittedCodeHash = await sha256(verificationPassword);
      if (!constantTimeEqual(submittedCodeHash, CFT_REGISTRATION_CODE_HASH)) {
        return json({ error: "The AMG verification password is incorrect." }, 403, origin);
      }

      const { data: existingContact } = await supabase.from("cft_contacts").select("trainer_id").eq("email", email).maybeSingle();
      if (existingContact) return json({ error: "A CFT account already exists for this email. Use trainer login instead." }, 409, origin);

      const { data: created, error: createUserError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { first_name: firstName, last_name: lastName, full_name: displayName },
        app_metadata: { role: "cft" },
      });
      if (createUserError || !created.user) {
        const duplicate = createUserError?.message.toLowerCase().includes("already") || createUserError?.message.toLowerCase().includes("registered");
        return json({ error: duplicate ? "A CFT account already exists for this email. Use trainer login instead." : "We couldn’t create the CFT login. Please try again." }, duplicate ? 409 : 500, origin);
      }

      let trainerId = "";
      try {
        const { error: profileError } = await supabase.from("profiles").upsert({
          id: created.user.id,
          email,
          first_name: firstName,
          last_name: lastName || null,
          role: "cft",
          is_active: true,
        });
        if (profileError) throw profileError;

        const { data: trainer, error: trainerError } = await supabase.from("cft_directory").insert({
          user_id: created.user.id,
          display_name: displayName,
          initials: initialsFor(displayName),
          location: "",
          years_in_field: 0,
          bio,
          specialties: [],
          match_keywords: matchKeywords,
          avatar_tone: "green",
          active: true,
          is_available: false,
          is_demo: false,
        }).select("id").single();
        if (trainerError || !trainer) throw trainerError || new Error("Trainer profile was not created");
        trainerId = trainer.id;

        const { error: contactError } = await supabase.from("cft_contacts").insert({ trainer_id: trainerId, email, phone });
        if (contactError) throw contactError;

        const { data: rootOrganization, error: organizationError } = await supabase
          .from("amg_organizations").select("id").eq("slug", "anointed-money-group").eq("is_active", true).maybeSingle();
        if (organizationError || !rootOrganization) throw organizationError || new Error("AMG organization is not configured");
        const { error: membershipError } = await supabase.from("amg_organization_memberships").upsert({
          organization_id: rootOrganization.id,
          user_id: created.user.id,
          role: "cft",
          display_name: displayName,
          email,
          phone,
          is_active: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: "organization_id,user_id" });
        if (membershipError) throw membershipError;
      } catch (registrationError) {
        if (trainerId) await supabase.from("cft_directory").delete().eq("id", trainerId);
        await supabase.auth.admin.deleteUser(created.user.id);
        throw registrationError;
      }

      return json({ ok: true, message: "CFT account created. Sign in with the password you chose." }, 201, origin);
    }

    // A random booking reference is a receipt capability, not a user identity.
    // Return status only; never expose client details, emails, or meeting URLs.
    if (body.action === "receipt-status") {
      const references = body.references;
      if (!Array.isArray(references) || references.length < 1 || references.length > 50 ||
        references.some((value: unknown) => typeof value !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))) {
        return json({ error: "Provide valid appointment receipts." }, 400, origin);
      }
      const { data, error } = await supabase.from("matchup_appointments")
        .select("booking_reference,status")
        .in("booking_reference", [...new Set(references)]);
      if (error) throw error;
      const response = json({ receipts: data || [] }, 200, origin);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }

    if (body.action === "stats") {
      const date = easternDate();
      const [{ data: trainers, error: trainerError }, { data: openSlots, error: slotError }] = await Promise.all([
        supabase.from("cft_directory").select("id").eq("active", true).eq("is_available", true),
        supabase.from("cft_availability").select("trainer_id,start_time").eq("available_date", date).eq("status", "open"),
      ]);
      if (trainerError || slotError) throw trainerError || slotError;
      const nowMinutes = easternTimeMinutes();
      const openTrainerIds = new Set(((openSlots || []) as Array<{ start_time: string; trainer_id: string }>).filter((slot) => (timeMinutes(slot.start_time) ?? -1) > nowMinutes).map((slot) => slot.trainer_id));
      const availableToday = ((trainers || []) as Array<Record<string, any>>).filter((trainer) => openTrainerIds.has(trainer.id)).length;
      return json({ availableToday }, 200, origin);
    }

    if (body.action === "match") {
      const date = String(body.date || "");
      const preferredTime = String(body.preferredTime || "");
      const description = String(body.description || "").trim();
      const context = `${body.background || ""} ${body.focus || ""} ${description}`.toLowerCase();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < easternDate() || !/^\d{2}:\d{2}$/.test(preferredTime) || description.length < 10) return json({ error: "Add at least 10 characters about the client, a current or future date, and a preferred time." }, 400, origin);

      const [{ data: trainers, error: trainerError }, { data: availability, error: availabilityError }] = await Promise.all([
        supabase.from("cft_directory").select("id,display_name,initials,location,years_in_field,bio,specialties,match_keywords,avatar_tone").eq("active", true).eq("is_available", true),
        supabase.from("cft_availability").select("trainer_id,start_time").eq("available_date", date).eq("status", "open").order("start_time"),
      ]);
      if (trainerError || availabilityError) throw trainerError || availabilityError;

      const slotsByTrainer = new Map<string, string[]>();
      const rawSlotsByTrainer = new Map<string, string[]>();
      for (const slot of availability || []) {
        if (date === easternDate() && (timeMinutes(slot.start_time) ?? -1) <= easternTimeMinutes()) continue;
        const values = slotsByTrainer.get(slot.trainer_id) || [];
        values.push(formatSlot(slot.start_time));
        slotsByTrainer.set(slot.trainer_id, values);
        const rawValues = rawSlotsByTrainer.get(slot.trainer_id) || [];
        rawValues.push(slot.start_time);
        rawSlotsByTrainer.set(slot.trainer_id, rawValues);
      }

      await Promise.all([...rawSlotsByTrainer.entries()].map(async ([trainerId, rawSlots]) => {
        try {
          const busy = await googleBusyRanges(supabase, trainerId, date);
          if (!busy) return;
          const freeSlots = rawSlots.filter((slot) => slotIsFree(date, slot, busy)).map(formatSlot);
          if (freeSlots.length) slotsByTrainer.set(trainerId, freeSlots);
          else slotsByTrainer.delete(trainerId);
        } catch (calendarError) {
          slotsByTrainer.delete(trainerId);
          console.warn("Google availability unavailable; trainer excluded", trainerId);
        }
      }));
      const targetMinutes = timeMinutes(preferredTime) ?? 0;
      const distanceFromPreference = (slot: string) => Math.abs((timeMinutes(slot) ?? targetMinutes) - targetMinutes);
      for (const slots of slotsByTrainer.values()) slots.sort((a, b) => distanceFromPreference(a) - distanceFromPreference(b));
      const availableTrainers = ((trainers || []) as Array<Record<string, any>>).filter((trainer) => slotsByTrainer.has(trainer.id));
      if (!availableTrainers.length) return json({ error: "No CFT has an open time on that date. Please choose another date." }, 404, origin);

      const ranked = availableTrainers.map((trainer) => {
        const closestMinutes = Math.min(...(slotsByTrainer.get(trainer.id) || []).map(distanceFromPreference));
        const timeScore = closestMinutes <= 30 ? 10 : closestMinutes <= 60 ? 7 : closestMinutes <= 120 ? 4 : closestMinutes <= 180 ? 2 : 0;
        return { trainer, score: scoreTrainer(trainer, context) + timeScore, closestMinutes };
      }).sort((a, b) => b.score - a.score || a.closestMinutes - b.closestMinutes);
      const matches = ranked.map(({ trainer, score }) => ({
        id: trainer.id,
        name: trainer.display_name,
        initials: trainer.initials,
        location: trainer.location,
        years: trainer.years_in_field,
        about: trainer.bio,
        specialties: trainer.specialties,
        color: trainer.avatar_tone,
        match: Math.min(98, score),
        slots: slotsByTrainer.get(trainer.id),
      }));
      return json({
        trainer: matches[0],
        trainers: matches,
      }, 200, origin);
    }

    if (body.action === "appointment-response") {
      const accessToken = (request.headers.get("authorization") || "").replace(/^Bearer /i, "");
      const { data: identity, error: identityError } = await supabase.auth.getUser(accessToken);
      if (identityError || !identity.user) return json({ error: "Sign in to respond to an appointment." }, 401, origin);
      const caller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${accessToken}` } }, auth: { persistSession: false } });
      const { error: updateError } = await caller.rpc("amg_cft_workspace", { action: "appointment", payload: {
        trainerId: body.trainerId, id: body.appointmentId, status: body.status, expectedStatus: body.expectedStatus,
      } });
      if (updateError) return json({ error: "This request could not be updated. Refresh and try again." }, 409, origin);
      const { data: saved, error: readError } = await supabase.from("matchup_appointments").select("*").eq("id", body.appointmentId).single();
      if (readError || !saved) return json({ ok: true, status: body.status, calendarStatus: "failed" }, 200, origin);
      const { data: queued, error: queueError } = await supabase.rpc("queue_matchup_calendar", { p_appointment_id: saved.id });
      const calendarStatus = queueError ? "failed" : (queued?.status || "pending");
      return json({ ok: true, status: saved.status, calendarStatus }, 200, origin);
    }

    if (body.action === "book") {
      const appointmentTime = databaseTime(String(body.appointment?.time || ""));
      const appointmentDate = String(body.appointment?.date || "");
      const description = String(body.appointment?.description || "").trim();
      const agentName = String(body.agent?.name || "").trim();
      const agentPhone = String(body.agent?.phone || "").trim();
      const clientName = String(body.client?.name || "").trim();
      const clientPhone = String(body.client?.phone || "").trim();
      const appointmentMinutes = timeMinutes(String(body.appointment?.time || ""));
      if (
        !body.bookingId || !body.trainer?.id || !appointmentTime ||
        !/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate) || appointmentDate < easternDate() ||
        (appointmentDate === easternDate() && appointmentMinutes !== null && appointmentMinutes <= easternTimeMinutes()) ||
        agentName.length < 2 || !validEmail(body.agent?.email) || agentPhone.length < 7 ||
        clientName.length < 2 || !validEmail(body.client?.email) || clientPhone.length < 7 ||
        description.length < 10
      ) return json({ error: "Review the contact details, client description, appointment date, and time." }, 400, origin);
      let consent;
      try {
        const start = appointmentInstant(appointmentDate, appointmentTime);
        if (start.getTime() <= Date.now()) throw new Error("Choose a future appointment time.");
        consent = notificationConsent(body.notificationConsent, agentPhone, clientPhone);
      } catch (validationError) {
        return json({ error: validationError instanceof Error ? validationError.message : "Review appointment details." }, 400, origin);
      }
      const { data: replay, error: replayError } = await supabase.from("matchup_appointments")
        .select("id,email_status,google_calendar_status,google_meet_url").eq("booking_reference", body.bookingId).maybeSingle();
      if (replayError) throw replayError;
      // Idempotent replay: return receipt without sending emails or modifying consent.
      if (replay) return json({ ok: true, appointmentId: replay.id, emailStatus: replay.email_status, calendarStatus: replay.google_calendar_status, meetUrl: replay.google_meet_url || "", smsStatus: "unchanged" }, 200, origin);
      try {
        const busy = await googleBusyRanges(supabase, body.trainer.id, appointmentDate);
        if (busy && !slotIsFree(appointmentDate, appointmentTime, busy)) return json({ error: "That trainer is busy at this time. Please choose another slot." }, 409, origin);
      } catch {
        return json({ error: "The trainer’s calendar could not be checked. Please try again before booking." }, 503, origin);
      }
      const bookingArguments = {
        p_booking_reference: body.bookingId,
        p_trainer_id: body.trainer.id,
        p_agent_name: body.agent?.name,
        p_agent_email: body.agent?.email,
        p_agent_phone: body.agent?.phone,
        p_client_name: body.client?.name,
        p_client_email: body.client?.email,
        p_client_phone: body.client?.phone,
        p_client_background: body.appointment?.background,
        p_appointment_focus: body.appointment?.focus,
        p_client_description: body.appointment?.description,
        p_appointment_date: body.appointment?.date,
        p_appointment_time: appointmentTime,
        p_appointment_format: body.appointment?.format || "Video call",
      };
      const { data: appointmentId, error } = consent.length
        ? await supabase.rpc("book_matchup_with_consent", { p_booking: bookingArguments, p_consents: consent })
        : await supabase.rpc("book_matchup_appointment", bookingArguments);
      if (error && consent.length && error.code === "PGRST202") return json({ error: "Appointment texting setup is not ready. Turn off optional texts to book, or contact AMG." }, 503, origin);
      if (error) return json({ error: error.message.includes("no longer available") ? "That time was just booked. Please choose another slot." : "We couldn’t save the appointment." }, 409, origin);
      const savedAppointmentId = String(appointmentId);
      const agentEmail = String(body.agent?.email || "").trim().toLowerCase();
      if (agentEmail) {
        const { data: member } = await supabase.from("amg_organization_memberships")
          .select("organization_id,user_id")
          .ilike("email", agentEmail)
          .eq("is_active", true)
          .in("role", ["platform_admin", "broker_owner", "manager", "agent"])
          .limit(1)
          .maybeSingle();
        if (member) {
          await supabase.from("matchup_appointments").update({
            organization_id: member.organization_id,
            agent_user_id: member.user_id,
          }).eq("id", savedAppointmentId);
        }
      }
      const { data: queuedCalendar, error: queueError } = await supabase.rpc("queue_matchup_calendar", { p_appointment_id: savedAppointmentId });
      const calendarStatus = queueError ? "failed" : (queuedCalendar?.status || "pending");
      // The durable worker owns Google writes. A request crash cannot abandon its job.
      const { data: calendarReceipt } = await supabase.from("matchup_appointments").select("google_meet_url").eq("id", savedAppointmentId).maybeSingle();
      const meetUrl = String(calendarReceipt?.google_meet_url || "");
      const smsStatus = consent.length ? "consent_saved" : "not_requested";
      let emailStatus: "pending" | "sent" | "failed" = "pending";
      const resendKey = Deno.env.get("RESEND_API_KEY");
      const fromEmail = Deno.env.get("APPOINTMENT_FROM_EMAIL");
      const { data: trainerContact } = await supabase.from("cft_contacts").select("email").eq("trainer_id", body.trainer.id).maybeSingle();
      const trainerEmail = String(trainerContact?.email || "");

      if (resendKey && fromEmail && trainerEmail && !trainerEmail.endsWith("@example.com")) {
        const appointmentLine = `${escapeHtml(body.appointment?.displayDate)} at ${escapeHtml(body.appointment?.time)} ET`;
        const recipients = [
          { email: body.agent?.email, greeting: body.agent?.name, role: "Agent" },
          { email: body.client?.email, greeting: body.client?.name, role: "Client" },
          { email: trainerEmail, greeting: body.trainer?.name, role: "Certified Field Trainer" },
        ];
        const deliveries = await Promise.all(recipients.map((recipient) => fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `matchup-${savedAppointmentId}-${recipient.role}` },
          body: JSON.stringify({
            from: fromEmail,
            to: [recipient.email],
            subject: `AMG Matchup request — ${body.appointment?.displayDate} at ${body.appointment?.time}`,
            html: `<div style="font-family:Arial,sans-serif;color:#153e30;line-height:1.6"><h2>AMG Matchup appointment request</h2><p>Hello ${escapeHtml(recipient.greeting)},</p><p>A ${escapeHtml(recipient.role)} notification has been created for <strong>${appointmentLine}</strong>.</p><p><strong>Trainer:</strong> ${escapeHtml(body.trainer?.name)}<br><strong>Agent:</strong> ${escapeHtml(body.agent?.name)}<br><strong>Client:</strong> ${escapeHtml(body.client?.name)}<br><strong>Focus:</strong> ${escapeHtml(body.appointment?.focus)}<br><strong>Format:</strong> ${escapeHtml(body.appointment?.format || "Video call")}</p>${meetUrl ? `<p><a href="${escapeHtml(meetUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#173f31;color:#fff;text-decoration:none;font-weight:700">Join Google Meet</a></p>` : ""}<p>The CFT will accept or decline this request in the AMG Matchup Portal.</p></div>`,
          }),
        })));
        emailStatus = deliveries.every((delivery) => delivery.ok) ? "sent" : "failed";
        await supabase.from("matchup_appointments").update({ email_status: emailStatus }).eq("id", savedAppointmentId);
      }

      return json({ ok: true, appointmentId: savedAppointmentId, emailStatus, calendarStatus, meetUrl, smsStatus }, 200, origin);
    }

    return json({ error: "Unknown action" }, 400, origin);
  } catch (error) {
    console.error("AMG matchup function error", error instanceof Error ? error.message : error);
    return json({ error: "The AMG matchup service is temporarily unavailable." }, 500, origin);
  }
});
