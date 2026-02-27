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
 * 4. Graceful shutdown on SIGINT/SIGTERM
 */

import { McpClient, type ToolCallResult } from "./mcp-client.js";
import { callModel, type ChatMessage, type ModelCallerOptions } from "./model-caller.js";
import { log } from "./utils.js";

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
  let running = true;

  // Graceful shutdown
  const shutdown = async () => {
    if (!running) return;
    running = false;
    log("info", "Shutting down agent...");
    await client.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Initialize MCP session
  log("info", `Connecting to bridge at ${bridgeUrl}...`);
  const initResult = await client.initialize();
  log("info", `Connected. Server: ${JSON.stringify(initResult.serverInfo)}`);

  // Register agent
  const regResult = await client.callTool("register_agent", {
    name: `${model}-agent`,
    type: "openai-compat",
    capabilities: ["chat"],
  });
  const agentName = extractText(regResult);
  log("info", `Registered as: ${agentName}`);

  // Subscribe to all conversations
  const convResult = await client.callTool("list_conversations", {});
  const convText = extractText(convResult);
  let conversations: Array<{ id: string; title: string }> = [];
  try {
    const parsed = JSON.parse(convText);
    conversations = Array.isArray(parsed) ? parsed : parsed.conversations ?? [];
  } catch {
    log("debug", "No existing conversations to subscribe to");
  }

  const conversationState = new Map<string, ConversationState>();

  for (const conv of conversations) {
    try {
      await client.callTool("subscribe", { conversation_id: conv.id });
      conversationState.set(conv.id, {});
      log("info", `Subscribed to: ${conv.title} (${conv.id})`);
    } catch (err) {
      log("error", `Failed to subscribe to ${conv.id}: ${err}`);
    }
  }

  const modelOpts: ModelCallerOptions = { endpoint, model, apiKey };
  const defaultSystem = systemPrompt ??
    `You are ${model}, an AI agent participating in a multi-agent conversation on Agorai. ` +
    `Be concise and helpful. When replying, focus on your area of expertise.`;

  console.log(`Agent running (mode: ${mode}, model: ${model})`);
  console.log(`Polling every ${pollIntervalMs / 1000}s. Press Ctrl+C to stop.\n`);

  // Poll loop
  let pollCount = 0;
  const discoveryInterval = 5; // check for new conversations every N polls

  while (running) {
    try {
      pollCount++;

      // Periodically discover and subscribe to new conversations
      if (pollCount % discoveryInterval === 1 || conversationState.size === 0) {
        await discoverConversations(client, conversationState);
      }

      // Check each subscribed conversation for new messages
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
          agentName,
          mode,
        );
      }
    } catch (err) {
      log("error", `Poll error: ${err instanceof Error ? err.message : String(err)}`);
    }

    await sleep(pollIntervalMs);
  }
}

async function discoverConversations(
  client: McpClient,
  states: Map<string, ConversationState>,
): Promise<void> {
  // List all projects first
  const projResult = await client.callTool("list_projects", {});
  const projText = extractText(projResult);
  let projects: Array<{ id: string }> = [];
  try {
    const parsed = JSON.parse(projText);
    projects = Array.isArray(parsed) ? parsed : parsed.projects ?? [];
  } catch {
    return;
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
        } catch {
          // Already subscribed or other issue
        }
      }
    }
  }
}

async function processConversation(
  client: McpClient,
  conversationId: string,
  states: Map<string, ConversationState>,
  modelOpts: ModelCallerOptions,
  systemPrompt: string,
  agentName: string,
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

  // Filter out our own messages (match on agent name in the registered info)
  // agentName is the raw JSON from register_agent, parse the actual name
  let myName = "unknown";
  try {
    const reg = JSON.parse(agentName);
    myName = reg.name ?? reg.id ?? "unknown";
  } catch {
    myName = agentName;
  }

  const otherMessages = messages.filter((m) => {
    const sender = getSender(m);
    return sender !== myName && !sender.includes(myName);
  });
  if (otherMessages.length === 0) return;

  // Passive mode: only respond if @mentioned
  if (mode === "passive") {
    const mentionPattern = new RegExp(`@${myName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    const hasMention = otherMessages.some((m) => mentionPattern.test(m.content));
    if (!hasMention) {
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

  // Call the model
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
  } catch (err) {
    log("error", `Model call failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Mark messages as read
  await client.callTool("mark_read", { conversation_id: conversationId });
}

function extractText(result: ToolCallResult): string {
  if (result.content.length === 0) return "";
  return result.content.map((c) => c.text).join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
