/**
 * Store types with visibility model.
 *
 * Every entity carries a `visibility` field from the ordered set:
 * public < team < confidential < restricted
 *
 * Agents have a `clearanceLevel` that determines the maximum visibility
 * they can read. The store filters automatically — agents never see
 * data above their clearance.
 */

import type { VisibilityLevel } from "../config.js";

export type { VisibilityLevel };

/** Ordered mapping for visibility comparisons. */
export const VISIBILITY_ORDER: Record<VisibilityLevel, number> = {
  public: 0,
  team: 1,
  confidential: 2,
  restricted: 3,
};

// --- Confidentiality model ---

export type ConfidentialityMode = "normal" | "strict" | "flexible";

export interface BridgeInstructions {
  /** Human-readable instruction for handling confidentiality. Pre-computed by bridge based on project mode. */
  confidentiality: string;
  /** The project's confidentiality mode. */
  mode: ConfidentialityMode;
}

export interface BridgeMetadata {
  visibility: VisibilityLevel;
  senderClearance: VisibilityLevel;
  visibilityCapped: boolean;
  originalVisibility?: VisibilityLevel;
  timestamp: string;
  instructions: BridgeInstructions;
  /** True if this is a directed message (whisper) — only recipients can see it. */
  whisper?: boolean;
  /** Agent IDs who can see this whisper message (includes sender implicitly). */
  recipients?: string[];
}

export interface AgentHighWaterMark {
  agentId: string;
  projectId: string;
  maxVisibility: VisibilityLevel;
  updatedAt: string;
}

export interface Agent {
  id: string;
  name: string;
  type: string;
  capabilities: string[];
  clearanceLevel: VisibilityLevel;
  apiKeyHash: string;
  lastSeenAt: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  visibility: VisibilityLevel;
  confidentialityMode: ConfidentialityMode;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryEntry {
  id: string;
  projectId: string;
  type: string;
  title: string;
  tags: string[];
  priority: string;
  visibility: VisibilityLevel;
  content: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  status: string;
  defaultVisibility: VisibilityLevel;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  conversationId: string;
  agentId: string;
  historyAccess: string;
  joinedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  fromAgent: string;
  type: string;
  visibility: VisibilityLevel;
  content: string;
  tags: string[];
  /** Whisper recipients (agent IDs). Null for broadcast messages. */
  recipients: string[] | null;
  /** @deprecated Use agentMetadata/bridgeMetadata */
  metadata: Record<string, unknown> | null;
  agentMetadata: Record<string, unknown> | null;
  bridgeMetadata: BridgeMetadata | null;
  createdAt: string;
}

// --- Creation types (omit auto-generated fields) ---

export interface AgentRegistration {
  name: string;
  type: string;
  capabilities: string[];
  clearanceLevel?: VisibilityLevel;
  apiKeyHash: string;
}

export interface CreateProject {
  name: string;
  description?: string;
  visibility?: VisibilityLevel;
  confidentialityMode?: ConfidentialityMode;
  createdBy: string;
}

export interface CreateMemoryEntry {
  projectId: string;
  type: string;
  title: string;
  tags: string[];
  content: string;
  priority?: string;
  visibility?: VisibilityLevel;
  createdBy: string;
}

export interface CreateConversation {
  projectId: string;
  title: string;
  defaultVisibility?: VisibilityLevel;
  createdBy: string;
}

export interface CreateMessage {
  conversationId: string;
  fromAgent: string;
  type?: string;
  visibility?: VisibilityLevel;
  content: string;
  tags?: string[];
  /** Whisper recipients (agent IDs). If set, only these agents + sender can see the message. */
  recipients?: string[];
  metadata?: Record<string, unknown>;
}

export interface SubscribeOptions {
  historyAccess?: "full" | "from_join";
}

// --- Access Requests ---

export type AccessRequestStatus = "pending" | "approved" | "denied" | "silent_denied";

export interface AccessRequest {
  id: string;
  conversationId: string;
  agentId: string;
  agentName: string;
  message: string | null;
  status: AccessRequestStatus;
  respondedBy: string | null;
  createdAt: string;
  respondedAt: string | null;
}

export interface CreateAccessRequest {
  conversationId: string;
  agentId: string;
  agentName: string;
  message?: string;
}

export interface MemoryFilters {
  type?: string;
  tags?: string[];
  limit?: number;
}

export interface GetMessagesOptions {
  since?: string;
  unreadOnly?: boolean;
  limit?: number;
  tags?: string[];
  fromAgent?: string;
}

// --- Tasks ---

export type TaskStatus = "open" | "claimed" | "completed" | "cancelled";

export interface Task {
  id: string;
  projectId: string;
  conversationId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  requiredCapabilities: string[];
  createdBy: string;
  claimedBy: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  result: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTask {
  projectId: string;
  conversationId?: string;
  title: string;
  description?: string;
  requiredCapabilities?: string[];
  createdBy: string;
}

export interface TaskFilters {
  status?: TaskStatus;
  claimedBy?: string;
  capability?: string;
}

// --- Instructions (scope × selector matrix) ---

export type InstructionScope = "bridge" | "project" | "conversation";

export interface InstructionSelector {
  /** Match agents of this type (e.g. "claude-code", "ollama"). */
  type?: string;
  /** Match agents with this capability (e.g. "code-execution"). */
  capability?: string;
}

export interface Instruction {
  id: string;
  scope: InstructionScope;
  scopeId: string | null;
  selector: InstructionSelector | null;
  content: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInstruction {
  scope: InstructionScope;
  scopeId?: string;
  selector?: InstructionSelector;
  content: string;
  createdBy: string;
}

// --- Agent Memory (private per-agent scratchpad) ---

export type AgentMemoryScope = "global" | "project" | "conversation";

export interface AgentMemory {
  agentId: string;
  scope: AgentMemoryScope;
  scopeId: string | null;
  content: string;
  updatedAt: string;
}
