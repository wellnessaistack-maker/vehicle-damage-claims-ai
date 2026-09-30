// Saves evaluation results into eval/results/latest.json (one run per model).
//
//   node scripts/import-eval.ts results.json
//
// Accepts a file downloaded from the Evaluation page ({ runs: [...] }), a single
// run, or the compact output of /api/eval-run (claim details and labels are
// filled back in from eval/cases.csv).

import { readFileSync, writeFileSync } from "node:fs";

import { loadEvalCases } from "../lib/eval/cases.ts";
import type { EvalCaseResult, EvalRun } from "../lib/eval/metrics.ts";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/import-eval.ts <results.json>");
  process.exit(1);
}

const input = JSON.parse(readFileSync(file, "utf8"));
const incoming: EvalRun[] = Array.isArray(input.runs) ? input.runs : [input];
const cases = new Map(loadEvalCases().map((c) => [c.caseId, c]));

const runs = incoming.map((run) => ({
  ...run,
  cases: run.cases.map((r: Partial<EvalCaseResult> & { caseId: string }) => {
    const c = cases.get(r.caseId);
    if (!c) throw new Error(`Unknown case ${r.caseId}`);
    return { photos: c.photos, claim: c.claim, labels: c.labels, ...r } as EvalCaseResult;
  }),
}));

const path = "eval/results/latest.json";
const existing = JSON.parse(readFileSync(path, "utf8")) as { runs: EvalRun[] };
const models = new Set(runs.map((r) => r.model));
const merged = [...runs, ...existing.runs.filter((r) => !models.has(r.model))];
writeFileSync(path, JSON.stringify({ runs: merged }, null, 2) + "\n");
console.log(`Saved ${runs.map((r) => `${r.model} (${r.cases.length} cases)`).join(", ")} to ${path}`);
