// Scores evaluation results against expert labels. Pure functions, used by the
// command-line runner, the Evaluation page and the protocol test in the app.
//
// No pass/fail thresholds: the deck's position is that targets get agreed with
// the carrier's claims and risk owners, so this only reports the numbers.

import type { ClaimContext, PhotoMetrics } from "../claims/types.ts";
import type { Extraction } from "../extraction/schema.ts";
import { decide, type Decision } from "../policy/engine.ts";
import type { Route, Settings } from "../policy/protocol.ts";

export interface CaseLabels {
  expectedRoute: Route;
  acceptableRoutes: Route[];
  mustEscalate: boolean;
  expectedFlags: string[];
  expectedMake: string;
  expectedModel: string;
  expectedColour: string;
  expectedCostBand: string;
  whatItTests: string;
  source: string;
  labelStatus: string;
}

export interface EvalCaseResult {
  caseId: string;
  photos: string[];
  claim: ClaimContext;
  labels: CaseLabels;
  ok: boolean;
  failure?: string;
  extraction?: Extraction;
  photoMetrics: PhotoMetrics[];
  latencyMs: number;
  costUsd: number;
  modelServed?: string;
  /** Routes from repeated runs of the same case, when the run used --repeat. */
  repeatRoutes?: Route[];
}

export interface EvalRun {
  runAt: string;
  model: string;
  promptVersion: string;
  protocolVersion: string;
  cases: EvalCaseResult[];
}

export interface ScoredCase {
  result: EvalCaseResult;
  decision: Decision | null;
  route: Route;
  exact: boolean;
  acceptable: boolean;
  missedEscalation: boolean;
  overEscalated: boolean;
  missingFlags: string[];
  vehicle: { make: FieldScore; model: FieldScore; colour: FieldScore };
  cost: { low: number | null; high: number | null; band: string; sideOfLimit: "below" | "straddles" | "above" | null };
}

export type FieldScore = "correct" | "correctly_unknown" | "wrong" | "guessed" | "missed" | "n/a";

export interface Summary {
  total: number;
  assessed: number;
  failures: number;
  escalation: { caught: number; of: number; missedIds: string[]; viaFailure: number };
  agreement: { exact: number; acceptable: number; of: number };
  overEscalated: { count: number; of: number; ids: string[] };
  confusion: Record<Route, Record<Route, number>>;
  vehicle: { make: Tally; model: Tally; colour: Tally };
  abstention: { correct: number; of: number };
  flags: { caught: number; of: number };
  stability: { stable: number; of: number } | null;
  latency: { p50: number; p95: number } | null;
  cost: { mean: number; total: number };
  rangeCoverage: null;
}

export interface Tally {
  right: number;
  of: number;
}

const ROUTES: Route[] = ["photo_estimate", "more_evidence", "adjuster", "manual_triage"];

export function scoreCase(r: EvalCaseResult, settings: Settings): ScoredCase {
  const decision = r.ok && r.extraction ? decide(r.extraction, r.claim, r.photoMetrics, settings) : null;
  const route: Route = decision?.route ?? "manual_triage";
  const acceptable = r.labels.acceptableRoutes.includes(route);
  const fired = new Set(decision?.reasons.map((x) => x.id) ?? []);
  const v = decision?.requiredOutputs.vehicle;
  const e = decision?.requiredOutputs.estimate;
  const low = e && e.status !== "withheld" ? e.lowUsd : null;
  const high = e && e.status !== "withheld" ? e.highUsd : null;
  return {
    result: r,
    decision,
    route,
    exact: route === r.labels.expectedRoute,
    acceptable,
    // A failure goes to manual triage, which is a person, so it isn't a missed escalation.
    missedEscalation: r.labels.mustEscalate && route !== "adjuster" && route !== "manual_triage",
    overEscalated: !r.labels.mustEscalate && route === "adjuster" && !r.labels.acceptableRoutes.includes("adjuster"),
    missingFlags: r.labels.expectedFlags.filter((f) => !fired.has(f)),
    vehicle: {
      make: fieldScore(r.labels.expectedMake, v?.make.value ?? null),
      model: fieldScore(r.labels.expectedModel, v?.model.value ?? null),
      colour: fieldScore(r.labels.expectedColour, v?.colour.value ?? null),
    },
    cost: {
      low,
      high,
      band: r.labels.expectedCostBand,
      sideOfLimit: low === null || high === null ? null : high <= settings.fastPathLimitUsd ? "below" : low > settings.fastPathLimitUsd ? "above" : "straddles",
    },
  };
}

export function fieldScore(expected: string, actual: string | null): FieldScore {
  const exp = expected.trim();
  if (!exp || exp.toLowerCase() === "n/a") return "n/a";
  if (exp === "CANT_TELL") return actual ? "guessed" : "correctly_unknown";
  if (!actual) return "missed";
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const options = exp.split("|").map(norm);
  const a = norm(actual);
  // Treat silver and grey as the same family, as the policy checks do.
  const greyish = (s: string) => /silver|grey|gray|charcoal|graphite/.test(s);
  return options.some((o) => a.includes(o) || o.includes(a) || (greyish(o) && greyish(a))) ? "correct" : "wrong";
}

export function summarise(scored: ScoredCase[]): Summary {
  const assessed = scored.filter((s) => s.result.ok);
  const must = scored.filter((s) => s.result.labels.mustEscalate);
  const notMust = scored.filter((s) => !s.result.labels.mustEscalate);
  const confusion = Object.fromEntries(ROUTES.map((a) => [a, Object.fromEntries(ROUTES.map((b) => [b, 0]))])) as Summary["confusion"];
  scored.forEach((s) => confusion[s.result.labels.expectedRoute][s.route]++);

  const tally = (k: "make" | "model" | "colour"): Tally => {
    const rel = assessed.filter((s) => s.vehicle[k] !== "n/a");
    return { right: rel.filter((s) => s.vehicle[k] === "correct" || s.vehicle[k] === "correctly_unknown").length, of: rel.length };
  };
  const abst = assessed.flatMap((s) => Object.values(s.vehicle)).filter((f) => f === "correctly_unknown" || f === "guessed");
  const withFlags = scored.filter((s) => s.result.labels.expectedFlags.length > 0);
  const repeats = scored.filter((s) => s.result.repeatRoutes && s.result.repeatRoutes.length > 1);
  const lat = assessed.map((s) => s.result.latencyMs).sort((a, b) => a - b);
  const costs = scored.map((s) => s.result.costUsd);

  return {
    total: scored.length,
    assessed: assessed.length,
    failures: scored.length - assessed.length,
    escalation: {
      caught: must.filter((s) => !s.missedEscalation).length,
      of: must.length,
      missedIds: must.filter((s) => s.missedEscalation).map((s) => s.result.caseId),
      // Reached a person only because the AI failed, not because the rules escalated it.
      viaFailure: must.filter((s) => s.route === "manual_triage").length,
    },
    agreement: { exact: scored.filter((s) => s.exact).length, acceptable: scored.filter((s) => s.acceptable).length, of: scored.length },
    overEscalated: { count: notMust.filter((s) => s.overEscalated).length, of: notMust.length, ids: notMust.filter((s) => s.overEscalated).map((s) => s.result.caseId) },
    confusion,
    vehicle: { make: tally("make"), model: tally("model"), colour: tally("colour") },
    abstention: { correct: abst.filter((f) => f === "correctly_unknown").length, of: abst.length },
    flags: { caught: withFlags.filter((s) => s.missingFlags.length === 0).length, of: withFlags.length },
    stability: repeats.length
      ? { stable: repeats.filter((s) => new Set(s.result.repeatRoutes).size === 1).length, of: repeats.length }
      : null,
    latency: lat.length ? { p50: lat[Math.floor(lat.length * 0.5)], p95: lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] } : null,
    cost: { mean: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0, total: costs.reduce((a, b) => a + b, 0) },
    // Needs final paid costs from the carrier. Not available for this set.
    rangeCoverage: null,
  };
}

/** Parses cases.csv (simple CSV: no quoted commas are used in the file). */
export function parseCasesCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
}

export function labelsFromRow(row: Record<string, string>): CaseLabels {
  const list = (s: string) => s.split(";").map((x) => x.trim()).filter(Boolean);
  return {
    expectedRoute: row.expected_route as Route,
    acceptableRoutes: list(row.acceptable_routes) as Route[],
    mustEscalate: row.must_escalate === "yes",
    expectedFlags: list(row.expected_flags),
    expectedMake: row.expected_make,
    expectedModel: row.expected_model,
    expectedColour: row.expected_colour,
    expectedCostBand: row.expected_cost_band,
    whatItTests: row.what_it_tests,
    source: row.source,
    labelStatus: row.label_status,
  };
}

/** Applies "key=value;key=value" overrides from the CSV to a claim. */
export function applyOverrides(claim: ClaimContext, overrides: string): ClaimContext {
  const out: ClaimContext = { ...claim, policyVehicle: { ...claim.policyVehicle } };
  for (const pair of overrides.split(";").map((p) => p.trim()).filter(Boolean)) {
    const [k, v] = pair.split("=");
    const val: unknown = v === "true" ? true : v === "false" ? false : v === "null" ? null : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
    if (k === "powertrain") out.policyVehicle.powertrain = val as ClaimContext["policyVehicle"]["powertrain"];
    else (out as unknown as Record<string, unknown>)[k] = val;
  }
  return out;
}

/**
 * Lower end of a 95% Wilson interval: with k successes out of n, the true rate
 * is plausibly as low as this. Shown so a small set isn't over-read (11 of 11
 * is still consistent with a true rate around 74%).
 */
export function plausibleLow(k: number, n: number): number | null {
  if (n === 0) return null;
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (centre - margin) / denom);
}
