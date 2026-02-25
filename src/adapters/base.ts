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
  /** Self-reported confidence score (0-1) */
  confidence: number;
  /** Token usage for this invocation (if available from the agent) */
  tokens?: TokenUsage;
  /** Raw output from the CLI for debugging */
  raw?: unknown;
  /** Execution time in milliseconds */
  durationMs: number;
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
