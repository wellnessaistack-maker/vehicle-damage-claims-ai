"use client";

// The evaluation page: the answer first, then the model comparison, the failures, and every case.

import { useMemo, useState } from "react";

import { CaseTable, Confusion, LiveRunner, ModelComparison, publicPath, REPO } from "@/components/eval/parts.tsx";
import results from "@/eval/results/latest.json";
import { DEFAULT_MODEL, modelInfo } from "@/lib/extraction/models.ts";
import { plausibleLow, scoreCase, summarise, type EvalRun } from "@/lib/eval/metrics.ts";
import { DEFAULT_SETTINGS, ROUTE_LABELS, type Route } from "@/lib/policy/protocol.ts";

const RUNS = (results as { runs: EvalRun[] }).runs;
const MAIN = RUNS.find((r) => r.model === DEFAULT_MODEL && r.promptVersion === "extract-v2") ?? RUNS[0];

// Plain-language notes on each claim the default model didn't get exactly right.
const NOTES: Record<string, { what: string; why: string; next: string }> = {
  "05_rotated": {
    what: "A clean photo, uploaded sideways.",
    why: "Sideways, the AI couldn't tell which car it was, so it asked the customer for another photo instead of guessing.",
    next: "Straighten photos automatically before the AI looks at them. Today this costs the customer one extra photo; it never lets a serious claim through.",
  },
  "00a_camry": {
    what: "Front-corner damage priced close to the $2,500 approval limit.",
    why: "The price sat right around the limit, so on repeat runs it went to an adjuster once and was approved three times. The expert would approve it, but an adjuster is a reasonable call too.",
    next: "Claims whose price could run well past the limit now always go to an adjuster, so it gives the same answer every time. With your paid claims we'd set that threshold properly.",
  },
  V3_low_value: {
    what: "The same Civic, but the policy says the car is only worth $2,500.",
    why: "The repair comes to about $1,130, which is 45% of the car's value. That's under the 60% total-loss line, so it was approved. The expert label assumed a higher repair price and called it a total loss.",
    next: "An estimator should decide whether this is a total loss. If the carrier's line is lower than 60%, it's a one-number change.",
  },
  "03_compressed": {
    what: "A blurry, forwarded copy of a photo.",
    why: "It asked the customer for a better photo. The expert might have approved from it, but asking is reasonable.",
    next: "Fine as it is. Your reviewers' decisions would tell us whether it asks too often.",
  },
};

const FIXED_IN_V2 = [
  { what: "A customer's wider retake was judged on the original close-up", fix: "Prompt now judges evidence on the best photo in the set" },
  { what: "A crumpled bumper cover was called structural damage", fix: "Prompt now defines structural as deformed frame, pillars or floor" },
  { what: "A door dent got a hidden-damage allowance that pushed it over the limit", fix: "The allowance now applies only to moderate front or rear damage, or anything severe" },
];

export default function EvaluationPage() {
  const [live, setLive] = useState<EvalRun | null>(null);
  const run = live ?? MAIN;
  const scored = useMemo(() => run.cases.map((c) => scoreCase(c, DEFAULT_SETTINGS)), [run]);
  const s = useMemo(() => summarise(scored), [scored]);
  const saved = useMemo(
    () =>
      [...RUNS]
        .sort((a, b) => b.promptVersion.localeCompare(a.promptVersion) || Number(b.model === DEFAULT_MODEL) - Number(a.model === DEFAULT_MODEL))
        .map((r) => ({ run: r, summary: summarise(r.cases.map((c) => scoreCase(c, DEFAULT_SETTINGS))) })),
    [],
  );
  const severity = (x: (typeof scored)[number]) => (x.missedEscalation ? 0 : !x.acceptable ? 1 : x.result.repeatRoutes && new Set(x.result.repeatRoutes).size > 1 ? 2 : 3);
  // Most serious first: a serious claim approved, then a wrong route, then a route that varied, then reasonable alternatives.
  const misses = scored.filter((x) => !x.exact || (x.result.repeatRoutes && new Set(x.result.repeatRoutes).size > 1)).sort((a, b) => severity(a) - severity(b));
  const varied = (routes: string[]) =>
    Object.entries(routes.reduce<Record<string, number>>((n, r) => ({ ...n, [r]: (n[r] ?? 0) + 1 }), {}))
      .sort((a, b) => b[1] - a[1])
      .map(([r, k]) => `${ROUTE_LABELS[r as Route]} ${k} time${k === 1 ? "" : "s"}`)
      .join(", ");
  const low = plausibleLow(s.escalation.caught, s.escalation.of);
  const cautious = misses.every((m) => !m.missedEscalation);

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
          <h1 style={{ fontSize: 24, marginBottom: 6 }}>Can you trust the route it recommends?</h1>
          <p className="ev-answer">
            On {run.cases.length} test claims, it sent <b>{s.escalation.caught} of {s.escalation.of}</b> serious claims to an adjuster and{" "}
            <b>{s.overEscalated.count === 0 ? "none" : `${s.overEscalated.count}`} of the {s.overEscalated.of}</b> simple ones. When it was unsure, it asked for another photo rather than guess. That&apos;s a
            good start, not proof: proof needs your own claims.
          </p>
        </div>

        <div className="ev-score ev-score-4">
          <div className="ev-tile ev-lead">
            <div className="ev-v">
              {s.escalation.caught} of {s.escalation.of}
            </div>
            <div className="ev-l2">serious claims went to an adjuster</div>
            <div className="ev-d">
              {s.escalation.caught === s.escalation.of
                ? "None was approved from photos."
                : `The ${s.escalation.of - s.escalation.caught === 1 ? "one it missed was a borderline total loss" : `${s.escalation.of - s.escalation.caught} it missed are below`}. With so few claims, the real rate could be as low as ${low !== null ? Math.round(low * 100) : "?"}%.`}
            </div>
          </div>
          <div className="ev-tile">
            <div className="ev-v">
              {s.overEscalated.count} of {s.overEscalated.of}
            </div>
            <div className="ev-l2">simple claims sent to an adjuster they didn&apos;t need</div>
            <div className="ev-d">Each one would be an adjuster&apos;s time spent for nothing.</div>
          </div>
          <div className="ev-tile">
            <div className="ev-v">
              {s.agreement.exact} of {s.agreement.of}
            </div>
            <div className="ev-l2">got the same route as our expert</div>
            <div className="ev-d">The other {s.agreement.of - s.agreement.exact} are explained below.</div>
          </div>
          <div className="ev-tile">
            <div className="ev-v">{s.latency ? `${Math.round(s.latency.p50 / 1000)} sec` : "n/a"}</div>
            <div className="ev-l2">and about {Math.round(s.cost.mean * 100)} cents a claim</div>
            <div className="ev-d">Runs in the background, so a reviewer rarely waits.</div>
          </div>
        </div>

        <div className="ev-two">
          <section className="card">
            <div className="card-head">
              <h3>What we tested it on</h3>
            </div>
            <div className="card-body ev-source">
              <p>
                <b>Are they real claims?</b> No. The photos are real photos of damaged cars, but the claim details (the customer, the policy, the car&apos;s value) are made up for testing. None come from an insurer.
              </p>
              <p>
                <b>Where are the photos from?</b> 8 originals: four real crashes from Wikimedia Commons (a flood, a front-end crush, a van under a wall, a car into a tree), a press photo of a race-car crash, a dented Honda Civic and Toyota
                Camry I sourced, and one photo with no car in it.
              </p>
              <p>
                <b>Why 26?</b> The other 18 are built from those 8 to test one thing each. 13 are harder versions of a photo (too dark, blurry, sideways, glare, close-ups): does it ask for a better photo instead of guessing? 5 reuse the
                Civic photo with a tricky claim detail (an injury, damage on the wrong side, a cheap car, two different cars): do the rules catch it?
              </p>
              <p>
                <b>Who decided the right answer?</b> I did, as drafts. An estimator should review them before anyone relies on these numbers.
              </p>
              <p className="hint">
                {s.escalation.of} should go to an adjuster, and only {run.cases.filter((c) => c.labels.expectedRoute === "photo_estimate").length} should be approved from photos, so the next gap to fill is more simple claims. Every test
                claim is listed with its photo under More detail, at the bottom.
              </p>
            </div>
          </section>
          <section className="card">
            <div className="card-head">
              <h3>What we&apos;d need from you to trust it</h3>
            </div>
            <div className="card-body ev-needs ev-needs-2">
              <div>
                <b>A few hundred past claims</b>
                <span>with photos, where each one went, and what was finally paid</span>
              </div>
              <div>
                <b>Two of your estimators</b>
                <span>labelling them separately, so we know how often experts agree</span>
              </div>
              <div>
                <b>Today&apos;s numbers</b>
                <span>how often claims are escalated late, and how long a review takes</span>
              </div>
              <div>
                <b>A test set we never tune on</b>
                <span>so every change is checked against it before it goes live</span>
              </div>
            </div>
          </section>
        </div>

        {/* 2. Where it went wrong */}
        <section className="card">
          <div className="card-head">
            <h3>The {misses.length} claims it didn&apos;t get exactly right</h3>
            <span className="sub">{cautious ? "Every one erred on the safe side" : "One serious claim was approved; the rest erred on the safe side"}</span>
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
                      <span className={`chip ${m.acceptable ? "chip-warn" : "chip-bad"}`}>{m.missedEscalation ? "Approved, but should have gone to an adjuster" : flipped ? "Different answer on repeat runs" : m.acceptable ? "Reasonable, not the expert's first choice" : "Asked for a photo it didn't need"}</span>
                    </div>
                    <div className="ev-miss-routes">
                      Expert said: <b>{ROUTE_LABELS[m.result.labels.expectedRoute]}</b> · It said: <b>{flipped ? varied(m.result.repeatRoutes!) : ROUTE_LABELS[m.route as Route]}</b>
                    </div>
                    {n && (
                      <dl className="ev-miss-body">
                        <dt>What happened</dt>
                        <dd>{n.why}</dd>
                        <dt>What we&apos;d change</dt>
                        <dd>{n.next}</dd>
                      </dl>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <details className="ev-fold">
          <summary>More detail: every test claim with its photo, models compared, and how it was scored</summary>
          <div className="ev-tech">
            <div className="ev-strip">
              <span>
                <b>Didn&apos;t guess when unsure</b> {s.abstention.correct} of {s.abstention.of}
              </span>
              <span>
                <b>Car identified right</b> make {s.vehicle.make.right} of {s.vehicle.make.of}, model {s.vehicle.model.right} of {s.vehicle.model.of}, colour {s.vehicle.colour.right} of {s.vehicle.colour.of}
              </span>
              <span>
                <b>Review flags raised</b> {s.flags.caught} of {s.flags.of}
              </span>
              <span>
                <b>Same route every run</b> {s.stability ? `${s.stability.stable} of ${s.stability.of}` : "not measured"}
              </span>
              <span>
                <b>Slowest 1 in 20</b> {s.latency ? `${(s.latency.p95 / 1000).toFixed(1)} s` : "n/a"}
              </span>
              <span>
                <b>Model and prompt</b> {modelInfo(run.model).label}, {run.promptVersion}
              </span>
            </div>
            <section className="card">
              <div className="card-body">
                <div className="ev-fixed" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
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
        {/* Models and routes, side by side */}
        <div className="ev-two">
          <ModelComparison runs={saved} title="Models and prompts side by side" sub="Same 26 cases, same rules" />
          <Confusion s={s} />
        </div>

            <CaseTable scored={scored} />
            <LiveRunner onProgress={(r) => setLive(r)} />
          </div>
        </details>
      </main>
    </div>
  );
}
