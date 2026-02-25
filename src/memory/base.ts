/**
 * Memory and Blackboard interfaces.
 *
 * The Blackboard is the shared knowledge store across all debate sessions.
 * It has two spaces:
 * - Private (default): all data stays here unless explicitly promoted
 * - Public (opt-in): shared with external agents, requires user validation
 *
 * All data is partitioned by project. A project groups related debates,
 * context entries, and decisions. State is auto-persisted — every mutation
 * is written to the Blackboard immediately. You just switch projects and
 * everything is there when you come back. No manual save/suspend needed.
 */

export type Visibility = "private" | "public";

export interface ProjectRecord {
  id: string;
  name: string;
  description?: string;
  /** Explicitly archived by user. Otherwise, projects are always available. */
  archived: boolean;
  /** Default thoroughness for debates in this project */
  thoroughness: number;
  /** Default agents for this project (names) */
  agents: string[];
  /** Arbitrary project-level metadata (goals, notes, etc.) */
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** Auto-updated on every operation — used for sorting "most recent" */
  lastActiveAt: string;
}

export interface MemoryEntry {
  id: string;
  projectId: string;
  key: string;
  value: string;
  visibility: Visibility;
  debateId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DebateRecord {
  id: string;
  projectId: string;
  prompt: string;
  mode: "quick" | "full";
  status: "running" | "completed" | "failed";
  thoroughness: number;
  participants: string[];
  rounds: RoundRecord[];
  result?: DebateResult;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
}

export interface RoundRecord {
  roundNumber: number;
  responses: ParticipantResponse[];
  summary?: string;
}

export interface ParticipantResponse {
  agent: string;
  persona?: string;
  content: string;
  confidence: number;
  /** Trust score from agent-registry (reserved for future use) */
  trustScore?: number;
  durationMs: number;
}

export interface DebateResult {
  consensus: string;
  dissent?: string;
  confidenceScore: number;
  protocol: "vote" | "debate" | "quorum";
}

/**
 * Low-level memory backend (key-value + debate records + projects).
 *
 * All context and debate operations are scoped to a project.
 * State is auto-persisted: every write operation is committed immediately.
 * Switching projects is just changing a pointer — no save/load ceremony.
 */
export interface IMemoryBackend {
  // Project lifecycle
  createProject(project: Omit<ProjectRecord, "id" | "createdAt" | "updatedAt" | "lastActiveAt">): Promise<ProjectRecord>;
  getProject(id: string): Promise<ProjectRecord | null>;
  /** List projects sorted by lastActiveAt (most recent first). Set archived=true to include archived. */
  listProjects(includeArchived?: boolean): Promise<ProjectRecord[]>;
  updateProject(id: string, updates: Partial<Pick<ProjectRecord, "name" | "description" | "archived" | "thoroughness" | "agents" | "metadata">>): Promise<ProjectRecord>;

  // Key-value context (scoped to project)
  // Every write auto-updates the project's lastActiveAt.
  get(projectId: string, key: string, visibility?: Visibility): Promise<MemoryEntry | null>;
  set(projectId: string, key: string, value: string, visibility?: Visibility): Promise<void>;
  delete(projectId: string, key: string): Promise<boolean>;
  list(projectId: string, visibility?: Visibility): Promise<MemoryEntry[]>;

  // Debate records (scoped to project)
  // Every write auto-updates the project's lastActiveAt.
  saveDebate(debate: DebateRecord): Promise<void>;
  getDebate(id: string): Promise<DebateRecord | null>;
  listDebates(projectId: string, visibility?: Visibility): Promise<DebateRecord[]>;
}

/**
 * Blackboard: memory backend + privacy controls.
 *
 * Auto-persist model: all mutations are written immediately to SQLite.
 * Projects don't need to be "saved" or "loaded" — they're always there.
 * Switch between projects freely, come back anytime, full state preserved.
 *
 * This is the foundation for collaborative workflows — multiple people
 * or agents can work on different projects, switch between them,
 * and pick up where they left off. No ceremony, no lost context.
 */
export interface IBlackboard extends IMemoryBackend {
  /**
   * Touch a project — update lastActiveAt to now.
   * Called automatically on every scoped operation.
   */
  touchProject(projectId: string): Promise<void>;

  /**
   * Promote a debate or entry from private to public.
   * Returns false if sensitive data is detected (caller must handle).
   */
  promote(id: string): Promise<{ ok: boolean; sensitiveFindings?: string[] }>;

  /**
   * Demote a debate or entry from public back to private.
   */
  demote(id: string): Promise<void>;

  /**
   * Scan text for sensitive patterns (emails, API keys, IPs, passwords).
   */
  scanForSensitiveData(text: string): string[];
}
