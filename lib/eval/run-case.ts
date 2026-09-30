// Runs one labelled case through the real pipeline. Server and command-line only.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fingerprint, type PastClaimPhoto } from "../image/fingerprint.ts";
import { assessCase } from "../pipeline.ts";
import type { Settings } from "../policy/protocol.ts";
import type { EvalCase } from "./cases.ts";
import type { EvalCaseResult } from "./metrics.ts";

export async function runEvalCase(c: EvalCase, opts: { model: string; settings: Settings; root?: string }): Promise<EvalCaseResult> {
  const root = opts.root ?? process.cwd(/*turbopackIgnore: true*/);
  const photos = c.photos.map((p) => ({ name: p.split("/").pop()!, data: readFileSync(join(/*turbopackIgnore: true*/ root, p)) }));

  // Each case only sees the past-claim photos it lists, so edits of the same
  // source photo in other cases don't count as reuse.
  const pastClaims: PastClaimPhoto[] = await Promise.all(
    c.priorClaimPhotos.map(async (p) => ({
      claimId: "CLM-2025-08817",
      photo: p,
      hash: (await fingerprint(readFileSync(join(/*turbopackIgnore: true*/ root, p)))).hash,
    })),
  );

  const a = await assessCase({ claim: c.claim, photos, settings: opts.settings, model: opts.model, pastClaims });
  return {
    caseId: c.caseId,
    photos: c.photos,
    claim: c.claim,
    labels: c.labels,
    ok: a.ok,
    failure: a.ok ? undefined : a.failure.message,
    extraction: a.ok ? a.extraction : undefined,
    photoMetrics: a.photos,
    latencyMs: a.timings.totalMs,
    costUsd: a.ok ? a.meta.costUsd : 0,
    modelServed: a.ok ? a.meta.modelServed : undefined,
  };
}
