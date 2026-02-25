/**
 * ProjectManager — super-orchestrator (project-level).
 *
 * Responsibilities:
 * - Manage project lifecycle (create, switch, archive)
 * - Decompose complex tasks into sub-questions
 * - Route each sub-question to the right protocol (vote / debate / quorum)
 * - Respect the thoroughness budget
 * - Cross-debate synthesis (aggregate results from multiple DebateSessions)
 *
 * Projects are auto-persisted. Every operation writes to the Blackboard
 * immediately. Switching projects is just changing a pointer — the old
 * project's state is already saved. Come back anytime, everything's there.
 *
 * Stub for v0.1 — skeleton with types. Full implementation in v0.3.
 */

import type { DebateSession, DebateSessionResult } from "./orchestrator.js";
import type { IBlackboard, ProjectRecord } from "./memory/base.js";
import type { Config } from "./config.js";
import type { IAgentAdapter } from "./adapters/base.js";

export interface AnalyzeOptions {
  /** Project to run the analysis in (uses active project if omitted) */
  projectId?: string;
  /** The complex task/question to decompose */
  prompt: string;
  /** Override thoroughness for this analysis */
  thoroughness?: number;
  /** Which agents to use */
  agents?: IAgentAdapter[];
}

export interface SubQuestion {
  question: string;
  type: "factual" | "design" | "security";
  priority: number;
}

export interface AnalysisResult {
  /** Project this analysis belongs to */
  projectId: string;
  /** Original prompt */
  prompt: string;
  /** Decomposed sub-questions */
  subQuestions: SubQuestion[];
  /** Results from each sub-debate */
  debateResults: DebateSessionResult[];
  /** Cross-debate synthesis */
  synthesis: string;
  /** Total duration */
  durationMs: number;
}

export class ProjectManager {
  private readonly config: Config;
  private readonly debateSession: DebateSession;
  private readonly blackboard: IBlackboard;
  private activeProjectId: string | null = null;

  constructor(config: Config, debateSession: DebateSession, blackboard: IBlackboard) {
    this.config = config;
    this.debateSession = debateSession;
    this.blackboard = blackboard;
  }

  /**
   * Create a new project and make it active.
   */
  async createProject(name: string, description?: string): Promise<ProjectRecord> {
    const project = await this.blackboard.createProject({
      name,
      description,
      archived: false,
      thoroughness: this.config.thoroughness,
      agents: this.config.agents.filter((a) => a.enabled).map((a) => a.name),
      metadata: {},
    });
    this.activeProjectId = project.id;
    return project;
  }

  /**
   * Switch to an existing project. No ceremony — just point to it.
   * The previous project's state is already persisted.
   */
  async switchProject(projectId: string): Promise<ProjectRecord> {
    const project = await this.blackboard.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }
    if (project.archived) {
      throw new Error(`Project ${projectId} is archived. Unarchive it first.`);
    }
    this.activeProjectId = project.id;
    await this.blackboard.touchProject(projectId);
    return project;
  }

  /**
   * Archive a project. It won't show up in default listings
   * but all data is preserved. Can be unarchived later.
   */
  async archiveProject(projectId?: string): Promise<void> {
    const id = projectId ?? this.activeProjectId;
    if (!id) throw new Error("No active project to archive");
    await this.blackboard.updateProject(id, { archived: true });
    if (this.activeProjectId === id) {
      this.activeProjectId = null;
    }
  }

  /**
   * List projects (most recently active first).
   */
  async listProjects(includeArchived = false): Promise<ProjectRecord[]> {
    return this.blackboard.listProjects(includeArchived);
  }

  /**
   * Get the currently active project ID.
   */
  getActiveProjectId(): string | null {
    return this.activeProjectId;
  }

  /**
   * Decompose a complex prompt into sub-questions.
   * TODO v0.3: use an LLM to do the decomposition
   */
  private async decompose(_prompt: string, _thoroughness: number): Promise<SubQuestion[]> {
    throw new Error("ProjectManager.decompose: not implemented (v0.3)");
  }

  /**
   * Run cross-debate synthesis.
   * TODO v0.3: aggregate results and produce a coherent final answer
   */
  private async synthesize(
    _prompt: string,
    _results: DebateSessionResult[]
  ): Promise<string> {
    throw new Error("ProjectManager.synthesize: not implemented (v0.3)");
  }

  /**
   * Analyze a complex task: decompose, debate each sub-question, synthesize.
   * All debates are stored under the active project.
   * Stub for v0.1.
   */
  async analyze(options: AnalyzeOptions): Promise<AnalysisResult> {
    const projectId = options.projectId ?? this.activeProjectId;
    if (!projectId) {
      throw new Error("No active project. Create or switch to a project first.");
    }

    const thoroughness = options.thoroughness ?? this.config.thoroughness;

    void this.debateSession;
    void this.blackboard;

    const subQuestions = await this.decompose(options.prompt, thoroughness);
    void subQuestions;

    throw new Error(
      `ProjectManager.analyze: not implemented (v0.3). ` +
      `Would decompose "${options.prompt.slice(0, 50)}..." with thoroughness ${thoroughness} ` +
      `in project ${projectId}.`
    );
  }
}
