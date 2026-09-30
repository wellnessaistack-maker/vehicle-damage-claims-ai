// GET /api/eval-cases: the labelled evaluation cases (labels, claim details,
// photo paths). No photos, no secrets. Used by the Evaluation page's live run.

import { loadEvalCases } from "@/lib/eval/cases.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(loadEvalCases());
}
