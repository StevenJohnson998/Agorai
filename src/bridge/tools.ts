/**
 * Bridge MCP tool schemas (Zod).
 *
 * 16 tools in 5 groups: agents, projects, memory, conversations, messages.
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

// --- Projects ---

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(MAX.name).describe("Project name"),
  description: z.string().max(MAX.description).optional().describe("Project description"),
  visibility: VisibilityParam,
  confidentiality_mode: z.enum(["normal", "strict", "flexible"]).default("normal").describe("Confidentiality mode: normal (agent-responsible), strict (bridge-enforced), flexible (agent chooses freely)"),
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
  type: z.enum(["message", "spec", "result", "review", "status", "question"]).default("message").describe("Message type"),
  visibility: VisibilityParam,
  metadata: z.record(z.unknown()).optional().describe("Private metadata (only visible to you). Do not include keys starting with '_bridge'."),
});

export const GetMessagesSchema = z.object({
  conversation_id: z.string().max(MAX.id).describe("Conversation ID"),
  since: z.string().max(MAX.id).optional().describe("ISO timestamp — only messages after this time"),
  unread_only: z.boolean().default(false).describe("Only return unread messages"),
  limit: z.number().int().min(1).max(200).optional().describe("Max messages to return"),
});

export const GetStatusSchema = z.object({});

export const MarkReadSchema = z.object({
  conversation_id: z.string().max(MAX.id).describe("Conversation ID"),
  up_to_message_id: z.string().max(MAX.id).optional().describe("Mark all messages up to this ID as read (default: all)"),
});
