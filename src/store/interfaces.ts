/**
 * Store interface.
 *
 * All read operations that return user-visible data take an `agentId` parameter.
 * The store looks up the agent's `clearanceLevel` and filters results automatically.
 * The agent never knows hidden data exists.
 */

import type {
  Agent,
  AgentStatus,
  AgentRegistration,
  AgentHighWaterMark,
  Project,
  CreateProject,
  ProjectMember,
  ProjectRole,
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
  SkillFilters,
  SkillFile,
  User,
  CreateUser,
  Session,
  UserStatus,
  VerbosityLevel,
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
  findAgentsByCapability(capability: string): Promise<Agent[]>;
  updateAgentLastSeen(id: string): Promise<void>;
  updateAgentStatus(id: string, status: AgentStatus, statusMessage?: string): Promise<void>;
  removeAgent(id: string): Promise<boolean>;

  // --- Projects (filtered by agent clearance) ---
  createProject(project: CreateProject): Promise<Project>;
  getProject(id: string, agentId: string): Promise<Project | null>;
  listProjects(agentId: string): Promise<Project[]>;
  deleteProject(id: string): Promise<void>;
  renameProject(id: string, name: string): Promise<void>;

  // --- Project Members ---
  addMember(projectId: string, agentId: string, role?: ProjectRole): Promise<ProjectMember>;
  removeMember(projectId: string, agentId: string): Promise<boolean>;
  listMembers(projectId: string): Promise<ProjectMember[]>;
  isMember(projectId: string, agentId: string): Promise<boolean>;
  isHumanAgent(agentId: string): Promise<boolean>;

  // --- Project Memory (filtered by agent clearance) ---
  setMemory(entry: CreateMemoryEntry): Promise<MemoryEntry>;
  getMemory(projectId: string, agentId: string, filters?: MemoryFilters): Promise<MemoryEntry[]>;
  getMemoryEntry(id: string): Promise<MemoryEntry | null>;
  deleteMemory(id: string): Promise<boolean>;

  // --- Conversations ---
  createConversation(conv: CreateConversation): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | null>;
  listConversations(projectId: string, agentId: string): Promise<Conversation[]>;
  deleteConversation(id: string): Promise<void>;
  renameConversation(id: string, title: string): Promise<void>;

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

  // --- Access Requests ---
  createAccessRequest(req: CreateAccessRequest): Promise<AccessRequest>;
  getAccessRequest(id: string): Promise<AccessRequest | null>;
  listAccessRequestsForConversation(conversationId: string): Promise<AccessRequest[]>;
  listAccessRequestsByAgent(agentId: string): Promise<AccessRequest[]>;
  respondToAccessRequest(id: string, status: AccessRequestStatus, respondedBy: string): Promise<AccessRequest | null>;
  hasPendingAccessRequest(conversationId: string, agentId: string): Promise<boolean>;

  // --- Tasks ---
  createTask(task: CreateTask): Promise<Task>;
  getTask(id: string): Promise<Task | null>;
  listTasks(projectId: string, agentId: string, filters?: TaskFilters): Promise<Task[]>;
  claimTask(id: string, agentId: string): Promise<Task | null>;
  completeTask(id: string, agentId: string, result?: string): Promise<Task | null>;
  releaseTask(id: string, agentId: string): Promise<Task | null>;
  updateTask(id: string, agentId: string, updates: { title?: string; description?: string; status?: TaskStatus }): Promise<Task | null>;

  // --- Skills (progressive disclosure) ---
  setSkill(skill: CreateSkill): Promise<Skill>;
  getSkill(id: string): Promise<Skill | null>;
  listSkills(scope: SkillScope, scopeId?: string, filters?: SkillFilters): Promise<Skill[]>;
  getMatchingSkills(agent: { name: string; type: string; capabilities: string[] }, conversationId: string): Promise<Skill[]>;
  deleteSkill(id: string): Promise<boolean>;

  // --- Skill Files ---
  setSkillFile(skillId: string, filename: string, content: string): Promise<SkillFile>;
  getSkillFile(skillId: string, filename: string): Promise<SkillFile | null>;
  listSkillFiles(skillId: string): Promise<{ filename: string; updatedAt: string }[]>;

  // --- Agent Memory (private per-agent scratchpad) ---
  setAgentMemory(agentId: string, scope: AgentMemoryScope, content: string, scopeId?: string): Promise<AgentMemory>;
  getAgentMemory(agentId: string, scope: AgentMemoryScope, scopeId?: string): Promise<AgentMemory | null>;
  deleteAgentMemory(agentId: string, scope: AgentMemoryScope, scopeId?: string): Promise<boolean>;

  // --- High-water marks (passive tracking) ---
  getHighWaterMark(agentId: string, projectId: string): Promise<AgentHighWaterMark | null>;

  // --- GUI Users & Sessions ---
  createUser(data: CreateUser): Promise<User>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  updateUserStatus(id: string, status: UserStatus, approvedBy?: string): Promise<User | null>;
  updateUserVerbosity(id: string, verbosity: VerbosityLevel): Promise<User | null>;
  createSession(userId: string, ip?: string, userAgent?: string): Promise<string>;
  getSession(sessionId: string): Promise<(Session & { user: User }) | null>;
  deleteSession(sessionId: string): Promise<void>;
  cleanExpiredSessions(): Promise<number>;
  updateSessionActivity(sessionId: string): Promise<void>;
  incrementFailedLogins(userId: string): Promise<void>;
  resetFailedLogins(userId: string): Promise<void>;
  deleteUser(id: string): Promise<boolean>;

  // --- Lifecycle ---
  initialize(): Promise<void>;
  close(): Promise<void>;
}
