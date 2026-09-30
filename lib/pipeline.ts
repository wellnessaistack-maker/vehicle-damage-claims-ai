// One case, end to end:
//   1. prepare each photo (fix rotation, resize, re-encode, drop metadata)
//   2. measure photo quality and fingerprint each photo (plain code, no AI)
//   3. one AI call for the whole case
//   4. run the routing protocol
//
// Nothing is stored. Photos live in memory for the length of the request.
// If the AI fails, the case goes to manual triage with the reason, and the
// photo checks are still returned so the reviewer isn't starting from nothing.

import sharp from "sharp";

import type { ClaimContext, PhotoMetrics } from "./claims/types.ts";
import { extract, ExtractionError, type ExtractionMeta, type FailureKind, type SimulatedFailure } from "./extraction/extract.ts";
import { modelFromEnv } from "./extraction/models.ts";
import { PROMPT_VERSION } from "./extraction/prompt.ts";
import type { Extraction } from "./extraction/schema.ts";
import { findPastClaimMatch, fingerprint, type PastClaimPhoto } from "./image/fingerprint.ts";
import { measurePhoto } from "./image/metrics.ts";
import { decide, type Decision } from "./policy/engine.ts";
import { PROTOCOL_VERSION, ROUTE_LABELS, type Settings } from "./policy/protocol.ts";

const MODEL_LONG_EDGE = 1568;

export interface Timings {
  prepareMs: number;
  modelMs: number;
  rulesMs: number;
  totalMs: number;
}

export interface AssessmentSuccess {
  ok: true;
  claimId: string;
  assessedAt: string;
  extraction: Extraction;
  decision: Decision;
  photos: PhotoMetrics[];
  meta: ExtractionMeta;
  timings: Timings;
}

export interface AssessmentFailure {
  ok: false;
  claimId: string;
  assessedAt: string;
  route: "manual_triage";
  routeLabel: string;
  failure: { kind: FailureKind; message: string; simulated: boolean };
  photos: PhotoMetrics[];
  modelRequested: string;
  promptVersion: string;
  protocolVersion: string;
  timings: Timings;
}

export type Assessment = AssessmentSuccess | AssessmentFailure;

export async function assessCase(input: {
  claim: ClaimContext;
  photos: { name: string; data: Buffer }[];
  settings: Settings;
  model?: string;
  simulate?: SimulatedFailure;
  pastClaims?: PastClaimPhoto[];
}): Promise<Assessment> {
  const t0 = Date.now();
  const model = input.model ?? modelFromEnv();

  const prepared = await Promise.all(
    input.photos.map(async (p) => {
      const jpeg = await sharp(p.data)
        .rotate()
        .resize({ width: MODEL_LONG_EDGE, height: MODEL_LONG_EDGE, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      const [metrics, fp] = await Promise.all([measurePhoto(p.name, p.data), fingerprint(p.data)]);
      const photo: PhotoMetrics = { ...metrics, nearDuplicateOf: findPastClaimMatch(fp, input.pastClaims) };
      return { name: p.name, jpeg, photo };
    }),
  );
  const photos = prepared.map((p) => p.photo);
  const t1 = Date.now();

  let extraction: Extraction;
  let meta: ExtractionMeta;
  try {
    ({ extraction, meta } = await extract(prepared, { model, simulate: input.simulate }));
  } catch (err) {
    const e = err instanceof ExtractionError ? err : new ExtractionError("api_error", "Something went wrong calling the AI.");
    const t2 = Date.now();
    return {
      ok: false,
      claimId: input.claim.claimId,
      assessedAt: new Date().toISOString(),
      route: "manual_triage",
      routeLabel: ROUTE_LABELS.manual_triage,
      failure: { kind: e.kind, message: e.message, simulated: e.simulated },
      photos,
      modelRequested: model,
      promptVersion: PROMPT_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      timings: { prepareMs: t1 - t0, modelMs: t2 - t1, rulesMs: 0, totalMs: t2 - t0 },
    };
  }
  const t2 = Date.now();

  const decision = decide(extraction, input.claim, photos, input.settings);
  const t3 = Date.now();

  return {
    ok: true,
    claimId: input.claim.claimId,
    assessedAt: new Date().toISOString(),
    extraction,
    decision,
    photos,
    meta,
    timings: { prepareMs: t1 - t0, modelMs: t2 - t1, rulesMs: t3 - t2, totalMs: t3 - t0 },
  };
}
