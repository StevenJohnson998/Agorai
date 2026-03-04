/**
 * Keryx — Discussion Manager types.
 *
 * Keryx manages PROCESS, never creates CONTENT.
 * All synthesis/summaries are delegated to participating agents.
 */

// --- Round lifecycle ---

export type RoundStatus =
  | "idle"
  | "open"
  | "collecting"
  | "synthesizing"
  | "closed"
  | "interrupted";

export interface Round {
  id: number;
  topic: string;
  status: RoundStatus;
  openedAt: number;
  closedAt?: number;
  /** Message ID that triggered this round (human message). */
  triggerMessageId: string;
  /** Agent IDs expected to respond (subscribers minus keryx). */
  expectedAgents: Set<string>;
  /** Agent IDs that have responded in this round. */
  respondedAgents: Set<string>;
  /** Message IDs of responses in this round. */
  responseMessageIds: string[];
  /** Timeout handle for the round timer. */
  timeoutHandle?: ReturnType<typeof setTimeout>;
  /** Current escalation level (0 = none, 1 = nudge, 2 = backup, 3 = human). */
  escalationLevel: number;
  /** Agent ID that interrupted this round (if any). */
  interruptedBy?: string;
  /** Synthesis message ID (if received). */
  synthesisMessageId?: string;
}

// --- Conversation state ---

export interface ConversationState {
  conversationId: string;
  projectId: string;
  currentRound: Round | null;
  roundHistory: Round[];
  /** Timestamp of last processed message (bootstrap marker). */
  lastSeenAt: number;
  /** Whether Keryx is paused for this conversation. */
  paused: boolean;
  /** Whether Keryx is disabled for this conversation. */
  disabled: boolean;
  /** Rolling message window for pattern detection. */
  messageWindow: WindowMessage[];
}

export interface WindowMessage {
  id: string;
  fromAgent: string;
  content: string;
  timestamp: number;
}

// --- Agent profile (for timing) ---

export interface AgentProfile {
  agentId: string;
  /** Rolling average response time in ms. */
  avgResponseTimeMs: number;
  /** Number of responses tracked. */
  responseCount: number;
}

// --- Config ---

export interface KeryxConfig {
  enabled: boolean;
  baseTimeoutMs: number;
  nudgeAfterMs: number;
  maxRoundsPerTopic: number;
  synthesisCapability: string;
  healthWindowSize: number;
}

// --- Intervention types ---

export type InterventionType =
  | "round_open"
  | "round_close"
  | "synthesis_request"
  | "nudge"
  | "escalate_to_human"
  | "interrupt"
  | "onboarding_request"
  | "loop_detected"
  | "drift_detected"
  | "domination_warning"
  | "paused"
  | "resumed";
