// GET /api/eval-run/<model>/<case,case,...|all>/<repeat>
//   e.g. /api/eval-run/claude-opus-5-5/all/1
// (Query parameters ?model=&cases=&repeat= work too.)
// Runs the labelled evaluation set on the server. Disabled on the public
// production deployment so nobody can spend the API budget; it works locally
// and on preview deployments, which sit behind Vercel's login.

import { MODELS } from "@/lib/extraction/models.ts";
import { runEvaluation } from "@/lib/eval/run-all.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request, ctx: { params: Promise<{ args?: string[] }> }) {
  if (process.env.VERCEL_ENV === "production") {
    return Response.json({ error: "The evaluation runner is turned off in production. Run it locally or on a preview deployment." }, { status: 403 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "No API key configured." }, { status: 503 });
  }
  const url = new URL(req.url);
  const [pModel, pCases, pRepeat] = (await ctx.params).args ?? [];
  const model = pModel ?? url.searchParams.get("model") ?? MODELS[0].id;
  if (!MODELS.some((m) => m.id === model)) return Response.json({ error: "Unknown model." }, { status: 400 });
  const repeat = Math.min(3, Math.max(1, Number(pRepeat ?? url.searchParams.get("repeat") ?? 1)));
  const casesArg = pCases ?? url.searchParams.get("cases") ?? "all";
  const only = casesArg === "all" ? undefined : casesArg.split(",").filter(Boolean);
  const run = await runEvaluation({ model, repeat, only, concurrency: 8 });
  return Response.json(run);
}
