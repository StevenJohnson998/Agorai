import type { IAgentAdapter } from "./base.js";
import type { AgentConfig } from "../config.js";
import { ClaudeAdapter } from "./claude.js";
import { GeminiAdapter } from "./gemini.js";
import { OllamaAdapter } from "./ollama.js";
import { OpenAICompatAdapter } from "./openai-compat.js";
import { createLogger } from "../logger.js";

const log = createLogger("adapters");

/**
 * Create the right adapter based on agent config.
 *
 * Selection order:
 * 1. Explicit `type` field (if set)
 * 2. Auto-detect: `model` → Ollama, `command` → CLI
 */
export function createAdapter(config: AgentConfig): IAgentAdapter {
  // Explicit type takes priority
  if (config.type === "openai-compat") {
    log.debug("creating OpenAICompatAdapter for", config.name, "model=" + config.model);
    return new OpenAICompatAdapter(config);
  }

  if (config.type === "ollama") {
    log.debug("creating OllamaAdapter for", config.name, "model=" + config.model);
    return new OllamaAdapter(config);
  }

  if (config.type === "cli") {
    log.debug("creating CLI adapter for", config.name, "command=" + config.command);
    return createCliAdapter(config);
  }

  // Auto-detect from fields (backward compat)
  if (config.model) {
    log.debug("creating OllamaAdapter for", config.name, "model=" + config.model);
    return new OllamaAdapter(config);
  }

  if (config.command) {
    log.debug("creating CLI adapter for", config.name, "command=" + config.command);
    return createCliAdapter(config);
  }

  throw new Error(
    `Agent "${config.name}": must have "type", "command" (CLI), or "model" (Ollama/OpenAI-compat) configured.`
  );
}

function createCliAdapter(config: AgentConfig): IAgentAdapter {
  switch (config.command) {
    case "claude":
      return new ClaudeAdapter(config);
    case "gemini":
      return new GeminiAdapter(config);
    default:
      // Generic CLI — use Claude adapter as base (same exec pattern)
      return new ClaudeAdapter(config);
  }
}

export { ClaudeAdapter } from "./claude.js";
export { GeminiAdapter } from "./gemini.js";
export { OllamaAdapter } from "./ollama.js";
export { OpenAICompatAdapter } from "./openai-compat.js";
export type { IAgentAdapter, AgentResponse, AgentInvokeOptions } from "./base.js";
