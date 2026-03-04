/**
 * Agorai — public API.
 *
 * This module re-exports the key types and classes for programmatic use
 * of Agorai as a library (e.g. embedding a bridge + internal agent in
 * your own Node.js application).
 */

// --- Store ---
export { SqliteStore } from "./store/sqlite.js";
export { StoreEventBus } from "./store/events.js";
export type { MessageCreatedEvent, AccessRequestCreatedEvent, TaskCreatedEvent, TaskUpdatedEvent } from "./store/events.js";
export type { IStore } from "./store/interfaces.js";
export type {
  Agent,
  AgentRegistration,
  AgentHighWaterMark,
  Project,
  CreateProject,
  Conversation,
  CreateConversation,
  Message,
  CreateMessage,
  GetMessagesOptions,
  MemoryEntry,
  CreateMemoryEntry,
  MemoryFilters,
  Subscription,
  SubscribeOptions,
  VisibilityLevel,
  BridgeMetadata,
  BridgeInstructions,
  ConfidentialityMode,
  AccessRequest,
  AccessRequestStatus,
  CreateAccessRequest,
  Task,
  CreateTask,
  TaskFilters,
  TaskStatus,
  AgentMemory,
  AgentMemoryScope,
  Skill,
  CreateSkill,
  SkillScope,
  SkillSelector,
  SkillMetadata,
  SkillFile,
  SkillFilters,
} from "./store/types.js";

// --- Bridge ---
export { startBridgeServer } from "./bridge/server.js";
export { ApiKeyAuthProvider, hashApiKey } from "./bridge/auth.js";
export type { AuthResult, IAuthProvider } from "./bridge/auth.js";
export type { BridgeServerOptions } from "./bridge/server.js";

// --- Adapters ---
export { createAdapter } from "./adapters/index.js";
export type { IAgentAdapter, AgentResponse, AgentInvokeOptions } from "./adapters/base.js";

// --- Debate ---
export { DebateSession } from "./orchestrator.js";
export type { DebateMode, DebateOptions, DebateSessionResult } from "./orchestrator.js";

// --- Config ---
export { loadConfig, getUserDataDir } from "./config.js";
export type { Config, AgentConfig, PersonaConfig, BridgeConfig } from "./config.js";

// --- Internal Agent ---
export { runInternalAgent } from "./agent/internal-agent.js";
export type { InternalAgentOptions } from "./agent/internal-agent.js";

// --- Agent Context ---
export { buildAgentContext, buildBridgeRules, renderForPrompt, renderForMcpInstructions } from "./agent/context.js";
export type { AgentContext, BridgeRules, BuildContextOptions } from "./agent/context.js";

// --- Keryx (Discussion Manager) ---
export { KeryxModule } from "./keryx/index.js";
export type { KeryxConfig, RoundStatus, Round, ConversationState, InterventionType } from "./keryx/types.js";
