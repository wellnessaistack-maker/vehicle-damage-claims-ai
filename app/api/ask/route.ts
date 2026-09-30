// POST /api/ask: a reviewer's question about a case, answered from its photos and facts.

import { z } from "zod";

import { ask } from "@/lib/extraction/ask.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  question: z.string().min(1).max(1000),
  photos: z.array(z.object({ name: z.string().max(200), base64: z.string().min(1) })).max(8),
  facts: z.unknown(),
  route: z.string().max(100),
  reasons: z.array(z.string().max(1000)).max(40),
  history: z.array(z.object({ question: z.string().max(1000), answer: z.string().max(4000) })).max(10),
});

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "The server has no API key configured." }, { status: 503 });
  }
  let body;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "The question wasn't in the expected format." }, { status: 400 });
  }
  try {
    return Response.json(await ask(body));
  } catch {
    return Response.json({ error: "The AI couldn't answer right now. Try again in a moment." }, { status: 502 });
  }
}
