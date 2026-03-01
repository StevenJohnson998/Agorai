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
  metadata?: Record<string, unknown>;
}

export interface SubscribeOptions {
  historyAccess?: "full" | "from_join";
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
}
