// One AI call per case: every photo in the case goes in, the fixed-format
// extraction comes out. The format is enforced by the API (structured outputs)
// and checked again here with the same schema. If the result is still unusable
// after one retry, the case goes to manual triage; we never guess.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { costUsd, modelFromEnv } from "./models.ts";
import { PROMPT_VERSION, SYSTEM_PROMPT } from "./prompt.ts";
import { extractionSchema, type Extraction } from "./schema.ts";

export type FailureKind = "no_api_key" | "timeout" | "rate_limited" | "api_error" | "refused" | "invalid_output";

export class ExtractionError extends Error {
  constructor(
    public kind: FailureKind,
    message: string,
    public simulated = false,
  ) {
    super(message);
  }
}

export interface ExtractionMeta {
  modelRequested: string;
  modelServed: string;
  fallbackUsed: boolean;
  promptVersion: string;
  attempts: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface PhotoInput {
  name: string;
  /** JPEG bytes, already normalised. */
  jpeg: Buffer;
}

export type SimulatedFailure = "timeout" | "invalid_output";

const TIMEOUT_MS = 45_000;

export async function extract(
  photos: PhotoInput[],
  opts: { model?: string; simulate?: SimulatedFailure } = {},
): Promise<{ extraction: Extraction; meta: ExtractionMeta }> {
  const model = opts.model ?? modelFromEnv();

  if (opts.simulate === "timeout") {
    throw new ExtractionError("timeout", "Simulated: the AI service didn't respond in time.", true);
  }
  if (opts.simulate === "invalid_output") {
    throw new ExtractionError("invalid_output", "Simulated: the AI returned something that didn't match the required format.", true);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ExtractionError("no_api_key", "The server has no ANTHROPIC_API_KEY configured.");
  }

  const client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  photos.forEach((p, i) => {
    content.push({ type: "text", text: `Photo ${i + 1} of ${photos.length}: ${p.name}` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: p.jpeg.toString("base64") } });
  });
  content.push({
    type: "text",
    text: `Report what you can see in ${photos.length === 1 ? "this photo" : `these ${photos.length} photos`}.`,
  });

  const started = Date.now();
  let attempts = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  let lastProblem = "";

  while (attempts < 2) {
    attempts++;
    let response;
    try {
      response = await client.beta.messages.parse({
        model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        output_config: { effort: "low", format: betaZodOutputFormat(extractionSchema) },
        messages: [{ role: "user", content }],
      });
    } catch (err) {
      throw toExtractionError(err);
    }

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    cost += costUsd(response.model, response.usage);

    if (response.stop_reason === "refusal") {
      throw new ExtractionError("refused", "The AI declined to assess these photos.");
    }
    if (response.stop_reason === "max_tokens") {
      lastProblem = "The AI's answer was cut off before it finished.";
      continue;
    }
    const parsed = extractionSchema.safeParse(response.parsed_output);
    if (!parsed.success) {
      lastProblem = "The AI's answer didn't match the required format.";
      continue;
    }

    const fallbackUsed = response.content.some((b) => b.type === "fallback") || response.model !== model;
    return {
      extraction: parsed.data,
      meta: {
        modelRequested: model,
        modelServed: response.model,
        fallbackUsed,
        promptVersion: PROMPT_VERSION,
        attempts,
        latencyMs: Date.now() - started,
        inputTokens,
        outputTokens,
        costUsd: round4(cost),
      },
    };
  }
  throw new ExtractionError("invalid_output", `${lastProblem} Tried twice.`);
}

function toExtractionError(err: unknown): ExtractionError {
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new ExtractionError("timeout", "The AI service didn't respond in time.");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ExtractionError("rate_limited", "The AI service is busy (rate limited).");
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return new ExtractionError("no_api_key", "The server's API key was rejected.");
  }
  if (err instanceof Anthropic.APIError) {
    return new ExtractionError("api_error", `The AI service returned an error${err.status ? ` (HTTP ${err.status})` : ""}.`);
  }
  return new ExtractionError("api_error", "The AI service couldn't be reached.");
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;
