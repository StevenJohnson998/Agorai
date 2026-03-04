/**
 * Bridge MCP tool schemas (Zod).
 *
 * 35 tools in 9 groups: agents, projects, memory, conversations, messages, tasks, skills, skill files, agent memory.
 * All tool handlers are registered in bridge/server.ts.
 *
 * Size limits:
 *   - names/titles: 200 chars
 *   - descriptions: 5000 chars
 *   - message content: 100KB (large for code review payloads)
 *   - memory content: 50KB
 *   - tags/capabilities arrays: 20 items, 50 chars each
 *   - type strings: 50 chars
 *   - IDs: 100 chars (UUIDs are 36, generous margin)
 */

import { z } from "zod";

/** Max lengths for reuse across schemas. */
const MAX = {
  id: 100,
  name: 200,
  title: 200,
  description: 5_000,
  type: 50,
  tag: 50,
  tagsArray: 20,
  capabilitiesArray: 20,
  messageContent: 100_000, // ~100KB
  memoryContent: 50_000,   // ~50KB
  metadataJson: 10_000,    // ~10KB serialized
} as const;

const VisibilityParam = z
  .enum(["public", "team", "confidential", "restricted"])
  .optional()
  .describe("Visibility level (default: team)");

// --- Agents ---

export const RegisterAgentSchema = z.object({
  name: z.string().min(1).max(MAX.name).describe("Agent display name"),
  type: z.string().max(MAX.type).default("custom").describe("Agent type (e.g. claude-code, claude-desktop, ollama)"),
  capabilities: z.array(z.string().max(MAX.tag)).max(MAX.capabilitiesArray).default([]).describe("Agent capabilities (e.g. code-execution, analysis, review)"),
});

export const ListBridgeAgentsSchema = z.object({
  project_id: z.string().max(MAX.id).optional().describe("Filter to agents subscribed to a project's conversations"),
});

export const DiscoverCapabilitiesSchema = z.object({
  capability: z.string().max(MAX.tag).optional()
    .describe("Filter agents by capability (case-insensitive). Omit to browse all agents and their capabilities."),
});

// --- Projects ---

const AccessModeParam = z
  .enum(["visible", "hidden"])
  .optional()
  .describe("Access mode: visible (appears in listings) or hidden (only members see it). Default: visible.");

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(MAX.name).describe("Project name"),
  description: z.string().max(MAX.description).optional().describe("Project description"),
  visibility: VisibilityParam,
  confidentiality_mode: z.enum(["normal", "strict", "flexible"]).default("normal").describe("Confidentiality mode: normal (agent-responsible), strict (bridge-enforced), flexible (agent chooses freely)"),
  access_mode: AccessModeParam,
});

export const ListProjectsSchema = z.object({});

// --- Project Memory ---

export const SetMemorySchema = z.object({
  project_id: z.string().max(MAX.id).describe("Project ID"),
  type: z.string().max(MAX.type).default("note").describe("Entry type: context, decision, skill, note, digest"),
  title: z.string().min(1).max(MAX.title).describe("Entry title"),
  tags: z.array(z.string().max(MAX.tag)).max(MAX.tagsArray).default([]).describe("Tags for filtering"),
  content: z.string().max(MAX.memoryContent).describe("Entry content"),
  priority: z.enum(["high", "normal", "low"]).default("normal").describe("Priority level"),
  visibility: VisibilityParam,
});

export const GetMemorySchema = z.object({
  project_id: z.string().max(MAX.id).describe("Project ID"),
  type: z.string().max(MAX.type).optional().describe("Filter by type"),
  tags: z.array(z.string().max(MAX.tag)).max(MAX.tagsArray).optional().describe("Filter by tags (any match)"),
  limit: z.number().int().min(1).max(100).optional().describe("Max entries to return"),
});

export const DeleteMemorySchema = z.object({
  id: z.string().max(MAX.id).describe("Memory entry ID to delete"),
});

// --- Conversations ---

export const CreateConversationSchema = z.object({
  project_id: z.string().max(MAX.id).describe("Project ID"),
  title: z.string().min(1).max(MAX.title).describe("Conversation title"),
  default_visibility: VisibilityParam.describe("Default visibility for new messages"),
  access_mode: AccessModeParam,
});

export const ListConversationsSchema = z.object({
  project_id: z.string().max(MAX.id).describe("Project ID"),
  status: z.enum(["active", "closed", "archived"]).optional().describe("Filter by status"),
});

export const SubscribeSchema = z.object({
  conversation_id: z.string().max(MAX.id).describe("Conversation ID"),
  history_access: z.enum(["full", "from_join"]).default("full").describe("How much history to access"),
});

export const UnsubscribeSchema = z.object({
  conversation_id: z.string().max(MAX.id).describe("Conversation ID"),
});

export const ListSubscribersSchema = z.object({
  conversation_id: z.string().max(MAX.id).describe("Conversation ID"),
});

// --- Messages ---

export const SendMessageSchema = z.object({
  conversation_id: z.string().max(MAX.id).describe("Conversation ID"),
  content: z.string().min(1).max(MAX.messageContent).describe("Message content"),
  type: z.enum(["message", "spec", "result", "review", "status", "question", "proposal", "decision"]).default("message").describe("Message type"),
  visibility: VisibilityParam,
  tags: z.array(z.string().max(MAX.tag)).max(MAX.tagsArray).default([]).describe("Tags for categorizing/filtering this message"),
  recipients: z.array(z.string().max(MAX.id)).max(20).optional()
    .describe("Directed message (whisper): only these agent IDs + you can see the message. Omit for broadcast."),
  metadata: z.record(z.unknown()).optional().describe("Private metadata (only visible to you). Do not include keys starting with '_bridge'."),
});

export const GetMessagesSchema = z.object({
  conversation_id: z.string().max(MAX.id).describe("Conversation ID"),
  since: z.string().max(MAX.id).optional().describe("ISO timestamp — only messages after this time"),
  unread_only: z.boolean().default(false).describe("Only return unread messages"),
  limit: z.number().int().min(1).max(200).optional().describe("Max messages to return"),
  tags: z.array(z.string().max(MAX.tag)).max(MAX.tagsArray).optional().describe("Filter by tags (any match)"),
  from_agent: z.string().max(MAX.id).optional().describe("Filter by sender agent ID"),
});

export const GetStatusSchema = z.object({});

export const MarkReadSchema = z.object({
  conversation_id: z.string().max(MAX.id).describe("Conversation ID"),
  up_to_message_id: z.string().max(MAX.id).optional().describe("Mark all messages up to this ID as read (default: all)"),
});

// --- Access Requests ---

export const ListAccessRequestsSchema = z.object({
  conversation_id: z.string().max(MAX.id).describe("Conversation ID"),
});

export const RespondToAccessRequestSchema = z.object({
  request_id: z.string().max(MAX.id).describe("Access request ID"),
  action: z.enum(["approve", "deny", "silent_deny"]).describe("Action: approve (subscribe agent), deny (reject with notification), silent_deny (reject silently — requester sees 'pending')"),
  clearance: z.enum(["public", "team", "confidential", "restricted"]).optional().describe("Clearance level to grant the agent on approve (default: public)"),
});

export const GetMyAccessRequestsSchema = z.object({});

// --- Tasks ---

export const CreateTaskSchema = z.object({
  project_id: z.string().max(MAX.id).describe("Project ID"),
  conversation_id: z.string().max(MAX.id).optional().describe("Link task to a conversation (optional)"),
  title: z.string().min(1).max(MAX.title).describe("Task title"),
  description: z.string().max(MAX.description).optional().describe("Task description"),
  required_capabilities: z.array(z.string().max(MAX.tag)).max(MAX.capabilitiesArray).default([])
    .describe("Capabilities needed to claim this task"),
});

export const ListTasksSchema = z.object({
  project_id: z.string().max(MAX.id).describe("Project ID"),
  status: z.enum(["open", "claimed", "completed", "cancelled"]).optional().describe("Filter by status"),
  claimed_by: z.string().max(MAX.id).optional().describe("Filter by claiming agent ID"),
  capability: z.string().max(MAX.tag).optional().describe("Filter by required capability"),
});

export const ClaimTaskSchema = z.object({
  task_id: z.string().max(MAX.id).describe("Task ID to claim"),
});

export const CompleteTaskSchema = z.object({
  task_id: z.string().max(MAX.id).describe("Task ID to complete"),
  result: z.string().max(MAX.messageContent).optional().describe("Task result or output"),
});

export const ReleaseTaskSchema = z.object({
  task_id: z.string().max(MAX.id).describe("Task ID to release back to open"),
});

export const UpdateTaskSchema = z.object({
  task_id: z.string().max(MAX.id).describe("Task ID to update"),
  title: z.string().min(1).max(MAX.title).optional().describe("New title"),
  description: z.string().max(MAX.description).optional().describe("New description"),
  status: z.enum(["open", "cancelled"]).optional().describe("Set status (only 'open' to reopen or 'cancelled' to cancel)"),
});

// --- Skills ---

export const SetSkillSchema = z.object({
  title: z.string().min(1).max(MAX.title).describe("Skill title (unique within scope)"),
  content: z.string().min(1).max(MAX.memoryContent).describe("Full skill content (loaded on demand via get_skill)"),
  summary: z.string().max(MAX.description).optional().describe("Short description (~1 line) shown in skill listings"),
  instructions: z.string().max(MAX.description).optional().describe("Behavioral hint for agents receiving this skill"),
  project_id: z.string().max(MAX.id).optional().describe("Project ID for project-scoped skills"),
  conversation_id: z.string().max(MAX.id).optional().describe("Conversation ID for conversation-scoped skills"),
  selector: z.object({
    type: z.string().max(MAX.type).optional().describe("Target agent type (e.g. 'claude-code', 'ollama')"),
    capability: z.string().max(MAX.tag).optional().describe("Target agent capability (e.g. 'code-execution')"),
  }).optional().describe("Optional selector to target specific agent types or capabilities."),
  agents: z.array(z.string().max(MAX.name)).max(MAX.tagsArray).optional().describe("Agent names this skill applies to. Empty = everyone."),
  tags: z.array(z.string().max(MAX.tag)).max(MAX.tagsArray).optional().describe("Tags for filtering skills"),
});

export const ListSkillsSchema = z.object({
  project_id: z.string().max(MAX.id).optional().describe("Project ID for project-scoped skills"),
  conversation_id: z.string().max(MAX.id).optional().describe("Conversation ID for conversation-scoped skills"),
  tags: z.array(z.string().max(MAX.tag)).max(MAX.tagsArray).optional().describe("Filter by tags (any match)"),
});

export const GetSkillSchema = z.object({
  skill_id: z.string().max(MAX.id).describe("Skill ID to retrieve (returns full content)"),
});

export const DeleteSkillSchema = z.object({
  skill_id: z.string().max(MAX.id).describe("Skill ID to delete"),
});

// --- Skill Files ---

export const SetSkillFileSchema = z.object({
  skill_id: z.string().max(MAX.id).describe("Parent skill ID"),
  filename: z.string().min(1).max(MAX.name).describe("Filename for the skill file"),
  content: z.string().max(MAX.memoryContent).describe("File content"),
});

export const GetSkillFileSchema = z.object({
  skill_id: z.string().max(MAX.id).describe("Parent skill ID"),
  filename: z.string().min(1).max(MAX.name).describe("Filename to retrieve"),
});

// --- Agent Memory ---

export const SetAgentMemorySchema = z.object({
  content: z.string().max(MAX.memoryContent).describe("Memory content (overwrites previous content for this scope)"),
  project_id: z.string().max(MAX.id).optional().describe("Project ID for project-scoped memory"),
  conversation_id: z.string().max(MAX.id).optional().describe("Conversation ID for conversation-scoped memory (requires project_id)"),
});

export const GetAgentMemorySchema = z.object({
  project_id: z.string().max(MAX.id).optional().describe("Project ID for project-scoped memory"),
  conversation_id: z.string().max(MAX.id).optional().describe("Conversation ID for conversation-scoped memory"),
});

export const DeleteAgentMemorySchema = z.object({
  project_id: z.string().max(MAX.id).optional().describe("Project ID for project-scoped memory"),
  conversation_id: z.string().max(MAX.id).optional().describe("Conversation ID for conversation-scoped memory"),
});

// --- Project Members ---

export const AddMemberSchema = z.object({
  project_id: z.string().max(MAX.id).describe("Project ID"),
  agent_id: z.string().max(MAX.id).describe("Agent ID to add as member"),
});

export const RemoveMemberSchema = z.object({
  project_id: z.string().max(MAX.id).describe("Project ID"),
  agent_id: z.string().max(MAX.id).describe("Agent ID to remove"),
});

export const ListMembersSchema = z.object({
  project_id: z.string().max(MAX.id).describe("Project ID"),
});
