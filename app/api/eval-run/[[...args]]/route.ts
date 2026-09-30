// GET /api/eval-run/<model>/<case,case,...|all>/<repeat>
//   e.g. /api/eval-run/claude-opus-5-5/all/1
//
// Runs the labelled evaluation set on the server. Each run costs API credits,
// so on Vercel it needs a secret token as the first path segment
// (/api/eval-run/<EVAL_TOKEN>/<model>/...), and is off entirely if EVAL_TOKEN
// isn't set. Locally no token is needed.

import { MODELS } from "@/lib/extraction/models.ts";
import { runEvaluation } from "@/lib/eval/run-all.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request, ctx: { params: Promise<{ args?: string[] }> }) {
  let args = (await ctx.params).args ?? [];
  if (process.env.VERCEL_ENV) {
    const token = process.env.EVAL_TOKEN;
    if (!token || args[0] !== token) {
      return Response.json({ error: "The evaluation runner needs a valid token on this deployment. Run it locally with npm run eval." }, { status: 403 });
    }
    args = args.slice(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "No API key configured." }, { status: 503 });
  }
  const url = new URL(req.url);
  const [pModel, pCases, pRepeat] = args;
  const model = pModel ?? url.searchParams.get("model") ?? MODELS[0].id;
  if (!MODELS.some((m) => m.id === model)) return Response.json({ error: "Unknown model." }, { status: 400 });
  const repeat = Math.min(3, Math.max(1, Number(pRepeat ?? url.searchParams.get("repeat") ?? 1)));
  const casesArg = pCases ?? url.searchParams.get("cases") ?? "all";
  const only = casesArg === "all" ? undefined : casesArg.split(",").filter(Boolean);
  const run = await runEvaluation({ model, repeat, only, concurrency: 8 });
  return Response.json(run);
}
