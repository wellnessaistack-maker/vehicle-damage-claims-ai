"use client";

import { useMemo, useState } from "react";

import { CaseTable, Confusion, Headline, LiveRunner, ModelComparison, Writeup } from "@/components/eval/parts.tsx";

import results from "@/eval/results/latest.json";
import { loadDemoPhoto } from "@/lib/client/intake.ts";
import { DEFAULT_MODEL, MODELS, modelInfo } from "@/lib/extraction/models.ts";
import { plausibleLow, scoreCase, summarise, type EvalCaseResult, type EvalRun, type FieldScore, type ScoredCase, type Summary } from "@/lib/eval/metrics.ts";
import type { Assessment } from "@/lib/pipeline.ts";
import { DEFAULT_SETTINGS, PROTOCOL_VERSION, ROUTE_LABELS, usd, type Route } from "@/lib/policy/protocol.ts";

// Newest prompt first, and the default model first within a prompt version.
const RUNS = [...(results as { runs: EvalRun[] }).runs].sort(
  (a, b) => b.promptVersion.localeCompare(a.promptVersion) || Number(b.model === DEFAULT_MODEL) - Number(a.model === DEFAULT_MODEL),
);

export default function EvaluationPage() {
  const [runIdx, setRunIdx] = useState(0);
  const [live, setLive] = useState<EvalRun | null>(null);
  const scoredRuns = useMemo(
    () =>
      [...(live ? [live] : []), ...RUNS]
        .map((run) => ({ run, live: run === live, scored: run.cases.map((c) => scoreCase(c, DEFAULT_SETTINGS)) }))
        .map((x) => ({ ...x, summary: summarise(x.scored) })),
    [live],
  );
  const current = scoredRuns[Math.min(runIdx, scoredRuns.length - 1)];

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

        <LiveRunner
          onProgress={(run) => {
            setLive(run);
            setRunIdx(0);
          }}
        />

        {!current ? (
          <div className="card">
            <div className="card-body">No saved run yet. Use &quot;Run the labelled set now&quot; above, or run <code>npm run eval</code> locally and commit the results.</div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div className="seg">
                {scoredRuns.map((r, i) => (
                  <button key={`${r.run.model}-${r.run.runAt}`} className={r === current ? "on" : ""} onClick={() => setRunIdx(i)}>
                    {r.live ? "Live run" : "Saved"}: {modelInfo(r.run.model).label}
                    {!r.live && r.run.promptVersion ? `, ${r.run.promptVersion}` : ""}
                  </button>
                ))}
              </div>
              <span className="hint">
                {current.run.cases.length} cases · {new Date(current.run.runAt).toLocaleString()} · prompt {current.run.promptVersion} · protocol v{current.run.protocolVersion} · labels are draft, pending expert review
              </span>
            </div>

            <Headline s={current.summary} />
            {scoredRuns.filter((r) => !r.live).length > 1 && <ModelComparison runs={scoredRuns.filter((r) => !r.live)} />}
            <Confusion s={current.summary} />
            <CaseTable scored={current.scored} />
          </>
        )}

        <Writeup />
      </main>
    </div>
  );
}

