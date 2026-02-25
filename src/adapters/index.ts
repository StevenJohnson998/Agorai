import type { IAgentAdapter } from "./base.js";
import type { AgentConfig } from "../config.js";
import { ClaudeAdapter } from "./claude.js";
import { GeminiAdapter } from "./gemini.js";
import { OllamaAdapter } from "./ollama.js";
import { createLogger } from "../logger.js";

const log = createLogger("adapters");

/**
 * Create the right adapter based on agent config.
 *
 * - If `model` is set → Ollama HTTP adapter
 * - If `command` is set → CLI adapter (Claude, Gemini, or generic)
 * - Otherwise → error
 */
export function createAdapter(config: AgentConfig): IAgentAdapter {
  // Ollama: has a model field
  if (config.model) {
    log.debug("creating OllamaAdapter for", config.name, "model=" + config.model);
    return new OllamaAdapter(config);
  }

  // CLI-based: pick adapter based on command name
  if (config.command) {
    log.debug("creating CLI adapter for", config.name, "command=" + config.command);
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

  throw new Error(
    `Agent "${config.name}": must have either "command" (CLI) or "model" (Ollama) configured.`
  );
}

export { ClaudeAdapter } from "./claude.js";
export { GeminiAdapter } from "./gemini.js";
export { OllamaAdapter } from "./ollama.js";
export type { IAgentAdapter, AgentResponse, AgentInvokeOptions } from "./base.js";
