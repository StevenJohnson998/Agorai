import type {
  IBlackboard,
  MemoryEntry,
  DebateRecord,
  ProjectRecord,
  Visibility,
} from "./base.js";
import type { Config } from "../config.js";

/**
 * SQLite-backed Blackboard implementation.
 *
 * Auto-persist: every mutation writes to SQLite immediately.
 * Project operations auto-update lastActiveAt.
 *
 * Stub for v0.1 — methods throw "not implemented" errors.
 * Full implementation in v0.2.
 */
export class SqliteBlackboard implements IBlackboard {
  private readonly dbPath: string;
  private readonly sensitivePatterns: RegExp[];

  constructor(config: Config) {
    this.dbPath = config.database.path;
    this.sensitivePatterns = config.privacy.sensitivePatterns.map(
      (p) => new RegExp(p, "gi")
    );
  }

  // --- Project lifecycle ---

  async createProject(
    _project: Omit<ProjectRecord, "id" | "createdAt" | "updatedAt" | "lastActiveAt">
  ): Promise<ProjectRecord> {
    throw new Error("SqliteBlackboard.createProject: not implemented (v0.2)");
  }

  async getProject(_id: string): Promise<ProjectRecord | null> {
    throw new Error("SqliteBlackboard.getProject: not implemented (v0.2)");
  }

  async listProjects(_includeArchived?: boolean): Promise<ProjectRecord[]> {
    throw new Error("SqliteBlackboard.listProjects: not implemented (v0.2)");
  }

  async updateProject(
    _id: string,
    _updates: Partial<Pick<ProjectRecord, "name" | "description" | "archived" | "thoroughness" | "agents" | "metadata">>
  ): Promise<ProjectRecord> {
    throw new Error("SqliteBlackboard.updateProject: not implemented (v0.2)");
  }

  async touchProject(_projectId: string): Promise<void> {
    throw new Error("SqliteBlackboard.touchProject: not implemented (v0.2)");
  }

  // --- Key-value context (scoped to project) ---

  async get(_projectId: string, _key: string, _visibility?: Visibility): Promise<MemoryEntry | null> {
    throw new Error("SqliteBlackboard.get: not implemented (v0.2)");
  }

  async set(_projectId: string, _key: string, _value: string, _visibility?: Visibility): Promise<void> {
    throw new Error("SqliteBlackboard.set: not implemented (v0.2)");
  }

  async delete(_projectId: string, _key: string): Promise<boolean> {
    throw new Error("SqliteBlackboard.delete: not implemented (v0.2)");
  }

  async list(_projectId: string, _visibility?: Visibility): Promise<MemoryEntry[]> {
    throw new Error("SqliteBlackboard.list: not implemented (v0.2)");
  }

  // --- Debate records (scoped to project) ---

  async saveDebate(_debate: DebateRecord): Promise<void> {
    throw new Error("SqliteBlackboard.saveDebate: not implemented (v0.2)");
  }

  async getDebate(_id: string): Promise<DebateRecord | null> {
    throw new Error("SqliteBlackboard.getDebate: not implemented (v0.2)");
  }

  async listDebates(_projectId: string, _visibility?: Visibility): Promise<DebateRecord[]> {
    throw new Error("SqliteBlackboard.listDebates: not implemented (v0.2)");
  }

  // --- Blackboard: privacy controls ---

  async promote(_id: string): Promise<{ ok: boolean; sensitiveFindings?: string[] }> {
    throw new Error("SqliteBlackboard.promote: not implemented (v0.2)");
  }

  async demote(_id: string): Promise<void> {
    throw new Error("SqliteBlackboard.demote: not implemented (v0.2)");
  }

  scanForSensitiveData(text: string): string[] {
    const findings: string[] = [];
    for (const pattern of this.sensitivePatterns) {
      pattern.lastIndex = 0;
      const matches = text.match(pattern);
      if (matches) {
        findings.push(...matches);
      }
    }
    return findings;
  }
}
