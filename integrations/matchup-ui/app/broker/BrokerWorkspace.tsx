"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Organization = { id: string; name: string; slug: string; parentId: string | null };
type Metrics = { activeAgents: number; calls: number; answeredCalls: number; talkSeconds: number; meetingsBooked: number; meetingsHeld: number };
type AgentMetric = { user_id: string; display_name: string; email: string | null; phone: string | null; role: string; calls: number; answered_calls: number; talk_seconds: number; meetings_booked: number; meetings_held: number };
type Activity = { id: string; agentUserId: string; agentName: string; type: string; occurredAt: string; direction: string | null; outcome: string | null; durationSeconds: number | null };
type Workspace = { selectedOrganizationId: string; organizations: Organization[]; range: { start: string; end: string }; metrics: Metrics; agents: AgentMetric[]; recentActivity: Activity[] };

const emptyMetrics: Metrics = { activeAgents: 0, calls: 0, answeredCalls: 0, talkSeconds: 0, meetingsBooked: 0, meetingsHeld: 0 };

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function secondsLabel(seconds: number) {
  if (!seconds) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function percent(value: number, total: number) {
  return total ? `${Math.round((value / total) * 100)}%` : "—";
}

function activityLabel(activity: Activity) {
  if (activity.type === "call") return `${activity.direction === "incoming" ? "Incoming" : "Outgoing"} call · ${activity.outcome || "completed"}`;
  return activity.type.replaceAll("_", " ");
}

export default function BrokerWorkspace() {
  const initialStart = useMemo(() => { const value = new Date(); value.setDate(value.getDate() - 29); return dateKey(value); }, []);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [rangeStart, setRangeStart] = useState(initialStart);
  const [rangeEnd, setRangeEnd] = useState(() => dateKey(new Date()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSignedIn(Boolean(data.session));
      setSessionChecked(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setSignedIn(Boolean(session));
      setSessionChecked(true);
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  const loadWorkspace = useCallback(async (nextOrganization = organizationId) => {
    setLoading(true);
    setError("");
    const { data, error: loadError } = await supabase.rpc("amg_broker_workspace", {
      selected_organization: nextOrganization,
      range_start: rangeStart,
      range_end: rangeEnd,
    });
    if (loadError) {
      setWorkspace(null);
      setError(loadError.message.includes("manageable AMG organization")
        ? "This account is not assigned to an AMG organization yet. An AMG administrator must add it as a broker, manager, or agent."
        : loadError.message);
    } else {
      const value = data as Workspace;
      setWorkspace(value);
      setOrganizationId(value.selectedOrganizationId);
    }
    setLoading(false);
  }, [organizationId, rangeEnd, rangeStart]);

  useEffect(() => {
    if (signedIn) void loadWorkspace();
  }, [signedIn]); // load once after authentication; filters reload explicitly

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthMessage("");
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setPassword("");
    setAuthMessage(signInError ? "That email or password was not accepted. Check it and try again." : "Signed in securely.");
    setAuthBusy(false);
  }

  const metrics = workspace?.metrics || emptyMetrics;
  const agents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return workspace?.agents || [];
    return (workspace?.agents || []).filter((agent) => `${agent.display_name} ${agent.email || ""} ${agent.role}`.toLowerCase().includes(needle));
  }, [query, workspace]);

  if (!sessionChecked) return <div className="broker-auth-page"><div className="broker-loading">Loading secure organization workspace…</div></div>;

  if (!signedIn) return (
    <div className="broker-auth-page">
      <header className="broker-auth-header"><a href="/matchups/" className="agent-match-brand"><span className="logo-wrap"><Image src="/matchups/amg-logo.webp" alt="AMG logo" width={44} height={44} priority unoptimized /></span><div><strong>AMG</strong><span>Organization Portal</span></div></a><a href="/matchups/">Back to Matchup</a></header>
      <main className="broker-auth-main"><article className="broker-auth-card"><span className="eyebrow"><span />Leadership workspace</span><h1>Broker login</h1><p>Use your AMG email and password to manage your organization and review team performance.</p><form onSubmit={signIn}><label><span>Work email</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button className="confirm-button full" disabled={authBusy}>{authBusy ? "Signing in…" : "Sign in →"}</button></form>{authMessage && <div className="auth-message" role="status">{authMessage}</div>}<small>Access is limited to the organization and agents assigned to your AMG account.</small></article></main>
    </div>
  );

  return (
    <div className="broker-shell">
      <aside className={`broker-sidebar ${mobileNav ? "open" : ""}`}>
        <a href="/matchups/" className="broker-brand"><Image src="/matchups/amg-logo.webp" alt="AMG logo" width={42} height={42} priority unoptimized /><span><strong>AMG</strong><small>Organizations</small></span></a>
        <nav><a className="active" href="#overview">Overview</a><a href="#agents">Agents</a><a href="#activity">Activity</a><a href="#meetings">Meetings</a></nav>
        <div className="broker-sidebar-note"><span>Secure view</span><p>You only see organizations assigned to your AMG account.</p></div>
        <button className="broker-signout" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </aside>
      {mobileNav && <button className="broker-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <main className="broker-main">
        <header className="broker-topbar"><button className="broker-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}>☰</button><div><span className="broker-live-dot" /> Live organization metrics</div><a href="/matchups/">Book a matchup</a></header>
        <div className="broker-content" id="overview">
          <section className="broker-heading"><div><span className="eyebrow"><span />AMG hierarchy</span><h1>Organization performance</h1><p>Calls, appointments, and agent activity in one accountable view.</p></div>{workspace && <label><span>Organization</span><select value={workspace.selectedOrganizationId} onChange={(event) => { setOrganizationId(event.target.value); void loadWorkspace(event.target.value); }}>{workspace.organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>}</section>

          <form className="broker-filters" onSubmit={(event) => { event.preventDefault(); void loadWorkspace(); }}><label><span>From</span><input type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} /></label><label><span>Through</span><input type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} /></label><button disabled={loading}>{loading ? "Refreshing…" : "Apply range"}</button></form>
          {error && <div className="broker-alert" role="alert">{error}</div>}
          {loading && <div className="broker-loading">Refreshing organization metrics…</div>}

          {!loading && workspace && <>
            <section className="broker-kpis" aria-label="Organization metrics">
              <article><span>Active agents</span><strong>{metrics.activeAgents}</strong><small>in this organization</small></article>
              <article><span>Total calls</span><strong>{metrics.calls}</strong><small>{metrics.answeredCalls} answered</small></article>
              <article><span>Answer rate</span><strong>{percent(metrics.answeredCalls, metrics.calls)}</strong><small>completed conversations</small></article>
              <article><span>Talk time</span><strong>{secondsLabel(metrics.talkSeconds)}</strong><small>across all agents</small></article>
              <article><span>Meetings booked</span><strong>{metrics.meetingsBooked}</strong><small>{metrics.meetingsHeld} held</small></article>
              <article><span>Call → meeting</span><strong>{percent(metrics.meetingsBooked, metrics.calls)}</strong><small>booking conversion</small></article>
            </section>

            <section className="broker-grid">
              <article className="broker-panel broker-team" id="agents"><header><div><span>Team scoreboard</span><h2>Agent performance</h2></div><input type="search" placeholder="Search agents" value={query} onChange={(event) => setQuery(event.target.value)} /></header><div className="broker-table-wrap"><table><thead><tr><th>Agent</th><th>Calls</th><th>Answered</th><th>Talk time</th><th>Booked</th><th>Held</th><th>Conversion</th></tr></thead><tbody>{agents.map((agent) => <tr key={agent.user_id}><td><span className="broker-avatar">{agent.display_name.split(" ").map((part) => part[0]).slice(0,2).join("")}</span><span><strong>{agent.display_name}</strong><small>{agent.role.replaceAll("_", " ")}</small></span></td><td>{agent.calls}</td><td>{percent(agent.answered_calls, agent.calls)}</td><td>{secondsLabel(agent.talk_seconds)}</td><td>{agent.meetings_booked}</td><td>{agent.meetings_held}</td><td>{percent(agent.meetings_booked, agent.calls)}</td></tr>)}</tbody></table>{agents.length === 0 && <div className="broker-empty"><strong>No agent activity yet</strong><p>Assign agents to this organization and connect their Quo identities to begin tracking live metrics.</p></div>}</div></article>

              <aside className="broker-panel broker-activity" id="activity"><header><span>Latest updates</span><h2>Activity feed</h2></header><div>{workspace.recentActivity.map((activity) => <article key={activity.id}><span className={`activity-mark ${activity.type}`}>{activity.type === "call" ? "↗" : "✓"}</span><div><strong>{activity.agentName}</strong><p>{activityLabel(activity)}{activity.durationSeconds ? ` · ${secondsLabel(activity.durationSeconds)}` : ""}</p><small>{new Date(activity.occurredAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small></div></article>)}{workspace.recentActivity.length === 0 && <div className="broker-empty compact"><strong>No recent activity</strong><p>Calls and booked meetings will appear here automatically.</p></div>}</div></aside>
            </section>
          </>}
        </div>
      </main>
    </div>
  );
}
