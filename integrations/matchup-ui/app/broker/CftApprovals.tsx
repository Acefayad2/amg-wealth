"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Application = { id: string; name: string; email: string; phone: string; bio: string; status: "pending"; createdAt: string };

export default function CftApprovals() {
  const [canReview, setCanReview] = useState(false);
  const [applications, setApplications] = useState<Application[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef(true);
  const lock = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
    const result = await supabase.rpc("amg_cft_applications", { action: "list", payload: {} });
    if (!active.current) return;
    if (result.error || !result.data || !Array.isArray(result.data.applications)) {
      setApplications([]);
      setNeedsRefresh(true);
      setMessage("We couldn’t refresh CFT approvals. Refresh the list before reviewing an application.");
    } else {
      setCanReview(result.data.canReview === true);
      if (result.data.canReview !== true) setMessage("");
      setApplications(result.data.applications);
      setCount(result.data.pendingCount || 0);
      setNeedsRefresh(false);
    }
    } catch {
      if (active.current) {
        setApplications([]); setNeedsRefresh(true);
        setMessage("We couldn’t refresh CFT approvals. Refresh the list before reviewing an application.");
      }
    } finally { if (active.current) setLoading(false); }
  }, []);

  useEffect(() => {
    active.current = true;
    void load();
    return () => { active.current = false; };
  }, [load]);

  async function review(application: Application, action: "approve" | "decline") {
    if (lock.current || needsRefresh || loading) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      const result = await supabase.rpc("amg_cft_applications", { action, payload: { id: application.id, expectedStatus: "pending" } });
      if (!active.current) return;
      if (result.error || result.data?.ok !== true || result.data.status !== (action === "approve" ? "approved" : "declined")) {
        setNeedsRefresh(true);
        setMessage("The decision could not be confirmed. Refresh the list to check the saved status before taking another action.");
      } else {
        setMessage(action === "approve" ? `${application.name} is approved. They can sign in and set their availability.` : `${application.name} was declined. Their trainer access remains disabled.`);
        await load();
      }
    } catch {
      if (active.current) {
        setNeedsRefresh(true);
        setMessage("The decision could not be confirmed. Refresh the list before trying again.");
      }
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }

  if (!canReview && !message) return null;
  return <section className="broker-panel cft-approvals" id="cft-approvals" aria-labelledby="cft-approvals-title">
    <header><div><h2 id="cft-approvals-title">CFT signup approvals</h2><p>New AMG trainers stay inactive until you approve their application.</p></div><button className="approval-refresh" disabled={loading || busy} onClick={() => { setMessage(""); void load(); }}>{loading ? "Refreshing…" : "Refresh list"}</button></header>
    {message && <p className="approval-message" role="status">{message}</p>}
    {canReview && <><p className="approval-count">{count} pending application{count === 1 ? "" : "s"}{count > applications.length ? ` · Showing the oldest ${applications.length}. Review these, then refresh for more.` : ""}</p>
      {loading ? <p className="approval-message">Loading applications…</p> : applications.length ? <div className="approval-list">{applications.map(application => <article className="approval-row" key={application.id}><div><h3>{application.name}</h3><p>{application.email} · {application.phone}</p><p>{application.bio}</p><small>Submitted {new Date(application.createdAt).toLocaleDateString("en-US", {month:"long", day:"numeric",year:"numeric"})}</small></div><div className="approval-actions"><button disabled={busy || needsRefresh} onClick={() => void review(application, "approve")}>Approve CFT</button><button className="approval-decline" disabled={busy || needsRefresh} onClick={() => void review(application, "decline")}>Decline</button></div></article>)}</div> : !needsRefresh && <div className="broker-empty"><strong>No CFT applications are waiting.</strong><p>New signups will appear here for your review.</p></div>}
    </>}
  </section>;
}
