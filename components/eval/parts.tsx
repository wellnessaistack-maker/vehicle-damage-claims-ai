"use client";

import { useMemo, useState } from "react";

import results from "@/eval/results/latest.json";
import { loadDemoPhoto } from "@/lib/client/intake.ts";
import { DEFAULT_MODEL, MODELS, modelInfo } from "@/lib/extraction/models.ts";
import { scoreCase, summarise, type EvalCaseResult, type EvalRun, type FieldScore, type ScoredCase, type Summary } from "@/lib/eval/metrics.ts";
import type { Assessment } from "@/lib/pipeline.ts";
import { DEFAULT_SETTINGS, PROTOCOL_VERSION, ROUTE_LABELS, usd, type Route } from "@/lib/policy/protocol.ts";

const ROUTES: Route[] = ["photo_estimate", "more_evidence", "adjuster", "manual_triage"];
export const REPO = "https://github.com/wellnessaistack-maker/vehicle-damage-claims-ai";

interface LiveCase {
  caseId: string;
  photos: string[];
  priorClaimPhotos: string[];
  claim: EvalCaseResult["claim"];
  labels: EvalCaseResult["labels"];
}

/** Runs every labelled case through the same /api/assess route the worklist uses. */
// A handful of cases that cover each route, so a live demo run stays cheap.
export const QUICK_SET = ["A_civic", "B_civic_closeup", "C_f1", "D_nissan_front_crush", "06_mirrored_duplicate", "V1_injury"];

export function LiveRunner({ onProgress }: { onProgress: (run: EvalRun) => void }) {
  const [model, setModel] = useState(MODELS[0].id);
  const [full, setFull] = useState(false);
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<EvalRun | null>(null);

  const start = async () => {
    setErr(null);
    setState("running");
    setDone(0);
    let cases: LiveCase[];
    try {
      cases = await (await fetch("/api/eval-cases")).json();
      if (!full) cases = cases.filter((c) => QUICK_SET.includes(c.caseId));
    } catch {
      setErr("Couldn't load the labelled cases.");
      setState("idle");
      return;
    }
    setTotal(cases.length);
    const run: EvalRun = { runAt: new Date().toISOString(), model, promptVersion: "", protocolVersion: PROTOCOL_VERSION, cases: [] };
    const results: EvalCaseResult[] = [];
    let next = 0;
    const worker = async () => {
      while (next < cases.length) {
        const c = cases[next++];
        const r = await runOne(c, model);
        results.push(r.result);
        if (r.promptVersion) run.promptVersion = r.promptVersion;
        setDone(results.length);
        const order = new Map(cases.map((x, i) => [x.caseId, i]));
        const sorted = [...results].sort((a, b) => order.get(a.caseId)! - order.get(b.caseId)!);
        const snapshot = { ...run, cases: sorted };
        setLast(snapshot);
        onProgress(snapshot);
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    setState("done");
  };

  const download = () => {
    if (!last) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ runs: [last] }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `eval-${last.model}-${last.runAt.slice(0, 16)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>Run the labelled set now</h3>
        <span className="sub">Same route, prompt and rules as the worklist. Each case is one real AI call and costs money.</span>
      </div>
      <div className="card-body" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <select className="text-input" style={{ width: 200 }} value={model} onChange={(e) => setModel(e.target.value)} disabled={state === "running"}>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <label className="hint" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} disabled={state === "running"} />
          All 26 cases (otherwise a quick set of {QUICK_SET.length} covering each route)
        </label>
        <button className="btn btn-primary" onClick={() => void start()} disabled={state === "running"}>
          {state === "running" ? "Running..." : state === "done" ? "Run again" : "Run now"}
        </button>
        {state !== "idle" && (
          <span className="hint">
            {state === "running" && <span className="spinner" style={{ marginRight: 6, verticalAlign: -2 }} />}
            {done} of {total} cases done
          </span>
        )}
        {state === "done" && (
          <button className="btn btn-sm" onClick={download}>
            Download results
          </button>
        )}
        {err && <span className="err">{err}</span>}
      </div>
    </div>
  );
}

async function runOne(c: LiveCase, model: string): Promise<{ result: EvalCaseResult; promptVersion?: string }> {
  const started = Date.now();
  const base = { caseId: c.caseId, photos: c.photos, claim: c.claim, labels: c.labels };
  try {
    const photos = await Promise.all(c.photos.map((p) => loadDemoPhoto(publicPath(p))));
    const res = await fetch("/api/assess", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        claim: c.claim,
        photos: photos.map((p) => ({ name: p.name, base64: p.base64 })),
        model,
        pastClaims: c.priorClaimPhotos.length ? "demo" : "none",
      }),
    });
    const a = (await res.json()) as Assessment & { error?: string };
    if (!res.ok || a.error) throw new Error(a.error ?? `HTTP ${res.status}`);
    return {
      promptVersion: a.ok ? a.meta.promptVersion : a.promptVersion,
      result: {
        ...base,
        ok: a.ok,
        failure: a.ok ? undefined : a.failure.message,
        extraction: a.ok ? a.extraction : undefined,
        photoMetrics: a.photos,
        latencyMs: a.timings.totalMs,
        costUsd: a.ok ? a.meta.costUsd : 0,
        modelServed: a.ok ? a.meta.modelServed : undefined,
      },
    };
  } catch (e) {
    return { result: { ...base, ok: false, failure: e instanceof Error ? e.message : "Request failed", photoMetrics: [], latencyMs: Date.now() - started, costUsd: 0 } };
  }
}

export const publicPath = (p: string) => "/" + p.replace(/^demo-images\//, "demo/");

export function ModelComparison({ runs, title, sub }: { runs: { run: EvalRun; summary: Summary }[]; title?: string; sub?: string }) {
  const label = (r: EvalRun) => `${modelInfo(r.model).label}, ${r.promptVersion}`;
  const rows: [string, (s: Summary) => string][] = [
    ["Complex claims sent to an adjuster", (s) => `${s.escalation.caught} of ${s.escalation.of}`],
    ["Same route as the expert label", (s) => `${s.agreement.exact} of ${s.agreement.of}`],
    ["An acceptable route per the label", (s) => `${s.agreement.acceptable} of ${s.agreement.of}`],
    ["Simple claims sent to an adjuster", (s) => `${s.overEscalated.count} of ${s.overEscalated.of}`],
    ["Didn't guess when unsure", (s) => `${s.abstention.correct} of ${s.abstention.of}`],
    ["Make / model / colour", (s) => `${s.vehicle.make.right}/${s.vehicle.make.of}, ${s.vehicle.model.right}/${s.vehicle.model.of}, ${s.vehicle.colour.right}/${s.vehicle.colour.of}`],
    ["Typical time per claim", (s) => (s.latency ? `${(s.latency.p50 / 1000).toFixed(1)} s` : "n/a")],
    ["Cost per case", (s) => `$${s.cost.mean.toFixed(3)}`],
    ["AI failures", (s) => String(s.failures)],
  ];
  return (
    <div className="card">
      <div className="card-head">
        <h3>{title ?? "Saved runs side by side"}</h3>
        <span className="sub">{sub ?? "Same cases and rules. Each column changes the model or the prompt version, which is how every change gets scored before it goes live."}</span>
      </div>
      <div className="card-body">
        <table className="t">
          <thead>
            <tr>
              <th>Measure</th>
              {runs.map((r) => (
                <th key={label(r.run)}>{label(r.run)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([measure, f]) => (
              <tr key={measure}>
                <td>{measure}</td>
                {runs.map((r) => (
                  <td key={label(r.run)}>{f(r.summary)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Confusion({ s }: { s: Summary }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>Recommended route compared with the expert&apos;s</h3>
        <span className="sub">Each row is what the expert said; each column is what the AI and rules recommended. Bold is where they agree.</span>
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

/** The expert's cost band, in words. */
const BAND_TEXT: Record<string, string> = {
  under_1000: "under $1,000",
  "1000_2500": "$1,000 to $2,500",
  "2500_to_total_loss": "$2,500 up to total loss",
  total_loss: "total loss",
  unsure: "unsure of the band",
};

const fieldText: Record<FieldScore, string> = {
  correct: "✓",
  correctly_unknown: "✓ (didn't guess)",
  wrong: "✕ wrong",
  guessed: "✕ guessed",
  missed: "✕ left blank",
  "n/a": "",
};

export function CaseTable({ scored }: { scored: ScoredCase[] }) {
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
              <th>Recommended route</th>
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
                    <img src={publicPath(r.photos[0])} alt="" style={{ width: 72, height: 48, objectFit: "cover", borderRadius: 4 }} />
                  </td>
                  <td>
                    <div className="mono">{r.caseId}</div>
                    <div className="hint">{r.labels.whatItTests}</div>
                  </td>
                  <td>
                    {ROUTE_LABELS[r.labels.expectedRoute]}
                    {r.labels.mustEscalate && <div className="chip chip-bad" style={{ marginTop: 2 }}>needs an adjuster</div>}
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
                      d?.requiredOutputs.estimate.status === "provisional" && d.requiredOutputs.estimate.lowUsd !== null ? (
                        <>
                          {usd(d.requiredOutputs.estimate.lowUsd)} to {usd(d.requiredOutputs.estimate.highUsd!)}
                          <div className="hint">provisional, not scored</div>
                        </>
                      ) : (
                        <span className="hint">none</span>
                      )
                    )}
                    {BAND_TEXT[r.labels.expectedCostBand] && <div className="hint">Expert: {BAND_TEXT[r.labels.expectedCostBand]}</div>}
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

