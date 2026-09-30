// One place to build the API client. Some organisation-level API keys aren't
// tied to a workspace and need the workspace ID sent with every request; set
// ANTHROPIC_WORKSPACE_ID for those (or use a workspace-scoped key instead).

import Anthropic from "@anthropic-ai/sdk";

export function makeClient(opts: { timeout: number }): Anthropic {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic({
    timeout: opts.timeout,
    maxRetries: 1,
    defaultHeaders: workspace ? { "anthropic-workspace-id": workspace } : undefined,
  });
}
