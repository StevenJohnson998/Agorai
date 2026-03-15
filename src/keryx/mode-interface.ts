/**
 * Mode interface — common contract for all Keryx conversation modes.
 *
 * Modes:
 *   - socratic:    Turn-by-turn, each AI speaks in order
 *   - ecclesia:    Round-based parallel debate with synthesis/consensus
 *   - wild-agora:  FFA, no moderation, passive observation only
 */

import type { IStore } from "../store/interfaces.js";
import type { Agent, Message } from "../store/types.js";
import type { KeryxConfig, ConversationState, AgentProfile } from "./types.js";

/** Conversation mode identifier. */
export type ConversationMode = "socratic" | "ecclesia" | "wild-agora";

/**
 * Context object passed to mode handlers — provides access to shared
 * infrastructure without exposing the full KeryxModule.
 */
export interface ModeContext {
  readonly store: IStore;
  readonly config: KeryxConfig;
  readonly signal: AbortSignal;
  readonly keryxAgentId: string;
  readonly agentProfiles: Map<string, AgentProfile>;

  /** Send a Keryx status message to a conversation. */
  sendMessage(conversationId: string, content: string): Promise<Message>;

  /** Check if a message is from a human agent (cached). */
  isHumanMessage(message: Message): Promise<boolean>;

  /** Get non-keryx, non-moderator, non-human subscriber agent IDs + names. */
  getParticipantAgents(conversationId: string, excludeAgentId?: string): Promise<Array<{ id: string; name: string }>>;

  /** Update agent response time profile. */
  updateAgentProfile(agentId: string, responseTimeMs: number): void;

  /** Calculate adaptive timeout for a conversation. */
  calculateTimeout(state: ConversationState, topic: string, subscriberCount: number): number;

  /** Run pattern detection on conversation state. */
  runPatternDetection(state: ConversationState): Promise<void>;
}

/**
 * Interface that every conversation mode must implement.
 */
export interface ConversationModeHandler {
  /** Mode identifier. */
  readonly name: ConversationMode;

  /**
   * Handle an incoming message in this mode.
   * Called by the core module after filtering out Keryx's own messages and status messages.
   * The message has already been added to the rolling window.
   */
  handleMessage(message: Message, state: ConversationState, ctx: ModeContext): void;

  /**
   * Clean up mode-specific timers/state when a conversation is removed or mode changes.
   */
  cleanup(state: ConversationState): void;

  /**
   * Return the skill content describing this mode's protocol to agents.
   */
  getSkillContent(): string;

  /**
   * Return the skill summary (short description for tier-1 metadata).
   */
  getSkillSummary(): string;

  /**
   * Return the skill instructions (action guidance for agents).
   */
  getSkillInstructions(): string;
}
