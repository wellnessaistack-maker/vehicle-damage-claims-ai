"use client";

// Preview of a reworked Evaluation page: answer first, failures second, detail folded away.
// Same data and scoring as /evaluation.

import { useMemo, useState } from "react";

import { CaseTable, Confusion, LiveRunner, ModelComparison, publicPath, REPO } from "@/components/eval/parts.tsx";
import results from "@/eval/results/latest.json";
import { DEFAULT_MODEL, modelInfo } from "@/lib/extraction/models.ts";
import { plausibleLow, scoreCase, summarise, type EvalRun } from "@/lib/eval/metrics.ts";
import { DEFAULT_SETTINGS, ROUTE_LABELS, type Route } from "@/lib/policy/protocol.ts";

const RUNS = (results as { runs: EvalRun[] }).runs;
const MAIN = RUNS.find((r) => r.model === DEFAULT_MODEL && r.promptVersion === "extract-v2") ?? RUNS[0];

// Plain-language notes on each case the default model didn't get exactly right.
const NOTES: Record<string, { what: string; why: string; next: string }> = {
  "05_rotated": {
    what: "A clean photo, uploaded sideways.",
    why: "The model didn't read the car properly on its side, so the rules asked the customer for another photo.",
    next: "Straighten photos in code before the AI sees them. Costs the customer one extra photo today; never a missed escalation.",
  },
  "00a_camry": {
    what: "Front-corner damage priced right at the $2,500 limit.",
    why: "Over four runs it went to an adjuster once and the photo path three times.",
    next: "This is why ranges that straddle the limit are flagged for a price check. With your data we'd tune the limit rules on real paid costs.",
  },
  "03_compressed": {
    what: "A heavily compressed, forwarded copy of a photo.",
    why: "Asked the customer for a better photo. The label accepts this; an expert might have estimated from it.",
    next: "Acceptable as is. Your reviewers' overrides would tell us whether it's too cautious.",
  },
};

const FIXED_IN_V2 = [
  { what: "A customer's wider retake was judged on the original close-up", fix: "Prompt now judges evidence on the best photo in the set" },
  { what: "A crumpled bumper cover was called structural damage", fix: "Prompt now defines structural as deformed frame, pillars or floor" },
  { what: "A door dent got a hidden-damage allowance that pushed it over the limit", fix: "The allowance now applies only to moderate front or rear damage, or anything severe" },
];

export default function EvaluationPreview() {
  const [live, setLive] = useState<EvalRun | null>(null);
  const run = live ?? MAIN;
  const scored = useMemo(() => run.cases.map((c) => scoreCase(c, DEFAULT_SETTINGS)), [run]);
  const s = useMemo(() => summarise(scored), [scored]);
  const saved = useMemo(
    () => RUNS.map((r) => ({ run: r, summary: summarise(r.cases.map((c) => scoreCase(c, DEFAULT_SETTINGS))) })),
    [],
  );
  const misses = scored.filter((x) => !x.exact || (x.result.repeatRoutes && new Set(x.result.repeatRoutes).size > 1));
  const low = plausibleLow(s.escalation.caught, s.escalation.of);
  const cautious = misses.every((m) => !m.missedEscalation);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">CR</div>
          Claims first review <small>Evaluation (preview of a new layout)</small>
        </div>
        <div className="topbar-spacer" />
        <nav className="topbar-nav">
          <a href="/evaluation">Current layout</a>
          <a href="/">Back to worklist</a>
        </nav>
      </header>

      <main className="eval-page">
        <div>
          <h1 style={{ fontSize: 24, marginBottom: 4 }}>Can you trust the route it recommends?</h1>
          <p style={{ color: "var(--text-2)", maxWidth: 860, margin: 0 }}>
            {run.cases.length} labelled claims through the real pipeline with {modelInfo(run.model).label} ({run.promptVersion}). A check that nothing is broken, not proof it works on your claims. Labels are drafts pending expert review, and there are
            no pass marks here on purpose: those get agreed with your claims and risk owners.
          </p>
        </div>

        {/* 1. The answer */}
        <div className="ev-score">
          <div className="ev-tile ev-lead">
            <div className="ev-l">Complex claims caught</div>
            <div className="ev-v">
              {s.escalation.caught} of {s.escalation.of}
            </div>
            <div className="ev-d">None of the claims an expert would send to an adjuster went down the fast path.</div>
            {low !== null && <div className="ev-fine">With this few cases, the true rate could be as low as {Math.round(low * 100)}%.</div>}
          </div>
          <div className="ev-tile">
            <div className="ev-l">Matched the expert</div>
            <div className="ev-v">
              {s.agreement.exact} of {s.agreement.of}
            </div>
            <div className="ev-d">
              {s.agreement.acceptable} of {s.agreement.of} counting routes the label also accepts.
            </div>
          </div>
          <div className="ev-tile">
            <div className="ev-l">Over-escalated</div>
            <div className="ev-v">
              {s.overEscalated.count} of {s.overEscalated.of}
            </div>
            <div className="ev-d">Too much caution would eat the time savings.</div>
          </div>
          <div className="ev-tile">
            <div className="ev-l">Speed and cost</div>
            <div className="ev-v">{s.latency ? `${(s.latency.p50 / 1000).toFixed(1)} s` : "n/a"}</div>
            <div className="ev-d">About {Math.round(s.cost.mean * 100)} cents a claim, estimated. {s.failures} AI failures.</div>
          </div>
          <div className="ev-tile ev-gap">
            <div className="ev-l">Estimate vs paid cost</div>
            <div className="ev-v">Needs your data</div>
            <div className="ev-d">How often your final paid cost lands inside our range. Can&apos;t be measured without paid claims.</div>
          </div>
        </div>

        {/* 2. Where it went wrong */}
        <section className="card">
          <div className="card-head">
            <h3>Where it went wrong</h3>
            <span className="sub">{cautious ? "Every mistake went the cautious way: more photos or a person, never the fast path" : "Includes a missed escalation"}</span>
          </div>
          <div className="card-body ev-misses">
            {misses.map((m) => {
              const n = NOTES[m.result.caseId];
              const flipped = m.result.repeatRoutes && new Set(m.result.repeatRoutes).size > 1;
              return (
                <div key={m.result.caseId} className="ev-miss">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={publicPath(m.result.photos[0])} alt="" />
                  <div>
                    <div className="ev-miss-head">
                      <span>{n?.what ?? m.result.labels.whatItTests}</span>
                      <span className={`chip ${m.acceptable ? "chip-warn" : "chip-bad"}`}>{flipped ? "Unstable at the limit" : m.acceptable ? "Acceptable, not exact" : "Wrong route"}</span>
                    </div>
                    <div className="ev-miss-routes">
                      Expert: <b>{ROUTE_LABELS[m.result.labels.expectedRoute]}</b> · Ours: <b>{ROUTE_LABELS[m.route as Route]}</b>{flipped ? " on the saved run" : ""}
                    </div>
                    {n && (
                      <>
                        <div>{n.why}</div>
                        <div className="hint">What we&apos;d do: {n.next}</div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="ev-fixed">
              <div className="section-label">Already fixed, from the first run (prompt v1)</div>
              <ul>
                {FIXED_IN_V2.map((f) => (
                  <li key={f.what}>
                    <s>{f.what}.</s> {f.fix}.
                  </li>
                ))}
              </ul>
              <div className="hint">Prompt v2 was written after seeing these, so its gain on the same cases is flattering. With your data we&apos;d keep a locked test set nobody tunes against.</div>
            </div>
          </div>
        </section>

        {/* 3. What we need */}
        <section className="card">
          <div className="card-head">
            <h3>What it takes to trust it on your claims</h3>
            <a className="sub" href={`${REPO}#customer-data-and-expertise-needed`}>
              Detail in the README
            </a>
          </div>
          <div className="card-body ev-needs">
            <div>
              <b>A few hundred past claims</b>
              <span>with photos, the route taken, the final paid cost and supplements</span>
            </div>
            <div>
              <b>Two estimating experts</b>
              <span>labelling independently; their agreement is the ceiling to beat</span>
            </div>
            <div>
              <b>Today&apos;s baseline</b>
              <span>late escalations, supplement rate, reviewer minutes per claim</span>
            </div>
            <div>
              <b>A locked test set</b>
              <span>scored before any prompt, model or rule change goes live</span>
            </div>
          </div>
        </section>

        {/* 4. Detail, folded */}
        <div className="section-label" style={{ marginBottom: -6 }}>
          The detail
        </div>
        <details className="card ev-fold">
          <summary>
            Every case <span className="hint">{run.cases.length} claims, with photo, expected route, our route and the rules that fired</span>
          </summary>
          <CaseTable scored={scored} />
        </details>
        <details className="card ev-fold">
          <summary>
            Where the routes landed <span className="hint">expected route against ours</span>
          </summary>
          <Confusion s={s} />
        </details>
        <details className="card ev-fold">
          <summary>
            Opus and Sonnet side by side <span className="hint">same cases, same rules</span>
          </summary>
          <ModelComparison runs={saved} />
        </details>
        <details className="card ev-fold">
          <summary>
            Re-run it yourself <span className="hint">6 cases live, well under a dollar; or all 26</span>
          </summary>
          <LiveRunner onProgress={(r) => setLive(r)} />
        </details>
      </main>
    </div>
  );
}
