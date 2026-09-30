// Runs the labelled evaluation set locally and saves the results.
//
//   npm run eval                                 # default model, once
//   npm run eval -- --model claude-sonnet-5-5    # another model
//   npm run eval -- --repeat 3                   # check route stability
//
// Needs ANTHROPIC_API_KEY in the environment. Results are merged into
// eval/results/latest.json (one run per model and prompt version), which the
// Evaluation page reads.

import { readFileSync, writeFileSync } from "node:fs";

import { modelFromEnv } from "../lib/extraction/models.ts";
import { scoreCase, summarise, type EvalRun } from "../lib/eval/metrics.ts";
import { runEvaluation } from "../lib/eval/run-all.ts";
import { DEFAULT_SETTINGS } from "../lib/policy/protocol.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const model = arg("model") ?? modelFromEnv();
const repeat = Number(arg("repeat") ?? 1);

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY first.");
  process.exit(1);
}

console.log(`Running the evaluation set with ${model}${repeat > 1 ? `, ${repeat} times each` : ""}...`);
const run = await runEvaluation({ model, repeat, onProgress: (m) => console.log("  " + m) });
const s = summarise(run.cases.map((c) => scoreCase(c, DEFAULT_SETTINGS)));

console.log(`
Escalation recall:        ${s.escalation.caught} of ${s.escalation.of}${s.escalation.missedIds.length ? `  (missed: ${s.escalation.missedIds.join(", ")})` : ""}
Routing agreement:        ${s.agreement.exact} of ${s.agreement.of} exact, ${s.agreement.acceptable} of ${s.agreement.of} acceptable
Escalated unnecessarily:  ${s.overEscalated.count} of ${s.overEscalated.of}
Make / model / colour:    ${s.vehicle.make.right}/${s.vehicle.make.of}, ${s.vehicle.model.right}/${s.vehicle.model.of}, ${s.vehicle.colour.right}/${s.vehicle.colour.of}
Didn't guess when unsure: ${s.abstention.correct} of ${s.abstention.of}
Expected flags raised:    ${s.flags.caught} of ${s.flags.of}
Route stable on repeat:   ${s.stability ? `${s.stability.stable} of ${s.stability.of}` : "not measured (use --repeat 3)"}
Latency p50 / p95:        ${s.latency ? `${(s.latency.p50 / 1000).toFixed(1)} s / ${(s.latency.p95 / 1000).toFixed(1)} s` : "n/a"}
Cost:                     $${s.cost.mean.toFixed(3)} per case, $${s.cost.total.toFixed(2)} total
Range contains paid cost: not measurable without final paid costs
`);

const path = "eval/results/latest.json";
const existing = JSON.parse(readFileSync(path, "utf8")) as { runs: EvalRun[] };
const runs = [run, ...existing.runs.filter((r) => !(r.model === run.model && r.promptVersion === run.promptVersion))];
writeFileSync(path, JSON.stringify({ runs }, null, 2) + "\n");
console.log(`Saved to ${path}`);
