/**
 * MCP tool definitions (Zod schemas).
 *
 * These define the tools exposed by the Agorai MCP server:
 * - 7 core tools (debate, analyze, agents, context, handoff, join)
 * - 4 project management tools (create, list, switch, archive)
 */

import { z } from "zod";

// --- Tool input schemas ---

/**
 * Role assignment schema for per-debate persona overrides.
 * Each entry maps an agent name to one or more persona names.
 * Example: { "claude": ["architect", "security"], "ollama": ["critic"] }
 * If omitted, agents use their default personas from config.
 * An agent can cumulate multiple roles — their system prompts are merged.
 */
export const RoleAssignmentSchema = z.record(
  z.string(),
  z.array(z.string())
).optional().describe("Per-agent role overrides: { agent: [persona, ...] }");

export const DebateInputSchema = z.object({
  prompt: z.string().describe("The question or topic to debate"),
  debate_id: z
    .string()
    .optional()
    .describe("Resume an existing debate by ID. Loads previous rounds and continues from there."),
  agents: z
    .array(z.string())
    .optional()
    .describe("Agent names to participate (default: all enabled)"),
  roles: RoleAssignmentSchema,
  mode: z
    .enum(["quick", "full"])
    .default("full")
    .describe("quick = 1 round, full = multi-round"),
  max_rounds: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Override max rounds (additional rounds when resuming)"),
  max_tokens: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Token budget for this debate (0 = unlimited, overrides config)"),
  thoroughness: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Override thoroughness (0=cheap, 1=thorough)"),
  estimate_only: z
    .boolean()
    .default(false)
    .describe("Return token usage estimate without running the debate"),
});

export const AnalyzeInputSchema = z.object({
  prompt: z.string().describe("Complex task to decompose and analyze"),
  project_id: z.string().optional().describe("Project to run in (uses active project if omitted)"),
  thoroughness: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Override thoroughness for this analysis"),
});

export const ListAgentsInputSchema = z.object({});

export const ContextGetInputSchema = z.object({
  key: z.string().describe("Key to retrieve from private memory"),
});

export const ContextSetInputSchema = z.object({
  key: z.string().describe("Key to store in private memory"),
  value: z.string().describe("Value to store"),
});

export const HandoffInputSchema = z.object({
  agent: z.string().describe("Target agent name"),
  spec: z.string().describe("Specification to hand off"),
  context: z.string().optional().describe("Additional context"),
});

export const JoinDebateInputSchema = z.object({
  debate_id: z.string().describe("ID of the debate to join"),
  agent: z.string().describe("Agent name requesting to join"),
});

// --- Project management schemas ---

export const ProjectCreateInputSchema = z.object({
  name: z.string().describe("Project name"),
  description: z.string().optional().describe("What this project is about"),
  thoroughness: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Default thoroughness for this project"),
});

export const ProjectListInputSchema = z.object({
  include_archived: z
    .boolean()
    .default(false)
    .describe("Include archived projects (default: false)"),
});

export const ProjectSwitchInputSchema = z.object({
  project_id: z.string().describe("Project ID to switch to"),
});

export const ProjectArchiveInputSchema = z.object({
  project_id: z.string().optional().describe("Project to archive (default: active project)"),
});

// --- Tool definitions for MCP registration ---

export const TOOL_DEFINITIONS = [
  {
    name: "debate",
    description:
      "Start a multi-agent debate on a topic. Agents discuss in rounds, " +
      "then reach consensus via vote, debate, or quorum protocol.",
    inputSchema: DebateInputSchema,
  },
  {
    name: "analyze",
    description:
      "Submit a complex task to the ProjectManager for decomposition into " +
      "sub-questions, parallel debates, and cross-debate synthesis.",
    inputSchema: AnalyzeInputSchema,
  },
  {
    name: "list_agents",
    description: "List available agents and their status (enabled, available on system).",
    inputSchema: ListAgentsInputSchema,
  },
  {
    name: "context_get",
    description: "Read a value from the project's private memory (Blackboard).",
    inputSchema: ContextGetInputSchema,
  },
  {
    name: "context_set",
    description: "Write a value to the project's private memory (Blackboard).",
    inputSchema: ContextSetInputSchema,
  },
  {
    name: "handoff",
    description: "Transfer a specification to a specific agent for execution.",
    inputSchema: HandoffInputSchema,
  },
  {
    name: "join_debate",
    description:
      "Allow an external agent to join an ongoing debate. " +
      "Only public-space debates are accessible.",
    inputSchema: JoinDebateInputSchema,
  },
  {
    name: "project_create",
    description:
      "Create a new project. Projects group debates, context, and decisions. " +
      "State is auto-saved — no need to manually save or suspend.",
    inputSchema: ProjectCreateInputSchema,
  },
  {
    name: "project_list",
    description:
      "List projects, most recently active first. " +
      "Set include_archived=true to see archived projects.",
    inputSchema: ProjectListInputSchema,
  },
  {
    name: "project_switch",
    description:
      "Switch to a different project. Previous project state is already saved. " +
      "All subsequent debates and context operations will target this project.",
    inputSchema: ProjectSwitchInputSchema,
  },
  {
    name: "project_archive",
    description:
      "Archive a project. Hides it from default listings but preserves all data. " +
      "Can be unarchived later.",
    inputSchema: ProjectArchiveInputSchema,
  },
] as const;
