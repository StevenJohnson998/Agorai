/**
 * Bridge HTTP server — Streamable HTTP transport for the MCP bridge.
 *
 * Exposes 16 bridge tools + debate tools over HTTP.
 * Auth is handled via API key in Authorization header.
 * Each request is authenticated before being passed to the MCP handler.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IStore } from "../store/interfaces.js";
import type { IAuthProvider, AuthResult } from "./auth.js";
import type { Config } from "../config.js";
import { createLogger } from "../logger.js";

import {
  RegisterAgentSchema,
  ListBridgeAgentsSchema,
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
} from "./tools.js";

const log = createLogger("bridge");

/** Per-session context: maps transport sessionId → agent auth. */
const sessionAuth = new Map<string, AuthResult>();

/** Active transports keyed by sessionId. */
const transports = new Map<string, StreamableHTTPServerTransport>();

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

function createBridgeMcpServer(store: IStore, agentId: string): McpServer {
  const server = new McpServer({
    name: "agorai-bridge",
    version: "0.2.0",
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
    async (_args) => {
      const agents = await store.listAgents();
      // Strip apiKeyHash from response
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
    "Subscribe to a conversation",
    SubscribeSchema.shape,
    async (args) => {
      await store.subscribe(args.conversation_id, agentId, {
        historyAccess: args.history_access,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify({ subscribed: true, conversation_id: args.conversation_id }) }] };
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
    "Send a message in a conversation (visibility capped at your clearance)",
    SendMessageSchema.shape,
    async (args) => {
      const message = await store.sendMessage({
        conversationId: args.conversation_id,
        fromAgent: agentId,
        type: args.type,
        visibility: args.visibility,
        content: args.content,
        metadata: args.metadata as Record<string, unknown> | undefined,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(message, null, 2) }] };
    },
  );

  server.tool(
    "get_messages",
    "Get messages from a conversation (filtered by your clearance)",
    GetMessagesSchema.shape,
    async (args) => {
      const messages = await store.getMessages(args.conversation_id, agentId, {
        since: args.since,
        unreadOnly: args.unread_only,
        limit: args.limit,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(messages, null, 2) }] };
    },
  );

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
    "Mark messages as read in a conversation",
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
        res.end(JSON.stringify({ status: "ok", version: "0.2.0" }));
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
          transports.delete(sessionId);
          sessionAuth.delete(sessionId);
          res.writeHead(200);
          res.end();
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not found" }));
        }
        return;
      }

      // Check for existing session
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

      // New session — create transport and MCP server scoped to this agent
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      const mcpServer = createBridgeMcpServer(store, authResult.agentId!);
      await mcpServer.connect(transport);

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
          sessionAuth.delete(transport.sessionId);
          log.debug(`session closed: ${transport.sessionId}`);
        }
      };

      await transport.handleRequest(req, res);

      if (transport.sessionId) {
        transports.set(transport.sessionId, transport);
        sessionAuth.set(transport.sessionId, authResult);
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
      // Close all active transports
      for (const transport of transports.values()) {
        await transport.close();
      }
      transports.clear();
      sessionAuth.clear();

      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      log.info("bridge server stopped");
    },
  };
}
