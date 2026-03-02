/**
 * SQLite store implementation using better-sqlite3.
 *
 * All read operations filter by the requesting agent's clearanceLevel.
 * Visibility is stored as text and compared via integer mapping.
 */

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { IStore } from "./interfaces.js";
import { StoreEventBus } from "./events.js";
import type {
  Agent,
  AgentRegistration,
  AgentHighWaterMark,
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
  Instruction,
  CreateInstruction,
  InstructionScope,
  InstructionSelector,
} from "./types.js";
import { VISIBILITY_ORDER } from "./types.js";

function visibilityToInt(v: VisibilityLevel): number {
  return VISIBILITY_ORDER[v];
}

/** UTC ISO 8601 timestamp. All timestamps stored as UTC; display conversion is the client's responsibility. */
function now(): string {
  return new Date().toISOString();
}

export class SqliteStore implements IStore {
  private db: Database.Database;
  readonly eventBus: StoreEventBus;

  constructor(dbPath: string, eventBus?: StoreEventBus) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.eventBus = eventBus ?? new StoreEventBus();
  }

  async initialize(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'custom',
        capabilities TEXT NOT NULL DEFAULT '[]',
        clearance_level TEXT NOT NULL DEFAULT 'team',
        api_key_hash TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        visibility TEXT NOT NULL DEFAULT 'team',
        confidentiality_mode TEXT NOT NULL DEFAULT 'normal',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_memory (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'note',
        title TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        priority TEXT NOT NULL DEFAULT 'normal',
        visibility TEXT NOT NULL DEFAULT 'team',
        content TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );
      CREATE INDEX IF NOT EXISTS idx_project_memory_project_type ON project_memory(project_id, type);

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        default_visibility TEXT NOT NULL DEFAULT 'team',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS conversation_agents (
        conversation_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        history_access TEXT NOT NULL DEFAULT 'full',
        joined_at TEXT NOT NULL,
        PRIMARY KEY (conversation_id, agent_id),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id),
        FOREIGN KEY (agent_id) REFERENCES agents(id)
      );
      CREATE INDEX IF NOT EXISTS idx_conversation_agents_agent ON conversation_agents(agent_id);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        from_agent TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'message',
        visibility TEXT NOT NULL DEFAULT 'team',
        content TEXT NOT NULL,
        metadata TEXT,
        agent_metadata TEXT,
        bridge_metadata TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);

      CREATE TABLE IF NOT EXISTS message_reads (
        message_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        read_at TEXT NOT NULL,
        PRIMARY KEY (message_id, agent_id),
        FOREIGN KEY (message_id) REFERENCES messages(id),
        FOREIGN KEY (agent_id) REFERENCES agents(id)
      );

      CREATE TABLE IF NOT EXISTS agent_high_water_marks (
        agent_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        max_visibility TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (agent_id, project_id),
        FOREIGN KEY (agent_id) REFERENCES agents(id),
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS access_requests (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        message TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        responded_by TEXT,
        created_at TEXT NOT NULL,
        responded_at TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id),
        FOREIGN KEY (agent_id) REFERENCES agents(id)
      );
      CREATE INDEX IF NOT EXISTS idx_access_requests_conv_status ON access_requests(conversation_id, status);
      CREATE INDEX IF NOT EXISTS idx_access_requests_agent_status ON access_requests(agent_id, status);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        conversation_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        required_capabilities TEXT NOT NULL DEFAULT '[]',
        created_by TEXT NOT NULL,
        claimed_by TEXT,
        claimed_at TEXT,
        completed_at TEXT,
        result TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (created_by) REFERENCES agents(id)
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);

      CREATE TABLE IF NOT EXISTS agent_memory (
        agent_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (agent_id, scope, scope_id),
        FOREIGN KEY (agent_id) REFERENCES agents(id)
      );

      CREATE TABLE IF NOT EXISTS instructions (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL DEFAULT '',
        selector_json TEXT NOT NULL DEFAULT '{}',
        content TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (created_by) REFERENCES agents(id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_instructions_scope_selector ON instructions(scope, scope_id, selector_json);
    `);

    // --- Schema migrations for existing databases ---
    this.migrateSchema();
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // --- Schema migration for existing databases ---

  private migrateSchema(): void {
    // Check if messages table has the new columns
    const msgCols = this.db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    const msgColNames = new Set(msgCols.map((c) => c.name));

    if (!msgColNames.has("agent_metadata")) {
      this.db.exec("ALTER TABLE messages ADD COLUMN agent_metadata TEXT");
      // Migrate existing metadata → agent_metadata for pre-migration data
      this.db.exec("UPDATE messages SET agent_metadata = metadata WHERE metadata IS NOT NULL");
    }
    if (!msgColNames.has("bridge_metadata")) {
      this.db.exec("ALTER TABLE messages ADD COLUMN bridge_metadata TEXT");
    }

    // Check if projects table has confidentiality_mode
    const projCols = this.db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
    const projColNames = new Set(projCols.map((c) => c.name));

    if (!projColNames.has("confidentiality_mode")) {
      this.db.exec("ALTER TABLE projects ADD COLUMN confidentiality_mode TEXT NOT NULL DEFAULT 'normal'");
    }

    // Check if messages table has tags column
    if (!msgColNames.has("tags")) {
      this.db.exec("ALTER TABLE messages ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
    }

    // Check if messages table has recipients column (whisper support)
    if (!msgColNames.has("recipients")) {
      this.db.exec("ALTER TABLE messages ADD COLUMN recipients TEXT");
    }
  }

  // --- Agent helpers ---

  private getAgentClearance(agentId: string): VisibilityLevel {
    const row = this.db.prepare("SELECT clearance_level FROM agents WHERE id = ?").get(agentId) as
      | { clearance_level: string }
      | undefined;
    if (!row) return "public";
    return row.clearance_level as VisibilityLevel;
  }

  private rowToAgent(row: Record<string, unknown>): Agent {
    return {
      id: row.id as string,
      name: row.name as string,
      type: row.type as string,
      capabilities: JSON.parse(row.capabilities as string),
      clearanceLevel: row.clearance_level as VisibilityLevel,
      apiKeyHash: row.api_key_hash as string,
      lastSeenAt: row.last_seen_at as string,
      createdAt: row.created_at as string,
    };
  }

  private rowToTask(row: Record<string, unknown>): Task {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      conversationId: (row.conversation_id as string) ?? null,
      title: row.title as string,
      description: (row.description as string) ?? null,
      status: row.status as TaskStatus,
      requiredCapabilities: JSON.parse((row.required_capabilities as string) || "[]"),
      createdBy: row.created_by as string,
      claimedBy: (row.claimed_by as string) ?? null,
      claimedAt: (row.claimed_at as string) ?? null,
      completedAt: (row.completed_at as string) ?? null,
      result: (row.result as string) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  // --- Agents ---

  async registerAgent(agent: AgentRegistration): Promise<Agent> {
    const existing = this.db.prepare("SELECT * FROM agents WHERE name = ?").get(agent.name) as
      | Record<string, unknown>
      | undefined;

    if (existing) {
      const ts = now();
      this.db.prepare(`
        UPDATE agents SET type = ?, capabilities = ?, clearance_level = ?, api_key_hash = ?, last_seen_at = ?
        WHERE name = ?
      `).run(
        agent.type,
        JSON.stringify(agent.capabilities),
        agent.clearanceLevel ?? "team",
        agent.apiKeyHash,
        ts,
        agent.name,
      );
      return this.rowToAgent({
        ...existing,
        type: agent.type,
        capabilities: JSON.stringify(agent.capabilities),
        clearance_level: agent.clearanceLevel ?? "team",
        api_key_hash: agent.apiKeyHash,
        last_seen_at: ts,
      });
    }

    const id = randomUUID();
    const ts = now();
    this.db.prepare(`
      INSERT INTO agents (id, name, type, capabilities, clearance_level, api_key_hash, last_seen_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      agent.name,
      agent.type,
      JSON.stringify(agent.capabilities),
      agent.clearanceLevel ?? "team",
      agent.apiKeyHash,
      ts,
      ts,
    );

    return {
      id,
      name: agent.name,
      type: agent.type,
      capabilities: agent.capabilities,
      clearanceLevel: agent.clearanceLevel ?? "team",
      apiKeyHash: agent.apiKeyHash,
      lastSeenAt: ts,
      createdAt: ts,
    };
  }

  async getAgent(id: string): Promise<Agent | null> {
    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToAgent(row) : null;
  }

  async getAgentByApiKey(keyHash: string): Promise<Agent | null> {
    const row = this.db.prepare("SELECT * FROM agents WHERE api_key_hash = ?").get(keyHash) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToAgent(row) : null;
  }

  async listAgents(): Promise<Agent[]> {
    const rows = this.db.prepare("SELECT * FROM agents ORDER BY name").all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToAgent(r));
  }

  async findAgentsByCapability(capability: string): Promise<Agent[]> {
    const agents = await this.listAgents();
    const lower = capability.toLowerCase();
    return agents.filter((a) => a.capabilities.some((c) => c.toLowerCase() === lower));
  }

  async updateAgentLastSeen(id: string): Promise<void> {
    this.db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(now(), id);
  }

  async removeAgent(id: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // --- Projects ---

  async createProject(project: CreateProject): Promise<Project> {
    const id = randomUUID();
    const ts = now();
    const confMode = project.confidentialityMode ?? "normal";
    this.db.prepare(`
      INSERT INTO projects (id, name, description, visibility, confidentiality_mode, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, project.name, project.description ?? null, project.visibility ?? "team", confMode, project.createdBy, ts, ts);

    return {
      id,
      name: project.name,
      description: project.description ?? null,
      visibility: project.visibility ?? "team",
      confidentialityMode: confMode,
      createdBy: project.createdBy,
      createdAt: ts,
      updatedAt: ts,
    };
  }

  async getProject(id: string, agentId: string): Promise<Project | null> {
    const clearance = this.getAgentClearance(agentId);
    const maxVis = visibilityToInt(clearance);
    const row = this.db.prepare(`
      SELECT * FROM projects WHERE id = ?
    `).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (visibilityToInt(row.visibility as VisibilityLevel) > maxVis) return null;
    return this.rowToProject(row);
  }

  async listProjects(agentId: string): Promise<Project[]> {
    const clearance = this.getAgentClearance(agentId);
    const rows = this.db.prepare(`
      SELECT * FROM projects ORDER BY updated_at DESC
    `).all() as Record<string, unknown>[];
    const maxVis = visibilityToInt(clearance);
    return rows
      .filter((r) => visibilityToInt(r.visibility as VisibilityLevel) <= maxVis)
      .map((r) => this.rowToProject(r));
  }

  private rowToProject(row: Record<string, unknown>): Project {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string | null,
      visibility: row.visibility as VisibilityLevel,
      confidentialityMode: (row.confidentiality_mode as ConfidentialityMode) ?? "normal",
      createdBy: row.created_by as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  // --- Project Memory ---

  async setMemory(entry: CreateMemoryEntry): Promise<MemoryEntry> {
    const id = randomUUID();
    const ts = now();
    this.db.prepare(`
      INSERT INTO project_memory (id, project_id, type, title, tags, priority, visibility, content, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.projectId,
      entry.type,
      entry.title,
      JSON.stringify(entry.tags),
      entry.priority ?? "normal",
      entry.visibility ?? "team",
      entry.content,
      entry.createdBy,
      ts,
      ts,
    );

    return {
      id,
      projectId: entry.projectId,
      type: entry.type,
      title: entry.title,
      tags: entry.tags,
      priority: entry.priority ?? "normal",
      visibility: entry.visibility ?? "team",
      content: entry.content,
      createdBy: entry.createdBy,
      createdAt: ts,
      updatedAt: ts,
    };
  }

  async getMemory(projectId: string, agentId: string, filters?: MemoryFilters): Promise<MemoryEntry[]> {
    const clearance = this.getAgentClearance(agentId);
    const maxVis = visibilityToInt(clearance);

    let sql = "SELECT * FROM project_memory WHERE project_id = ?";
    const params: unknown[] = [projectId];

    if (filters?.type) {
      sql += " AND type = ?";
      params.push(filters.type);
    }

    sql += " ORDER BY created_at DESC";

    // No SQL LIMIT — visibility and tag filters run in JS, so we need the full set first
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];

    let results = rows
      .filter((r) => visibilityToInt(r.visibility as VisibilityLevel) <= maxVis)
      .map((r) => this.rowToMemoryEntry(r))
      .filter((entry) => {
        if (!filters?.tags || filters.tags.length === 0) return true;
        return filters.tags.some((t) => entry.tags.includes(t));
      });

    if (filters?.limit) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  async getMemoryEntry(id: string): Promise<MemoryEntry | null> {
    const row = this.db.prepare("SELECT * FROM project_memory WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToMemoryEntry(row) : null;
  }

  async deleteMemory(id: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM project_memory WHERE id = ?").run(id);
    return result.changes > 0;
  }

  private rowToMemoryEntry(row: Record<string, unknown>): MemoryEntry {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      type: row.type as string,
      title: row.title as string,
      tags: JSON.parse(row.tags as string),
      priority: row.priority as string,
      visibility: row.visibility as VisibilityLevel,
      content: row.content as string,
      createdBy: row.created_by as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  // --- Conversations ---

  async createConversation(conv: CreateConversation): Promise<Conversation> {
    const id = randomUUID();
    const ts = now();
    this.db.prepare(`
      INSERT INTO conversations (id, project_id, title, status, default_visibility, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
    `).run(id, conv.projectId, conv.title, conv.defaultVisibility ?? "team", conv.createdBy, ts, ts);

    return {
      id,
      projectId: conv.projectId,
      title: conv.title,
      status: "active",
      defaultVisibility: conv.defaultVisibility ?? "team",
      createdBy: conv.createdBy,
      createdAt: ts,
      updatedAt: ts,
    };
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToConversation(row) : null;
  }

  async listConversations(projectId: string, agentId: string): Promise<Conversation[]> {
    const clearance = this.getAgentClearance(agentId);
    const maxVis = visibilityToInt(clearance);
    const rows = this.db.prepare(`
      SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC
    `).all(projectId) as Record<string, unknown>[];
    return rows
      .filter((r) => visibilityToInt(r.default_visibility as VisibilityLevel) <= maxVis)
      .map((r) => this.rowToConversation(r));
  }

  private rowToConversation(row: Record<string, unknown>): Conversation {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      title: row.title as string,
      status: row.status as string,
      defaultVisibility: row.default_visibility as VisibilityLevel,
      createdBy: row.created_by as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  // --- Subscriptions ---

  async subscribe(conversationId: string, agentId: string, opts?: SubscribeOptions): Promise<void> {
    const ts = now();
    this.db.prepare(`
      INSERT OR REPLACE INTO conversation_agents (conversation_id, agent_id, history_access, joined_at)
      VALUES (?, ?, ?, ?)
    `).run(conversationId, agentId, opts?.historyAccess ?? "full", ts);
  }

  async unsubscribe(conversationId: string, agentId: string): Promise<void> {
    this.db.prepare(`
      DELETE FROM conversation_agents WHERE conversation_id = ? AND agent_id = ?
    `).run(conversationId, agentId);
    // Cleanup conversation-scoped agent memory on unsubscribe
    this.db.prepare(
      "DELETE FROM agent_memory WHERE agent_id = ? AND scope = 'conversation' AND scope_id = ?"
    ).run(agentId, conversationId);
  }

  async getSubscribers(conversationId: string): Promise<Subscription[]> {
    const rows = this.db.prepare(`
      SELECT * FROM conversation_agents WHERE conversation_id = ?
    `).all(conversationId) as Record<string, unknown>[];
    return rows.map((r) => ({
      conversationId: r.conversation_id as string,
      agentId: r.agent_id as string,
      historyAccess: r.history_access as string,
      joinedAt: r.joined_at as string,
    }));
  }

  async isSubscribed(conversationId: string, agentId: string): Promise<boolean> {
    const row = this.db.prepare(
      "SELECT 1 FROM conversation_agents WHERE conversation_id = ? AND agent_id = ?",
    ).get(conversationId, agentId);
    return row !== undefined;
  }

  // --- Messages ---

  // --- Confidentiality instructions ---

  private getConfidentialityInstructions(visibility: VisibilityLevel, mode: ConfidentialityMode): BridgeInstructions {
    switch (mode) {
      case "strict":
        return {
          confidentiality: "The bridge enforces confidentiality automatically. Your output visibility is managed by the bridge.",
          mode,
        };
      case "flexible":
        return {
          confidentiality: "You may set any visibility level up to your clearance.",
          mode,
        };
      case "normal":
      default:
        return {
          confidentiality: `Set your output visibility >= ${visibility} (this message's level). Use the highest level among all input messages.`,
          mode,
        };
    }
  }

  private getProjectConfidentialityMode(conversationId: string): ConfidentialityMode {
    const row = this.db.prepare(`
      SELECT p.confidentiality_mode FROM projects p
      INNER JOIN conversations c ON c.project_id = p.id
      WHERE c.id = ?
    `).get(conversationId) as { confidentiality_mode: string } | undefined;
    return (row?.confidentiality_mode as ConfidentialityMode) ?? "normal";
  }

  async sendMessage(msg: CreateMessage): Promise<Message> {
    const id = randomUUID();
    const ts = now();

    // Cap visibility at sender's clearance level
    const senderClearance = this.getAgentClearance(msg.fromAgent);
    const requestedVis = msg.visibility ?? "team";
    const wasCapped = visibilityToInt(requestedVis) > visibilityToInt(senderClearance);
    const cappedVis = wasCapped ? senderClearance : requestedVis;

    // Build bridge metadata (trusted, immutable by agents)
    const confMode = this.getProjectConfidentialityMode(msg.conversationId);
    const recipients = msg.recipients && msg.recipients.length > 0 ? msg.recipients : null;
    const bridgeMeta: BridgeMetadata = {
      visibility: cappedVis,
      senderClearance,
      visibilityCapped: wasCapped,
      ...(wasCapped ? { originalVisibility: requestedVis } : {}),
      timestamp: ts,
      instructions: this.getConfidentialityInstructions(cappedVis, confMode),
      ...(recipients ? { whisper: true, recipients } : {}),
    };

    // Strip any _bridge / bridgeMetadata keys from agent-provided metadata (anti-forge)
    let cleanedAgentMeta: Record<string, unknown> | null = null;
    if (msg.metadata) {
      cleanedAgentMeta = {};
      for (const [k, v] of Object.entries(msg.metadata)) {
        if (!k.startsWith("_bridge") && k !== "bridgeMetadata" && k !== "bridge_metadata") {
          cleanedAgentMeta[k] = v;
        }
      }
      if (Object.keys(cleanedAgentMeta).length === 0) cleanedAgentMeta = null;
    }

    const tags = msg.tags ?? [];

    this.db.prepare(`
      INSERT INTO messages (id, conversation_id, from_agent, type, visibility, content, tags, recipients, metadata, agent_metadata, bridge_metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      msg.conversationId,
      msg.fromAgent,
      msg.type ?? "message",
      cappedVis,
      msg.content,
      JSON.stringify(tags),
      recipients ? JSON.stringify(recipients) : null,
      cleanedAgentMeta ? JSON.stringify(cleanedAgentMeta) : null,
      cleanedAgentMeta ? JSON.stringify(cleanedAgentMeta) : null,
      JSON.stringify(bridgeMeta),
      ts,
    );

    // Update conversation updated_at
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(ts, msg.conversationId);

    const message: Message = {
      id,
      conversationId: msg.conversationId,
      fromAgent: msg.fromAgent,
      type: msg.type ?? "message",
      visibility: cappedVis,
      content: msg.content,
      tags,
      recipients,
      metadata: cleanedAgentMeta,
      agentMetadata: cleanedAgentMeta,
      bridgeMetadata: bridgeMeta,
      createdAt: ts,
    };

    // Emit event for reactive consumers (SSE, internal agents)
    this.eventBus.emitMessage(message);

    return message;
  }

  async getMessages(conversationId: string, agentId: string, opts?: GetMessagesOptions): Promise<Message[]> {
    const clearance = this.getAgentClearance(agentId);
    const maxVis = visibilityToInt(clearance);

    let sql = "SELECT * FROM messages WHERE conversation_id = ?";
    const params: unknown[] = [conversationId];

    if (opts?.since) {
      sql += " AND created_at > ?";
      params.push(opts.since);
    }

    if (opts?.unreadOnly) {
      sql += ` AND id NOT IN (SELECT message_id FROM message_reads WHERE agent_id = ?)`;
      params.push(agentId);
    }

    if (opts?.fromAgent) {
      sql += " AND from_agent = ?";
      params.push(opts.fromAgent);
    }

    sql += " ORDER BY created_at ASC";

    // No SQL LIMIT — visibility and tag filters run in JS, so we need the full set first
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];

    let results = rows
      .filter((r) => visibilityToInt(r.visibility as VisibilityLevel) <= maxVis)
      .map((r) => this.rowToMessage(r))
      .filter((msg) => {
        // Whisper gate: if message has recipients, agent must be sender or in recipients list
        if (msg.recipients) {
          if (msg.fromAgent !== agentId && !msg.recipients.includes(agentId)) return false;
        }
        return true;
      })
      .filter((msg) => {
        if (!opts?.tags || opts.tags.length === 0) return true;
        return opts.tags.some((t) => msg.tags.includes(t));
      });

    if (opts?.limit) {
      results = results.slice(0, opts.limit);
    }

    // Passive high-water mark tracking: record the max visibility the agent has seen
    if (results.length > 0) {
      this.updateHighWaterMark(agentId, conversationId, results);
    }

    return results;
  }

  // --- High-water mark tracking ---

  private updateHighWaterMark(agentId: string, conversationId: string, messages: Message[]): void {
    // Find the project for this conversation
    const convRow = this.db.prepare("SELECT project_id FROM conversations WHERE id = ?").get(conversationId) as
      | { project_id: string }
      | undefined;
    if (!convRow) return;

    const projectId = convRow.project_id;

    // Find the max visibility among returned messages
    let maxVis = 0;
    for (const msg of messages) {
      const v = visibilityToInt(msg.visibility);
      if (v > maxVis) maxVis = v;
    }

    const maxVisLevel = (Object.entries(VISIBILITY_ORDER).find(([, v]) => v === maxVis)?.[0] ?? "public") as VisibilityLevel;
    const ts = now();

    // Upsert: only increase, never decrease
    this.db.prepare(`
      INSERT INTO agent_high_water_marks (agent_id, project_id, max_visibility, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (agent_id, project_id) DO UPDATE SET
        max_visibility = CASE
          WHEN excluded.max_visibility > agent_high_water_marks.max_visibility THEN excluded.max_visibility
          ELSE agent_high_water_marks.max_visibility
        END,
        updated_at = CASE
          WHEN excluded.max_visibility > agent_high_water_marks.max_visibility THEN excluded.updated_at
          ELSE agent_high_water_marks.updated_at
        END
    `).run(agentId, projectId, String(maxVis), ts);
  }

  async getHighWaterMark(agentId: string, projectId: string): Promise<AgentHighWaterMark | null> {
    const row = this.db.prepare(
      "SELECT * FROM agent_high_water_marks WHERE agent_id = ? AND project_id = ?"
    ).get(agentId, projectId) as Record<string, unknown> | undefined;

    if (!row) return null;

    // Convert stored integer back to visibility level
    const storedInt = parseInt(row.max_visibility as string, 10);
    const visLevel = (Object.entries(VISIBILITY_ORDER).find(([, v]) => v === storedInt)?.[0] ?? "public") as VisibilityLevel;

    return {
      agentId: row.agent_id as string,
      projectId: row.project_id as string,
      maxVisibility: visLevel,
      updatedAt: row.updated_at as string,
    };
  }

  async markRead(messageIds: string[], agentId: string): Promise<void> {
    const ts = now();
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO message_reads (message_id, agent_id, read_at) VALUES (?, ?, ?)
    `);
    const markAll = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        stmt.run(id, agentId, ts);
      }
    });
    markAll(messageIds);
  }

  async getUnreadCount(agentId: string): Promise<number> {
    const clearance = this.getAgentClearance(agentId);
    const maxVis = visibilityToInt(clearance);

    // Get conversations the agent is subscribed to
    const rows = this.db.prepare(`
      SELECT m.id, m.visibility FROM messages m
      INNER JOIN conversation_agents ca ON m.conversation_id = ca.conversation_id AND ca.agent_id = ?
      LEFT JOIN message_reads mr ON m.id = mr.message_id AND mr.agent_id = ?
      WHERE mr.message_id IS NULL
    `).all(agentId, agentId) as Record<string, unknown>[];

    return rows.filter((r) => visibilityToInt(r.visibility as VisibilityLevel) <= maxVis).length;
  }

  // --- Access Requests ---

  private rowToAccessRequest(row: Record<string, unknown>): AccessRequest {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      agentId: row.agent_id as string,
      agentName: row.agent_name as string,
      message: row.message as string | null,
      status: row.status as AccessRequestStatus,
      respondedBy: row.responded_by as string | null,
      createdAt: row.created_at as string,
      respondedAt: row.responded_at as string | null,
    };
  }

  async createAccessRequest(req: CreateAccessRequest): Promise<AccessRequest> {
    const id = randomUUID();
    const ts = now();
    this.db.prepare(`
      INSERT INTO access_requests (id, conversation_id, agent_id, agent_name, message, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, req.conversationId, req.agentId, req.agentName, req.message ?? null, ts);

    const accessRequest: AccessRequest = {
      id,
      conversationId: req.conversationId,
      agentId: req.agentId,
      agentName: req.agentName,
      message: req.message ?? null,
      status: "pending",
      respondedBy: null,
      createdAt: ts,
      respondedAt: null,
    };

    this.eventBus.emitAccessRequest(accessRequest);
    return accessRequest;
  }

  async getAccessRequest(id: string): Promise<AccessRequest | null> {
    const row = this.db.prepare("SELECT * FROM access_requests WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToAccessRequest(row) : null;
  }

  async listAccessRequestsForConversation(conversationId: string): Promise<AccessRequest[]> {
    const rows = this.db.prepare(
      "SELECT * FROM access_requests WHERE conversation_id = ? AND status = 'pending' ORDER BY created_at ASC"
    ).all(conversationId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToAccessRequest(r));
  }

  async listAccessRequestsByAgent(agentId: string): Promise<AccessRequest[]> {
    const rows = this.db.prepare(
      "SELECT * FROM access_requests WHERE agent_id = ? ORDER BY created_at DESC"
    ).all(agentId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToAccessRequest(r));
  }

  async respondToAccessRequest(id: string, status: AccessRequestStatus, respondedBy: string): Promise<AccessRequest | null> {
    const ts = now();
    const result = this.db.prepare(`
      UPDATE access_requests SET status = ?, responded_by = ?, responded_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(status, respondedBy, ts, id);

    if (result.changes === 0) return null;
    return this.getAccessRequest(id);
  }

  async hasPendingAccessRequest(conversationId: string, agentId: string): Promise<boolean> {
    const row = this.db.prepare(
      "SELECT 1 FROM access_requests WHERE conversation_id = ? AND agent_id = ? AND status = 'pending'"
    ).get(conversationId, agentId);
    return row !== undefined;
  }

  // --- Tasks ---

  private releaseStaleTaskClaims(): void {
    const threshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const stale = this.db.prepare(`
      SELECT t.id FROM tasks t
      JOIN agents a ON t.claimed_by = a.id
      WHERE t.status = 'claimed' AND a.last_seen_at < ?
    `).all(threshold) as { id: string }[];

    if (stale.length > 0) {
      const ts = now();
      const release = this.db.prepare(
        "UPDATE tasks SET status = 'open', claimed_by = NULL, claimed_at = NULL, updated_at = ? WHERE id = ?"
      );
      for (const { id } of stale) {
        release.run(ts, id);
        // Emit event for each released task
        const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown> | undefined;
        if (row) this.eventBus.emitTaskUpdated(this.rowToTask(row), "released");
      }
    }
  }

  async createTask(task: CreateTask): Promise<Task> {
    const id = randomUUID();
    const ts = now();
    this.db.prepare(`
      INSERT INTO tasks (id, project_id, conversation_id, title, description, status, required_capabilities, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
    `).run(
      id,
      task.projectId,
      task.conversationId ?? null,
      task.title,
      task.description ?? null,
      JSON.stringify(task.requiredCapabilities ?? []),
      task.createdBy,
      ts,
      ts,
    );

    const created: Task = {
      id,
      projectId: task.projectId,
      conversationId: task.conversationId ?? null,
      title: task.title,
      description: task.description ?? null,
      status: "open",
      requiredCapabilities: task.requiredCapabilities ?? [],
      createdBy: task.createdBy,
      claimedBy: null,
      claimedAt: null,
      completedAt: null,
      result: null,
      createdAt: ts,
      updatedAt: ts,
    };

    this.eventBus.emitTaskCreated(created);
    return created;
  }

  async getTask(id: string): Promise<Task | null> {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToTask(row) : null;
  }

  async listTasks(projectId: string, agentId: string, filters?: TaskFilters): Promise<Task[]> {
    // Verify project access
    const project = await this.getProject(projectId, agentId);
    if (!project) return [];

    // Release stale claims before listing
    this.releaseStaleTaskClaims();

    const rows = this.db.prepare(
      "SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC"
    ).all(projectId) as Record<string, unknown>[];

    let results = rows.map((r) => this.rowToTask(r));

    // JS-side filtering (consistent with existing visibility filtering pattern)
    if (filters?.status) {
      results = results.filter((t) => t.status === filters.status);
    }
    if (filters?.claimedBy) {
      results = results.filter((t) => t.claimedBy === filters.claimedBy);
    }
    if (filters?.capability) {
      const lower = filters.capability.toLowerCase();
      results = results.filter((t) =>
        t.requiredCapabilities.some((c) => c.toLowerCase() === lower)
      );
    }

    return results;
  }

  async claimTask(id: string, agentId: string): Promise<Task | null> {
    // Release stale claims before attempting
    this.releaseStaleTaskClaims();

    const ts = now();
    const result = this.db.prepare(
      "UPDATE tasks SET status = 'claimed', claimed_by = ?, claimed_at = ?, updated_at = ? WHERE id = ? AND status = 'open'"
    ).run(agentId, ts, ts, id);

    if (result.changes === 0) return null;

    const task = await this.getTask(id);
    if (task) this.eventBus.emitTaskUpdated(task, "claimed");
    return task;
  }

  async completeTask(id: string, agentId: string, result?: string): Promise<Task | null> {
    const ts = now();
    const dbResult = this.db.prepare(
      "UPDATE tasks SET status = 'completed', completed_at = ?, result = ?, updated_at = ? WHERE id = ? AND claimed_by = ? AND status = 'claimed'"
    ).run(ts, result ?? null, ts, id, agentId);

    if (dbResult.changes === 0) return null;

    const task = await this.getTask(id);
    if (task) this.eventBus.emitTaskUpdated(task, "completed");
    return task;
  }

  async releaseTask(id: string, agentId: string): Promise<Task | null> {
    const ts = now();
    // Allow both the claimer and the creator to release
    const dbResult = this.db.prepare(
      "UPDATE tasks SET status = 'open', claimed_by = NULL, claimed_at = NULL, updated_at = ? WHERE id = ? AND status = 'claimed' AND (claimed_by = ? OR created_by = ?)"
    ).run(ts, id, agentId, agentId);

    if (dbResult.changes === 0) return null;

    const task = await this.getTask(id);
    if (task) this.eventBus.emitTaskUpdated(task, "released");
    return task;
  }

  async updateTask(id: string, agentId: string, updates: { title?: string; description?: string; status?: TaskStatus }): Promise<Task | null> {
    // Only the creator can update a task
    const existing = this.db.prepare("SELECT * FROM tasks WHERE id = ? AND created_by = ?").get(id, agentId) as
      | Record<string, unknown>
      | undefined;
    if (!existing) return null;

    const ts = now();
    const fields: string[] = ["updated_at = ?"];
    const params: unknown[] = [ts];

    if (updates.title !== undefined) {
      fields.push("title = ?");
      params.push(updates.title);
    }
    if (updates.description !== undefined) {
      fields.push("description = ?");
      params.push(updates.description);
    }
    if (updates.status !== undefined) {
      fields.push("status = ?");
      params.push(updates.status);
      if (updates.status === "open") {
        // Reopening: clear claim fields
        fields.push("claimed_by = NULL", "claimed_at = NULL");
      }
    }

    params.push(id);
    this.db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...params);

    const task = await this.getTask(id);
    if (task) {
      const action = updates.status === "cancelled" ? "cancelled" : "updated";
      this.eventBus.emitTaskUpdated(task, action);
    }
    return task;
  }

  // --- Agent Memory ---

  async setAgentMemory(agentId: string, scope: AgentMemoryScope, content: string, scopeId?: string): Promise<AgentMemory> {
    const ts = now();
    const resolvedScopeId = scope === "global" ? "" : (scopeId ?? "");

    this.db.prepare(`
      INSERT INTO agent_memory (agent_id, scope, scope_id, content, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (agent_id, scope, scope_id) DO UPDATE SET
        content = excluded.content,
        updated_at = excluded.updated_at
    `).run(agentId, scope, resolvedScopeId, content, ts);

    return {
      agentId,
      scope,
      scopeId: resolvedScopeId || null,
      content,
      updatedAt: ts,
    };
  }

  async getAgentMemory(agentId: string, scope: AgentMemoryScope, scopeId?: string): Promise<AgentMemory | null> {
    const resolvedScopeId = scope === "global" ? "" : (scopeId ?? "");

    const row = this.db.prepare(
      "SELECT * FROM agent_memory WHERE agent_id = ? AND scope = ? AND scope_id = ?"
    ).get(agentId, scope, resolvedScopeId) as Record<string, unknown> | undefined;

    if (!row) return null;

    const rawScopeId = row.scope_id as string;
    return {
      agentId: row.agent_id as string,
      scope: row.scope as AgentMemoryScope,
      scopeId: rawScopeId || null,
      content: row.content as string,
      updatedAt: row.updated_at as string,
    };
  }

  async deleteAgentMemory(agentId: string, scope: AgentMemoryScope, scopeId?: string): Promise<boolean> {
    const resolvedScopeId = scope === "global" ? "" : (scopeId ?? "");

    const result = this.db.prepare(
      "DELETE FROM agent_memory WHERE agent_id = ? AND scope = ? AND scope_id = ?"
    ).run(agentId, scope, resolvedScopeId);

    return result.changes > 0;
  }

  // --- Instructions ---

  private rowToInstruction(row: Record<string, unknown>): Instruction {
    const selectorStr = row.selector_json as string;
    const selector = selectorStr && selectorStr !== "{}" ? JSON.parse(selectorStr) as InstructionSelector : null;
    const rawScopeId = row.scope_id as string;
    return {
      id: row.id as string,
      scope: row.scope as InstructionScope,
      scopeId: rawScopeId || null,
      selector,
      content: row.content as string,
      createdBy: row.created_by as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  async setInstruction(instruction: CreateInstruction): Promise<Instruction> {
    const id = randomUUID();
    const ts = now();
    const scopeId = instruction.scope === "bridge" ? "" : (instruction.scopeId ?? "");
    const selectorJson = instruction.selector ? JSON.stringify(instruction.selector) : "{}";

    this.db.prepare(`
      INSERT INTO instructions (id, scope, scope_id, selector_json, content, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (scope, scope_id, selector_json) DO UPDATE SET
        content = excluded.content,
        updated_at = excluded.updated_at
    `).run(id, instruction.scope, scopeId, selectorJson, instruction.content, instruction.createdBy, ts, ts);

    // Re-read to get actual ID (upsert may have kept the original)
    const row = this.db.prepare(
      "SELECT * FROM instructions WHERE scope = ? AND scope_id = ? AND selector_json = ?"
    ).get(instruction.scope, scopeId, selectorJson) as Record<string, unknown>;

    return this.rowToInstruction(row);
  }

  async listInstructions(scope: InstructionScope, scopeId?: string): Promise<Instruction[]> {
    const resolvedScopeId = scope === "bridge" ? "" : (scopeId ?? "");
    const rows = this.db.prepare(
      "SELECT * FROM instructions WHERE scope = ? AND scope_id = ? ORDER BY created_at ASC"
    ).all(resolvedScopeId ? scope : scope, resolvedScopeId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToInstruction(r));
  }

  async getMatchingInstructions(agent: { type: string; capabilities: string[] }, conversationId: string): Promise<Instruction[]> {
    // Resolve project ID from conversation
    const conv = await this.getConversation(conversationId);
    if (!conv) return [];

    // Fetch all instructions for bridge + project + conversation scopes
    const rows = this.db.prepare(`
      SELECT * FROM instructions
      WHERE (scope = 'bridge' AND scope_id = '')
         OR (scope = 'project' AND scope_id = ?)
         OR (scope = 'conversation' AND scope_id = ?)
      ORDER BY
        CASE scope WHEN 'bridge' THEN 0 WHEN 'project' THEN 1 WHEN 'conversation' THEN 2 END,
        created_at ASC
    `).all(conv.projectId, conversationId) as Record<string, unknown>[];

    const all = rows.map((r) => this.rowToInstruction(r));

    // Filter by selector match
    return all.filter((instr) => {
      if (!instr.selector) return true; // no selector = applies to all
      if (instr.selector.type && instr.selector.type.toLowerCase() !== agent.type.toLowerCase()) return false;
      if (instr.selector.capability && !agent.capabilities.some((c) => c.toLowerCase() === instr.selector!.capability!.toLowerCase())) return false;
      return true;
    });
  }

  async deleteInstruction(id: string, agentId: string): Promise<boolean> {
    // Only the creator can delete
    const result = this.db.prepare(
      "DELETE FROM instructions WHERE id = ? AND created_by = ?"
    ).run(id, agentId);
    return result.changes > 0;
  }

  private rowToMessage(row: Record<string, unknown>): Message {
    const legacyMeta = row.metadata ? JSON.parse(row.metadata as string) : null;
    // For pre-migration rows, agent_metadata may be null but metadata has data
    const agentMeta = row.agent_metadata
      ? JSON.parse(row.agent_metadata as string)
      : legacyMeta;
    const bridgeMeta = row.bridge_metadata
      ? JSON.parse(row.bridge_metadata as string)
      : null;

    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      fromAgent: row.from_agent as string,
      type: row.type as string,
      visibility: row.visibility as VisibilityLevel,
      content: row.content as string,
      tags: JSON.parse((row.tags as string) || "[]"),
      recipients: row.recipients ? JSON.parse(row.recipients as string) : null,
      metadata: legacyMeta,
      agentMetadata: agentMeta,
      bridgeMetadata: bridgeMeta,
      createdAt: row.created_at as string,
    };
  }
}
