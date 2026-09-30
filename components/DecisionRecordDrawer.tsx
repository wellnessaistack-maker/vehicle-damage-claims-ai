"use client";

import { currentDecision, holderLine, type CaseItem } from "@/lib/client/cases.ts";
import { DEFAULT_SETTINGS, ROUTE_LABELS, SETTING_DEFS, type Settings } from "@/lib/policy/protocol.ts";

export function DecisionRecordDrawer({ item, settings, onClose }: { item: CaseItem; settings: Settings; onClose: () => void }) {
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
  };

  const download = (name: string, content: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  };

  // A reviewer's correction becomes a labelled test case, in the same shape as eval/cases.csv.
  const testCaseRow = () => {
    const o = item.outcome!;
    const v = d?.requiredOutputs.vehicle;
    const cols = [
      `REVIEW_${item.claim.claimId}`,
      item.photos.map((p) => p.url ?? p.name).join(";"),
      "BLANK",
      "",
      "",
      o.route,
      o.route,
      o.route === "adjuster" ? "yes" : "no",
      "",
      v?.make.value ?? "CANT_TELL",
      v?.model.value ?? "CANT_TELL",
      v?.colour.value ?? "CANT_TELL",
      o.adjustedRange ? bandFor(o.adjustedRange.highUsd, settings) : "unsure",
      (o.reason ?? o.summary).replace(/,/g, ";"),
      "Reviewer correction",
      "draft (reviewer)",
    ];
    return cols.join(",") + "\n";
  };

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
            <button className="btn btn-sm" onClick={() => download(`${item.claim.claimId}-decision.json`, JSON.stringify(record, null, 2), "application/json")}>
              Download decision record (JSON)
            </button>
            {item.outcome && (item.outcome.action === "route_changed" || item.outcome.adjustedRange) && (
              <button className="btn btn-sm btn-primary" onClick={() => download(`${item.claim.claimId}-test-case.csv`, testCaseRow(), "text/csv")}>
                Download correction as a test case
              </button>
            )}
          </div>

          <section>
            <div className="section-label">Outcome</div>
            <dl className="kv">
              <dt>Recommended route</dt>
              <dd>{d ? d.routeLabel : ROUTE_LABELS.manual_triage}</dd>
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
                  {a.photos.map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
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

function bandFor(high: number, s: Settings) {
  if (high < 1000) return "under_1000";
  if (high <= s.fastPathLimitUsd) return "1000_2500";
  return "2500_to_total_loss";
}
