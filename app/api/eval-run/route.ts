// GET /api/eval-run?model=claude-opus-5-5&repeat=1
// Runs the labelled evaluation set on the server. Disabled on the public
// production deployment so nobody can spend the API budget; it works locally
// and on preview deployments, which sit behind Vercel's login.

import { MODELS } from "@/lib/extraction/models.ts";
import { runEvaluation } from "@/lib/eval/run-all.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (process.env.VERCEL_ENV === "production") {
    return Response.json({ error: "The evaluation runner is turned off in production. Run it locally or on a preview deployment." }, { status: 403 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "No API key configured." }, { status: 503 });
  }
  const url = new URL(req.url);
  const model = url.searchParams.get("model") ?? MODELS[0].id;
  if (!MODELS.some((m) => m.id === model)) return Response.json({ error: "Unknown model." }, { status: 400 });
  const repeat = Math.min(3, Math.max(1, Number(url.searchParams.get("repeat") ?? 1)));
  const only = url.searchParams.get("cases")?.split(",").filter(Boolean);
  const run = await runEvaluation({ model, repeat, only, concurrency: 8 });
  return Response.json(run);
}
