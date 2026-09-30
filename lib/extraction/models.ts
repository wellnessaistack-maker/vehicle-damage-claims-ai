// Models the prototype can use, with list prices for the cost-per-case figure.
// Prices are US dollars per million tokens (first-party API list price).

export interface ModelInfo {
  id: string;
  label: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
}

export const MODELS: ModelInfo[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2 },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2 },
];

export const DEFAULT_MODEL = "claude-opus-5-5";

export function modelFromEnv(): string {
  const m = process.env.CLAUDE_MODEL?.trim();
  return m && MODELS.some((x) => x.id === m) ? m : DEFAULT_MODEL;
}

export function modelInfo(id: string): ModelInfo {
  return MODELS.find((m) => id.startsWith(m.id)) ?? MODELS[0];
}

export function costUsd(
  modelId: string,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null },
): number {
  const m = modelInfo(modelId);
  // Cache writes are billed at 1.25x input; approximate but close enough for a per-case figure.
  const input = usage.input_tokens + 1.25 * (usage.cache_creation_input_tokens ?? 0);
  const cached = usage.cache_read_input_tokens ?? 0;
  return (input * m.inputPerMTok + cached * m.cacheReadPerMTok + usage.output_tokens * m.outputPerMTok) / 1_000_000;
}
