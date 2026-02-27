/**
 * SQLite store implementation using better-sqlite3.
 *
 * All read operations filter by the requesting agent's clearanceLevel.
 * Visibility is stored as text and compared via integer mapping.
 */

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { IStore } from "./interfaces.js";
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
  VisibilityLevel,
} from "./types.js";
import { VISIBILITY_ORDER } from "./types.js";

function visibilityToInt(v: VisibilityLevel): number {
  return VISIBILITY_ORDER[v];
}

function now(): string {
  return new Date().toISOString();
}

export class SqliteStore implements IStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
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
    `);
  }

  async close(): Promise<void> {
    this.db.close();
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
    this.db.prepare(`
      INSERT INTO projects (id, name, description, visibility, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, project.name, project.description ?? null, project.visibility ?? "team", project.createdBy, ts, ts);

    return {
      id,
      name: project.name,
      description: project.description ?? null,
      visibility: project.visibility ?? "team",
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

  // --- Messages ---

  async sendMessage(msg: CreateMessage): Promise<Message> {
    const id = randomUUID();
    const ts = now();

    // Cap visibility at sender's clearance level
    const senderClearance = this.getAgentClearance(msg.fromAgent);
    const requestedVis = msg.visibility ?? "team";
    const cappedVis =
      visibilityToInt(requestedVis) > visibilityToInt(senderClearance)
        ? senderClearance
        : requestedVis;

    this.db.prepare(`
      INSERT INTO messages (id, conversation_id, from_agent, type, visibility, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      msg.conversationId,
      msg.fromAgent,
      msg.type ?? "message",
      cappedVis,
      msg.content,
      msg.metadata ? JSON.stringify(msg.metadata) : null,
      ts,
    );

    // Update conversation updated_at
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(ts, msg.conversationId);

    return {
      id,
      conversationId: msg.conversationId,
      fromAgent: msg.fromAgent,
      type: msg.type ?? "message",
      visibility: cappedVis,
      content: msg.content,
      metadata: msg.metadata ?? null,
      createdAt: ts,
    };
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

    sql += " ORDER BY created_at ASC";

    // No SQL LIMIT — visibility filter runs in JS, so we need the full set first
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];

    let results = rows
      .filter((r) => visibilityToInt(r.visibility as VisibilityLevel) <= maxVis)
      .map((r) => this.rowToMessage(r));

    if (opts?.limit) {
      results = results.slice(0, opts.limit);
    }

    return results;
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

  private rowToMessage(row: Record<string, unknown>): Message {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      fromAgent: row.from_agent as string,
      type: row.type as string,
      visibility: row.visibility as VisibilityLevel,
      content: row.content as string,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
      createdAt: row.created_at as string,
    };
  }
}
