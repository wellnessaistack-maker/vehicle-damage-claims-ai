// GET /api/health: is the server configured? Never returns the key itself.

import { modelFromEnv } from "@/lib/extraction/models.ts";
import { PROMPT_VERSION } from "@/lib/extraction/prompt.ts";
import { PROTOCOL_VERSION } from "@/lib/policy/protocol.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    model: modelFromEnv(),
    promptVersion: PROMPT_VERSION,
    protocolVersion: PROTOCOL_VERSION,
  });
}
