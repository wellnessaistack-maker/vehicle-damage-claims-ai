"use client";

import { useState } from "react";

import { currentDecision, routeOf, timeAgo, vehicleLine, type CaseItem } from "@/lib/client/cases.ts";
import { ROUTE_LABELS, type Route, type Settings } from "@/lib/policy/protocol.ts";

const LANES: Route[] = ["adjuster", "more_evidence", "photo_estimate", "manual_triage"];

const OUTCOME_LABELS: Record<string, string> = {
  approved: "Approved",
  message_sent: "Waiting on customer",
  assigned_adjuster: "With adjuster",
  assigned_manual: "In manual review",
  route_changed: "Route changed",
};

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
  const [showDone, setShowDone] = useState(true);
  const done = cases.filter((c) => c.status === "done");
  const pending = cases.filter((c) => c.status === "queued" || c.status === "processing");
  const total = cases.length;
  const pct = total ? Math.round((done.length / total) * 100) : 0;

  const item = (c: CaseItem, route: Route | null) => {
    const d = currentDecision(c, settings);
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
          <span>{c.status === "done" && c.outcome ? OUTCOME_LABELS[c.outcome.action] : timeAgo(c.addedAt)}</span>
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
            {props.openCount} open · {done.length} done
          </span>
        </div>
        <div className="progress" aria-label="Progress to an empty worklist">
          <div style={{ width: `${pct}%` }} />
        </div>
        <div className="wl-goal">{total === 0 ? "Nothing in your queue yet." : props.openCount === 0 ? "Worklist clear. Nice work." : "Goal: clear the worklist by end of day."}</div>
        <div className="wl-actions">
          <button className="btn btn-primary" onClick={props.onAdd}>
            + Add claims
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
        {pending.length > 0 && (
          <>
            <div className="wl-group-head">
              <span className="spinner" /> Assessing <span className="n">{pending.length}</span>
            </div>
            {pending.map((c) => item(c, null))}
          </>
        )}
        {LANES.map((lane) => {
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
        {done.length > 0 && (
          <>
            <button className="wl-group-head btn-ghost" style={{ border: 0, width: "100%", cursor: "pointer", background: "none" }} onClick={() => setShowDone((s) => !s)}>
              {showDone ? "▾" : "▸"} Done today <span className="n">{done.length}</span>
            </button>
            {showDone && done.map((c) => item(c, c.outcome?.route ?? routeOf(c, settings)))}
          </>
        )}
      </div>
    </aside>
  );
}
