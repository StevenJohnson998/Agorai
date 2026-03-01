/**
 * Agent runner — connects a "dumb" model (Ollama, Groq, etc.) to the bridge.
 *
 * 1. Initializes MCP session with the bridge
 * 2. Registers agent + subscribes to conversations
 * 3. Poll loop (every 3s):
 *    - get_status → unread count
 *    - If unread > 0 → get_messages
 *    - Mode passive: respond only if @agent-name mentioned
 *    - Mode active: respond to everything
 *    - Build context (20 last messages) → callModel() → send_message
 * 4. Session recovery on bridge restart (SessionExpiredError → re-init)
 * 5. Health check monitor (exit after 10 consecutive failures)
 * 6. Graceful shutdown on SIGINT/SIGTERM
 */

import { McpClient, type ToolCallResult, type SSENotification } from "./mcp-client.js";
import { callModel, type ChatMessage, type ModelCallerOptions } from "./model-caller.js";
import { log, checkHealth, baseUrl } from "./utils.js";
import { SessionExpiredError, BridgeUnreachableError } from "./errors.js";
import { Backoff } from "./backoff.js";

export interface AgentOptions {
  bridgeUrl: string;
  passKey: string;
  model: string;
  endpoint: string;
  apiKey?: string;
  mode: "passive" | "active";
  pollIntervalMs?: number;
  systemPrompt?: string;
}

interface ConversationState {
  lastMessageTimestamp?: string;
}

/**
 * Run the agent loop. Blocks until SIGINT/SIGTERM.
 */
export async function runAgent(options: AgentOptions): Promise<void> {
  const {
    bridgeUrl,
    passKey,
    model,
    endpoint,
    apiKey,
    mode,
    pollIntervalMs = 3000,
    systemPrompt,
  } = options;

  const client = new McpClient({ bridgeUrl, passKey });
  const backoff = new Backoff();
  let running = true;

  // SSE push notification state
  const pendingConversations = new Set<string>();
  let sseConnected = false;
  let sseAbort: (() => void) | null = null;

  function startSSEStream(): void {
    // Close existing stream if any
    if (sseAbort) sseAbort();
    sseConnected = false;

    const controller = client.openSSEStream((notification: SSENotification) => {
      if (notification.method === "notifications/message") {
        const convId = notification.params.conversationId as string;
        if (convId) {
          pendingConversations.add(convId);
          log("debug", `SSE: notification for conversation ${convId}`);
        }
      }
    });

    sseAbort = () => controller.abort();
    sseConnected = true;
    log("info", "SSE push notifications enabled");
  }

  // Graceful shutdown
  const shutdown = async () => {
    if (!running) return;
    running = false;
    log("info", "Shutting down agent...");
    if (sseAbort) sseAbort();
    await client.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const conversationState = new Map<string, ConversationState>();
  let agentName = "";
  let myName = "unknown";
  let myId = "unknown";

  const modelOpts: ModelCallerOptions = { endpoint, model, apiKey };
  const defaultSystem = systemPrompt ??
    `You are ${model}, an AI agent participating in a multi-agent conversation on Agorai. ` +
    `Be concise and helpful. When replying, focus on your area of expertise.`;

  /**
   * Initialize (or re-initialize) the MCP session: init + register + subscribe.
   * Called at startup and after session recovery.
   */
  async function initializeSession(): Promise<void> {
    log("info", `Connecting to bridge at ${bridgeUrl}...`);
    const initResult = await client.initialize();
    log("info", `Connected. Server: ${JSON.stringify(initResult.serverInfo)}`);

    // Register agent
    const regResult = await client.callTool("register_agent", {
      name: model,
      type: "openai-compat",
      capabilities: ["chat"],
    });
    agentName = extractText(regResult);
    log("info", `Registered as: ${agentName}`);

    // Parse agent identity
    try {
      const reg = JSON.parse(agentName);
      myName = reg.name ?? "unknown";
      myId = reg.id ?? "unknown";
    } catch {
      myName = agentName;
    }

    // Re-subscribe to all known conversations + discover new ones
    for (const [convId] of conversationState) {
      try {
        await client.callTool("subscribe", { conversation_id: convId });
        log("debug", `Re-subscribed to ${convId}`);
      } catch {
        // May no longer exist
      }
    }

    // Initial discovery
    const newCount = await discoverConversations(client, conversationState);
    if (newCount > 0) {
      log("info", `Discovery: found ${newCount} new conversation(s)`);
    }
  }

  // Initial connection with backoff
  while (running) {
    try {
      await initializeSession();
      backoff.succeed();
      startSSEStream();
      break;
    } catch (err) {
      if (err instanceof BridgeUnreachableError) {
        log("error", `${err.message} — retrying...`);
        await backoff.wait();
      } else {
        throw err; // Unexpected error at startup — fail fast
      }
    }
  }

  if (!running) return;

  console.log(`Agent running (mode: ${mode}, model: ${model})`);
  console.log(`Polling every ${pollIntervalMs / 1000}s${sseConnected ? " + SSE push" : ""}. Press Ctrl+C to stop.\n`);

  // Health check state
  let consecutiveHealthFailures = 0;
  let lastHealthCheck = Date.now();
  let lastHeartbeat = Date.now();
  const healthIntervalMs = 30_000;
  const maxHealthFailures = 10;

  // Poll loop
  let pollCount = 0;
  const discoveryInterval = 5; // check for new conversations every N polls

  while (running) {
    try {
      pollCount++;
      const now = Date.now();

      // Heartbeat (~30s)
      if (now - lastHeartbeat >= healthIntervalMs) {
        log("info", `Heartbeat: agent alive, ${conversationState.size} conversation(s) tracked`);
        lastHeartbeat = now;
      }

      // Health check (~30s)
      if (now - lastHealthCheck >= healthIntervalMs) {
        lastHealthCheck = now;
        const health = await checkHealth(baseUrl(bridgeUrl));
        if (health.ok) {
          consecutiveHealthFailures = 0;
        } else {
          consecutiveHealthFailures++;
          log("error", `Health check failed (${consecutiveHealthFailures}/${maxHealthFailures}): ${health.error}`);
          if (consecutiveHealthFailures >= maxHealthFailures) {
            log("error", `${maxHealthFailures} consecutive health failures (~${Math.round(maxHealthFailures * healthIntervalMs / 60_000)}min) — exiting for process manager restart`);
            running = false;
            await client.close();
            process.exit(1);
          }
        }
      }

      // Periodically discover and subscribe to new conversations
      if (pollCount % discoveryInterval === 1 || conversationState.size === 0) {
        const newCount = await discoverConversations(client, conversationState);
        if (newCount > 0) {
          log("info", `Discovery: found ${newCount} new conversation(s)`);
        }
      }

      // Process conversations with SSE notifications first (instant response)
      if (pendingConversations.size > 0) {
        const pending = [...pendingConversations];
        pendingConversations.clear();
        log("debug", `SSE: processing ${pending.length} pending conversation(s)`);

        for (const convId of pending) {
          // Ensure we're tracking this conversation
          if (!conversationState.has(convId)) {
            conversationState.set(convId, {});
          }
          await processConversation(
            client,
            convId,
            conversationState,
            modelOpts,
            defaultSystem,
            myName,
            myId,
            mode,
          );
        }
      }

      // Full poll: check all conversations (catches anything SSE might have missed)
      for (const [convId] of conversationState) {
        const msgResult = await client.callTool("get_messages", {
          conversation_id: convId,
          unread_only: true,
          limit: 20,
        });
        const msgText = extractText(msgResult);

        let messages: Array<{ id: string; content: string; sender: string; fromAgent: string; timestamp: string; createdAt: string }>;
        try {
          const parsed = JSON.parse(msgText);
          messages = Array.isArray(parsed) ? parsed : parsed.messages ?? [];
        } catch {
          continue;
        }

        if (messages.length === 0) continue;

        log("debug", `${messages.length} new message(s) in ${convId}`);

        await processConversation(
          client,
          convId,
          conversationState,
          modelOpts,
          defaultSystem,
          myName,
          myId,
          mode,
        );
      }

      // Successful poll — reset backoff
      backoff.succeed();
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        log("info", "Session expired — reconnecting...");
        if (sseAbort) sseAbort();
        sseConnected = false;
        client.resetSession();
        try {
          await initializeSession();
          backoff.succeed();
          startSSEStream();
          log("info", "Reconnected successfully");
        } catch (initErr) {
          if (initErr instanceof BridgeUnreachableError) {
            log("error", `${initErr.message} — backing off...`);
            await backoff.wait();
          } else {
            log("error", `Reconnect failed: ${initErr instanceof Error ? initErr.message : String(initErr)}`);
            await backoff.wait();
          }
        }
      } else if (err instanceof BridgeUnreachableError) {
        log("error", `${err.message} — backing off...`);
        await backoff.wait();
      } else {
        log("error", `Poll error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await sleep(pollIntervalMs);
  }
}

/**
 * Discover new conversations across all projects. Returns count of newly found ones.
 */
async function discoverConversations(
  client: McpClient,
  states: Map<string, ConversationState>,
): Promise<number> {
  let newCount = 0;

  // List all projects first
  const projResult = await client.callTool("list_projects", {});
  const projText = extractText(projResult);
  let projects: Array<{ id: string }> = [];
  try {
    const parsed = JSON.parse(projText);
    projects = Array.isArray(parsed) ? parsed : parsed.projects ?? [];
  } catch {
    return 0;
  }

  // For each project, list conversations and subscribe to new ones
  for (const proj of projects) {
    const convResult = await client.callTool("list_conversations", { project_id: proj.id });
    const convText = extractText(convResult);
    let conversations: Array<{ id: string; title: string }> = [];
    try {
      const parsed = JSON.parse(convText);
      conversations = Array.isArray(parsed) ? parsed : parsed.conversations ?? [];
    } catch {
      continue;
    }

    for (const conv of conversations) {
      if (!states.has(conv.id)) {
        try {
          await client.callTool("subscribe", { conversation_id: conv.id });
          states.set(conv.id, {});
          log("info", `Subscribed to: ${conv.title ?? conv.id}`);
          newCount++;
        } catch {
          // Already subscribed or other issue
        }
      }
    }
  }

  return newCount;
}

async function processConversation(
  client: McpClient,
  conversationId: string,
  states: Map<string, ConversationState>,
  modelOpts: ModelCallerOptions,
  systemPrompt: string,
  myName: string,
  myId: string,
  mode: "passive" | "active",
): Promise<void> {
  const state = states.get(conversationId) ?? {};

  // Get messages (recent, to build context)
  const getArgs: Record<string, unknown> = {
    conversation_id: conversationId,
    limit: 20,
  };
  if (state.lastMessageTimestamp) {
    getArgs.since = state.lastMessageTimestamp;
  }

  const msgResult = await client.callTool("get_messages", getArgs);
  const msgText = extractText(msgResult);

  // Bridge returns messages with fromAgent (ID or name) and createdAt
  let messages: Array<{ id: string; content: string; fromAgent: string; sender?: string; createdAt: string; timestamp?: string }>;
  try {
    const parsed = JSON.parse(msgText);
    messages = Array.isArray(parsed) ? parsed : parsed.messages ?? [];
  } catch {
    return;
  }

  if (messages.length === 0) return;

  // Update timestamp to latest
  const latest = messages[messages.length - 1];
  state.lastMessageTimestamp = latest.createdAt ?? latest.timestamp;
  states.set(conversationId, state);

  // Resolve sender field (bridge may use fromAgent or sender)
  const getSender = (m: typeof messages[0]) => m.sender ?? m.fromAgent ?? "unknown";

  // Filter out our own messages (match on agent id and name)
  const otherMessages = messages.filter((m) => {
    const sender = getSender(m);
    return sender !== myName && sender !== myId && !sender.includes(myName);
  });
  if (otherMessages.length === 0) return;

  // Passive mode: only respond if @mentioned
  if (mode === "passive") {
    const mentionPattern = new RegExp(`@${myName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    const hasMention = otherMessages.some((m) => mentionPattern.test(m.content));
    if (!hasMention) {
      log("info", `Skipping ${otherMessages.length} message(s) in ${conversationId} (no @mention)`);
      await client.callTool("mark_read", { conversation_id: conversationId });
      return;
    }
  }

  // Build context for the model
  const chatMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const msg of messages) {
    const sender = getSender(msg);
    const isOurs = sender === myName || sender.includes(myName);
    chatMessages.push({
      role: isOurs ? "assistant" : "user",
      content: `[${sender}]: ${msg.content}`,
    });
  }

  // Call the model — mark_read ONLY after successful send
  try {
    log("info", `Generating response for conversation ${conversationId}...`);
    const response = await callModel(chatMessages, modelOpts);

    // Send response to bridge
    await client.callTool("send_message", {
      conversation_id: conversationId,
      content: response.content,
      type: "message",
    });

    log("info", `Replied in ${conversationId} (${response.durationMs}ms, ${response.completionTokens} tokens)`);

    // Mark as read AFTER successful send — on failure, messages stay unread for retry
    await client.callTool("mark_read", { conversation_id: conversationId });
    log("debug", `Marked messages read in ${conversationId}`);
  } catch (err) {
    log("error", `Model/send failed in ${conversationId}: ${err instanceof Error ? err.message : String(err)}`);
    // Messages NOT marked read — they will be retried on next poll
  }
}

export function extractText(result: ToolCallResult): string {
  if (result.content.length === 0) return "";
  return result.content.map((c) => c.text).join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
