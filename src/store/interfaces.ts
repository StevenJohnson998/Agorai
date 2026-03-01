/**
 * Store interface.
 *
 * All read operations that return user-visible data take an `agentId` parameter.
 * The store looks up the agent's `clearanceLevel` and filters results automatically.
 * The agent never knows hidden data exists.
 */

import type {
  Agent,
  AgentRegistration,
  Project,
  CreateProject,
  MemoryEntry,
  CreateMemoryEntry,
  MemoryFilters,
  Conversation,
  CreateConversation,
  Subscription,
  SubscribeOptions,
  Message,
  CreateMessage,
  GetMessagesOptions,
} from "./types.js";
import type { StoreEventBus } from "./events.js";

export interface IStore {
  /** Event bus for reactive notifications. Optional for backward compat. */
  readonly eventBus?: StoreEventBus;
  // --- Agents ---
  registerAgent(agent: AgentRegistration): Promise<Agent>;
  getAgent(id: string): Promise<Agent | null>;
  getAgentByApiKey(keyHash: string): Promise<Agent | null>;
  listAgents(): Promise<Agent[]>;
  updateAgentLastSeen(id: string): Promise<void>;
  removeAgent(id: string): Promise<boolean>;

  // --- Projects (filtered by agent clearance) ---
  createProject(project: CreateProject): Promise<Project>;
  getProject(id: string, agentId: string): Promise<Project | null>;
  listProjects(agentId: string): Promise<Project[]>;

  // --- Project Memory (filtered by agent clearance) ---
  setMemory(entry: CreateMemoryEntry): Promise<MemoryEntry>;
  getMemory(projectId: string, agentId: string, filters?: MemoryFilters): Promise<MemoryEntry[]>;
  getMemoryEntry(id: string): Promise<MemoryEntry | null>;
  deleteMemory(id: string): Promise<boolean>;

  // --- Conversations ---
  createConversation(conv: CreateConversation): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | null>;
  listConversations(projectId: string, agentId: string): Promise<Conversation[]>;

  // --- Subscriptions ---
  subscribe(conversationId: string, agentId: string, opts?: SubscribeOptions): Promise<void>;
  unsubscribe(conversationId: string, agentId: string): Promise<void>;
  getSubscribers(conversationId: string): Promise<Subscription[]>;
  isSubscribed(conversationId: string, agentId: string): Promise<boolean>;

  // --- Messages (filtered by agent clearance) ---
  sendMessage(msg: CreateMessage): Promise<Message>;
  getMessages(conversationId: string, agentId: string, opts?: GetMessagesOptions): Promise<Message[]>;
  markRead(messageIds: string[], agentId: string): Promise<void>;
  getUnreadCount(agentId: string): Promise<number>;

  // --- Lifecycle ---
  initialize(): Promise<void>;
  close(): Promise<void>;
}
