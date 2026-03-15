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

  // 429 rate-limit cooldown: exponential backoff per agent
  let cooldownUntil = 0;
  let consecutiveRateLimits = 0;

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

      // Skip processing if in 429 cooldown
      if (now < cooldownUntil) {
        await interruptibleSleep(pollIntervalMs, signal);
        continue;
      }

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

        if (result === "rate_limited") {
          consecutiveRateLimits++;
          const backoffMs = Math.min(30_000 * Math.pow(2, consecutiveRateLimits - 1), 300_000); // 30s, 60s, 120s, 240s, max 5min
          cooldownUntil = Date.now() + backoffMs;
          log.warn(`Rate limited — cooldown ${backoffMs / 1000}s (attempt ${consecutiveRateLimits})`);
        } else if (result === "error" && currentStatus !== "error") {
          currentStatus = "error";
          await store.updateAgentStatus(resolvedAgentId, "error", "API error");
          log.warn(`Status changed to ERROR for ${agentName}`);
        } else if (result === "ok") {
          if (consecutiveRateLimits > 0) {
            consecutiveRateLimits = 0;
            cooldownUntil = 0;
          }
          if (currentStatus === "error") {
            currentStatus = "online";
            await store.updateAgentStatus(resolvedAgentId, "online");
            log.info(`Status recovered to ONLINE for ${agentName}`);
          }
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
 * Discover conversations the agent is already subscribed to and track them.
 * Agents no longer auto-subscribe — they must be explicitly added to conversations
 * (by the creator, via GUI, or via MCP subscribe tool).
 */
async function discoverConversations(
  store: IStore,
  agentId: string,
  _agentName: string,
  tracked: Set<string>,
  _isFirstRun: boolean,
): Promise<void> {
  const projects = await store.listProjects(agentId);

  for (const project of projects) {
    const conversations = await store.listConversations(project.id, agentId);

    for (const conv of conversations) {
      if (!tracked.has(conv.id)) {
        const alreadySubscribed = await store.isSubscribed(conv.id, agentId);
        if (alreadySubscribed) {
          tracked.add(conv.id);
          log.info(`Tracking conversation: ${conv.title} (${conv.id})`);
        }
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
): Promise<"ok" | "skipped" | "error" | "rate_limited"> {
  // Get unread messages
  const unreadMessages = await store.getMessages(conversationId, agentId, {
    unreadOnly: true,
    limit: 20,
  });

  if (unreadMessages.length === 0) return "skipped";

  // ---------------------------------------------------------------------------
  // Keryx gateway: if conversation is Keryx-managed, agents only respond when
  // Keryx opens a round and mentions them. All other messages are marked read
  // silently. Context is cut off at the round-open timestamp so agents don't
  // see other agents' current-round responses (independent, unbiased answers).
  // ---------------------------------------------------------------------------
  const isKeryxManaged = await (async () => {
    const subscribers = await store.getSubscribers(conversationId);
    for (const sub of subscribers) {
      const agent = await store.getAgent(sub.agentId);
      if (agent && (agent.name === "keryx" || agent.type === "orchestrator")) return true;
    }
    return false;
  })();

  if (isKeryxManaged) {
    const mentionPattern = new RegExp(
      `@${agentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      "i",
    );

    // Find the latest Keryx round-open message in unread
    const keryxRoundOpen = [...unreadMessages].reverse().find(
      (m) => m.type === "status" && m.tags?.includes("keryx") && /Round \d+/i.test(m.content) && /Participants:/.test(m.content),
    );

    // Also detect Keryx direct requests (synthesis, nudge) — Keryx status messages
    // that @mention us and ask for action. Exclude pattern warnings (🔁 loop, 📐 drift,
    // ⚠️ domination) which are informational, not actionable.
    const keryxActionPattern = /🔄|Please synthesize|⏰|Please respond/;
    const keryxDirectRequest = !keryxRoundOpen
      ? [...unreadMessages].reverse().find(
          (m) => m.type === "status" && m.tags?.includes("keryx") && mentionPattern.test(m.content) && keryxActionPattern.test(m.content),
        )
      : null;

    if (!keryxRoundOpen && !keryxDirectRequest) {
      // No actionable Keryx message in unread — mark everything read silently
      log.debug(`Keryx-managed ${conversationId}: no round-open or direct request — waiting`);
      await store.markRead(unreadMessages.map((m) => m.id), agentId);
      return "skipped";
    }

    // The Keryx message we're responding to (round-open or direct request)
    const keryxTrigger = keryxRoundOpen ?? keryxDirectRequest!;

    // For round-open: check if we're listed as a participant
    if (keryxRoundOpen && !mentionPattern.test(keryxRoundOpen.content)) {
      log.debug(`Keryx round in ${conversationId} doesn't include us — skipping`);
      await store.markRead(unreadMessages.map((m) => m.id), agentId);
      return "skipped";
    }

    // Check if we already responded after this Keryx trigger
    const recentMsgs = await store.getMessages(conversationId, agentId, { limit: 30 });
    const triggerIdx = recentMsgs.findIndex((m) => m.id === keryxTrigger.id);
    if (triggerIdx >= 0) {
      const msgsAfterTrigger = recentMsgs.slice(triggerIdx + 1);
      if (msgsAfterTrigger.some((m) => m.fromAgent === agentId && m.type !== "status")) {
        log.info(`Already responded to Keryx trigger in ${conversationId} — skipping`);
        await store.markRead(unreadMessages.map((m) => m.id), agentId);
        return "skipped";
      }
    }

    // Round 1 ("Topic:"): cut context at round timestamp for independent answers.
    // Round 2+ ("Continuing:"): full context so agents can build on previous rounds.
    // Direct requests (synthesis, nudge): full context.
    const isRoundOpen = !!keryxRoundOpen;
    const isContinuationRound = isRoundOpen && /Continuing:/.test(keryxTrigger.content);
    const cutoffTimestamp = (isRoundOpen && !isContinuationRound) ? keryxTrigger.createdAt : undefined;
    log.info(`Keryx ${isContinuationRound ? "round-continue" : isRoundOpen ? "round-open" : "direct request"} in ${conversationId} — generating response`);
    await store.markRead(unreadMessages.map((m) => m.id), agentId);

    const context = await buildAgentContext({
      store,
      agentId,
      conversationId,
      includeMessages: true,
      messageLimit: 20,
      messageCutoffTimestamp: cutoffTimestamp,
      decisionDepth,
      keryxActive: true,
    });
    const rendered = renderForPrompt(context, mode);

    return invokeAndSend(store, adapter, rendered, customSystemPrompt, conversationId, agentId, unreadMessages);
  }

  // ---------------------------------------------------------------------------
  // Non-Keryx conversation: standard flow (passive/active mode)
  // ---------------------------------------------------------------------------

  // Filter out own messages and status messages
  const otherMessages = unreadMessages.filter((m) => m.fromAgent !== agentId && m.type !== "status");
  if (otherMessages.length === 0) {
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

  // Build full context from store
  const context = await buildAgentContext({
    store,
    agentId,
    conversationId,
    includeMessages: true,
    messageLimit: 20,
    decisionDepth,
  });
  const rendered = renderForPrompt(context, mode);

  return invokeAndSend(store, adapter, rendered, customSystemPrompt, conversationId, agentId, unreadMessages);
}

/**
 * Invoke the LLM adapter and send the response. Shared by Keryx-gated and normal paths.
 */
async function invokeAndSend(
  store: IStore,
  adapter: IAgentAdapter,
  rendered: { conversationPrompt: string; systemPrompt: string },
  customSystemPrompt: string | undefined,
  conversationId: string,
  agentId: string,
  unreadMessages: { id: string }[],
): Promise<"ok" | "skipped" | "error" | "rate_limited"> {
  try {
    log.info(`Generating response for conversation ${conversationId}...`);
    const invokeOpts: AgentInvokeOptions = {
      prompt: rendered.conversationPrompt,
      systemPrompt: customSystemPrompt ?? rendered.systemPrompt,
    };
    const response = await adapter.invoke(invokeOpts);

    // Let the LLM opt out of responding
    const trimmed = response.content.trim();
    if (!trimmed || trimmed.includes("[NO_RESPONSE]")) {
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
    const errMsg = err instanceof Error ? err.message : String(err);
    // Detect rate limiting (429)
    if (errMsg.includes("429") || errMsg.toLowerCase().includes("rate limit") || errMsg.toLowerCase().includes("too many requests")) {
      log.warn(`Rate limited in ${conversationId}: ${errMsg} — backing off silently`);
      await store.markRead(unreadMessages.map((m) => m.id), agentId);
      return "rate_limited";
    }
    log.error(`Adapter/send failed in ${conversationId}: ${errMsg}`);

    // Notify Keryx (and other listeners) that this agent failed to respond.
    // This allows Keryx to remove the agent from the current round immediately
    // instead of waiting for the full timeout.
    try {
      const shortErr = errMsg.length > 120 ? errMsg.slice(0, 120) + "..." : errMsg;
      await store.sendMessage({
        conversationId,
        fromAgent: agentId,
        type: "status",
        content: `[agent-error] Failed to generate response: ${shortErr}`,
        tags: ["agent-error"],
      });
    } catch (notifyErr) {
      log.error(`Failed to send error notification: ${notifyErr instanceof Error ? notifyErr.message : String(notifyErr)}`);
    }

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
