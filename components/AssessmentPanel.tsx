"use client";

import { useEffect, useRef, useState } from "react";

import { currentDecision, DIRECTORY, holderLine, recipient, REVIEWER, ROUTE_OWNER, type CaseItem, type CaseOutcome, type ThreadEntry } from "@/lib/client/cases.ts";
import { loadDemoPhoto, shrink, kindOf, type CasePhoto } from "@/lib/client/intake.ts";
import { decide, type Decision, type EstimateOutput } from "@/lib/policy/engine.ts";
import { ROUTE_LABELS, usd, type Route, type Settings } from "@/lib/policy/protocol.ts";

type Mode = null | "change" | "adjust" | "send" | "comment" | "ask";

export function AssessmentPanel(props: {
  item: CaseItem | null;
  settings: Settings;
  routeOverride: Route | null;
  onComplete: (id: string, outcome: Omit<CaseOutcome, "at">) => void;
  onThread: (id: string, entry: Omit<ThreadEntry, "id" | "at">) => void;
  onReassess: (id: string) => void;
  onCustomerPhotos: (id: string, photos: CasePhoto[]) => void;
  onOpenRecord: () => void;
  onOpenProtocol: () => void;
}) {
  const { item, settings } = props;
  const [mode, setMode] = useState<Mode>(null);
  const d = item ? currentDecision(item, settings) : null;
  const [message, setMessage] = useState<string>(d?.customerMessage ?? "");
  useEffect(() => {
    setMessage(d?.customerMessage ?? "");
  }, [d?.customerMessage]);

  if (!item) {
    return (
      <aside className="col assess">
        <div className="viewer-empty">
          <div>
            <h2>Assessment</h2>
            <p>The vehicle, damage summary, repair estimate and recommended route appear here.</p>
          </div>
        </div>
      </aside>
    );
  }

  if (item.status === "queued" || item.status === "processing") {
    return (
      <aside className="col assess">
        <div className="assess-scroll">
          <Assessing started={item.addedAt} />
        </div>
      </aside>
    );
  }

  const a = item.assessment!;
  const route: Route = a.ok ? d!.route : "manual_triage";
  const reDecided = a.ok && JSON.stringify(a.decision.settings) !== JSON.stringify(settings);

  return (
    <aside className="col assess">
      <div className="assess-scroll">
        <div className={`banner route-${route}`}>
          <div className="banner-top">
            <span className="banner-label">Recommended route</span>
            <div className="banner-links">
              <button className="btn btn-sm btn-ghost" onClick={props.onOpenRecord}>
                Decision record
              </button>
            </div>
          </div>
          <h2>{ROUTE_LABELS[route]}</h2>
          <div className="banner-flags">
            {a.ok && d!.humanReview.required && route !== "adjuster" && <span className="chip" style={{ borderColor: "#c4b5fd", color: "#6d28d9", background: "#f5f3ff" }}>Human review flagged</span>}
            {a.ok && !d!.humanReview.required && route === "photo_estimate" && <span className="chip chip-ok">No review flags</span>}
            {a.ok && d!.siuReferral && <span className="chip chip-bad">Refer to SIU</span>}
            {reDecided && <span className="chip chip-warn">Re-run with protocol draft</span>}
            {a.ok ? (
              <span className="chip">
                {(a.timings.totalMs / 1000).toFixed(1)} s · ~${a.meta.costUsd.toFixed(3)} est. · {a.meta.modelServed}
              </span>
            ) : (
              <span className="chip">{a.failure.simulated ? "Simulated failure" : "AI assessment failed"}</span>
            )}
          </div>
        </div>

        {!a.ok ? (
          <div className="failure">
            <b>Not assessed.</b> {a.failure.message}
            <div style={{ marginTop: 6 }}>
              This claim goes to manual triage, which is today&apos;s normal process. Nothing was guessed and no route was invented. The photo checks still ran; see the decision record.
            </div>
          </div>
        ) : (
          <>
            <RequiredOutputs d={d!} />
            <Reasons d={d!} onOpenProtocol={props.onOpenProtocol} />
            <PolicyChecks d={d!} />
            {d!.customerMessage && item.status !== "done" && (
              <div className="card">
                <div className="card-head">
                  <h3>Message to the customer</h3>
                  <span className="sub">Edit before sending</span>
                </div>
                <div className="card-body">
                  <textarea className="message" value={message} onChange={(e) => setMessage(e.target.value)} />
                </div>
              </div>
            )}
            <Checklist d={d!} />
          </>
        )}

        <Thread item={item} decision={d} onThread={props.onThread} mode={mode} setMode={setMode} />
      </div>

      <ActionBar
        item={item}
        route={route}
        d={d}
        settings={settings}
        mode={mode}
        setMode={setMode}
        message={message}
        onComplete={props.onComplete}
        onThread={props.onThread}
        onReassess={props.onReassess}
        onCustomerPhotos={props.onCustomerPhotos}
      />
    </aside>
  );
}

function Assessing({ started }: { started: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, (Date.now() - new Date(started).getTime()) / 1000);
  const steps = ["Checking photo quality and past claims", "Reading the photos (AI)", "Applying the routing protocol"];
  const active = s < 1.5 ? 0 : 1;
  return (
    <div className="card">
      <div className="card-head">
        <h3>
          <span className="spinner" style={{ marginRight: 8, verticalAlign: -2 }} />
          Assessing
        </h3>
        <span className="sub">{s.toFixed(0)} s</span>
      </div>
      <div className="card-body">
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          {steps.map((st, i) => (
            <li key={st} style={{ color: i === active ? "var(--text)" : "var(--text-3)", fontWeight: i === active ? 600 : 400 }}>
              {st}
            </li>
          ))}
        </ol>
        <div className="note">Usually 10 to 30 seconds. Photos are not stored.</div>
      </div>
    </div>
  );
}

function RequiredOutputs({ d }: { d: Decision }) {
  const v = d.requiredOutputs.vehicle;
  const field = (label: string, f: { value: string | null; note?: string }) => (
    <div>
      <div className="section-label">{label}</div>
      <div className={`field-value ${f.value ? "" : "unknown"}`}>{f.value ?? "Not determinable"}</div>
      {f.note && <div className="field-note">{f.value ? f.note : f.note === "Not determinable from these photos" ? "Not guessed from these photos" : f.note}</div>}
    </div>
  );
  return (
    <div className="card">
      <div className="card-head">
        <h3>First review</h3>
        <span className="sub">Pre-filled for the reviewer</span>
      </div>
      <div className="card-body">
        <div className="section-label" style={{ marginBottom: 8 }}>
          Vehicle metadata
        </div>
        <div className="fields">
          {field("Make", v.make)}
          {field("Model", v.model)}
          {field("Colour", v.colour)}
        </div>
        {(v.yearRange || (v.vehicleClass !== "passenger_car" && v.vehicleClass !== "none")) && (
          <div className="field-note" style={{ marginTop: 6 }}>
            {v.yearRange && <>Likely years {v.yearRange}. </>}
            {v.vehicleClass !== "passenger_car" && v.vehicleClass !== "none" && <>Vehicle type: {v.vehicleClass.replace(/_/g, " ")}.</>}
          </div>
        )}
      </div>
      <div className="card-body">
        <div className="section-label">Damage summary</div>
        <div className="summary">{d.requiredOutputs.damageSummary}</div>
      </div>
      <div className="card-body">
        <div className="section-label">Estimated repair cost (rough AI estimate)</div>
        <Estimate e={d.requiredOutputs.estimate} />
      </div>
    </div>
  );
}

function Estimate({ e }: { e: EstimateOutput }) {
  if (e.status === "withheld") {
    return (
      <>
        <div className="field-value unknown">Withheld</div>
        <div className="note" style={{ marginTop: 2 }}>
          {e.note}
        </div>
      </>
    );
  }
  const lo = e.lowUsd!;
  const hi = e.highUsd!;
  const max = Math.max(hi, e.fastPathLimitUsd, e.totalLossLineUsd && e.totalLossLineUsd < hi * 3 ? e.totalLossLineUsd : 0) * 1.12;
  const pos = (n: number) => `${Math.min(100, (n / max) * 100)}%`;
  const showTl = e.totalLossLineUsd !== null && e.totalLossLineUsd <= max;
  return (
    <>
      <div className="range" style={{ opacity: e.status === "reference_only" ? 0.7 : 1 }}>
        {usd(lo)} to {usd(hi)}
        <small>{e.status === "reference_only" ? "adjuster reference only" : "range, not a payable amount"}</small>
      </div>
      <div className="rangebar" aria-label="Estimate range compared with the fast-path limit and total-loss line">
        <div className="rangebar-track" />
        <div className="rangebar-fill" style={{ left: pos(lo), width: `calc(${pos(hi)} - ${pos(lo)})`, background: e.status === "reference_only" ? "var(--text-3)" : undefined }} />
        <div className="rangebar-mark" style={{ left: pos(e.fastPathLimitUsd) }}>
          <span>Fast-path limit {usd(e.fastPathLimitUsd)}</span>
        </div>
        {showTl && (
          <div className="rangebar-mark tl" style={{ left: pos(e.totalLossLineUsd!) }}>
            <span>Total-loss line {usd(e.totalLossLineUsd!)}</span>
          </div>
        )}
      </div>
      <div className="section-label" style={{ marginTop: 14 }}>
        Main drivers
      </div>
      <ul className="drivers">
        {e.drivers.map((dr) => (
          <li key={dr.label}>
            <span>
              {dr.label}
              <span className={`chip src ${dr.source === "ai_estimate" ? "chip-info" : ""}`}>{dr.source === "ai_estimate" ? "AI estimate" : "Rule adjustment, illustrative"}</span>
            </span>
            <span style={{ whiteSpace: "nowrap" }}>
              {dr.lowUsd === 0 ? "up to " : `${usd(dr.lowUsd)} to `}
              {usd(dr.highUsd)}
            </span>
          </li>
        ))}
      </ul>
      <div className="note">{e.note}</div>
      <div className="note-strong">{e.accuracyNote}</div>
    </>
  );
}

function Reasons({ d, onOpenProtocol }: { d: Decision; onOpenProtocol: () => void }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>Why this route</h3>
        <button className="btn btn-sm btn-ghost" onClick={onOpenProtocol}>
          Routing protocol v{d.protocolVersion}
        </button>
      </div>
      <div className="card-body">
        {d.reasons.length === 0 ? (
          <div className="reason-text">
            No rule stopped this claim from taking the photo estimate path. The photos show the vehicle and the whole damaged area, nothing suggests hidden or serious damage, and the estimate is under the fast-path limit.
          </div>
        ) : (
          <ul className="reasons">
            {d.reasons.map((r) => (
              <li key={r.id} className={`reason effect-${r.effect}`}>
                <span className="dot" />
                <div>
                  <div className="reason-title">
                    {r.title}
                    <span className="rid">{r.id}</span>
                    <span className="chip" style={{ marginLeft: 6 }}>
                      {r.effect === "adjuster" ? "Sends to adjuster" : r.effect === "more_evidence" ? "Asks for photos" : "Flags for review"}
                    </span>
                  </div>
                  <div className="reason-text">{r.reason}</div>
                  {r.evidence && <div className="reason-evidence">Seen: {r.evidence}</div>}
                  {r.citations && (
                    <details className="cites">
                      <summary>Checked against</summary>
                      <ul>
                        {r.citations.map((c, i) => (
                          <li key={i}>
                            <span className={`src src-${c.source.split(" ")[0].toLowerCase()}`}>{c.source}</span> {c.text}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PolicyChecks({ d }: { d: Decision }) {
  const icon = { match: "✓", mismatch: "✕", not_compared: "?", info: "i" } as const;
  return (
    <div className="card">
      <div className="card-head">
        <h3>Policy and claim checks</h3>
        <span className="sub">What&apos;s on file compared with what the photos show. Nothing here decides coverage.</span>
      </div>
      <div className="card-body">
        <table className="t">
          <thead>
            <tr>
              <th />
              <th>Check</th>
              <th>On file</th>
              <th>From the photos and rules</th>
            </tr>
          </thead>
          <tbody>
            {d.policyChecks.map((p) => (
              <tr key={p.label}>
                <td className={`pc pc-${p.status}`}>{icon[p.status]}</td>
                <td>
                  <b>{p.label}</b>
                </td>
                <td>{p.onFile}</td>
                <td>
                  {p.observed}
                  {p.note && <div className="hint">{p.note}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Checklist({ d }: { d: Decision }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>Evidence checklist</h3>
        <span className="sub">Checked by code and the AI&apos;s observations, not its confidence</span>
      </div>
      <div className="card-body">
        <ul className="checklist">
          {d.evidenceChecklist.map((c) => (
            <li key={c.label} title={c.detail}>
              <span className={c.ok ? "tick" : "cross"}>{c.ok ? "✓" : "✕"}</span>
              <span>{c.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Thread(props: {
  item: CaseItem;
  decision: Decision | null;
  onThread: (id: string, entry: Omit<ThreadEntry, "id" | "at">) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
}) {
  const { item, decision, mode } = props;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  // Braces matter: newer Chrome returns a Promise from scrollIntoView, and an
  // effect must return nothing or a cleanup function.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [item.thread.length]);

  const history = () => {
    const pairs: { question: string; answer: string }[] = [];
    item.thread.forEach((t, i) => {
      if (t.kind === "question" && item.thread[i + 1]?.kind === "answer") pairs.push({ question: t.text, answer: item.thread[i + 1].text });
    });
    return pairs.slice(-5);
  };

  const submit = async () => {
    const q = text.trim();
    if (!q) return;
    setErr(null);
    if (mode === "comment") {
      props.onThread(item.id, { kind: "comment", author: REVIEWER.name, text: q });
      setText("");
      props.setMode(null);
      return;
    }
    setBusy(true);
    props.onThread(item.id, { kind: "question", author: REVIEWER.name, text: q });
    setText("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: q,
          photos: item.photos.filter((p) => p.base64).map((p) => ({ name: p.name, base64: p.base64 })),
          facts: item.assessment?.ok ? item.assessment.extraction : null,
          route: decision?.routeLabel ?? ROUTE_LABELS.manual_triage,
          reasons: decision?.reasons.map((r) => `${r.title}: ${r.reason}`) ?? [],
          history: history(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "The AI couldn't answer right now.");
      props.onThread(item.id, { kind: "answer", author: "AI assistant", text: body.answer });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The AI couldn't answer right now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>Case thread</h3>
        <span className="sub">The assistant can explain, but can&apos;t change the route</span>
      </div>
      <div className="card-body">
        <div className="thread">
          {item.thread.map((t) => (
            <div key={t.id} className={`entry ${t.kind === "note" || t.kind === "answer" ? "ai" : t.kind}`}>
              <div className="entry-head">
                <b>{t.author}</b>
                <span>{t.kind === "question" ? "asked" : t.kind === "comment" ? "commented" : t.kind === "action" ? "" : ""}</span>
                <span style={{ marginLeft: "auto" }}>{new Date(t.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
              </div>
              <div className="entry-body">{t.text}</div>
            </div>
          ))}
          {busy && (
            <div className="entry ai">
              <div className="entry-head">
                <b>AI assistant</b>
              </div>
              <div className="entry-body">
                <span className="spinner" /> Looking at the photos...
              </div>
            </div>
          )}
          <div ref={end} />
        </div>
        {(mode === "comment" || mode === "ask") && (
          <div className="composer">
            <textarea
              autoFocus
              placeholder={mode === "ask" ? 'Ask about this claim, e.g. "What makes this structural?"' : "Add a comment for the file"}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
              }}
            />
            {err && <div className="err">{err}</div>}
            <div className="composer-row">
              <button className="btn btn-sm btn-ghost" onClick={() => props.setMode(null)}>
                Cancel
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => void submit()} disabled={busy || !text.trim()}>
                {mode === "ask" ? "Ask" : "Add comment"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionBar(props: {
  item: CaseItem;
  route: Route;
  d: Decision | null;
  settings: Settings;
  mode: Mode;
  setMode: (m: Mode) => void;
  message: string;
  onComplete: (id: string, outcome: Omit<CaseOutcome, "at">) => void;
  onThread: (id: string, entry: Omit<ThreadEntry, "id" | "at">) => void;
  onReassess: (id: string) => void;
  onCustomerPhotos: (id: string, photos: CasePhoto[]) => void;
}) {
  const { item, route, d, mode, setMode } = props;
  const [newRoute, setNewRoute] = useState<Route>(route === "adjuster" ? "photo_estimate" : "adjuster");
  const [reason, setReason] = useState("");
  const e = d?.requiredOutputs.estimate;
  const [lo, setLo] = useState(String(e?.lowUsd ?? ""));
  const [hi, setHi] = useState(String(e?.highUsd ?? ""));
  const [to, setTo] = useState("dana");
  const [note, setNote] = useState("");
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const done = (outcome: Omit<CaseOutcome, "at">) => {
    props.onComplete(item.id, outcome);
    setMode(null);
  };
  const open = (m: Mode) => {
    setReason("");
    setMode(mode === m ? null : m);
  };

  // While a form is open, its own button is the only way forward.
  const formOpen = mode === "adjust" || mode === "change" || mode === "send";
  const totalLoss = !!d?.reasons.some((r) => r.id === "C2");
  const adjusterTargets = totalLoss ? ["total_loss"] : ["field"];
  if (d?.siuReferral) adjusterTargets.push("siu");
  const names = (ids: string[]) => ids.map((id) => recipient(id).name.replace(/^(Estimating|Total|Field|Manual)/, (m) => m.toLowerCase())).join(" and ");

  // The reviewer's range goes back through the same rules, so a correction can change the route.
  const loN = Number(lo);
  const hiN = Number(hi);
  const rangeValid = lo.trim() !== "" && hi.trim() !== "" && loN >= 0 && hiN >= loN;
  const preview =
    mode === "adjust" && rangeValid && item.assessment?.ok
      ? decide(item.assessment.extraction, item.claim, item.assessment.photos, props.settings, { reviewerRange: { lowUsd: loN, highUsd: hiN } })
      : null;
  const previewCostReasons = preview?.reasons.filter((r) => r.group === "cost") ?? [];
  const previewTotalLoss = !!preview?.reasons.some((r) => r.id === "C2");
  const previewTargets = preview?.route === "adjuster" ? [previewTotalLoss ? "total_loss" : "field", ...(preview.siuReferral ? ["siu"] : [])] : ["estimating"];

  const extras = (
    <>
      <button className="btn btn-sm" onClick={() => open("send")}>
        Send to someone
      </button>
      {route !== "manual_triage" && (
        <button className="btn btn-sm" onClick={() => open("change")}>
          Change route
        </button>
      )}
      <button className="btn btn-sm" onClick={() => setMode(mode === "comment" ? null : "comment")}>
        Comment
      </button>
      {route !== "manual_triage" && (
        <button className="btn btn-sm" onClick={() => setMode(mode === "ask" ? null : "ask")}>
          Ask
        </button>
      )}
    </>
  );

  if (item.status === "done" && item.outcome) {
    const waiting = item.outcome.action === "message_sent";
    const holder = holderLine(item.outcome);
    return (
      <div className="actionbar">
        <div className="done-banner">
          Done: {item.outcome.summary}
          {item.outcome.reason && <> Reason: {item.outcome.reason}</>}
          {holder && <div className="done-holder">{holder}</div>}
        </div>
        {waiting && (
          <div className="actionbar-row">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              onChange={async (ev) => {
                const files = Array.from(ev.target.files ?? []);
                const bad = files.find((f) => kindOf(f) !== "image");
                if (bad) return setUploadErr("Only JPEG, PNG or WebP photos can be added.");
                setUploadErr(null);
                props.onCustomerPhotos(item.id, await Promise.all(files.map((f) => shrink(f, f.name, "upload"))));
              }}
            />
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>
              Customer replied: add their photos
            </button>
            {item.demoKey === "B" && (
              <button
                className="btn"
                onClick={async () => props.onCustomerPhotos(item.id, [await loadDemoPhoto("/demo/A-straightforward/demo_A_civic.jpg")])}
                title="Demo only: attaches the wider photo of the same car"
              >
                Demo: attach the customer&apos;s retake
              </button>
            )}
          </div>
        )}
        {uploadErr && <div className="err">{uploadErr}</div>}
        <div className="actionbar-row">
          <button className="btn btn-sm btn-ghost" onClick={() => props.onReassess(item.id)}>
            Reopen and re-assess
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="actionbar">
      {mode === "send" && (
        <div className="inline-form">
          <div className="row">
            <label>
              Send to
              <select value={to} onChange={(ev) => setTo(ev.target.value)}>
                {DIRECTORY.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.role})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="hint">{recipient(to).forWhat}.</div>
          <label>
            Note for {recipient(to).name}
            <textarea rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="What do you need from them?" />
          </label>
          <div className="composer-row">
            <button className="btn btn-sm btn-ghost" onClick={() => setMode(null)}>
              Cancel
            </button>
            <button
              className="btn btn-sm"
              title="Keeps the claim on your worklist and adds the request to the case thread"
              onClick={() => {
                props.onThread(item.id, {
                  kind: "comment",
                  author: REVIEWER.name,
                  text: `@${recipient(to).name}: second opinion requested.${note.trim() ? ` ${note.trim()}` : ""} The claim stays on my worklist.`,
                });
                setNote("");
                setMode(null);
              }}
            >
              Ask for a second opinion
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() =>
                done({
                  action: "handed_off",
                  route,
                  summary: `Handed off to ${recipient(to).name} (${recipient(to).role}) with the recommended route of ${ROUTE_LABELS[route]}.`,
                  reason: note.trim() || undefined,
                  sentTo: [to],
                })
              }
            >
              Hand off
            </button>
          </div>
        </div>
      )}
      {mode === "change" && (
        <div className="inline-form">
          <div className="row">
            <label>
              New route
              <select value={newRoute} onChange={(ev) => setNewRoute(ev.target.value as Route)}>
                {(["photo_estimate", "more_evidence", "adjuster"] as Route[])
                  .filter((r) => r !== route)
                  .map((r) => (
                    <option key={r} value={r}>
                      {ROUTE_LABELS[r]}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="hint">Goes to the {names([ROUTE_OWNER[newRoute]])}. Your reason is saved with the decision and can become a test case.</div>
          <label>
            Reason (required)
            <textarea rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="What did the AI or the rules get wrong?" />
          </label>
          <div className="composer-row">
            <button className="btn btn-sm btn-ghost" onClick={() => setMode(null)}>
              Cancel
            </button>
            {!reason.trim() && <span className="hint">Add a reason to continue</span>}
            <button
              className="btn btn-sm btn-primary"
              disabled={!reason.trim()}
              onClick={() =>
                done({
                  action: "route_changed",
                  route: newRoute,
                  summary: `Changed the route from ${ROUTE_LABELS[route]} to ${ROUTE_LABELS[newRoute]} and sent it to the ${names([ROUTE_OWNER[newRoute]])}.`,
                  reason: reason.trim(),
                  sentTo: [ROUTE_OWNER[newRoute]],
                })
              }
            >
              Change route
            </button>
          </div>
        </div>
      )}
      {mode === "adjust" && e && (
        <div className="inline-form">
          <div className="row">
            <label>
              Low (USD)
              <input type="number" min={0} value={lo} onChange={(ev) => setLo(ev.target.value)} />
            </label>
            <label>
              High (USD)
              <input type="number" min={0} value={hi} onChange={(ev) => setHi(ev.target.value)} />
            </label>
          </div>
          {!rangeValid ? (
            <div className="err">Enter a low and a high, with the high at least as big as the low.</div>
          ) : preview ? (
            <div className={`adjust-preview route-${preview.route}`}>
              <b>With this range the rules say: {preview.routeLabel}.</b>{" "}
              {previewCostReasons.length ? previewCostReasons.map((r) => `${r.reason} (rule ${r.id})`).join(" ") : `It stays under the ${usd(props.settings.fastPathLimitUsd)} fast-path limit.`}
            </div>
          ) : null}
          <label>
            Why (optional, saved as feedback on the AI&apos;s price)
            <textarea rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. quarter panel needs replacing, not repair" />
          </label>
          <div className="composer-row">
            <button className="btn btn-sm btn-ghost" onClick={() => setMode(null)}>
              Cancel
            </button>
            <button
              className={`btn btn-sm ${preview?.route === "adjuster" ? "btn-danger" : "btn-primary"}`}
              disabled={!preview}
              onClick={() => {
                if (!preview) return;
                const range = `${usd(loN)} to ${usd(hiN)} (AI said ${usd(e.lowUsd!)} to ${usd(e.highUsd!)})`;
                done(
                  preview.route === "adjuster"
                    ? {
                        action: "assigned_adjuster",
                        route: "adjuster",
                        summary: `Adjusted the range to ${range}. That puts it on the ${preview.routeLabel} route, so it went to the ${names(previewTargets)}.`,
                        reason: reason.trim() || undefined,
                        adjustedRange: { lowUsd: loN, highUsd: hiN },
                        sentTo: previewTargets,
                      }
                    : {
                        action: "approved",
                        route: preview.route,
                        summary: `Approved the photo estimate path with an adjusted range of ${range}. Sent to the estimating team as the starting estimate.`,
                        reason: reason.trim() || undefined,
                        adjustedRange: { lowUsd: loN, highUsd: hiN },
                        sentTo: previewTargets,
                      },
                );
              }}
            >
              {preview?.route === "adjuster" ? `Send to ${names(previewTargets)}` : "Approve adjusted range"}
            </button>
          </div>
        </div>
      )}

      {!formOpen && route === "photo_estimate" && e && e.lowUsd !== null && (
        <div className="actionbar-row">
          <button
            className="btn btn-primary"
            onClick={() =>
              done({
                action: "approved",
                route,
                summary: `Approved the photo estimate path and the ${usd(e.lowUsd!)} to ${usd(e.highUsd!)} range as the starting estimate. Sent to the estimating team.`,
                sentTo: ["estimating"],
              })
            }
          >
            Approve route and estimate range
          </button>
          <button className="btn" onClick={() => open("adjust")}>
            Adjust range
          </button>
        </div>
      )}
      {!formOpen && route === "more_evidence" && (
        <div className="actionbar-row">
          <button
            className="btn btn-warn"
            onClick={() =>
              done({
                action: "message_sent",
                route,
                summary: `Sent the customer a request for ${d?.retakes.length ?? 1} photo${(d?.retakes.length ?? 1) === 1 ? "" : "s"}. Waiting on their reply.`,
                sentTo: [],
              })
            }
            disabled={!props.message.trim()}
          >
            Send customer message
          </button>
        </div>
      )}
      {!formOpen && route === "adjuster" && (
        <div className="actionbar-row">
          <button
            className="btn btn-danger"
            onClick={() =>
              done({
                action: "assigned_adjuster",
                route,
                summary: `Sent to the ${names(adjusterTargets)}${d?.siuReferral ? " for review before any payment" : ""}.`,
                sentTo: adjusterTargets,
              })
            }
          >
            Send to {names(adjusterTargets)}
          </button>
        </div>
      )}
      {!formOpen && route === "manual_triage" && (
        <div className="actionbar-row">
          <button className="btn btn-primary" onClick={() => done({ action: "assigned_manual", route, summary: "Sent to the manual triage queue (the existing process).", sentTo: ["manual"] })}>
            Send to manual triage
          </button>
          <button className="btn" onClick={() => props.onReassess(item.id)}>
            Retry assessment
          </button>
        </div>
      )}
      <div className="actionbar-row">{extras}</div>
    </div>
  );
}
