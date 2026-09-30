// Runs every labelled case (or a subset) through the real pipeline.

import { PROMPT_VERSION } from "../extraction/prompt.ts";
import { decide } from "../policy/engine.ts";
import { DEFAULT_SETTINGS, PROTOCOL_VERSION, type Route } from "../policy/protocol.ts";
import { loadEvalCases } from "./cases.ts";
import type { EvalCaseResult, EvalRun } from "./metrics.ts";
import { runEvalCase } from "./run-case.ts";

export async function runEvaluation(opts: { model: string; repeat?: number; only?: string[]; concurrency?: number; root?: string; onProgress?: (msg: string) => void }): Promise<EvalRun> {
  const cases = loadEvalCases(opts.root).filter((c) => !opts.only?.length || opts.only.includes(c.caseId));
  const repeat = Math.max(1, opts.repeat ?? 1);
  const jobs = cases.flatMap((c) => Array.from({ length: repeat }, (_, i) => ({ c, i })));
  const results = new Map<string, Awaited<ReturnType<typeof runEvalCase>>[]>();
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { c } = jobs[next++];
      const r = await runEvalCase(c, { model: opts.model, settings: DEFAULT_SETTINGS, root: opts.root });
      results.set(c.caseId, [...(results.get(c.caseId) ?? []), r]);
      opts.onProgress?.(`${c.caseId}: ${r.ok ? "ok" : `failed (${r.failure})`}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, jobs.length) }, worker));

  return {
    runAt: new Date().toISOString(),
    model: opts.model,
    promptVersion: PROMPT_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    cases: cases.map((c) => {
      const runs = results.get(c.caseId)!;
      const first = runs[0];
      return repeat > 1 ? { ...first, repeatRoutes: runs.map(decideRoute) } : first;
    }),
  };
}

function decideRoute(r: EvalCaseResult): Route {
  return r.ok && r.extraction ? decide(r.extraction, r.claim, r.photoMetrics, DEFAULT_SETTINGS).route : "manual_triage";
}
