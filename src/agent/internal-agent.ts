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
import type { MessageCreatedEvent } from "../store/events.js";
import { buildAgentContext, renderForPrompt } from "./context.js";
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
  decisionDepth?: number;
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
    decisionDepth,
  } = options;

  // systemPrompt from options is used as override; otherwise built from AgentContext
  const customSystemPrompt = systemPrompt;

  // Track subscribed conversations
  const subscribedConversations = new Set<string>();
  let lastHeartbeat = Date.now();
  const heartbeatIntervalMs = 30_000;

  // Track agent health status (DB-only, no broadcast messages)
  let currentStatus: "online" | "error" = "online";
  let isFirstRun = true;

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
      await discoverConversations(store, resolvedAgentId, agentName, subscribedConversations, isFirstRun);
      isFirstRun = false;

      // Helper: process a conversation and update DB health status (no broadcast messages)
      const processAndTrack = async (convId: string) => {
        const result = await processConversation(
          store,
          adapter,
          convId,
          resolvedAgentId,
          agentName,
          mode,
          customSystemPrompt,
          decisionDepth,
        );

        if (result === "error" && currentStatus !== "error") {
          currentStatus = "error";
          await store.updateAgentStatus(resolvedAgentId, "error", "API error");
          log.warn(`Status changed to ERROR for ${agentName}`);
        } else if (result === "ok" && currentStatus === "error") {
          currentStatus = "online";
          await store.updateAgentStatus(resolvedAgentId, "online");
          log.info(`Status recovered to ONLINE for ${agentName}`);
        }
      };

      // Track conversations already handled this cycle (avoid double-processing)
      const processedThisCycle = new Set<string>();

      // Process pending conversations from event bus first (instant response)
      if (pendingConversations.size > 0) {
        const pending = [...pendingConversations];
        pendingConversations.clear();
        log.debug(`Event bus: processing ${pending.length} pending conversation(s)`);

        for (const convId of pending) {
          if (signal?.aborted) break;
          if (!subscribedConversations.has(convId)) continue;
          await processAndTrack(convId);
          processedThisCycle.add(convId);
        }
      }

      // Full poll: process all subscribed conversations (catches anything event bus missed)
      for (const convId of subscribedConversations) {
        if (signal?.aborted) break;
        if (processedThisCycle.has(convId)) continue;
        await processAndTrack(convId);
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
 * Posts "joined" system message only for conversations that already have activity
 * (avoids spam on initial startup when subscribing to all existing conversations).
 */
async function discoverConversations(
  store: IStore,
  agentId: string,
  agentName: string,
  tracked: Set<string>,
  isFirstRun: boolean,
): Promise<void> {
  const projects = await store.listProjects(agentId);

  for (const project of projects) {
    const conversations = await store.listConversations(project.id, agentId);

    for (const conv of conversations) {
      if (!tracked.has(conv.id)) {
        const alreadySubscribed = await store.isSubscribed(conv.id, agentId);
        if (!alreadySubscribed) {
          await store.subscribe(conv.id, agentId);
          // Post "joined" message only if conversation has messages and it's not first run
          if (!isFirstRun) {
            const msgs = await store.getMessages(conv.id, agentId, { limit: 1 });
            if (msgs.length > 0) {
              await store.sendMessage({
                conversationId: conv.id,
                fromAgent: agentId,
                content: `📥 ${agentName} joined the conversation.`,
                type: "status",
              });
            }
          }
        }
        tracked.add(conv.id);
        log.info(`Subscribed to: ${conv.title} (${conv.id})`);
      }
    }
  }
}

/**
 * Process a single conversation: get unread, filter, respond, mark read.
 */
/**
 * Process a single conversation. Returns "ok" | "skipped" | "error".
 */
async function processConversation(
  store: IStore,
  adapter: IAgentAdapter,
  conversationId: string,
  agentId: string,
  agentName: string,
  mode: "passive" | "active",
  customSystemPrompt?: string,
  decisionDepth?: number,
): Promise<"ok" | "skipped" | "error"> {
  // Get unread messages
  const unreadMessages = await store.getMessages(conversationId, agentId, {
    unreadOnly: true,
    limit: 20,
  });

  if (unreadMessages.length === 0) return "skipped";

  // Filter out own messages and status messages (status msgs should not trigger responses)
  const otherMessages = unreadMessages.filter((m) => m.fromAgent !== agentId && m.type !== "status");
  if (otherMessages.length === 0) {
    // Only our own messages or status messages — mark them read and move on
    await store.markRead(unreadMessages.map((m) => m.id), agentId);
    return "skipped";
  }

  // Check for @mention
  const mentionPattern = new RegExp(
    `@${agentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    "i",
  );
  const hasMention = otherMessages.some((m) => mentionPattern.test(m.content));

  // Passive mode: only respond if @mentioned
  if (mode === "passive" && !hasMention) {
    log.info(`Skipping ${otherMessages.length} message(s) in ${conversationId} (no @mention, passive)`);
    await store.markRead(unreadMessages.map((m) => m.id), agentId);
    return "skipped";
  }

  // Active mode: anti-loop guard with collaboration window.
  // Agents respond to human/external messages always. For internal-only messages,
  // allow up to `decisionDepth` rounds of inter-agent collaboration after the last
  // human message, then stop to prevent infinite ping-pong.
  if (mode === "active" && !hasMention) {
    const hasNonInternalSender = await (async () => {
      for (const msg of otherMessages) {
        const sender = await store.getAgent(msg.fromAgent);
        if (sender && sender.type !== "internal") return true;
      }
      return false;
    })();

    if (!hasNonInternalSender) {
      // All unread are from internal agents. Check if we're within the collaboration window.
      // Count consecutive internal-only messages since the last human/external message.
      const maxRounds = decisionDepth ?? 3;
      const recentMessages = await store.getMessages(conversationId, agentId, { limit: 50 });

      let internalRounds = 0;
      // Walk backwards from the most recent message
      for (let i = recentMessages.length - 1; i >= 0; i--) {
        const msg = recentMessages[i];
        // Skip status messages entirely (system noise — whispers, join/leave, etc.)
        if (msg.type === "status") continue;
        const sender = await store.getAgent(msg.fromAgent);
        // Skip system agent messages (agorai-system)
        if (sender && sender.type === "system") continue;
        // Hit a human or external agent message — stop counting
        if (!sender || sender.type !== "internal") break;
        internalRounds++;
      }

      // Each "round" = all agents respond once. With N agents, N messages = 1 round.
      // Use a generous threshold: maxRounds * number of known internal agents in conversation.
      const subscribers = await store.getSubscribers(conversationId);
      const internalSubCount = await (async () => {
        let count = 0;
        for (const sub of subscribers) {
          const a = await store.getAgent(sub.agentId);
          if (a && a.type === "internal") count++;
        }
        return Math.max(count, 1);
      })();

      const maxInternalMessages = maxRounds * internalSubCount;

      if (internalRounds >= maxInternalMessages) {
        log.info(`Skipping in ${conversationId}: ${internalRounds} internal messages since last human (limit: ${maxInternalMessages}, depth: ${maxRounds})`);
        await store.markRead(unreadMessages.map((m) => m.id), agentId);
        return "skipped";
      }

      log.info(`Collaboration window: ${internalRounds}/${maxInternalMessages} internal messages — continuing`);
    }
  }

  // Build full context from store (identity, rules, skills, memory, messages)
  const context = await buildAgentContext({
    store,
    agentId,
    conversationId,
    includeMessages: true,
    messageLimit: 20,
    decisionDepth,
  });
  const rendered = renderForPrompt(context, mode);

  // Call adapter — mark read ONLY after successful send
  try {
    log.info(`Generating response for conversation ${conversationId}...`);
    const invokeOpts: AgentInvokeOptions = {
      prompt: rendered.conversationPrompt,
      systemPrompt: customSystemPrompt ?? rendered.systemPrompt,
    };
    const response = await adapter.invoke(invokeOpts);

    // Let the LLM opt out of responding
    const trimmed = response.content.trim();
    if (!trimmed || trimmed === "[NO_RESPONSE]") {
      log.debug(`No response needed for ${conversationId} — marking read`);
      await store.markRead(unreadMessages.map((m) => m.id), agentId);
      return "ok";
    }

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
    return "ok";
  } catch (err) {
    log.error(`Adapter/send failed in ${conversationId}: ${err instanceof Error ? err.message : String(err)}`);
    // Messages NOT marked read — they will be retried on next poll
    return "error";
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
