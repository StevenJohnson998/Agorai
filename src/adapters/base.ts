/**
 * Agent adapter interface.
 *
 * An adapter wraps an AI agent (CLI-based or HTTP-based)
 * and provides a uniform interface for the orchestrator to invoke it.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Monetary cost if the adapter can report it (e.g. Claude returns cost_usd) */
  costUsd?: number;
}

export interface AgentResponse {
  /** The agent's text response */
  content: string;
  /** Self-reported confidence score (0-1), extracted from response text */
  confidence: number;
  /** Trust score from agent-registry (reserved for future use) */
  trustScore?: number;
  /** Token usage for this invocation (if available from the agent) */
  tokens?: TokenUsage;
  /** Raw output from the CLI for debugging */
  raw?: unknown;
  /** Execution time in milliseconds */
  durationMs: number;
}

/** Instruction appended to system/user prompts to request confidence self-report. */
export const CONFIDENCE_INSTRUCTION =
  "After your response, on a new line, state your confidence level in this exact format: [confidence: X.XX] where X.XX is between 0.00 and 1.00.";

/**
 * Extract self-reported confidence from response text.
 * Looks for a [confidence: X.XX] marker and strips it from the content.
 * Returns 0.5 as default if no marker is found.
 */
export function extractConfidence(text: string): { confidence: number; cleanContent: string } {
  const regex = /\n?\s*\[?confidence:\s*(0(?:\.\d+)?|1(?:\.0+)?)\]?\s*$/i;
  const match = text.match(regex);
  if (match) {
    const confidence = parseFloat(match[1]);
    const cleanContent = text.slice(0, match.index).trimEnd();
    return { confidence, cleanContent };
  }
  return { confidence: 0.5, cleanContent: text };
}

export type AdapterType = "cli" | "http";

/**
 * Calculate a dynamic timeout based on estimated response size.
 * CLI adapters (Claude, Gemini) have higher base but lower per-token cost.
 * HTTP adapters (Ollama) have lower base but allow longer max for large models.
 */
export function calculateTimeout(promptLength: number, type: AdapterType): number {
  const estimatedTokens = Math.ceil(promptLength / 4);
  if (type === "cli") {
    // base 30s + 20ms/token, max 5 min
    return Math.min(30_000 + estimatedTokens * 20, 300_000);
  }
  // http: base 15s + 15ms/token, max 10 min
  return Math.min(15_000 + estimatedTokens * 15, 600_000);
}

export interface AgentInvokeOptions {
  /** The prompt to send to the agent */
  prompt: string;
  /** Optional system prompt (persona) */
  systemPrompt?: string;
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

export interface IAgentAdapter {
  /** Unique name for this agent (e.g. "claude", "gemini") */
  readonly name: string;

  /** Check if the agent CLI is available on this system */
  isAvailable(): Promise<boolean>;

  /** Invoke the agent with a prompt and return its response */
  invoke(options: AgentInvokeOptions): Promise<AgentResponse>;
}
