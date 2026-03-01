/**
 * Internal agent runner — runs an AI agent inside the bridge process.
 *
 * Mirrors the agorai-connect agent pattern but uses IStore directly
 * instead of McpClient HTTP calls (no network round-trip, no auth overhead).
 *
 * Lifecycle:
 * 1. Register agent in store with synthetic API key hash
 * 2. Poll loop (every pollIntervalMs):
 *    - Discover projects → list conversations → subscribe
 *    - Get unread messages → filter own → @mention check (passive)
 *    - Build context (20 msgs) → call adapter.invoke() → sendMessage
 *    - Mark read ONLY after successful send
 * 3. Graceful shutdown via AbortSignal or SIGINT/SIGTERM
 */

import type { IStore } from "../store/interfaces.js";
import type { IAgentAdapter, AgentInvokeOptions } from "../adapters/base.js";
import type { Message } from "../store/types.js";
import type { MessageCreatedEvent } from "../store/events.js";
import { createLogger } from "../logger.js";

const log = createLogger("internal-agent");

export interface InternalAgentOptions {
  store: IStore;
  adapter: IAgentAdapter;
  agentId: string;
  agentName: string;
  mode: "passive" | "active";
  pollIntervalMs?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
}

/**
 * Run an internal agent loop. Blocks until AbortSignal fires or SIGINT/SIGTERM.
 */
export async function runInternalAgent(options: InternalAgentOptions): Promise<void> {
  const {
    store,
    adapter,
    agentId,
    agentName,
    mode,
    pollIntervalMs = 3000,
    systemPrompt,
    signal,
  } = options;

  const defaultSystem = systemPrompt ??
    `You are ${agentName}, an AI agent participating in a multi-agent conversation on Agorai. ` +
    `Be concise and helpful. When replying, focus on your area of expertise.`;

  // Track subscribed conversations
  const subscribedConversations = new Set<string>();
  let lastHeartbeat = Date.now();
  const heartbeatIntervalMs = 30_000;

  log.info(`Internal agent "${agentName}" starting (mode: ${mode}, poll: ${pollIntervalMs}ms)`);

  // Register agent in store
  const agent = await store.registerAgent({
    name: agentName,
    type: "internal",
    capabilities: ["chat"],
    clearanceLevel: "team",
    apiKeyHash: `internal:${agentName}`,
  });
  const resolvedAgentId = agent.id;

  log.info(`Registered as ${agentName} (${resolvedAgentId})`);

  // Subscribe to event bus for instant notifications (no HTTP overhead)
  const pendingConversations = new Set<string>();
  let eventBusActive = false;
  let eventBusCleanup: (() => void) | null = null;

  if (store.eventBus) {
    const onMessage = (event: MessageCreatedEvent) => {
      // Only track conversations where we're NOT the sender
      if (event.message.fromAgent !== resolvedAgentId) {
        pendingConversations.add(event.message.conversationId);
      }
    };
    store.eventBus.onMessage(onMessage);
    eventBusActive = true;
    eventBusCleanup = () => store.eventBus!.offMessage(onMessage);
    log.info("Event bus subscription active (instant notifications)");

    // Clean up on abort signal
    if (signal) {
      signal.addEventListener("abort", eventBusCleanup, { once: true });
    }
  }

  // Poll loop
  while (!signal?.aborted) {
    try {
      const now = Date.now();

      // Heartbeat
      if (now - lastHeartbeat >= heartbeatIntervalMs) {
        log.info(`Heartbeat: ${agentName} alive, ${subscribedConversations.size} conversation(s) tracked${eventBusActive ? " + event bus" : ""}`);
        lastHeartbeat = now;
      }

      // Update last seen
      await store.updateAgentLastSeen(resolvedAgentId);

      // Discover and subscribe to conversations
      await discoverConversations(store, resolvedAgentId, subscribedConversations);

      // Process pending conversations from event bus first (instant response)
      if (pendingConversations.size > 0) {
        const pending = [...pendingConversations];
        pendingConversations.clear();
        log.debug(`Event bus: processing ${pending.length} pending conversation(s)`);

        for (const convId of pending) {
          if (signal?.aborted) break;
          // Ensure we're subscribed to this conversation
          if (!subscribedConversations.has(convId)) continue;

          await processConversation(
            store,
            adapter,
            convId,
            resolvedAgentId,
            agentName,
            mode,
            defaultSystem,
          );
        }
      }

      // Full poll: process all subscribed conversations (catches anything event bus missed)
      for (const convId of subscribedConversations) {
        if (signal?.aborted) break;

        await processConversation(
          store,
          adapter,
          convId,
          resolvedAgentId,
          agentName,
          mode,
          defaultSystem,
        );
      }
    } catch (err) {
      log.error(`Poll error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Wait for next poll (interruptible via AbortSignal)
    await interruptibleSleep(pollIntervalMs, signal);
  }

  // Clean up event bus listener (covers both signal and no-signal cases)
  if (eventBusCleanup) eventBusCleanup();

  log.info(`Internal agent "${agentName}" stopped`);
}

/**
 * Discover new conversations across all projects. Subscribe to any not yet tracked.
 */
async function discoverConversations(
  store: IStore,
  agentId: string,
  tracked: Set<string>,
): Promise<void> {
  const projects = await store.listProjects(agentId);

  for (const project of projects) {
    const conversations = await store.listConversations(project.id, agentId);

    for (const conv of conversations) {
      if (!tracked.has(conv.id)) {
        await store.subscribe(conv.id, agentId);
        tracked.add(conv.id);
        log.info(`Subscribed to: ${conv.title} (${conv.id})`);
      }
    }
  }
}

/**
 * Process a single conversation: get unread, filter, respond, mark read.
 */
async function processConversation(
  store: IStore,
  adapter: IAgentAdapter,
  conversationId: string,
  agentId: string,
  agentName: string,
  mode: "passive" | "active",
  systemPrompt: string,
): Promise<void> {
  // Get unread messages
  const unreadMessages = await store.getMessages(conversationId, agentId, {
    unreadOnly: true,
    limit: 20,
  });

  if (unreadMessages.length === 0) return;

  // Filter out own messages
  const otherMessages = unreadMessages.filter((m) => m.fromAgent !== agentId);
  if (otherMessages.length === 0) {
    // Only our own messages — mark them read and move on
    await store.markRead(unreadMessages.map((m) => m.id), agentId);
    return;
  }

  // Passive mode: only respond if @mentioned
  if (mode === "passive") {
    const mentionPattern = new RegExp(
      `@${agentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      "i",
    );
    const hasMention = otherMessages.some((m) => mentionPattern.test(m.content));
    if (!hasMention) {
      log.info(`Skipping ${otherMessages.length} message(s) in ${conversationId} (no @mention)`);
      await store.markRead(unreadMessages.map((m) => m.id), agentId);
      return;
    }
  }

  // Build context: get last 20 messages (not just unread) for full context
  const contextMessages = await store.getMessages(conversationId, agentId, { limit: 20 });

  // Resolve agent names for context display
  const agentNameCache = new Map<string, string>();
  agentNameCache.set(agentId, agentName);

  const promptParts: string[] = [];
  for (const msg of contextMessages) {
    let senderName = agentNameCache.get(msg.fromAgent);
    if (!senderName) {
      const senderAgent = await store.getAgent(msg.fromAgent);
      senderName = senderAgent?.name ?? msg.fromAgent;
      agentNameCache.set(msg.fromAgent, senderName);
    }

    const role = msg.fromAgent === agentId ? "you" : senderName;
    promptParts.push(`[${role}]: ${msg.content}`);
  }

  const prompt = promptParts.join("\n\n");

  // Call adapter — mark read ONLY after successful send
  try {
    log.info(`Generating response for conversation ${conversationId}...`);
    const invokeOpts: AgentInvokeOptions = {
      prompt,
      systemPrompt,
    };
    const response = await adapter.invoke(invokeOpts);

    // Send response to store
    await store.sendMessage({
      conversationId,
      fromAgent: agentId,
      content: response.content,
      type: "message",
    });

    log.info(`Replied in ${conversationId} (${response.durationMs}ms)`);

    // Mark as read AFTER successful send
    await store.markRead(unreadMessages.map((m) => m.id), agentId);
    log.debug(`Marked ${unreadMessages.length} messages read in ${conversationId}`);
  } catch (err) {
    log.error(`Adapter/send failed in ${conversationId}: ${err instanceof Error ? err.message : String(err)}`);
    // Messages NOT marked read — they will be retried on next poll
  }
}

/**
 * Sleep that can be interrupted by an AbortSignal.
 */
function interruptibleSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);

    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
