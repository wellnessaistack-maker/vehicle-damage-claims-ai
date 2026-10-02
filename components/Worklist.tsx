"use client";

import { useEffect, useState } from "react";

import { recipient, safeDecision, shortName, WORK_ORDER, workOrder, routeOf, timeAgo, vehicleLine, type CaseItem, type CaseOutcome } from "@/lib/client/cases.ts";
import { downloadFile, logCsv, summarize, type ReviewLogEntry } from "@/lib/client/review-log.ts";
import { ROUTE_LABELS, usd, type Route, type Settings } from "@/lib/policy/protocol.ts";

// The inbox reads bottom-up: the first claim to work sits at the bottom, and each one finished moves up.
const LANES: Route[] = [...WORK_ORDER].reverse();

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
  onSelect: (id: string | null) => void;
  onAdd: () => void;
  onLoadDemo: () => void;
  loadingDemo: boolean;
  openCount: number;
  reviewLog: ReviewLogEntry[];
  /** The tab a claim was just moved to, flashed briefly instead of a pop-up. */
  lastMove: { tab: "inbox" | "waiting" | "completed"; text: string; n: number } | null;
}) {
  const { cases, settings, selectedId, onSelect } = props;
  // Inbox holds what still needs this reviewer. A claim leaves it only when a final action is taken:
  // approved, routed or handed off. A photo request waits on the customer, and a second opinion
  // waits on a colleague; both come back to the inbox.
  const [view, setView] = useState<"inbox" | "waiting" | "completed">("inbox");
  const done = cases.filter((c) => c.status === "done");
  const waitingCustomer = done.filter((c) => c.outcome?.action === "message_sent");
  const waitingColleague = cases.filter((c) => c.status !== "done" && c.secondOpinion);
  const waiting = [...waitingColleague, ...waitingCustomer];
  const completed = done.filter((c) => c.outcome?.action !== "message_sent");

  // Follow the selected claim, e.g. a customer's reply brings it back to the inbox.
  const selected = cases.find((c) => c.id === selectedId);
  const selectedView = !selected
    ? null
    : selected.secondOpinion && selected.status !== "done"
      ? "waiting"
      : selected.status !== "done"
        ? "inbox"
        : selected.outcome?.action === "message_sent"
          ? "waiting"
          : "completed";
  useEffect(() => {
    if (selectedView) setView(selectedView);
  }, [selectedId, selectedView]);
  const pending = cases.filter((c) => c.status === "queued" || c.status === "processing");
  const ordered = workOrder(cases, settings);

  // Switching tabs opens a claim in that tab, so the panel never shows a claim from another one.
  const openTab = (key: "inbox" | "waiting" | "completed") => {
    if (key === view) return;
    setView(key);
    const first = key === "inbox" ? (ordered.find((c) => c.status === "ready") ?? ordered[0]) : key === "waiting" ? waiting[0] : completed[0];
    onSelect(first?.id ?? null);
  };
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
          : c.secondOpinion
            ? `Waiting on ${recipient(c.secondOpinion.from).person ? recipient(c.secondOpinion.from).name : shortName(c.secondOpinion.from)} for a second opinion`
            : c.outcome
            ? c.outcome.summary
            : top
              ? top.title
              : d?.route === "photo_estimate"
                ? `No concerns found: clear photos, estimate under ${usd(settings.fastPathLimitUsd)}`
                : "";
    return (
      <button key={c.id} className={`wl-item ${c.id === selectedId ? "active" : ""}`} onClick={() => onSelect(c.id)}>
        <div className="wl-item-top">
          <span>{c.claim.claimId}</span>
          <span>{c.status === "done" && c.outcome ? doneLabel(c.outcome) : c.secondOpinion ? `Asked ${timeAgo(c.secondOpinion.askedAt)}` : timeAgo(c.addedAt)}</span>
        </div>
        <div className="wl-item-sub">
          {c.claim.policyholder === "Not on file" ? (c.folder ? `Folder: ${c.folder.split("/").pop()}` : "Uploaded photos") : c.claim.policyholder}
          {" · "}
          {vehicleLine(c, d)}
        </div>
        <div className="wl-item-reason">
          {c.status === "processing" && <span className="spinner" style={{ marginRight: 6, verticalAlign: -2 }} />}
          {route && c.status === "done" && <span className={`route-${route}`}><span className="dot" style={{ display: "inline-block", marginRight: 6 }} /></span>}
          {c.status === "done" && c.outcome?.agreement && c.outcome.agreement !== "kept" && (
            <span className="chip chip-warn wl-override" title={`Recommended: ${ROUTE_LABELS[c.outcome.recommendedRoute ?? "manual_triage"]}`}>
              {c.outcome.agreement === "changed_route" ? "Route changed" : c.outcome.agreement === "changed_team" ? "Team changed" : "Amount changed"}
            </span>
          )}
          {c.reply && c.status !== "done" && !c.secondOpinion && <span className="chip chip-info wl-override">{shortName(c.reply.from, true)} replied</span>}
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
            <button key={key} role="tab" title={key === "waiting" ? "Waiting on a customer's photos or a colleague's second opinion" : undefined} aria-selected={view === key} className={view === key ? "active" : ""} onClick={() => openTab(key)}>
              {label}{" "}
              <span key={props.lastMove?.tab === key ? `${key}-${props.lastMove.n}` : key} className={props.lastMove?.tab === key ? "n bump" : "n"}>
                {n}
              </span>
            </button>
          ))}
        </div>
        <div className="sr-only" role="status">
          {props.lastMove?.text}
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
            const inLane = ordered.filter((c) => c.status === "ready" && routeOf(c, settings) === lane).reverse();
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
              {waitingColleague.length > 0 && (
                <>
                  <div className="wl-group-head">
                    On a colleague <span className="n">{waitingColleague.length}</span>
                  </div>
                  <div className="wl-hint">Second opinion requested. When they reply, the claim comes back to your inbox.</div>
                  {waitingColleague.map((c) => item(c, null))}
                </>
              )}
              {waitingCustomer.length > 0 && (
                <>
                  {waitingColleague.length > 0 && (
                    <div className="wl-group-head">
                      On a customer <span className="n">{waitingCustomer.length}</span>
                    </div>
                  )}
                  <div className="wl-hint">Photos requested. When the customer replies, the claim is re-assessed and comes back to your inbox.</div>
                  {waitingCustomer.map((c) => item(c, c.outcome?.route ?? null))}
                </>
              )}
            </>
          ) : (
            <div className="wl-empty">Nothing waiting on a customer or a colleague.</div>
          ))}
        {view === "completed" && props.reviewLog.length > 0 && <AgreementSummary log={props.reviewLog} />}
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

/** How often the reviewer kept the recommendation, across every decision in this session. */
function AgreementSummary({ log }: { log: ReviewLogEntry[] }) {
  const s = summarize(log);
  const pct = Math.round((s.kept / s.total) * 100);
  return (
    <div className="wl-agree">
      <div className="wl-agree-top">
        <b>
          Kept the recommendation on {s.kept} of {s.total} decision{s.total === 1 ? "" : "s"}
        </b>
        <span className="hint">{pct}%</span>
      </div>
      <div className="wl-agree-bar" aria-hidden>
        <span className="k" style={{ flex: s.kept }} />
        <span className="a" style={{ flex: s.adjusted }} />
        <span className="t" style={{ flex: s.team }} />
        <span className="c" style={{ flex: s.changed }} />
      </div>
      <div className="hint">
        {s.changed} route{s.changed === 1 ? "" : "s"} changed · {s.adjusted} amount{s.adjusted === 1 ? "" : "s"} changed
        {s.team > 0 ? ` · ${s.team} sent to a different team` : ""}. Includes photo requests. Each change is logged with the reason.
      </div>
      <button className="btn btn-sm" onClick={() => downloadFile("review-log.csv", logCsv(log), "text/csv")}>
        Download review log (CSV)
      </button>
    </div>
  );
}
