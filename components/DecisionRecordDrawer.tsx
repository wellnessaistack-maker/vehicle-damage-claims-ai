"use client";

import { currentDecision, holderLine, type CaseItem } from "@/lib/client/cases.ts";
import { AGREEMENT_LABELS, downloadFile, testCaseRow, type ReviewLogEntry } from "@/lib/client/review-log.ts";
import { DEFAULT_SETTINGS, ROUTE_LABELS, SETTING_DEFS, usd as usd0, type Settings } from "@/lib/policy/protocol.ts";

export function DecisionRecordDrawer({ item, settings, log, onClose }: { item: CaseItem; settings: Settings; log: ReviewLogEntry[]; onClose: () => void }) {
  const a = item.assessment;
  const d = currentDecision(item, settings);
  const changed = SETTING_DEFS.filter((s) => settings[s.key] !== DEFAULT_SETTINGS[s.key]);

  const record = {
    claim: item.claim,
    photos: item.photos.map((p) => ({ name: p.name, source: p.source, url: p.url })),
    assessment: a,
    decisionUnderCurrentSettings: d,
    reviewerActions: item.thread.filter((t) => t.kind === "action" || t.kind === "comment"),
    outcome: item.outcome,
    reviewDecisions: log,
  };

  // The current decision, if the claim is finished; earlier ones stay in the log after a re-assessment.
  const last = item.outcome ? log[log.length - 1] : undefined;
  const earlier = last ? log.slice(0, -1) : log;
  const disagreements = log.filter((e) => e.agreement !== "kept");

  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h2>Decision record</h2>
            <div className="sub">{item.claim.claimId}. Everything needed to explain this route later. In production this is kept as an audit log; here you can download it.</div>
          </div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="drawer-body">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-sm" onClick={() => downloadFile(`${item.claim.claimId}-decision.json`, JSON.stringify(record, null, 2), "application/json")}>
              Download decision record (JSON)
            </button>
            {disagreements.length > 0 && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => downloadFile(`${item.claim.claimId}-test-case.csv`, disagreements.map((e) => testCaseRow(e, settings)).join(""), "text/csv")}
              >
                Download correction as a test case
              </button>
            )}
          </div>

          <section>
            <div className="section-label">Outcome</div>
            <dl className="kv">
              {last ? (
                <>
                  <dt>Recommended route</dt>
                  <dd>{ROUTE_LABELS[last.recommendedRoute]}</dd>
                  <dt>Reviewer&apos;s route</dt>
                  <dd>
                    {ROUTE_LABELS[last.finalRoute]}{" "}
                    <span className={`chip ${last.agreement === "kept" ? "chip-ok" : "chip-warn"}`}>{AGREEMENT_LABELS[last.agreement]}</span>
                  </dd>
                  {last.adjustedRange && last.aiRange && (
                    <>
                      <dt>Estimate</dt>
                      <dd>
                        Rate card {usd0(last.aiRange.lowUsd)} to {usd0(last.aiRange.highUsd)}; reviewer{" "}
                        {last.adjustedRange.lowUsd === last.adjustedRange.highUsd
                          ? usd0(last.adjustedRange.highUsd)
                          : `${usd0(last.adjustedRange.lowUsd)} to ${usd0(last.adjustedRange.highUsd)}`}
                      </dd>
                    </>
                  )}
                </>
              ) : (
                <>
                  <dt>Recommended route</dt>
                  <dd>{d ? d.routeLabel : ROUTE_LABELS.manual_triage}</dd>
                </>
              )}
              {a?.ok && a.decision.route !== d?.route && (
                <>
                  <dt>Route when first assessed</dt>
                  <dd>{a.decision.routeLabel} (changed by the protocol draft or edited claim details)</dd>
                </>
              )}
              <dt>Human review</dt>
              <dd>{d?.humanReview.required ? d.humanReview.reasons.join(" ") : a?.ok ? "Not flagged" : "Manual triage"}</dd>
              <dt>Reviewer action</dt>
              <dd>{item.outcome ? `${item.outcome.summary}${item.outcome.reason ? ` Reason: ${item.outcome.reason}` : ""}` : "None yet"}</dd>
              {earlier.length > 0 && (
                <>
                  <dt>Earlier decisions</dt>
                  <dd>
                    {earlier.map((e) => `${ROUTE_LABELS[e.finalRoute]} (${AGREEMENT_LABELS[e.agreement].toLowerCase()})`).join("; ")}
                  </dd>
                </>
              )}
              {item.outcome && holderLine(item.outcome) && (
                <>
                  <dt>Who has it</dt>
                  <dd>{holderLine(item.outcome)}</dd>
                </>
              )}
            </dl>
          </section>

          <section>
            <div className="section-label">What produced this result</div>
            <dl className="kv">
              {a?.ok ? (
                <>
                  <dt>Model requested</dt>
                  <dd className="mono">{a.meta.modelRequested}</dd>
                  <dt>Model that answered</dt>
                  <dd className="mono">
                    {a.meta.modelServed}
                    {a.meta.fallbackUsed ? " (fallback used)" : ""}
                  </dd>
                  <dt>Prompt version</dt>
                  <dd className="mono">{a.meta.promptVersion}</dd>
                  <dt>Protocol version</dt>
                  <dd className="mono">
                    v{a.decision.protocolVersion}
                    {changed.length ? ` + draft (${changed.map((c) => c.label).join(", ")})` : ""}
                  </dd>
                  <dt>AI attempts</dt>
                  <dd>{a.meta.attempts}</dd>
                  <dt>Time</dt>
                  <dd>
                    {fmtMs(a.timings.totalMs)} total: photo checks {fmtMs(a.timings.prepareMs)}, AI {fmtMs(a.timings.modelMs)}, rules {fmtMs(a.timings.rulesMs)}
                  </dd>
                  <dt>Tokens and cost</dt>
                  <dd>
                    {a.meta.inputTokens.toLocaleString()} in, {a.meta.outputTokens.toLocaleString()} out, estimated ${a.meta.costUsd.toFixed(3)} at list prices (billed spend can be higher; check the Anthropic console)
                  </dd>
                  <dt>Assessed at</dt>
                  <dd>{new Date(a.assessedAt).toLocaleString()}</dd>
                </>
              ) : a ? (
                <>
                  <dt>Failure</dt>
                  <dd>
                    {a.failure.kind}: {a.failure.message}
                    {a.failure.simulated ? " (simulated)" : ""}
                  </dd>
                  <dt>Model requested</dt>
                  <dd className="mono">{a.modelRequested}</dd>
                  <dt>Prompt version</dt>
                  <dd className="mono">{a.promptVersion}</dd>
                  <dt>Protocol version</dt>
                  <dd className="mono">v{a.protocolVersion}</dd>
                </>
              ) : (
                <>
                  <dt>Status</dt>
                  <dd>Not assessed yet</dd>
                </>
              )}
            </dl>
          </section>

          {a && a.photos.length > 0 && (
            <section>
              <div className="section-label">Photo checks (code, no AI)</div>
              <table className="t">
                <thead>
                  <tr>
                    <th>Photo</th>
                    <th>Size</th>
                    <th>Brightness</th>
                    <th>Sharpness</th>
                    <th>Colour</th>
                    <th>Past claim match</th>
                  </tr>
                </thead>
                <tbody>
                  {a.photos.map((p, i) => (
                    <tr key={p.name}>
                      <td>Photo {i + 1}</td>
                      <td>
                        {p.width} x {p.height}
                      </td>
                      <td>{p.brightness}</td>
                      <td>{Math.round(p.sharpness)}</td>
                      <td>{p.greyscale ? "Black and white" : "Colour"}</td>
                      <td>{p.nearDuplicateOf ?? "None"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {d && (
            <section>
              <div className="section-label">Every rule, fired or not</div>
              <table className="t">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Tier</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {d.ruleResults.map((r) => (
                    <tr key={r.id} style={r.fired ? { background: "#faf5ff" } : undefined}>
                      <td>
                        <span className="mono">{r.id}</span> {r.title}
                      </td>
                      <td>{r.tier === "locked" ? "Locked" : "Configurable"}</td>
                      <td>
                        {r.fired ? <b>Fired: {r.reason}</b> : <span className="hint">Did not fire</span>}
                        {r.citations && (
                          <ul className="hint" style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                            {r.citations.map((c, i) => (
                              <li key={i}>
                                {c.source}: {c.text}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {a?.ok && (
            <section>
              <div className="section-label">Raw AI output (the only thing the AI contributed)</div>
              <pre className="json">{JSON.stringify(a.extraction, null, 2)}</pre>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtMs(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

