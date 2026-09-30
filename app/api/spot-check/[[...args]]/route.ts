// GET /api/spot-check/<EVAL_TOKEN>/<photo link, base64url-encoded>[/<model>]
//
// Runs one photo from a link through exactly the same pipeline as an upload with
// no claim details, and returns a short summary. For checking how the prototype
// handles photos it has never seen. Each call costs API credits, so on Vercel it
// needs the same secret token as the evaluation runner and is off without one.

import { blankClaim } from "@/lib/claims/demo.ts";
import { MODELS } from "@/lib/extraction/models.ts";
import { fetchImage, UnsafeUrlError } from "@/lib/net/safe-fetch.ts";
import { assessCase } from "@/lib/pipeline.ts";
import { DEFAULT_SETTINGS } from "@/lib/policy/protocol.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: Request, ctx: { params: Promise<{ args?: string[] }> }) {
  let args = (await ctx.params).args ?? [];
  if (process.env.VERCEL_ENV) {
    const token = process.env.EVAL_TOKEN;
    if (!token || args[0] !== token) return Response.json({ error: "Needs a valid token on this deployment." }, { status: 403 });
    args = args.slice(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "No API key configured." }, { status: 503 });
  const [encoded, pModel] = args;
  if (!encoded) return Response.json({ error: "Pass the photo link, base64url-encoded, as a path segment." }, { status: 400 });
  const model = pModel && MODELS.some((m) => m.id === pModel) ? pModel : undefined;

  let link: string;
  try {
    link = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return Response.json({ error: "Couldn't decode the link." }, { status: 400 });
  }
  let data: Buffer;
  try {
    ({ data } = await fetchImage(link));
  } catch (e) {
    return Response.json({ link, error: e instanceof UnsafeUrlError ? e.message : "We couldn't download that link." }, { status: 400 });
  }

  const a = await assessCase({ claim: blankClaim("SPOT-CHECK"), photos: [{ name: "spot-check.jpg", data }], settings: DEFAULT_SETTINGS, model });
  if (!a.ok) return Response.json({ link, ok: false, failure: a.failure, seconds: a.timings.totalMs / 1000 });
  const d = a.decision;
  const e = d.requiredOutputs.estimate;
  return Response.json({
    link,
    ok: true,
    route: d.routeLabel,
    vehicle: { make: d.requiredOutputs.vehicle.make.value, model: d.requiredOutputs.vehicle.model.value, colour: d.requiredOutputs.vehicle.colour.value, how: a.extraction.vehicle.identification_evidence },
    damage: d.requiredOutputs.damageSummary,
    estimate: e.status === "withheld" ? `withheld: ${e.note}` : `${e.lowUsd} to ${e.highUsd} (${e.status})${e.status === "provisional" ? `: ${e.note}` : ""}`,
    reasons: d.reasons.map((r) => `${r.id} ${r.title}`),
    seconds: a.timings.totalMs / 1000,
    costUsd: a.meta.costUsd,
    model: a.meta.modelServed,
  });
}
