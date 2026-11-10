"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import AccountBadge from "../AccountBadge";
import { useAccountProfile } from "@/lib/use-account-profile";
import { signInErrorMessage } from "@/lib/auth-message";
import { buildAvailability } from "./availability";
import { appointmentDateKey } from "@/lib/agent-flow";

const AMG_BACKEND_URL = "https://jkwhoisuhcbkokwntrfg.supabase.co/functions/v1/amg-matchup";

type Trainer = {
  id: string;
  user_id: string | null;
  display_name: string;
  initials: string;
  location: string;
  years_in_field: number;
  bio: string;
  specialties: string[];
  avatar_tone: string;
  is_available: boolean;
};

type Appointment = {
  id: string;
  trainer_id: string;
  agent_name: string;
  agent_email: string;
  agent_phone: string;
  client_name: string;
  client_email: string;
  client_phone: string;
  client_background: string;
  appointment_focus: string;
  client_description: string;
  appointment_date: string;
  appointment_time: string;
  appointment_format: string;
  status: "pending" | "confirmed" | "completed" | "cancelled";
};

type Slot = {
  id: string;
  trainer_id: string;
  available_date: string;
  start_time: string;
  status: "open" | "booked" | "blocked";
};

function todayKey() {
  return appointmentDateKey();
}

function dateLabel(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function timeLabel(value: string) {
  const [hourValue, minute] = value.split(":");
  const hour = Number(hourValue);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

function mondayFor(value: string) {
  const date = new Date(`${value}T12:00:00`);
  const weekday = date.getDay();
  date.setDate(date.getDate() - (weekday === 0 ? 6 : weekday - 1));
  return dateKey(date);
}

const weekDayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Mark({ children }: { children: string }) {
  return <span className="workspace-mark" aria-hidden="true">{children}</span>;
}

export default function CFTWorkspace() {
  const [accountUser, setAccountUser] = useState<User | null>(null);
  const accountProfile = useAccountProfile(accountUser);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [registration, setRegistration] = useState({ name: "", email: "", phone: "", password: "", verificationPassword: "", bio: "" });
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [selectedTrainerId, setSelectedTrainerId] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [weekStart, setWeekStart] = useState(() => mondayFor(todayKey()));
  const [selectedDays, setSelectedDays] = useState([0, 1, 2, 3, 4]);
  const [rangeStart, setRangeStart] = useState("09:00");
  const [rangeEnd, setRangeEnd] = useState("17:00");
  const [repeatWeeks, setRepeatWeeks] = useState(1);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [workspaceStale, setWorkspaceStale] = useState(false);
  const mutationLock = useRef(false);
  const workspaceGeneration = useRef(0);
  const [slotMessage, setSlotMessage] = useState("");
  const [googleBusySlotKeys, setGoogleBusySlotKeys] = useState<string[]>([]);
  const [conflictsBusy, setConflictsBusy] = useState(false);
  const [conflictsError, setConflictsError] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [showGoogleEvents, setShowGoogleEvents] = useState(false);
  const [calendarPreferenceBusy, setCalendarPreferenceBusy] = useState(false);
  const [calendarMessage, setCalendarMessage] = useState("");
  const calendarSyncToken = useRef("");

  async function syncCalendarSession(session: Session) {
    const identity = session.user.identities?.find((item) => item.provider === "google");
    try {
      if (session.provider_refresh_token && calendarSyncToken.current !== session.provider_refresh_token) {
        setCalendarBusy(true);
        const connectResponse = await fetch(AMG_BACKEND_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            action: "calendar-connect",
            providerRefreshToken: session.provider_refresh_token,
            googleEmail: identity?.identity_data?.email || session.user.email,
            scopes: "openid email profile https://www.googleapis.com/auth/calendar.events.freebusy https://www.googleapis.com/auth/calendar.events.owned",
          }),
        });
        const connectResult = await connectResponse.json();
        if (!connectResponse.ok) throw new Error(connectResult.error || "Google Calendar connection could not be saved.");
        calendarSyncToken.current = session.provider_refresh_token;
        setCalendarMessage("Google Calendar connection saved. Calendar checks depend on an active connection and successful sync.");
      }

      const statusResponse = await fetch(AMG_BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: "calendar-status" }),
      });
      const statusResult = await statusResponse.json();
      if (!statusResponse.ok) throw new Error(statusResult.error || "Calendar status could not be checked. Try reconnecting.");
      setCalendarConnected(Boolean(statusResult.connected));
      setShowGoogleEvents(statusResponse.ok && Boolean(statusResult.showBusyEvents));
    } catch (calendarError) {
      calendarSyncToken.current = "";
      setCalendarConnected(false);
      setShowGoogleEvents(false);
      setCalendarMessage(calendarError instanceof Error ? calendarError.message : "Google Calendar could not be connected.");
    } finally {
      setCalendarBusy(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setAccountUser(data.session?.user || null);
      setUserId(data.session?.user.id || null);
      if (data.session) void syncCalendarSession(data.session);
      setSessionChecked(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
      setAccountUser(session?.user || null);
      setUserId(session?.user.id || null);
      if (session) window.setTimeout(() => void syncCalendarSession(session), 0);
      else setCalendarConnected(false);
      setSessionChecked(true);
    });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);

  async function refreshWorkspace(generation = workspaceGeneration.current) {
    const { data, error: loadError } = await supabase.rpc("amg_cft_workspace", {
      action: "load", payload: { from: todayKey(), through: addDays(todayKey(), 366) },
    });
    if (loadError) throw new Error(loadError.message || "We couldn’t refresh the workspace.");
    if (!data || !Array.isArray(data.trainers) || !Array.isArray(data.appointments) || !Array.isArray(data.slots)) throw new Error("The workspace returned an incomplete response. Refresh before making changes.");
    if (generation !== workspaceGeneration.current) return;
    const trainerData = data.trainers as Trainer[];
    setTrainers(trainerData);
    setSelectedTrainerId((current) => trainerData.some((item) => item.id === current) ? current : (trainerData.find((item) => item.user_id === userId)?.id || trainerData[0]?.id || ""));
    setWorkspaceStale(false);
    setAppointments(data.appointments as Appointment[]);
    setSlots(data.slots as Slot[]);
  }

  useEffect(() => {
    const generation = ++workspaceGeneration.current;
    setTrainers([]); setAppointments([]); setSlots([]); setSelectedTrainerId(""); setRole("");
    if (!userId) return;
    async function loadWorkspace() {
      setLoading(true); setError("");
      try {
        const profile = await supabase.from("profiles").select("role,is_active").eq("id", userId).single();
        if (profile.error || !profile.data?.is_active || !["admin", "cft"].includes(profile.data.role)) throw new Error("This login is not connected to an active CFT workspace. Ask an AMG administrator to link your trainer profile.");
        if (generation !== workspaceGeneration.current) return;
        setRole(profile.data.role);
        await refreshWorkspace(generation);
      } catch (cause) {
        if (generation === workspaceGeneration.current) setError(cause instanceof Error ? cause.message : "We couldn’t load the workspace. Please refresh and try again.");
      } finally {
        if (generation === workspaceGeneration.current) setLoading(false);
      }
    }
    void loadWorkspace();
    return () => { workspaceGeneration.current++; };
    // The workspace is reloaded when the authenticated user changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function mutateWorkspace(action: string, payload: Record<string, unknown>, message: (value: string) => void, success: string) {
    if (mutationLock.current || workspaceStale) return;
    mutationLock.current = true; setMutationBusy(true); message("");
    const generation = workspaceGeneration.current;
    let saved = false;
    try {
      let responseMessage = success;
      if (action === "appointment-response") {
        const { data: auth } = await supabase.auth.getSession();
        if (!auth.session) throw new Error("Your login expired. Please sign in again.");
        const response = await fetch(AMG_BACKEND_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.session.access_token}` },
          body: JSON.stringify({ action, ...payload }),
        });
        const result = await response.json();
        if (!response.ok || result.ok !== true) throw new Error(result.error || "The server did not confirm the response.");
        responseMessage = result.calendarStatus === "failed"
          ? "Response saved; calendar sync needs attention."
          : result.calendarStatus === "pending"
            ? "Response saved. Calendar update queued."
            : "Response saved.";
      } else {
        const { data: result, error: mutationError } = await supabase.rpc("amg_cft_workspace", { action, payload });
        if (mutationError) throw new Error(mutationError.message);
        if (result?.ok !== true) throw new Error("The server did not confirm the change.");
      }
      saved = true;
      await refreshWorkspace(generation);
      if (generation === workspaceGeneration.current) message(responseMessage);
    } catch (cause) {
      if (generation !== workspaceGeneration.current) return;
      let refreshed = false;
      try { await refreshWorkspace(generation); refreshed = true; } catch { setWorkspaceStale(true); }
      message(saved
        ? "Your change was saved, but the latest workspace could not be loaded. Refresh before making another change."
        : `${cause instanceof Error ? cause.message : "The change could not be confirmed."}${refreshed ? " The workspace has been refreshed; review it before retrying." : " Refresh to check the latest status before retrying."}`);
    } finally {
      mutationLock.current = false; setMutationBusy(false);
    }
  }

  async function signInWithPassword(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthMessage("");
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: loginEmail.trim().toLowerCase(),
        password: loginPassword,
      });
      if (authError) throw authError;
      setLoginPassword("");
      setAuthMessage("Signed in securely.");
    } catch (cause) {
      setAuthMessage(signInErrorMessage(cause));
    } finally {
      setAuthBusy(false);
    }
  }

  async function sendPasswordReset() {
    const email = loginEmail.trim().toLowerCase();
    if (!email) {
      setAuthMessage("Enter your work email first, then choose Reset password.");
      return;
    }
    setAuthBusy(true);
    setAuthMessage("");
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/matchups/cft/`,
    });
    setAuthMessage(resetError ? "We couldn’t send the reset email. Try again." : "Password reset email sent. Open it to choose your password.");
    setAuthBusy(false);
  }

  async function saveRecoveredPassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword.length < 8 || newPassword.length > 72) {
      setAuthMessage("Use a password between 8 and 72 characters.");
      return;
    }
    setAuthBusy(true);
    setAuthMessage("");
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      setAuthMessage("We couldn’t save that password. Request a new reset email and try again.");
    } else {
      setNewPassword("");
      setRecoveryMode(false);
      setAuthMessage("Password saved. Your trainer workspace is ready.");
    }
    setAuthBusy(false);
  }

  async function registerCft(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthMessage("");
    try {
      const response = await fetch(AMG_BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cft-register", registration }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "We couldn’t create the CFT account.");
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: registration.email.trim().toLowerCase(),
        password: registration.password,
      });
      setAuthMessage(loginError ? "Your account was created. Use Trainer login with the password you chose." : "Account created. You are signed in.");
      setLoginEmail(registration.email.trim().toLowerCase());
      setLoginPassword("");
      setAuthMode("login");
    } catch (registrationError) {
      setAuthMessage(registrationError instanceof Error ? registrationError.message : "We couldn’t create the CFT account.");
    } finally {
      setRegistration((current) => ({ ...current, password: "", verificationPassword: "" }));
      setAuthBusy(false);
    }
  }

  async function connectGoogleCalendar() {
    setCalendarBusy(true);
    setCalendarMessage("");
    try {
    const { error: calendarError } = await supabase.auth.linkIdentity({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/matchups/cft/`,
        scopes: "openid email profile https://www.googleapis.com/auth/calendar.events.freebusy https://www.googleapis.com/auth/calendar.events.owned",
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (calendarError) {
      const needsSetup = calendarError.message.toLowerCase().includes("provider") || calendarError.message.toLowerCase().includes("unsupported");
      setCalendarMessage(needsSetup ? "Google Calendar is awaiting AMG’s one-time Google connection setup." : "We couldn’t open Google Calendar. Please try again.");
    }
    } catch {
      setCalendarMessage("We couldn’t open Google Calendar. Please try again.");
    } finally {
      setCalendarBusy(false);
    }
  }

  async function updateCalendarPreference(enabled: boolean) {
    if (calendarPreferenceBusy) return;
    setCalendarPreferenceBusy(true);
    setCalendarMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Your trainer login has expired. Sign in again.");
      const response = await fetch(AMG_BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action: "calendar-preferences", showBusyEvents: enabled }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "We couldn’t save that calendar option.");
      setShowGoogleEvents(enabled);
      setCalendarMessage(enabled ? "Google busy times are now shown in your weekly planner." : "Google busy times are now hidden from your weekly planner.");
    } catch (preferenceError) {
      setCalendarMessage(preferenceError instanceof Error ? preferenceError.message : "We couldn’t save that calendar option.");
    } finally {
      setCalendarPreferenceBusy(false);
    }
  }

  async function respondToRequest(id: string, status: "confirmed" | "cancelled") {
    const item = appointments.find((appointment) => appointment.id === id);
    if (!item) return;
    await mutateWorkspace("appointment-response", { trainerId: item.trainer_id, appointmentId: id, status, expectedStatus: item.status }, setError, "");
  }

  async function toggleMatching() {
    const trainer = trainers.find((item) => item.id === selectedTrainerId);
    if (!trainer) return;
    await mutateWorkspace("availability", { trainerId: trainer.id, available: !trainer.is_available }, setError, "");
  }

  async function addAvailability(event: FormEvent) {
    event.preventDefault();
    if (!selectedTrainerId || mutationLock.current || workspaceStale) return;
    try {
      const result = buildAvailability({ weekStart, days: selectedDays, weeks: repeatWeeks, start: rangeStart, end: rangeEnd, existing: slots.filter((slot) => slot.trainer_id === selectedTrainerId) });
      await mutateWorkspace("add-slots", { trainerId: selectedTrainerId, slots: result.slots }, setSlotMessage, `Availability saved and refreshed.${result.skipped ? ` ${result.skipped} overlapping times were skipped.` : ""}`);
    } catch (cause) {
      setSlotMessage(cause instanceof Error ? cause.message : "Check the selected times and try again.");
    }
  }

  async function changeSlotStatus(slot: Slot, status: "open" | "blocked") {
    if (slot.status === "booked") return;
    await mutateWorkspace("slot", { trainerId: slot.trainer_id, id: slot.id, status, expectedStatus: slot.status }, setSlotMessage, "Time updated.");
  }

  async function removeSlot(slot: Slot) {
    if (slot.status === "booked") return;
    await mutateWorkspace("delete-slot", { trainerId: slot.trainer_id, id: slot.id, expectedStatus: slot.status }, setSlotMessage, "Time removed.");
  }

  const trainer = trainers.find((item) => item.id === selectedTrainerId);
  const trainerAppointments = useMemo(() => appointments.filter((item) => item.trainer_id === selectedTrainerId), [appointments, selectedTrainerId]);
  const requests = trainerAppointments.filter((item) => item.status === "pending");
  const confirmedToday = trainerAppointments.filter((item) => item.status === "confirmed" && item.appointment_date === todayKey());
  const completedThisMonth = trainerAppointments.filter((item) => item.status === "completed" && item.appointment_date.slice(0, 7) === todayKey().slice(0, 7)).length;
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const weekSlots = useMemo(() => slots.filter((item) => item.trainer_id === selectedTrainerId && weekDates.includes(item.available_date)), [slots, selectedTrainerId, weekDates]);

  useEffect(() => {
    if (!userId || !selectedTrainerId || !calendarConnected || !showGoogleEvents) {
      setGoogleBusySlotKeys([]);
      setConflictsError("");
      setConflictsBusy(false);
      return;
    }
    let active = true;
    async function checkConflicts() {
      setConflictsBusy(true);
      setGoogleBusySlotKeys([]);
      setConflictsError("");
      try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        throw new Error("Your login expired. Sign in again to check Google busy times.");
      }
        const response = await fetch(AMG_BACKEND_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            action: "calendar-conflicts",
            trainerId: selectedTrainerId,
            slots: weekDates.flatMap((date) => Array.from({ length: 17 }, (_, index) => ({ date, time: `${String(index + 6).padStart(2, "0")}:00` }))),
          }),
        });
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.busySlotKeys)) throw new Error(result.error || "Google busy times could not be checked. Reconnect your calendar and try again.");
        if (active) setGoogleBusySlotKeys(result.busySlotKeys);
      } catch (cause) {
        if (active) {
          setGoogleBusySlotKeys([]);
          setConflictsError(cause instanceof Error ? cause.message : "Google busy times could not be checked.");
        }
      } finally {
        if (active) setConflictsBusy(false);
      }
    }
    void checkConflicts();
    return () => { active = false; };
  }, [calendarConnected, selectedTrainerId, showGoogleEvents, userId, weekDates]);

  if (!sessionChecked) return <div className="cft-auth-page"><div className="auth-loading"><span className="spinner" />Loading secure workspace…</div></div>;

  if (userId && recoveryMode) {
    return (
      <div className="cft-auth-page">
        <header className="cft-auth-header"><a className="agent-match-brand" href="/matchups/"><span className="logo-wrap"><Image src="/matchups/amg-logo.webp" alt="AMG Wealth logo" width={44} height={44} priority unoptimized /></span><div><strong>AMG</strong><span>Matchup Portal</span></div></a></header>
        <main className="cft-auth-main"><article className="cft-auth-card liquid-glass-card"><span className="auth-shield"><Mark>✓</Mark></span><span className="eyebrow"><span />Secure account</span><h1>Choose your password</h1><p>Create the password you will use for future trainer logins.</p><form onSubmit={saveRecoveredPassword}><label><span>New password</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={72} required /></label><button className="confirm-button full" disabled={authBusy}>{authBusy ? "Saving…" : "Save password →"}</button></form>{authMessage && <div className="auth-message" role="status">{authMessage}</div>}</article></main>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="cft-auth-page">
        <header className="cft-auth-header"><a className="agent-match-brand" href="/matchups/"><span className="logo-wrap"><Image src="/matchups/amg-logo.webp" alt="AMG Wealth logo" width={44} height={44} priority unoptimized /></span><div><strong>AMG</strong><span>Matchup Portal</span></div></a><a href="/matchups/">Back to matchup</a></header>
        <main className="cft-auth-main">
          <article className={`cft-auth-card liquid-glass-card ${authMode === "register" ? "registration-card" : ""}`}>
            <span className="auth-shield"><Mark>✓</Mark></span><span className="eyebrow"><span />CFT workspace</span>
            <h1>{authMode === "login" ? "Trainer login" : "Create CFT account"}</h1>
            <p>{authMode === "login" ? "Sign in with the work email and password connected to your AMG trainer account." : "Create your trainer profile and choose the password you will use to sign in. You can connect Google Calendar after signing in."}</p>
            <div className="auth-mode-switch"><button type="button" className={authMode === "login" ? "active" : ""} onClick={() => { setAuthMode("login"); setAuthMessage(""); }}>Trainer login</button><button type="button" className={authMode === "register" ? "active" : ""} onClick={() => { setAuthMode("register"); setAuthMessage(""); }}>Create account</button></div>
            {authMode === "login" ? <form onSubmit={signInWithPassword}><label><span>Work email</span><input type="email" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} autoComplete="email" required /></label><label><span>Password</span><input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoComplete="current-password" required /></label><button className="confirm-button full" disabled={authBusy}>{authBusy ? "Signing in…" : "Sign in →"}</button><button className="auth-reset-button" type="button" disabled={authBusy} onClick={() => void sendPasswordReset()}>Reset password</button></form> :
              <form className="cft-registration-form" onSubmit={registerCft}>
                <label><span>Full name</span><input type="text" value={registration.name} onChange={(event) => setRegistration({ ...registration, name: event.target.value })} autoComplete="name" minLength={3} maxLength={100} required /></label>
                <label><span>Work email</span><input type="email" value={registration.email} onChange={(event) => setRegistration({ ...registration, email: event.target.value })} autoComplete="email" required /></label>
                <label><span>Phone number</span><input type="tel" value={registration.phone} onChange={(event) => setRegistration({ ...registration, phone: event.target.value })} autoComplete="tel" minLength={7} maxLength={30} required /></label>
                <label><span>Create password</span><input type="password" value={registration.password} onChange={(event) => setRegistration({ ...registration, password: event.target.value })} autoComplete="new-password" minLength={8} maxLength={72} required /><small>Use at least 8 characters.</small></label>
                <label><span>AMG verification password</span><input type="password" value={registration.verificationPassword} onChange={(event) => setRegistration({ ...registration, verificationPassword: event.target.value })} autoComplete="off" required /></label>
                <label className="registration-wide"><span>Trainer description</span><textarea value={registration.bio} onChange={(event) => setRegistration({ ...registration, bio: event.target.value })} rows={4} minLength={20} maxLength={800} required /><small>Describe the clients and appointments you work with best in at least 20 characters.</small></label>
                <button className="confirm-button full registration-wide" disabled={authBusy}>{authBusy ? "Creating secure account…" : "Create CFT account →"}</button>
                <div className="registration-calendar-note registration-wide"><span className="google-calendar-mark" aria-hidden="true">G</span><div><strong>Google Calendar comes next</strong><small>After account creation, connect your calendar from the workspace.</small></div></div>
              </form>}
            {authMessage && <div className="auth-message" role="status">{authMessage}</div>}
            <small>{authMode === "login" ? "Only verified AMG CFT accounts can enter the workspace." : "Your account is ready immediately after registration—no phone verification required."}</small>
          </article>
        </main>
      </div>
    );
  }

  const name = trainer?.display_name || (role === "admin" ? "AMG Administrator" : "Trainer");
  return (
    <div className="app-shell cft-portal live-cft-workspace">
      <aside className={`sidebar glass-dark ${mobileNav ? "open" : ""}`}>
        <div className="brand"><div className="logo-wrap"><Image src="/matchups/amg-logo.webp" alt="AMG Wealth logo" width={44} height={44} priority unoptimized /></div><div><strong>AMG</strong><span>Matchup Portal</span></div><button className="icon-button close-nav" aria-label="Close navigation" onClick={() => setMobileNav(false)}>×</button></div>
        <nav><a className="nav-item active" href="#dashboard"><Mark>⌂</Mark>Overview</a><a className="nav-item" href="#today"><Mark>◷</Mark>My schedule</a><a className="nav-item" href="#requests"><Mark>●</Mark>Match requests{requests.length > 0 && <span className="nav-count">{requests.length}</span>}</a><a className="nav-item" href="#profile"><Mark>◎</Mark>My profile</a></nav>
        <a className="role-switch" href="/matchups/"><Mark>✦</Mark>Go to Agent Matchup</a>
        <AccountBadge profile={accountProfile} onSignOut={() => { void supabase.auth.signOut({ scope: "local" }); }} />
      </aside>
      {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <main>
        <header className="topbar glass-light"><button className="icon-button menu-button" aria-label="Open navigation" onClick={() => setMobileNav(true)}>☰</button><div className="mobile-brand">AMG <span>Matchup</span></div><div className="topbar-label"><span className="live-dot" />Live CFT workspace</div><button className="quick-book" onClick={() => document.getElementById("availability")?.scrollIntoView({ behavior: "smooth" })}>Availability</button></header>
        <div className="content" id="dashboard">
          <section className="welcome-row"><div><span className="eyebrow"><span />{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</span><h1>Welcome, {(accountProfile?.name || name).split(" ")[0]}.</h1><p>Your live schedule and incoming agent requests are below.</p></div>{role === "admin" && trainers.length > 1 && <label className="trainer-switcher"><span>Viewing trainer</span><select disabled={mutationBusy || workspaceStale} value={selectedTrainerId} onChange={(event) => setSelectedTrainerId(event.target.value)}>{trainers.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label>}{trainer && <button className={`availability-pill ${trainer.is_available ? "" : "paused"}`} disabled={mutationBusy || loading || workspaceStale} onClick={toggleMatching}><span className="live-dot" />{trainer.is_available ? "Available for matchups" : "Matching paused"}</button>}</section>
          {error && <div className="workspace-alert" role="alert">{error}</div>}
          {workspaceStale && <div className="workspace-alert" role="alert">Changes are paused until the latest schedule is loaded. <button type="button" onClick={() => window.location.reload()}>Reload workspace</button></div>}
          {loading && <div className="workspace-loading"><span className="spinner" />Loading live CFT data…</div>}
          {!loading && !trainer && <article className="cft-card empty-workspace glass-light"><Mark>◎</Mark><h2>No trainer profile is linked yet</h2><p>An AMG administrator needs to connect this login to a CFT directory profile.</p></article>}
          {trainer && <>
            <section className="stats-grid cft-stats"><article className="stat-card glass-light"><span className="stat-icon gold"><Mark>◷</Mark></span><div><small>Today</small><strong>{confirmedToday.length}</strong><p>appointments</p></div></article><article className="stat-card glass-light"><span className="stat-icon green"><Mark>●</Mark></span><div><small>New requests</small><strong>{requests.length}</strong><p>need a response</p></div></article><article className="stat-card glass-light"><span className="stat-icon plum"><Mark>✓</Mark></span><div><small>This month</small><strong>{completedThisMonth}</strong><p>completed</p></div></article></section>
            <section className="cft-workspace">
              <div className="primary-column">
                <article className="cft-card weekly-availability-card glass-light" id="availability">
                  <div className="weekly-availability-heading">
                    <div><span>Your availability</span><h2>Plan your week</h2><p>Add several appointment times at once, then block or remove anything that changes.</p></div>
                    <div className="week-navigation" aria-label="Choose week">
                      <button type="button" aria-label="Previous week" disabled={weekStart <= mondayFor(todayKey())} onClick={() => setWeekStart(addDays(weekStart, -7))}>←</button>
                      <strong>{dateLabel(weekStart)} – {dateLabel(addDays(weekStart, 6))}</strong>
                      <button type="button" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}>→</button>
                    </div>
                  </div>
                  <div className="availability-legend" aria-label="Availability status key">
                    <span className="open">Open</span><span className="busy">Google busy</span><span className="blocked">Blocked</span><span className="booked">Booked</span>
                    {calendarConnected && showGoogleEvents && <small>{conflictsBusy ? "Checking Google Calendar…" : conflictsError ? "Google busy times unavailable" : "Google busy times loaded"}</small>}
                  </div>
                  {conflictsError && <p className="slot-message" role="alert">{conflictsError}</p>}
                  <div className="week-grid">
                    {weekDates.map((day, dayIndex) => {
                      const daySlots = weekSlots.filter((slot) => slot.available_date === day);
                      const dayBusyTimes = showGoogleEvents ? googleBusySlotKeys.filter((key) => key.startsWith(`${day}|`)).map((key) => key.split("|")[1]) : [];
                      const calendarItems = [
                        ...daySlots.map((slot) => ({ key: slot.id, time: slot.start_time.slice(0, 5), slot })),
                        ...dayBusyTimes.filter((time) => !daySlots.some((slot) => slot.start_time.startsWith(time))).map((time) => ({ key: `google-${day}-${time}`, time, slot: null })),
                      ].sort((a, b) => a.time.localeCompare(b.time));
                      return <section className="week-day" key={day}>
                        <header><span>{weekDayLabels[dayIndex]}</span><strong>{new Date(`${day}T12:00:00`).getDate()}</strong></header>
                        <div className="week-day-slots">
                          {calendarItems.length === 0 && <small>No times</small>}
                          {calendarItems.map(({ key, time, slot }) => {
                            if (!slot) return <article className="week-slot busy google-only" key={key}><div><strong>{timeLabel(time)}</strong><span>Google busy</span></div></article>;
                            const isGoogleBusy = slot.status === "open" && googleBusySlotKeys.includes(`${slot.available_date}|${slot.start_time.slice(0, 5)}`);
                            const displayStatus = isGoogleBusy ? "busy" : slot.status;
                            return <article className={`week-slot ${displayStatus}`} key={key}>
                              <div><strong>{timeLabel(slot.start_time)}</strong><span>{isGoogleBusy ? "Google busy" : slot.status}</span></div>
                              {slot.status !== "booked" && <div className="slot-actions">
                                <button type="button" disabled={mutationBusy || loading || workspaceStale} onClick={() => changeSlotStatus(slot, slot.status === "blocked" ? "open" : "blocked")}>{slot.status === "blocked" ? "Open" : "Block"}</button>
                                <button className="remove" type="button" disabled={mutationBusy || loading || workspaceStale} onClick={() => removeSlot(slot)} aria-label={`Remove ${timeLabel(slot.start_time)} on ${dateLabel(slot.available_date)}`}>Remove</button>
                              </div>}
                            </article>;
                          })}
                        </div>
                      </section>;
                    })}
                  </div>
                  <form className="weekly-builder" onSubmit={addAvailability}>
                    <div className="builder-heading"><div><span>Bulk add</span><h3>Set recurring open hours</h3></div><small>Creates one-hour appointment slots.</small></div>
                    <fieldset><legend>Days</legend><div className="day-picker">{weekDayLabels.map((label, index) => <button type="button" key={label} className={selectedDays.includes(index) ? "selected" : ""} aria-pressed={selectedDays.includes(index)} onClick={() => setSelectedDays((current) => current.includes(index) ? current.filter((day) => day !== index) : [...current, index].sort())}>{label}</button>)}</div></fieldset>
                    <div className="builder-fields">
                      <label><span>Start</span><input type="time" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} required /></label>
                      <label><span>End</span><input type="time" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} required /></label>
                      <label><span>Repeat</span><select value={repeatWeeks} onChange={(event) => setRepeatWeeks(Number(event.target.value))}><option value={1}>This week</option><option value={2}>2 weeks</option><option value={4}>4 weeks</option><option value={8}>8 weeks</option></select></label>
                      <button className="confirm-button" disabled={mutationBusy || workspaceStale}>{mutationBusy ? "Saving changes…" : "Add open times"}</button>
                    </div>
                  </form>
                  {slotMessage && <p className="slot-message" role="status">{slotMessage}</p>}
                  <button className="availability-toggle" disabled={mutationBusy || loading || workspaceStale} onClick={toggleMatching}>{trainer.is_available ? "Pause new matchups" : "Resume new matchups"}</button>
                </article>
                <article className="cft-card glass-light" id="today"><div className="section-title"><div><span>{dateLabel(todayKey())}</span><h2>Today’s appointments</h2></div></div><div className="cft-schedule">{confirmedToday.length === 0 && <div className="empty-list"><Mark>◷</Mark><p>No confirmed appointments today.</p></div>}{confirmedToday.map((item) => <article className="schedule-row" key={item.id}><div className="schedule-time"><strong>{timeLabel(item.appointment_time)}</strong><span>ET</span></div><div className="schedule-info"><h3>{item.client_name}</h3><p>Agent: {item.agent_name} · {item.agent_phone}</p><span>{item.appointment_focus}</span></div><div className="schedule-mode">{item.appointment_format}</div></article>)}</div></article>
                <article className="cft-card glass-light" id="requests"><div className="section-title"><div><span>Needs your response</span><h2>New match requests</h2></div></div><div className="request-list">{requests.length === 0 && <div className="empty-list"><Mark>✓</Mark><p>You’re caught up. No new match requests.</p></div>}{requests.map((item) => <article className="request-row" key={item.id}><div className="request-avatar"><Mark>◎</Mark></div><div className="request-copy"><h3>{item.client_name}</h3><p>{item.client_background} · {item.appointment_focus}</p><small>Requested by {item.agent_name} · {dateLabel(item.appointment_date)} at {timeLabel(item.appointment_time)}</small></div><div className="request-actions"><button className="decline-button" disabled={mutationBusy || loading || workspaceStale} onClick={() => respondToRequest(item.id, "cancelled")}>Decline</button><button className="accept-button" disabled={mutationBusy || loading || workspaceStale} onClick={() => respondToRequest(item.id, "confirmed")}>Accept</button></div></article>)}</div></article>
              </div>
              <aside className="right-column">
                <article className="cft-card calendar-connect-card glass-light"><div className="calendar-connect-heading"><span className="google-calendar-mark" aria-hidden="true">G</span><div><span>Your calendar</span><h2>{calendarConnected ? "Google Calendar connected" : "Connect Google Calendar"}</h2></div></div><p>{calendarConnected ? "Calendar access is connected. Show private busy blocks below; if calendar checks fail, check Google directly before accepting appointments." : "Connect Google Calendar to enable busy-time checks and appointment syncing. This requires AMG’s Google Calendar setup to be available."}</p><button className={`google-calendar-button ${calendarConnected ? "connected" : ""}`} type="button" onClick={connectGoogleCalendar} disabled={calendarBusy}>{calendarBusy ? "Connecting Google…" : calendarConnected ? <><Mark>✓</Mark>Reconnect Google Calendar</> : <><span className="google-g" aria-hidden="true">G</span>Connect Google Calendar</>}</button>{calendarConnected && <label className="calendar-merge-option"><span><strong>Show Google busy times</strong><small>Merge existing events into your weekly planner. Event names and details stay private.</small></span><input type="checkbox" role="switch" checked={showGoogleEvents} disabled={calendarPreferenceBusy} onChange={(event) => void updateCalendarPreference(event.target.checked)} /><i aria-hidden="true" /></label>}{calendarMessage && <small className="calendar-message" role="status">{calendarMessage}</small>}</article>
                <article className="cft-card profile-summary glass-light" id="profile"><div className="profile-heading"><span className={`avatar large ${trainer.avatar_tone}`}>{trainer.initials}<span className="status-dot" /></span><div><h2>{trainer.display_name}</h2><p>Certified Field Trainer{trainer.location ? ` · ${trainer.location}` : ""}</p></div></div><p className="profile-bio">{trainer.bio}</p>{trainer.specialties.length > 0 && <div className="tags">{trainer.specialties.map((item) => <span key={item}>{item}</span>)}</div>}</article>
              </aside>
            </section>
          </>}
        </div>
      </main>
    </div>
  );
}
