"use client";

import { useMemo, useState } from "react";

import results from "@/eval/results/latest.json";
import { modelInfo } from "@/lib/extraction/models.ts";
import { scoreCase, summarise, type EvalRun, type FieldScore, type ScoredCase, type Summary } from "@/lib/eval/metrics.ts";
import { DEFAULT_SETTINGS, ROUTE_LABELS, usd, type Route } from "@/lib/policy/protocol.ts";

const RUNS = (results as { runs: EvalRun[] }).runs;
const ROUTES: Route[] = ["photo_estimate", "more_evidence", "adjuster", "manual_triage"];
const REPO = "https://github.com/wellnessaistack-maker/vehicle-damage-claims-ai";

export default function EvaluationPage() {
  const [runIdx, setRunIdx] = useState(0);
  const scoredRuns = useMemo(
    () => RUNS.map((run) => ({ run, scored: run.cases.map((c) => scoreCase(c, DEFAULT_SETTINGS)) })).map((x) => ({ ...x, summary: summarise(x.scored) })),
    [],
  );
  const current = scoredRuns[runIdx];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">CR</div>
          Claims first review <small>Evaluation</small>
        </div>
        <div className="topbar-spacer" />
        <nav className="topbar-nav">
          <a href="/">Back to worklist</a>
        </nav>
      </header>

      <main className="eval-page">
        <div>
          <h1 style={{ fontSize: 22 }}>How we&apos;d know this is working</h1>
          <p style={{ color: "var(--text-2)", maxWidth: 820 }}>
            A small labelled set, run through the real pipeline. It checks that nothing broke; it isn&apos;t proof the system works on your claims. The deck&apos;s three quality measures are reported as plain counts. There are no pass or fail targets
            here on purpose: those get agreed with your claims and risk owners in phase 1, on your own data.
          </p>
        </div>

        {!current ? (
          <div className="card">
            <div className="card-body">
              No evaluation run has been saved yet. Run <code>npm run eval</code> with an API key, then commit <code>eval/results/latest.json</code>.
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div className="seg">
                {scoredRuns.map((r, i) => (
                  <button key={r.run.model} className={i === runIdx ? "on" : ""} onClick={() => setRunIdx(i)}>
                    {modelInfo(r.run.model).label}
                  </button>
                ))}
              </div>
              <span className="hint">
                {current.run.cases.length} cases · run {new Date(current.run.runAt).toLocaleString()} · prompt {current.run.promptVersion} · protocol v{current.run.protocolVersion} · labels are draft, pending expert review
              </span>
            </div>

            <Headline s={current.summary} />
            {scoredRuns.length > 1 && <ModelComparison runs={scoredRuns} />}
            <Confusion s={current.summary} />
            <CaseTable scored={current.scored} />
          </>
        )}

        <Writeup />
      </main>
    </div>
  );
}

function Headline({ s }: { s: Summary }) {
  return (
    <>
      <div className="section-label" style={{ marginBottom: -6 }}>
        The deck&apos;s quality guardrails
      </div>
      <div className="stats">
        <div className="stat">
          <div className="l">Complex-case escalation recall</div>
          <div className="v">
            {s.escalation.caught} of {s.escalation.of}
          </div>
          <div className="d">
            Of the cases an expert would send to an adjuster, how many we escalated too.
            {s.escalation.missedIds.length > 0 && <> Missed: {s.escalation.missedIds.join(", ")}.</>}
          </div>
        </div>
        <div className="stat">
          <div className="l">Routing agreement with expert labels</div>
          <div className="v">
            {s.agreement.exact} of {s.agreement.of}
          </div>
          <div className="d">
            Exact match. {s.agreement.acceptable} of {s.agreement.of} counting routes the label marks as also acceptable. Expert-to-expert agreement is the realistic ceiling; we don&apos;t have it yet.
          </div>
        </div>
        <div className="stat" style={{ borderColor: "var(--evidence-line)", background: "var(--evidence-soft)" }}>
          <div className="l">Repair-range coverage</div>
          <div className="v">Not measured</div>
          <div className="d" style={{ color: "var(--evidence)" }}>
            The main test for the estimate is whether your final paid cost falls inside our range (and how wide the range is). That needs your paid-claims data, which we&apos;d use in phase 2.
          </div>
        </div>
      </div>
      <div className="section-label" style={{ marginBottom: -6 }}>
        Also watched
      </div>
      <div className="stats">
        <Stat label="Escalated when not needed" value={`${s.overEscalated.count} of ${s.overEscalated.of}`} note={s.overEscalated.ids.length ? `Cases: ${s.overEscalated.ids.join(", ")}` : "Too much caution eats the time savings."} />
        <Stat label="Didn't guess when it couldn't tell" value={`${s.abstention.correct} of ${s.abstention.of}`} note="Make, model or colour left blank where the label says it can't be known from the photo." />
        <Stat label="Make / model / colour" value={`${s.vehicle.make.right}/${s.vehicle.make.of} · ${s.vehicle.model.right}/${s.vehicle.model.of} · ${s.vehicle.colour.right}/${s.vehicle.colour.of}`} note="Correct, or correctly 'can't tell'." />
        <Stat label="Expected review flags raised" value={`${s.flags.caught} of ${s.flags.of}`} note="Rules like 'damage doesn't match the description' firing where they should." />
        <Stat label="Same route on a re-run" value={s.stability ? `${s.stability.stable} of ${s.stability.of}` : "Not measured"} note="The AI can give slightly different answers each time. Run with --repeat 3 to measure." />
        <Stat
          label="Time and cost per case"
          value={s.latency ? `${(s.latency.p50 / 1000).toFixed(1)} s · $${s.cost.mean.toFixed(3)}` : "n/a"}
          note={s.latency ? `Median time; slowest 5% ${(s.latency.p95 / 1000).toFixed(1)} s. ${s.failures} AI failure${s.failures === 1 ? "" : "s"}.` : ""}
        />
      </div>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="stat">
      <div className="l">{label}</div>
      <div className="v" style={{ fontSize: 18 }}>
        {value}
      </div>
      <div className="d">{note}</div>
    </div>
  );
}

function ModelComparison({ runs }: { runs: { run: EvalRun; summary: Summary }[] }) {
  const rows: [string, (s: Summary) => string][] = [
    ["Escalation recall", (s) => `${s.escalation.caught} of ${s.escalation.of}`],
    ["Routing agreement (exact)", (s) => `${s.agreement.exact} of ${s.agreement.of}`],
    ["Routing agreement (acceptable)", (s) => `${s.agreement.acceptable} of ${s.agreement.of}`],
    ["Escalated when not needed", (s) => `${s.overEscalated.count} of ${s.overEscalated.of}`],
    ["Didn't guess when unsure", (s) => `${s.abstention.correct} of ${s.abstention.of}`],
    ["Make / model / colour", (s) => `${s.vehicle.make.right}/${s.vehicle.make.of}, ${s.vehicle.model.right}/${s.vehicle.model.of}, ${s.vehicle.colour.right}/${s.vehicle.colour.of}`],
    ["Median time per case", (s) => (s.latency ? `${(s.latency.p50 / 1000).toFixed(1)} s` : "n/a")],
    ["Cost per case", (s) => `$${s.cost.mean.toFixed(3)}`],
    ["AI failures", (s) => String(s.failures)],
  ];
  return (
    <div className="card">
      <div className="card-head">
        <h3>Model comparison</h3>
        <span className="sub">Same cases, same prompt, same rules. Only the model changes.</span>
      </div>
      <div className="card-body">
        <table className="t">
          <thead>
            <tr>
              <th>Measure</th>
              {runs.map((r) => (
                <th key={r.run.model}>{modelInfo(r.run.model).label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, f]) => (
              <tr key={label}>
                <td>{label}</td>
                {runs.map((r) => (
                  <td key={r.run.model}>{f(r.summary)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Confusion({ s }: { s: Summary }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>Where the routes landed</h3>
        <span className="sub">Rows: expert label. Columns: our route.</span>
      </div>
      <div className="card-body">
        <table className="t">
          <thead>
            <tr>
              <th>Expert said</th>
              {ROUTES.map((r) => (
                <th key={r}>{ROUTE_LABELS[r]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROUTES.filter((r) => r !== "manual_triage").map((exp) => (
              <tr key={exp}>
                <td>{ROUTE_LABELS[exp]}</td>
                {ROUTES.map((act) => (
                  <td key={act} style={{ fontWeight: exp === act ? 700 : 400, color: s.confusion[exp][act] && exp !== act ? "var(--adjuster)" : undefined }}>
                    {s.confusion[exp][act]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const fieldText: Record<FieldScore, string> = {
  correct: "✓",
  correctly_unknown: "✓ (didn't guess)",
  wrong: "✕ wrong",
  guessed: "✕ guessed",
  missed: "✕ left blank",
  "n/a": "",
};

function CaseTable({ scored }: { scored: ScoredCase[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>Every case</h3>
        <span className="sub">Highlighted rows disagree with the expert label</span>
      </div>
      <div className="card-body" style={{ overflowX: "auto" }}>
        <table className="t">
          <thead>
            <tr>
              <th>Photo</th>
              <th>Case</th>
              <th>Expected</th>
              <th>Our route</th>
              <th>Why</th>
              <th>Make · model · colour</th>
              <th>Estimate</th>
            </tr>
          </thead>
          <tbody>
            {scored.map((s) => {
              const r = s.result;
              const d = s.decision;
              const reasons = d?.reasons.map((x) => x.id).join(", ") || (r.ok ? "none" : "AI failed");
              return (
                <tr key={r.caseId} className={s.acceptable ? "" : "mismatch"}>
                  <td>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/${r.photos[0].replace(/^demo-images\//, "demo/").replace(/^eval\/images\//, "eval/images/")}`} alt="" style={{ width: 72, height: 48, objectFit: "cover", borderRadius: 4 }} />
                  </td>
                  <td>
                    <div className="mono">{r.caseId}</div>
                    <div className="hint">{r.labels.whatItTests}</div>
                  </td>
                  <td>
                    {ROUTE_LABELS[r.labels.expectedRoute]}
                    {r.labels.mustEscalate && <div className="chip chip-bad" style={{ marginTop: 2 }}>must escalate</div>}
                  </td>
                  <td className={`route-${s.route}`}>
                    <span className="route-pill">{ROUTE_LABELS[s.route]}</span>
                  </td>
                  <td className="mono">{reasons}</td>
                  <td style={{ fontSize: 12 }}>
                    {d ? (
                      <>
                        <div>
                          {d.requiredOutputs.vehicle.make.value ?? "?"} {fieldText[s.vehicle.make]}
                        </div>
                        <div>
                          {d.requiredOutputs.vehicle.model.value ?? "?"} {fieldText[s.vehicle.model]}
                        </div>
                        <div>
                          {d.requiredOutputs.vehicle.colour.value ?? "?"} {fieldText[s.vehicle.colour]}
                        </div>
                      </>
                    ) : (
                      "n/a"
                    )}
                  </td>
                  <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                    {s.cost.low !== null ? (
                      <>
                        {usd(s.cost.low)} to {usd(s.cost.high!)}
                        <div className="hint">{s.cost.sideOfLimit === "below" ? "under the limit" : s.cost.sideOfLimit === "above" ? "over the limit" : "straddles the limit"}</div>
                      </>
                    ) : (
                      <span className="hint">withheld</span>
                    )}
                    <div className="hint">label: {r.labels.expectedCostBand}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Writeup() {
  return (
    <div className="card">
      <div className="card-head">
        <h3>Evaluation approach</h3>
        <a className="sub" href={`${REPO}/blob/main/eval/README.md`}>
          How the set is labelled
        </a>
      </div>
      <div className="card-body">
        <p style={{ marginTop: 0 }}>
          <b>What matters most.</b> The costly mistake is a complex claim slipping onto the fast path, so escalation recall comes first. Then routing agreement with your experts, while watching that we don&apos;t escalate so much that the time
          savings disappear. Then the brief&apos;s outputs: is make, model and colour right or correctly left blank, and does the damage summary name the right area without missing or inventing damage.
        </p>
        <p>
          <b>Where it fails.</b> A complex claim on the fast path (rare, expensive). Confidently naming the wrong car. Missing or inventing damage. Escalating too much. Reused or edited photos. Known weak spots today: pixel checks can&apos;t tell motion
          blur from a smooth close-up, glare is only caught by the AI, and the reused-photo check misses rotated copies.
        </p>
        <p>
          <b>The repair estimate.</b> We&apos;d score past claims and compare our range with what you finally paid: how often it contains the paid cost, and how wide it is. The mistake that matters is a range on the wrong side of the fast-path
          limit or the total-loss line. When it&apos;s too low, the shop files a supplement, as today; near a limit it gets flagged or goes to an adjuster; it is never the amount paid. Reviewers&apos; range adjustments are captured as &quot;AI was off by X&quot;.
        </p>
        <p style={{ marginBottom: 0 }}>
          <b>What we need from you.</b> A few hundred past claims with photos, the route each took, the final paid cost and any supplements. Time from two estimating experts to label them. How today&apos;s triage performs (late escalations,
          supplement rate) so there&apos;s a baseline to beat. Your eligibility rules, labour rates and vehicle values.
        </p>
      </div>
    </div>
  );
}
