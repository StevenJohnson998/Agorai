/**
 * Bridge HTTP server — Streamable HTTP transport for the MCP bridge.
 *
 * Exposes 32 bridge tools + debate tools over HTTP.
 * Auth is handled via API key in Authorization header.
 * Each request is authenticated before being passed to the MCP handler.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { IStore } from "../store/interfaces.js";
import type { IAuthProvider, AuthResult } from "./auth.js";
import type { Config } from "../config.js";
import type { MessageCreatedEvent, AccessRequestCreatedEvent, TaskCreatedEvent, TaskUpdatedEvent } from "../store/events.js";
import { VISIBILITY_ORDER, type VisibilityLevel } from "../store/types.js";
import { createLogger } from "../logger.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_VERSION: string = JSON.parse(
  readFileSync(resolve(__dirname, "../../package.json"), "utf-8")
).version;

import {
  RegisterAgentSchema,
  ListBridgeAgentsSchema,
  DiscoverCapabilitiesSchema,
  CreateProjectSchema,
  ListProjectsSchema,
  SetMemorySchema,
  GetMemorySchema,
  DeleteMemorySchema,
  CreateConversationSchema,
  ListConversationsSchema,
  SubscribeSchema,
  UnsubscribeSchema,
  SendMessageSchema,
  GetMessagesSchema,
  GetStatusSchema,
  MarkReadSchema,
  ListSubscribersSchema,
  ListAccessRequestsSchema,
  RespondToAccessRequestSchema,
  GetMyAccessRequestsSchema,
  CreateTaskSchema,
  ListTasksSchema,
  ClaimTaskSchema,
  CompleteTaskSchema,
  ReleaseTaskSchema,
  UpdateTaskSchema,
  SetInstructionsSchema,
  ListInstructionsSchema,
  DeleteInstructionsSchema,
  SetAgentMemorySchema,
  GetAgentMemorySchema,
  DeleteAgentMemorySchema,
} from "./tools.js";

const log = createLogger("bridge");

/** Per-session context: maps transport sessionId → agent auth. */
const sessionAuth = new Map<string, AuthResult>();

/** Active transports keyed by sessionId. */
const transports = new Map<string, StreamableHTTPServerTransport>();

/** Reverse index: agentId → set of sessionIds (one agent can have multiple sessions). */
const agentSessions = new Map<string, Set<string>>();

// --- Rate limiter (sliding window per agent) ---

interface RateBucket {
  tokens: number;
  lastRefill: number;
}

class RateLimiter {
  private buckets = new Map<string, RateBucket>();
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number, windowSeconds: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowSeconds * 1000;
  }

  /** Returns true if the request is allowed, false if rate-limited. */
  allow(agentId: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(agentId);

    if (!bucket) {
      bucket = { tokens: this.maxRequests - 1, lastRefill: now };
      this.buckets.set(agentId, bucket);
      return true;
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    const refill = Math.floor((elapsed / this.windowMs) * this.maxRequests);
    if (refill > 0) {
      bucket.tokens = Math.min(this.maxRequests, bucket.tokens + refill);
      bucket.lastRefill = now;
    }

    if (bucket.tokens > 0) {
      bucket.tokens--;
      return true;
    }

    return false;
  }
}

export interface BridgeServerOptions {
  store: IStore;
  auth: IAuthProvider;
  config: Config;
}

const ACCESS_DENIED = { content: [{ type: "text" as const, text: JSON.stringify({ error: "Not found or access denied" }) }] };

function createBridgeMcpServer(store: IStore, agentId: string): McpServer {
  const server = new McpServer({
    name: "agorai-bridge",
    version: PKG_VERSION,
  }, {
    instructions: [
      "You are connected to Agorai, a multi-agent collaboration bridge.",
      "",
      "IMPORTANT — Message read tracking:",
      "After you read messages with get_messages, you MUST call mark_read with the same conversation_id.",
      "This prevents you from seeing the same messages again on the next poll.",
      "Example: get_messages({conversation_id: \"abc\"}) → process messages → mark_read({conversation_id: \"abc\"})",
      "",
      "IMPORTANT — Visibility / confidentiality levels:",
      "Messages have a visibility level: public < team < confidential < restricted.",
      "When you send a message, set its visibility to the HIGHEST level among the messages you used as input.",
      "For example, if you read messages at 'team' and 'confidential' level, your reply MUST be 'confidential'.",
      "If unsure, default to the conversation's default visibility. Never downgrade confidentiality.",
      "",
      "IMPORTANT — Message metadata model:",
      "Messages have two metadata fields:",
      "- bridgeMetadata: trusted data injected by the bridge (visibility, capping info, confidentiality instructions). Always present. Read the 'instructions' field for guidance on how to handle confidentiality for this project.",
      "- agentMetadata: your private operational data (cost, model, tokens, etc.). Only visible to you — other agents cannot see it.",
      "When sending a message, pass any operational metadata in the 'metadata' field. Do NOT include keys starting with '_bridge'.",
      "",
      "Typical workflow:",
      "1. get_status — check for unread messages",
      "2. list_projects → list_conversations → subscribe to conversations you want to follow",
      "3. get_messages({conversation_id, unread_only: true}) — fetch new messages",
      "4. Process/respond with send_message (set visibility to max of input messages' visibility)",
      "5. mark_read({conversation_id}) — ALWAYS do this after reading, even if you don't reply",
      "",
      "IMPORTANT — @mentions and context:",
      "Use @agent-name to mention specific agents. Use list_subscribers to see who is in a conversation.",
      "When you @mention an agent who hasn't been active in the conversation, YOU are responsible for providing them with the necessary context.",
      "They may not have seen previous messages. Include a brief summary of the situation, key decisions made, and what you need from them.",
      "Do NOT assume other agents have read the full conversation history.",
      "",
      "IMPORTANT — Access requests:",
      "If you try to subscribe to a conversation you don't have access to, an access request is created automatically.",
      "Subscribers of that conversation can approve or deny your request via list_access_requests + respond_to_access_request.",
      "Check your request status with get_my_access_requests.",
    ].join("\n"),
  });

  // --- Agent tools ---

  server.tool(
    "register_agent",
    "Register or update the calling agent",
    RegisterAgentSchema.shape,
    async (args) => {
      const agent = await store.getAgent(agentId);
      if (!agent) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Agent not found" }) }] };
      }
      const updated = await store.registerAgent({
        name: args.name || agent.name,
        type: args.type || agent.type,
        capabilities: args.capabilities.length > 0 ? args.capabilities : agent.capabilities,
        clearanceLevel: agent.clearanceLevel,
        apiKeyHash: agent.apiKeyHash,
      });
      const { apiKeyHash: _, ...safe } = updated;
      return { content: [{ type: "text" as const, text: JSON.stringify(safe, null, 2) }] };
    },
  );

  server.tool(
    "list_agents",
    "List registered agents",
    ListBridgeAgentsSchema.shape,
    async (args) => {
      const agents = await store.listAgents();

      let filtered = agents;
      if (args.project_id) {
        // Verify caller can access the project
        const project = await store.getProject(args.project_id, agentId);
        if (!project) return ACCESS_DENIED;

        // Collect agent IDs from all conversation subscriptions in the project
        const conversations = await store.listConversations(args.project_id, agentId);
        const subscribedIds = new Set<string>();
        for (const conv of conversations) {
          const subs = await store.getSubscribers(conv.id);
          for (const sub of subs) subscribedIds.add(sub.agentId);
        }
        filtered = agents.filter((a) => subscribedIds.has(a.id));
      }

      const safe = filtered.map(({ apiKeyHash: _, ...rest }) => rest);
      return { content: [{ type: "text" as const, text: JSON.stringify(safe, null, 2) }] };
    },
  );

  server.tool(
    "discover_capabilities",
    "Find agents by capability. Without a filter, returns all agents and their capabilities.",
    DiscoverCapabilitiesSchema.shape,
    async (args) => {
      let agents;
      if (args.capability) {
        agents = await store.findAgentsByCapability(args.capability);
      } else {
        agents = await store.listAgents();
      }
      const safe = agents.map(({ apiKeyHash: _, ...rest }) => rest);
      return { content: [{ type: "text" as const, text: JSON.stringify(safe, null, 2) }] };
    },
  );

  // --- Project tools ---

  server.tool(
    "create_project",
    "Create a new project",
    CreateProjectSchema.shape,
    async (args) => {
      const project = await store.createProject({
        name: args.name,
        description: args.description,
        visibility: args.visibility,
        confidentialityMode: args.confidentiality_mode,
        createdBy: agentId,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(project, null, 2) }] };
    },
  );

  server.tool(
    "list_projects",
    "List accessible projects",
    ListProjectsSchema.shape,
    async () => {
      const projects = await store.listProjects(agentId);
      return { content: [{ type: "text" as const, text: JSON.stringify(projects, null, 2) }] };
    },
  );

  // --- Memory tools ---

  server.tool(
    "set_memory",
    "Add or update a project memory entry",
    SetMemorySchema.shape,
    async (args) => {
      // Verify caller can access the target project
      const project = await store.getProject(args.project_id, agentId);
      if (!project) return ACCESS_DENIED;

      const entry = await store.setMemory({
        projectId: args.project_id,
        type: args.type,
        title: args.title,
        tags: args.tags,
        content: args.content,
        priority: args.priority,
        visibility: args.visibility,
        createdBy: agentId,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(entry, null, 2) }] };
    },
  );

  server.tool(
    "get_memory",
    "Get project memory entries filtered by clearance",
    GetMemorySchema.shape,
    async (args) => {
      const entries = await store.getMemory(args.project_id, agentId, {
        type: args.type,
        tags: args.tags,
        limit: args.limit,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(entries, null, 2) }] };
    },
  );

  server.tool(
    "delete_memory",
    "Delete a memory entry",
    DeleteMemorySchema.shape,
    async (args) => {
      // Verify the entry exists, caller owns it, and can access its project
      const entry = await store.getMemoryEntry(args.id);
      if (!entry) return ACCESS_DENIED;
      if (entry.createdBy !== agentId) return ACCESS_DENIED;
      const project = await store.getProject(entry.projectId, agentId);
      if (!project) return ACCESS_DENIED;

      const deleted = await store.deleteMemory(args.id);
      return { content: [{ type: "text" as const, text: JSON.stringify({ deleted }) }] };
    },
  );

  // --- Conversation tools ---

  server.tool(
    "create_conversation",
    "Create a conversation in a project",
    CreateConversationSchema.shape,
    async (args) => {
      // Verify caller can access the target project
      const project = await store.getProject(args.project_id, agentId);
      if (!project) return ACCESS_DENIED;

      const conv = await store.createConversation({
        projectId: args.project_id,
        title: args.title,
        defaultVisibility: args.default_visibility,
        createdBy: agentId,
      });
      // Auto-subscribe the creator
      await store.subscribe(conv.id, agentId);
      return { content: [{ type: "text" as const, text: JSON.stringify(conv, null, 2) }] };
    },
  );

  server.tool(
    "list_conversations",
    "List conversations in a project",
    ListConversationsSchema.shape,
    async (args) => {
      let conversations = await store.listConversations(args.project_id, agentId);
      if (args.status) {
        conversations = conversations.filter((c) => c.status === args.status);
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(conversations, null, 2) }] };
    },
  );

  server.tool(
    "subscribe",
    "Subscribe to a conversation. If you don't have access, an access request is created automatically — existing subscribers can approve it.",
    SubscribeSchema.shape,
    async (args) => {
      // Check if already subscribed
      const alreadySubscribed = await store.isSubscribed(args.conversation_id, agentId);
      if (alreadySubscribed) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Already subscribed to this conversation" }) }] };
      }

      // Verify conversation exists and caller can access its project
      const conv = await store.getConversation(args.conversation_id);
      if (!conv) return ACCESS_DENIED;
      const project = await store.getProject(conv.projectId, agentId);

      if (project) {
        // Direct access — subscribe normally
        await store.subscribe(args.conversation_id, agentId, {
          historyAccess: args.history_access,
        });

        // Include matching instructions in subscribe response
        const agent = await store.getAgent(agentId);
        const matchingInstructions = agent
          ? await store.getMatchingInstructions(
              { type: agent.type, capabilities: agent.capabilities },
              args.conversation_id,
            )
          : [];

        return { content: [{ type: "text" as const, text: JSON.stringify({
          subscribed: true,
          conversation_id: args.conversation_id,
          instructions: matchingInstructions.map((i) => ({
            scope: i.scope,
            selector: i.selector,
            content: i.content,
          })),
        }) }] };
      }

      // No project access — fallback to access request
      // NOTE: Currently triggered by clearance < project visibility. In v0.6, access control
      // will be separated from clearance (clearance = message visibility, access = project membership).
      const hasPending = await store.hasPendingAccessRequest(args.conversation_id, agentId);
      if (hasPending) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "You already have a pending access request for this conversation" }) }] };
      }

      const agent = await store.getAgent(agentId);
      const accessRequest = await store.createAccessRequest({
        conversationId: args.conversation_id,
        agentId,
        agentName: agent?.name ?? agentId,
      });

      return { content: [{ type: "text" as const, text: JSON.stringify({ status: "access_requested", requestId: accessRequest.id, conversation_id: args.conversation_id }) }] };
    },
  );

  server.tool(
    "unsubscribe",
    "Unsubscribe from a conversation",
    UnsubscribeSchema.shape,
    async (args) => {
      await store.unsubscribe(args.conversation_id, agentId);
      return { content: [{ type: "text" as const, text: JSON.stringify({ unsubscribed: true, conversation_id: args.conversation_id }) }] };
    },
  );

  server.tool(
    "list_subscribers",
    "List agents subscribed to a conversation (with name, type, online status — useful for @mention suggestions)",
    ListSubscribersSchema.shape,
    async (args) => {
      // Verify caller is subscribed to the conversation
      const subscribed = await store.isSubscribed(args.conversation_id, agentId);
      if (!subscribed) return ACCESS_DENIED;

      const [subscriptions, allAgents] = await Promise.all([
        store.getSubscribers(args.conversation_id),
        store.listAgents(),
      ]);
      const agentMap = new Map(allAgents.map((a) => [a.id, a]));
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();

      const subscribers = subscriptions.map((sub) => {
        const agent = agentMap.get(sub.agentId);
        return {
          id: sub.agentId,
          name: agent?.name ?? sub.agentId,
          type: agent?.type ?? "unknown",
          online: agent ? agent.lastSeenAt > fiveMinAgo : false,
          joinedAt: sub.joinedAt,
        };
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(subscribers, null, 2) }] };
    },
  );

  // --- Message tools ---

  server.tool(
    "send_message",
    "Send a message in a conversation (visibility capped at your clearance). Set visibility to the highest level among the input messages you used (public < team < confidential < restricted). If unsure, omit it and the conversation default will be used.",
    SendMessageSchema.shape,
    async (args) => {
      // Verify caller is subscribed to the conversation
      const subscribed = await store.isSubscribed(args.conversation_id, agentId);
      if (!subscribed) return ACCESS_DENIED;

      // Validate @mentions in whispers: mentioned agents must be in recipients list
      if (args.recipients && args.recipients.length > 0) {
        const allAgents = await store.listAgents();
        const agentNameMap = new Map(allAgents.map((a) => [a.name.toLowerCase(), a.id]));
        const mentionPattern = /@([\w-]+)/g;
        let match;
        while ((match = mentionPattern.exec(args.content)) !== null) {
          const mentionedName = match[1].toLowerCase();
          const mentionedId = agentNameMap.get(mentionedName);
          if (mentionedId && mentionedId !== agentId && !args.recipients.includes(mentionedId)) {
            return { content: [{ type: "text" as const, text: JSON.stringify({
              error: `@${match[1]} is mentioned but not in recipients — they won't see this whisper. Add them to recipients or remove the @mention.`,
            }) }] };
          }
        }
      }

      const message = await store.sendMessage({
        conversationId: args.conversation_id,
        fromAgent: agentId,
        type: args.type,
        visibility: args.visibility,
        content: args.content,
        tags: args.tags,
        recipients: args.recipients,
        metadata: args.metadata as Record<string, unknown> | undefined,
      });

      // Response: include bridgeMetadata + agentMetadata (sender sees their own), exclude deprecated metadata
      const { metadata: _deprecated, ...rest } = message;
      return { content: [{ type: "text" as const, text: JSON.stringify(rest, null, 2) }] };
    },
  );

  server.tool(
    "get_messages",
    "Get messages from a conversation (filtered by your clearance). IMPORTANT: After calling this, you MUST call mark_read with the same conversation_id to avoid seeing the same messages again.",
    GetMessagesSchema.shape,
    async (args) => {
      // Verify caller is subscribed to the conversation
      const subscribed = await store.isSubscribed(args.conversation_id, agentId);
      if (!subscribed) return ACCESS_DENIED;

      const messages = await store.getMessages(args.conversation_id, agentId, {
        since: args.since,
        unreadOnly: args.unread_only,
        limit: args.limit,
        tags: args.tags,
        fromAgent: args.from_agent,
      });

      // Shape response: strip agentMetadata for non-sender, exclude deprecated metadata
      const shaped = messages.map((msg) => {
        const { metadata: _deprecated, agentMetadata, ...rest } = msg;
        return {
          ...rest,
          agentMetadata: msg.fromAgent === agentId ? agentMetadata : null,
        };
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(shaped, null, 2) }] };
    },
  );

  // --- Task tools ---

  server.tool(
    "create_task",
    "Create a task in a project. Other agents can discover and claim it.",
    CreateTaskSchema.shape,
    async (args) => {
      const project = await store.getProject(args.project_id, agentId);
      if (!project) return ACCESS_DENIED;

      const task = await store.createTask({
        projectId: args.project_id,
        conversationId: args.conversation_id,
        title: args.title,
        description: args.description,
        requiredCapabilities: args.required_capabilities,
        createdBy: agentId,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }] };
    },
  );

  server.tool(
    "list_tasks",
    "List tasks in a project, optionally filtered by status, capability, or claiming agent",
    ListTasksSchema.shape,
    async (args) => {
      const tasks = await store.listTasks(args.project_id, agentId, {
        status: args.status,
        claimedBy: args.claimed_by,
        capability: args.capability,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(tasks, null, 2) }] };
    },
  );

  server.tool(
    "claim_task",
    "Claim an open task. Atomic — only one agent can claim a task at a time.",
    ClaimTaskSchema.shape,
    async (args) => {
      const task = await store.claimTask(args.task_id, agentId);
      if (!task) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Task not available — it may already be claimed or does not exist" }) }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }] };
    },
  );

  server.tool(
    "complete_task",
    "Mark a claimed task as completed with an optional result",
    CompleteTaskSchema.shape,
    async (args) => {
      const task = await store.completeTask(args.task_id, agentId, args.result);
      if (!task) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Cannot complete — task is not claimed by you or does not exist" }) }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }] };
    },
  );

  server.tool(
    "release_task",
    "Release a claimed task back to open so another agent can claim it",
    ReleaseTaskSchema.shape,
    async (args) => {
      const task = await store.releaseTask(args.task_id, agentId);
      if (!task) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Cannot release — task is not claimed or you lack permission" }) }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }] };
    },
  );

  server.tool(
    "update_task",
    "Update a task you created (title, description, or status). Only the creator can update.",
    UpdateTaskSchema.shape,
    async (args) => {
      const task = await store.updateTask(args.task_id, agentId, {
        title: args.title,
        description: args.description,
        status: args.status,
      });
      if (!task) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Cannot update — task not found or you are not the creator" }) }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }] };
    },
  );

  // --- Instruction tools ---

  server.tool(
    "set_instructions",
    "Set instructions for agents in a scope. Only the project/conversation creator can set instructions for their scope. Use selector to target specific agent types or capabilities. Omit selector for instructions that apply to all agents.",
    SetInstructionsSchema.shape,
    async (args) => {
      let scope: "bridge" | "project" | "conversation" = "bridge";
      let scopeId: string | undefined;

      if (args.conversation_id) {
        scope = "conversation";
        scopeId = args.conversation_id;
        // Verify caller created the conversation
        const conv = await store.getConversation(args.conversation_id);
        if (!conv || conv.createdBy !== agentId) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Only the conversation creator can set instructions" }) }] };
        }
      } else if (args.project_id) {
        scope = "project";
        scopeId = args.project_id;
        // Verify caller created the project
        const project = await store.getProject(args.project_id, agentId);
        if (!project || project.createdBy !== agentId) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Only the project creator can set instructions" }) }] };
        }
      } else {
        // Bridge scope — not settable via MCP (future admin dashboard)
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Bridge-level instructions cannot be set via MCP. Provide project_id or conversation_id." }) }] };
      }

      const instr = await store.setInstruction({
        scope,
        scopeId,
        selector: args.selector,
        content: args.content,
        createdBy: agentId,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(instr, null, 2) }] };
    },
  );

  server.tool(
    "list_instructions",
    "List instructions for a scope. No params = bridge-level. With project_id = project-level. With conversation_id = conversation-level.",
    ListInstructionsSchema.shape,
    async (args) => {
      let scope: "bridge" | "project" | "conversation" = "bridge";
      let scopeId: string | undefined;

      if (args.conversation_id) {
        scope = "conversation";
        scopeId = args.conversation_id;
        // Verify subscribed
        const subscribed = await store.isSubscribed(args.conversation_id, agentId);
        if (!subscribed) return ACCESS_DENIED;
      } else if (args.project_id) {
        scope = "project";
        scopeId = args.project_id;
        const project = await store.getProject(args.project_id, agentId);
        if (!project) return ACCESS_DENIED;
      }

      const instructions = await store.listInstructions(scope, scopeId);
      return { content: [{ type: "text" as const, text: JSON.stringify(instructions, null, 2) }] };
    },
  );

  server.tool(
    "delete_instructions",
    "Delete an instruction by ID. Only the creator can delete.",
    DeleteInstructionsSchema.shape,
    async (args) => {
      const deleted = await store.deleteInstruction(args.instruction_id, agentId);
      return { content: [{ type: "text" as const, text: JSON.stringify({ deleted }) }] };
    },
  );

  // --- Agent Memory tools ---

  server.tool(
    "set_agent_memory",
    "Save private memory for yourself. No scope = global. With project_id = per-project. With conversation_id = per-conversation. Content overwrites previous.",
    SetAgentMemorySchema.shape,
    async (args) => {
      let scope: "global" | "project" | "conversation" = "global";
      let scopeId: string | undefined;

      if (args.conversation_id) {
        scope = "conversation";
        scopeId = args.conversation_id;
        // Verify subscribed to the conversation
        const subscribed = await store.isSubscribed(args.conversation_id, agentId);
        if (!subscribed) return ACCESS_DENIED;
      } else if (args.project_id) {
        scope = "project";
        scopeId = args.project_id;
        // Verify project access
        const project = await store.getProject(args.project_id, agentId);
        if (!project) return ACCESS_DENIED;
      }

      const mem = await store.setAgentMemory(agentId, scope, args.content, scopeId);
      return { content: [{ type: "text" as const, text: JSON.stringify(mem, null, 2) }] };
    },
  );

  server.tool(
    "get_agent_memory",
    "Read your private memory. No scope = global. With project_id = per-project. With conversation_id = per-conversation.",
    GetAgentMemorySchema.shape,
    async (args) => {
      let scope: "global" | "project" | "conversation" = "global";
      let scopeId: string | undefined;

      if (args.conversation_id) {
        scope = "conversation";
        scopeId = args.conversation_id;
      } else if (args.project_id) {
        scope = "project";
        scopeId = args.project_id;
      }

      const mem = await store.getAgentMemory(agentId, scope, scopeId);
      if (!mem) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ content: null, scope }) }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(mem, null, 2) }] };
    },
  );

  server.tool(
    "delete_agent_memory",
    "Delete your private memory for a scope. No scope = global. With project_id = per-project. With conversation_id = per-conversation.",
    DeleteAgentMemorySchema.shape,
    async (args) => {
      let scope: "global" | "project" | "conversation" = "global";
      let scopeId: string | undefined;

      if (args.conversation_id) {
        scope = "conversation";
        scopeId = args.conversation_id;
      } else if (args.project_id) {
        scope = "project";
        scopeId = args.project_id;
      }

      const deleted = await store.deleteAgentMemory(agentId, scope, scopeId);
      return { content: [{ type: "text" as const, text: JSON.stringify({ deleted, scope }) }] };
    },
  );

  // --- Status tools ---

  server.tool(
    "get_status",
    "Get a summary: projects, active conversations, unread messages, online agents",
    GetStatusSchema.shape,
    async () => {
      const [projects, agents, unreadCount] = await Promise.all([
        store.listProjects(agentId),
        store.listAgents(),
        store.getUnreadCount(agentId),
      ]);

      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      const onlineAgents = agents.filter((a) => a.lastSeenAt > fiveMinAgo);

      const status = {
        projects: projects.length,
        agents: {
          total: agents.length,
          online: onlineAgents.length,
          names: onlineAgents.map((a) => a.name),
        },
        unread_messages: unreadCount,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }] };
    },
  );

  server.tool(
    "mark_read",
    "Mark messages as read in a conversation. Call this after every get_messages to avoid re-reading the same messages. Pass just conversation_id to mark all messages read.",
    MarkReadSchema.shape,
    async (args) => {
      if (args.up_to_message_id) {
        // Get all messages up to this ID and mark them
        const allMessages = await store.getMessages(args.conversation_id, agentId);
        const idx = allMessages.findIndex((m) => m.id === args.up_to_message_id);
        if (idx >= 0) {
          const toMark = allMessages.slice(0, idx + 1).map((m) => m.id);
          await store.markRead(toMark, agentId);
          return { content: [{ type: "text" as const, text: JSON.stringify({ marked: toMark.length }) }] };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify({ marked: 0, error: "Message not found" }) }] };
      }

      // Mark all messages in conversation
      const allMessages = await store.getMessages(args.conversation_id, agentId);
      const ids = allMessages.map((m) => m.id);
      await store.markRead(ids, agentId);
      return { content: [{ type: "text" as const, text: JSON.stringify({ marked: ids.length }) }] };
    },
  );

  // --- Access Request tools ---

  server.tool(
    "list_access_requests",
    "List pending access requests for a conversation you're subscribed to",
    ListAccessRequestsSchema.shape,
    async (args) => {
      // Verify caller is subscribed to the conversation
      const subscribed = await store.isSubscribed(args.conversation_id, agentId);
      if (!subscribed) return ACCESS_DENIED;

      const requests = await store.listAccessRequestsForConversation(args.conversation_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(requests, null, 2) }] };
    },
  );

  server.tool(
    "respond_to_access_request",
    "Approve, deny, or silently deny an access request. On approve, the requesting agent is auto-subscribed.",
    RespondToAccessRequestSchema.shape,
    async (args) => {
      const request = await store.getAccessRequest(args.request_id);
      if (!request) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Access request not found" }) }] };
      }

      // Verify caller is subscribed to the conversation
      const subscribed = await store.isSubscribed(request.conversationId, agentId);
      if (!subscribed) return ACCESS_DENIED;

      const statusMap: Record<string, "approved" | "denied" | "silent_denied"> = {
        approve: "approved",
        deny: "denied",
        silent_deny: "silent_denied",
      };
      const newStatus = statusMap[args.action];

      const updated = await store.respondToAccessRequest(args.request_id, newStatus, agentId);
      if (!updated) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Request already responded to" }) }] };
      }

      // On approve: auto-subscribe the requesting agent
      if (newStatus === "approved") {
        await store.subscribe(request.conversationId, request.agentId);
      }

      return { content: [{ type: "text" as const, text: JSON.stringify({ ...updated, action: args.action }) }] };
    },
  );

  server.tool(
    "get_my_access_requests",
    "Check the status of your own access requests. Note: silently denied requests appear as 'pending'.",
    GetMyAccessRequestsSchema.shape,
    async () => {
      const requests = await store.listAccessRequestsByAgent(agentId);
      // Mask silent_denied as pending — the requester should not know
      const masked = requests.map((r) => {
        if (r.status === "silent_denied") {
          const { respondedBy, respondedAt, ...rest } = r;
          return { ...rest, status: "pending" as const, respondedBy: null, respondedAt: null };
        }
        return r;
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(masked, null, 2) }] };
    },
  );

  return server;
}

export async function startBridgeServer(opts: BridgeServerOptions): Promise<{
  close: () => Promise<void>;
}> {
  const { store, auth, config } = opts;
  const bridgeConfig = config.bridge!;

  const rateLimiter = new RateLimiter(
    bridgeConfig.rateLimit.maxRequests,
    bridgeConfig.rateLimit.windowSeconds,
  );
  const maxBodySize = bridgeConfig.maxBodySize;

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      // Health endpoint
      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", version: PKG_VERSION }));
        return;
      }

      // Only handle /mcp path
      if (url.pathname !== "/mcp") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      // Auth check — extract Bearer token (required for all /mcp requests)
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

      if (!token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing Authorization header" }));
        return;
      }

      const authResult = await auth.authenticate(token);
      if (!authResult.authenticated) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: authResult.error ?? "Authentication failed" }));
        return;
      }

      // Rate limiting — per agent
      if (!rateLimiter.allow(authResult.agentId!)) {
        log.warn(`rate limited: agent ${authResult.agentName} (${authResult.agentId})`);
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(bridgeConfig.rateLimit.windowSeconds) });
        res.end(JSON.stringify({ error: "Too many requests" }));
        return;
      }

      // Body size check (for POST/PUT)
      if (req.method === "POST" || req.method === "PUT") {
        const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
        if (contentLength > maxBodySize) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Request body too large (max ${maxBodySize} bytes)` }));
          return;
        }
      }

      // Handle DELETE for session termination
      if (req.method === "DELETE") {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (sessionId && transports.has(sessionId)) {
          const transport = transports.get(sessionId)!;
          await transport.close();
          removeSession(sessionId);
          res.writeHead(200);
          res.end();
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not found" }));
        }
        return;
      }

      // Check for existing session (GET or POST)
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res);
        return;
      }

      if (sessionId && !transports.has(sessionId)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found. Start a new session without Mcp-Session-Id header." }));
        return;
      }

      // GET without session ID — cannot initialize via GET
      if (req.method === "GET") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "GET requires an existing session. Initialize with POST first." }));
        return;
      }

      // New session — create transport and MCP server scoped to this agent
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      const mcpServer = createBridgeMcpServer(store, authResult.agentId!);
      await mcpServer.connect(transport);

      // Track whether onclose fired before we finish registration
      let closedBeforeRegistered = false;

      transport.onclose = () => {
        if (transport.sessionId) {
          if (transports.has(transport.sessionId)) {
            removeSession(transport.sessionId);
            log.debug(`session closed: ${transport.sessionId}`);
          } else {
            // onclose fired before registration completed — flag it
            closedBeforeRegistered = true;
          }
        }
      };

      await transport.handleRequest(req, res);

      if (transport.sessionId && !closedBeforeRegistered) {
        transports.set(transport.sessionId, transport);
        sessionAuth.set(transport.sessionId, authResult);
        trackAgentSession(authResult.agentId!, transport.sessionId);
        log.info(`new session: ${transport.sessionId} (agent: ${authResult.agentName})`);
      }
    } catch (err) {
      log.error("request handler error:", err instanceof Error ? err.message : String(err));
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  });

  // --- SSE push notification dispatch ---

  const eventBusListeners = store.eventBus
    ? setupSSEDispatch(store)
    : (log.info("Store has no eventBus — SSE push notifications disabled, agents will use polling"), undefined);

  const host = bridgeConfig.host;
  const port = bridgeConfig.port;

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      log.info(`bridge server listening on http://${host}:${port}/mcp`);
      resolve();
    });
  });

  return {
    close: async () => {
      // Unsubscribe from event bus
      if (eventBusListeners && store.eventBus) {
        store.eventBus.offMessage(eventBusListeners.messageListener);
        store.eventBus.offAccessRequest(eventBusListeners.accessRequestListener);
        store.eventBus.offTaskCreated(eventBusListeners.taskCreatedListener);
        store.eventBus.offTaskUpdated(eventBusListeners.taskUpdatedListener);
      }

      // Close all active transports (best-effort — some may already be closed)
      for (const transport of transports.values()) {
        try { await transport.close(); } catch { /* already closed */ }
      }
      transports.clear();
      sessionAuth.clear();
      agentSessions.clear();

      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      log.info("bridge server stopped");
    },
  };
}

// --- Agent session tracking helpers ---

function trackAgentSession(agentId: string, sessionId: string): void {
  let sessions = agentSessions.get(agentId);
  if (!sessions) {
    sessions = new Set();
    agentSessions.set(agentId, sessions);
  }
  sessions.add(sessionId);
}

function removeSession(sessionId: string): void {
  const auth = sessionAuth.get(sessionId);
  if (auth?.agentId) {
    const sessions = agentSessions.get(auth.agentId);
    if (sessions) {
      sessions.delete(sessionId);
      if (sessions.size === 0) agentSessions.delete(auth.agentId);
    }
  }
  transports.delete(sessionId);
  sessionAuth.delete(sessionId);
}

// --- SSE push notification dispatch ---

function setupSSEDispatch(store: IStore): {
  messageListener: (event: MessageCreatedEvent) => void;
  accessRequestListener: (event: AccessRequestCreatedEvent) => void;
  taskCreatedListener: (event: TaskCreatedEvent) => void;
  taskUpdatedListener: (event: TaskUpdatedEvent) => void;
} {
  const messageListener = (event: MessageCreatedEvent) => {
    dispatchMessageNotification(store, event).catch((err) => {
      log.error(`SSE dispatch error: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const accessRequestListener = (event: AccessRequestCreatedEvent) => {
    dispatchAccessRequestNotification(store, event).catch((err) => {
      log.error(`SSE access-request dispatch error: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const taskCreatedListener = (event: TaskCreatedEvent) => {
    dispatchTaskNotification(event.task, "created").catch((err) => {
      log.error(`SSE task dispatch error: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const taskUpdatedListener = (event: TaskUpdatedEvent) => {
    dispatchTaskNotification(event.task, event.action).catch((err) => {
      log.error(`SSE task dispatch error: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  store.eventBus!.onMessage(messageListener);
  store.eventBus!.onAccessRequest(accessRequestListener);
  store.eventBus!.onTaskCreated(taskCreatedListener);
  store.eventBus!.onTaskUpdated(taskUpdatedListener);
  log.info("SSE push notifications enabled");
  return { messageListener, accessRequestListener, taskCreatedListener, taskUpdatedListener };
}

async function dispatchMessageNotification(store: IStore, event: MessageCreatedEvent): Promise<void> {
  const { message } = event;

  // Get all subscribers + all agents in one batch (avoids N+1 DB calls)
  const [subscribers, allAgents] = await Promise.all([
    store.getSubscribers(message.conversationId),
    store.listAgents(),
  ]);
  const agentMap = new Map(allAgents.map((a) => [a.id, a]));

  log.debug(`SSE dispatch: ${subscribers.length} sub(s), ${agentSessions.size} session group(s)`);

  // Build the notification payload (content preview, not full message)
  const contentPreview = message.content.length > 200
    ? message.content.slice(0, 200) + "..."
    : message.content;

  const notification: JSONRPCMessage = {
    jsonrpc: "2.0",
    method: "notifications/message",
    params: {
      conversationId: message.conversationId,
      messageId: message.id,
      fromAgent: message.fromAgent,
      type: message.type,
      visibility: message.visibility,
      contentPreview,
      createdAt: message.createdAt,
    },
  };

  const messageVisInt = VISIBILITY_ORDER[message.visibility];

  for (const sub of subscribers) {
    // Exclude sender — they already know about their own message
    if (sub.agentId === message.fromAgent) continue;

    // Visibility gate: agent clearance must be >= message visibility
    const agent = agentMap.get(sub.agentId);
    if (!agent) continue;

    const agentVisInt = VISIBILITY_ORDER[agent.clearanceLevel as VisibilityLevel];
    if (agentVisInt < messageVisInt) continue;

    // Whisper gate: if message has recipients, agent must be in the list
    if (message.recipients && !message.recipients.includes(sub.agentId)) continue;

    // Find all active sessions for this agent and push notification
    const sessions = agentSessions.get(sub.agentId);
    if (!sessions) continue;

    for (const sessionId of sessions) {
      const transport = transports.get(sessionId);
      if (!transport) continue;

      try {
        await transport.send(notification);
      } catch {
        // Fire-and-forget: transport may have disconnected (agent will fall back to polling)
        log.debug(`SSE send failed for session ${sessionId} (agent: ${agent.name})`);
      }
    }
  }
}

async function dispatchAccessRequestNotification(store: IStore, event: AccessRequestCreatedEvent): Promise<void> {
  const { accessRequest } = event;

  // Notify all subscribers of the conversation about the new access request
  const subscribers = await store.getSubscribers(accessRequest.conversationId);

  const notification: JSONRPCMessage = {
    jsonrpc: "2.0",
    method: "notifications/access_request",
    params: {
      conversationId: accessRequest.conversationId,
      requestId: accessRequest.id,
      agentId: accessRequest.agentId,
      agentName: accessRequest.agentName,
      createdAt: accessRequest.createdAt,
    },
  };

  for (const sub of subscribers) {
    const sessions = agentSessions.get(sub.agentId);
    if (!sessions) continue;

    for (const sessionId of sessions) {
      const transport = transports.get(sessionId);
      if (!transport) continue;

      try {
        await transport.send(notification);
      } catch {
        log.debug(`SSE access-request send failed for session ${sessionId}`);
      }
    }
  }
}

async function dispatchTaskNotification(task: import("../store/types.js").Task, action: string): Promise<void> {
  const notification: JSONRPCMessage = {
    jsonrpc: "2.0",
    method: "notifications/task",
    params: {
      taskId: task.id,
      projectId: task.projectId,
      conversationId: task.conversationId,
      title: task.title,
      status: task.status,
      action,
      createdBy: task.createdBy,
      claimedBy: task.claimedBy,
      updatedAt: task.updatedAt,
    },
  };

  // Project-level notification: push to all agents with active sessions
  for (const [, sessions] of agentSessions) {
    for (const sessionId of sessions) {
      const transport = transports.get(sessionId);
      if (!transport) continue;

      try {
        await transport.send(notification);
      } catch {
        log.debug(`SSE task send failed for session ${sessionId}`);
      }
    }
  }
}
