/**
 * Bridge MCP tool schemas (Zod).
 *
 * 16 tools in 5 groups: agents, projects, memory, conversations, messages.
 * All tool handlers are registered in bridge/server.ts.
 */

import { z } from "zod";

const VisibilityParam = z
  .enum(["public", "team", "confidential", "restricted"])
  .optional()
  .describe("Visibility level (default: team)");

// --- Agents ---

export const RegisterAgentSchema = z.object({
  name: z.string().describe("Agent display name"),
  type: z.string().default("custom").describe("Agent type (e.g. claude-code, claude-desktop, ollama)"),
  capabilities: z.array(z.string()).default([]).describe("Agent capabilities (e.g. code-execution, analysis, review)"),
});

export const ListBridgeAgentsSchema = z.object({
  project_id: z.string().optional().describe("Filter to agents subscribed to a project's conversations"),
});

// --- Projects ---

export const CreateProjectSchema = z.object({
  name: z.string().describe("Project name"),
  description: z.string().optional().describe("Project description"),
  visibility: VisibilityParam,
});

export const ListProjectsSchema = z.object({});

// --- Project Memory ---

export const SetMemorySchema = z.object({
  project_id: z.string().describe("Project ID"),
  type: z.string().default("note").describe("Entry type: context, decision, skill, note, digest"),
  title: z.string().describe("Entry title"),
  tags: z.array(z.string()).default([]).describe("Tags for filtering"),
  content: z.string().describe("Entry content"),
  priority: z.enum(["high", "normal", "low"]).default("normal").describe("Priority level"),
  visibility: VisibilityParam,
});

export const GetMemorySchema = z.object({
  project_id: z.string().describe("Project ID"),
  type: z.string().optional().describe("Filter by type"),
  tags: z.array(z.string()).optional().describe("Filter by tags (any match)"),
  limit: z.number().int().min(1).max(100).optional().describe("Max entries to return"),
});

export const DeleteMemorySchema = z.object({
  id: z.string().describe("Memory entry ID to delete"),
});

// --- Conversations ---

export const CreateConversationSchema = z.object({
  project_id: z.string().describe("Project ID"),
  title: z.string().describe("Conversation title"),
  default_visibility: VisibilityParam.describe("Default visibility for new messages"),
});

export const ListConversationsSchema = z.object({
  project_id: z.string().describe("Project ID"),
  status: z.enum(["active", "closed", "archived"]).optional().describe("Filter by status"),
});

export const SubscribeSchema = z.object({
  conversation_id: z.string().describe("Conversation ID"),
  history_access: z.enum(["full", "from_join"]).default("full").describe("How much history to access"),
});

export const UnsubscribeSchema = z.object({
  conversation_id: z.string().describe("Conversation ID"),
});

export const ListSubscribersSchema = z.object({
  conversation_id: z.string().describe("Conversation ID"),
});

// --- Messages ---

export const SendMessageSchema = z.object({
  conversation_id: z.string().describe("Conversation ID"),
  content: z.string().describe("Message content"),
  type: z.enum(["message", "spec", "result", "review", "status", "question"]).default("message").describe("Message type"),
  visibility: VisibilityParam,
  metadata: z.record(z.unknown()).optional().describe("Arbitrary metadata"),
});

export const GetMessagesSchema = z.object({
  conversation_id: z.string().describe("Conversation ID"),
  since: z.string().optional().describe("ISO timestamp — only messages after this time"),
  unread_only: z.boolean().default(false).describe("Only return unread messages"),
  limit: z.number().int().min(1).max(200).optional().describe("Max messages to return"),
});

export const GetStatusSchema = z.object({});

export const MarkReadSchema = z.object({
  conversation_id: z.string().describe("Conversation ID"),
  up_to_message_id: z.string().optional().describe("Mark all messages up to this ID as read (default: all)"),
});
