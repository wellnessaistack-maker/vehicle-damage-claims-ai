"use client";

import { useEffect, useState } from "react";

import { recipient, safeDecision, routeOf, timeAgo, vehicleLine, type CaseItem, type CaseOutcome } from "@/lib/client/cases.ts";
import { ROUTE_LABELS, type Route, type Settings } from "@/lib/policy/protocol.ts";

const LANES: Route[] = ["adjuster", "more_evidence", "photo_estimate", "manual_triage"];

const OUTCOME_LABELS: Record<string, string> = {
  approved: "Approved",
  message_sent: "Waiting on customer",
  assigned_adjuster: "With adjuster",
  assigned_manual: "In manual review",
  route_changed: "Route changed",
  handed_off: "Handed off",
};

function doneLabel(o: CaseOutcome) {
  if (o.action === "message_sent") return "Waiting on customer";
  const first = o.sentTo?.[0];
  return first ? `With ${recipient(first).name.replace(/ (team|queue|unit)$/i, "")}` : OUTCOME_LABELS[o.action];
}

export function Worklist(props: {
  cases: CaseItem[];
  settings: Settings;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onLoadDemo: () => void;
  loadingDemo: boolean;
  openCount: number;
}) {
  const { cases, settings, selectedId, onSelect } = props;
  // Inbox holds what still needs this reviewer. A claim leaves it only when a final action is taken:
  // approved, routed or handed off. A photo request waits on the customer, then comes back.
  const [view, setView] = useState<"inbox" | "waiting" | "completed">("inbox");
  const done = cases.filter((c) => c.status === "done");
  const waiting = done.filter((c) => c.outcome?.action === "message_sent");
  const completed = done.filter((c) => c.outcome?.action !== "message_sent");

  // Follow the selected claim, e.g. a customer's reply brings it back to the inbox.
  const selected = cases.find((c) => c.id === selectedId);
  const selectedView = !selected ? null : selected.status !== "done" ? "inbox" : selected.outcome?.action === "message_sent" ? "waiting" : "completed";
  useEffect(() => {
    if (selectedView) setView(selectedView);
  }, [selectedId, selectedView]);
  const pending = cases.filter((c) => c.status === "queued" || c.status === "processing");
  const total = cases.length;
  const pct = total ? Math.round((done.length / total) * 100) : 0;

  const item = (c: CaseItem, route: Route | null) => {
    const d = safeDecision(c, settings);
    const top = d?.reasons[0];
    const reason =
      c.status === "processing" || c.status === "queued"
        ? "Assessing photos..."
        : c.assessment && !c.assessment.ok
          ? c.assessment.failure.message
          : c.outcome
            ? c.outcome.summary
            : top
              ? top.title
              : d?.route === "photo_estimate"
                ? "No rules stopped the fast path"
                : "";
    return (
      <button key={c.id} className={`wl-item ${c.id === selectedId ? "active" : ""}`} onClick={() => onSelect(c.id)}>
        <div className="wl-item-top">
          <span>{c.claim.claimId}</span>
          <span>{c.status === "done" && c.outcome ? doneLabel(c.outcome) : timeAgo(c.addedAt)}</span>
        </div>
        <div className="wl-item-sub">
          {c.claim.policyholder === "Not on file" ? (c.folder ? `Folder: ${c.folder.split("/").pop()}` : "Uploaded photos") : c.claim.policyholder}
          {" · "}
          {vehicleLine(c, d)}
        </div>
        <div className="wl-item-reason">
          {c.status === "processing" && <span className="spinner" style={{ marginRight: 6, verticalAlign: -2 }} />}
          {route && c.status === "done" && <span className={`route-${route}`}><span className="dot" style={{ display: "inline-block", marginRight: 6 }} /></span>}
          {reason}
        </div>
      </button>
    );
  };

  return (
    <aside className="col worklist">
      <div className="wl-head">
        <div className="wl-title">
          <h2>My worklist</h2>
          <span className="wl-count">
            {props.openCount} to review · {completed.length} completed
          </span>
        </div>
        <div className="progress" aria-label="Progress to an empty worklist">
          <div style={{ width: `${pct}%` }} />
        </div>
        <div className="wl-goal">{total === 0 ? "Nothing in your queue yet." : props.openCount === 0 ? "Worklist clear. Nice work." : "Goal: clear the worklist by end of day."}</div>
        <div className="wl-tabs" role="tablist">
          {(
            [
              ["inbox", "Inbox", props.openCount],
              ["waiting", "Waiting", waiting.length],
              ["completed", "Completed", completed.length],
            ] as const
          ).map(([key, label, n]) => (
            <button key={key} role="tab" title={key === "waiting" ? "Waiting on the customer's photos" : undefined} aria-selected={view === key} className={view === key ? "active" : ""} onClick={() => setView(key)}>
              {label} <span className="n">{n}</span>
            </button>
          ))}
        </div>
        <div className="wl-actions">
          <button className="btn btn-primary" onClick={props.onAdd}>
            + Add photos
          </button>
          <button className="btn" onClick={props.onLoadDemo} disabled={props.loadingDemo}>
            {props.loadingDemo ? "Loading..." : "Load demo queue"}
          </button>
        </div>
      </div>
      <div className="wl-body">
        {total === 0 && (
          <div className="wl-empty">
            Add photos (a single photo, a folder per claim, or a link), or load the demo queue.
          </div>
        )}
        {view === "inbox" && total > 0 && props.openCount === 0 && <div className="wl-empty">Inbox clear. Finished claims are under Completed.</div>}
        {view === "inbox" && pending.length > 0 && (
          <>
            <div className="wl-group-head">
              <span className="spinner" /> Assessing <span className="n">{pending.length}</span>
            </div>
            {pending.map((c) => item(c, null))}
          </>
        )}
        {view === "inbox" &&
          LANES.map((lane) => {
            const inLane = cases.filter((c) => c.status === "ready" && routeOf(c, settings) === lane);
            if (inLane.length === 0) return null;
            return (
              <div key={lane} className={`route-${lane}`}>
                <div className="wl-group-head">
                  <span className="dot" /> {ROUTE_LABELS[lane]} <span className="n">{inLane.length}</span>
                </div>
                {inLane.map((c) => item(c, lane))}
              </div>
            );
          })}
        {view === "waiting" &&
          (waiting.length ? (
            <>
              <div className="wl-hint">Photos requested. When the customer replies, the claim is re-assessed and comes back to your inbox.</div>
              {waiting.map((c) => item(c, c.outcome?.route ?? null))}
            </>
          ) : (
            <div className="wl-empty">No claims waiting on a customer.</div>
          ))}
        {view === "completed" &&
          (completed.length ? (
            completed.map((c) => item(c, c.outcome?.route ?? null))
          ) : (
            <div className="wl-empty">Nothing completed yet. A claim lands here once it&apos;s approved, routed or handed off.</div>
          ))}
      </div>
    </aside>
  );
}
