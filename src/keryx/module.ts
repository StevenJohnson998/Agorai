/**
 * KeryxModule — Discussion manager state machine.
 *
 * Event-driven (subscribes to store.eventBus.onMessage).
 * Manages rounds, timing, floor control, escalation.
 * Manages PROCESS, never creates CONTENT.
 */

import type { IStore } from "../store/interfaces.js";
import type { MessageCreatedEvent } from "../store/events.js";
import type { Agent, Message } from "../store/types.js";
import type {
  KeryxConfig,
  ConversationState,
  Round,
  AgentProfile,
  WindowMessage,
} from "./types.js";
import * as templates from "./templates.js";
import { calculateAdaptiveTimeout } from "./timing.js";
import { parseCommand, parseDuration } from "./commands.js";
import { detectLoop, detectDrift, detectDomination } from "./patterns.js";
import { createLogger } from "../logger.js";

const log = createLogger("keryx");

/** Internal agent ID for Keryx. */
const KERYX_AGENT_ID = "keryx";
const KERYX_AGENT_NAME = "keryx";
const KERYX_API_KEY_HASH = "internal:keryx";

/** How often to discover new conversations (ms). */
const DISCOVERY_INTERVAL_MS = 10_000;

/** Max messages in the rolling window for pattern detection. */
const MAX_WINDOW_SIZE = 50;

export class KeryxModule {
  private store: IStore;
  private config: KeryxConfig;
  private signal: AbortSignal;

  /** Per-conversation state (ephemeral, not persisted). */
  private states = new Map<string, ConversationState>();

  /** Per-agent response time profiles. */
  private agentProfiles = new Map<string, AgentProfile>();

  /** Keryx agent record (populated on start). */
  private keryxAgent: Agent | null = null;

  /** Discovery interval handle. */
  private discoveryHandle?: ReturnType<typeof setInterval>;

  /** Bound event handler (for cleanup). */
  private messageHandler: (event: MessageCreatedEvent) => void;

  constructor(store: IStore, config: KeryxConfig, signal: AbortSignal) {
    this.store = store;
    this.config = config;
    this.signal = signal;
    this.messageHandler = (event) => this.handleMessage(event);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    // Register Keryx as an agent
    this.keryxAgent = await this.store.registerAgent({
      name: KERYX_AGENT_NAME,
      type: "moderator",
      capabilities: ["discussion-management", "round-control"],
      clearanceLevel: "restricted",
      apiKeyHash: KERYX_API_KEY_HASH,
    });

    log.info(`Registered as agent ${this.keryxAgent.id}`);

    // Subscribe to message events
    if (this.store.eventBus) {
      this.store.eventBus.onMessage(this.messageHandler);
    }

    // Initial conversation discovery
    await this.discoverConversations();

    // Periodic discovery for new conversations
    this.discoveryHandle = setInterval(() => {
      if (!this.signal.aborted) {
        this.discoverConversations().catch(err =>
          log.error("Discovery error:", err),
        );
      }
    }, DISCOVERY_INTERVAL_MS);

    // Stop on abort
    this.signal.addEventListener("abort", () => this.stop(), { once: true });

    // Create behavioral skill
    await this.createKeryxSkill();

    log.info("Started");
  }

  async stop(): Promise<void> {
    if (this.discoveryHandle) {
      clearInterval(this.discoveryHandle);
      this.discoveryHandle = undefined;
    }

    // Unsubscribe from events
    if (this.store.eventBus) {
      this.store.eventBus.offMessage(this.messageHandler);
    }

    // Clear all round timers
    for (const state of this.states.values()) {
      if (state.currentRound?.timeoutHandle) {
        clearTimeout(state.currentRound.timeoutHandle);
      }
    }
    this.states.clear();

    log.info("Stopped");
  }

  // ---------------------------------------------------------------------------
  // Event handler
  // ---------------------------------------------------------------------------

  private handleMessage(event: MessageCreatedEvent): void {
    const { message } = event;

    // Ignore own messages
    if (message.fromAgent === this.keryxAgent?.id) return;

    // Ignore status/system messages
    if (message.type === "status") return;

    const state = this.states.get(message.conversationId);
    if (!state) return; // Not tracking this conversation

    // Add to rolling window
    this.addToWindow(state, message);

    // Check for @keryx commands (Phase 5 — wired later)
    if (this.isKeryxCommand(message.content)) {
      // Defer to avoid blocking the synchronous event handler
      setImmediate(() => this.handleCommand(message, state));
      return;
    }

    // Disabled or paused — no round management
    if (state.disabled || state.paused) return;

    const currentRound = state.currentRound;

    if (!currentRound || currentRound.status === "idle" || currentRound.status === "closed") {
      // No active round — check if this is a human message to open one
      if (this.isHumanMessage(message)) {
        setImmediate(() => this.openRound(state, message));
      }
      return;
    }

    if (currentRound.status === "open" || currentRound.status === "collecting") {
      // Active round — record response
      if (currentRound.expectedAgents.has(message.fromAgent)) {
        setImmediate(() => this.recordResponse(state, message));
      }
      return;
    }

    if (currentRound.status === "synthesizing") {
      // Waiting for synthesis — check if this is it
      setImmediate(() => this.handlePotentialSynthesis(state, message));
      return;
    }

    if (currentRound.status === "interrupted") {
      // Waiting for the interrupter's follow-up
      if (message.fromAgent === currentRound.interruptedBy) {
        setImmediate(() => this.resumeFromInterrupt(state, message));
      }
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // Round lifecycle
  // ---------------------------------------------------------------------------

  private async openRound(state: ConversationState, triggerMessage: Message): Promise<void> {
    if (this.signal.aborted) return;

    const roundNumber = state.roundHistory.length + 1;

    // Check max rounds
    if (roundNumber > this.config.maxRoundsPerTopic) {
      log.info(`Max rounds (${this.config.maxRoundsPerTopic}) reached for ${state.conversationId}`);
      return;
    }

    // Get subscribers (exclude Keryx)
    const subscribers = await this.store.getSubscribers(state.conversationId);
    const expectedAgents = new Set<string>();
    const agentNames: string[] = [];

    for (const sub of subscribers) {
      if (sub.agentId === this.keryxAgent?.id) continue;
      if (sub.agentId === triggerMessage.fromAgent) continue; // Don't expect the trigger author
      const agent = await this.store.getAgent(sub.agentId);
      if (agent && agent.type !== "moderator" && agent.type !== "keryx") {
        expectedAgents.add(sub.agentId);
        agentNames.push(agent.name);
      }
    }

    if (expectedAgents.size === 0) {
      log.debug(`No agents to participate in round for ${state.conversationId}`);
      return;
    }

    // Extract topic from trigger message (first 100 chars)
    const topic = triggerMessage.content.slice(0, 100) +
      (triggerMessage.content.length > 100 ? "…" : "");

    const timeoutMs = this.calculateTimeout(state, topic, expectedAgents.size);

    const round: Round = {
      id: roundNumber,
      topic,
      status: "open",
      openedAt: Date.now(),
      triggerMessageId: triggerMessage.id,
      expectedAgents,
      respondedAgents: new Set(),
      responseMessageIds: [],
      escalationLevel: 0,
    };

    state.currentRound = round;

    // Send round open message
    await this.sendKeryxMessage(
      state.conversationId,
      templates.roundOpen({
        roundNumber,
        topic,
        expectedAgents: agentNames,
        timeoutSeconds: Math.round(timeoutMs / 1000),
      }),
    );

    round.status = "collecting";

    // Start timeout chain
    this.startEscalationChain(state, timeoutMs);

    log.info(`Round ${roundNumber} opened in ${state.conversationId} (${expectedAgents.size} agents, ${Math.round(timeoutMs / 1000)}s timeout)`);
  }

  private async recordResponse(state: ConversationState, message: Message): Promise<void> {
    const round = state.currentRound;
    if (!round || (round.status !== "open" && round.status !== "collecting")) return;

    // Record the response
    round.respondedAgents.add(message.fromAgent);
    round.responseMessageIds.push(message.id);

    // Update agent profile
    this.updateAgentProfile(message.fromAgent, Date.now() - round.openedAt);

    log.debug(`Agent ${message.fromAgent} responded in round ${round.id} (${round.respondedAgents.size}/${round.expectedAgents.size})`);

    // Check completion
    this.checkRoundCompletion(state);
  }

  private checkRoundCompletion(state: ConversationState): void {
    const round = state.currentRound;
    if (!round || (round.status !== "open" && round.status !== "collecting")) return;

    // All expected agents responded?
    const allResponded = [...round.expectedAgents].every(id =>
      round.respondedAgents.has(id),
    );

    if (allResponded) {
      setImmediate(() => this.closeRound(state));
    }
  }

  private async closeRound(state: ConversationState): Promise<void> {
    const round = state.currentRound;
    if (!round) return;

    // Idempotent — prevent double-close
    if (round.status === "closed" || round.status === "synthesizing") return;

    // Cancel pending timers
    if (round.timeoutHandle) {
      clearTimeout(round.timeoutHandle);
      round.timeoutHandle = undefined;
    }

    round.closedAt = Date.now();
    round.status = "synthesizing";

    const noResponseCount = round.responseMessageIds.filter(
      async (id) => {
        // We can't easily check content here, so count from window
        return false;
      }
    ).length;

    // Send round close message
    await this.sendKeryxMessage(
      state.conversationId,
      templates.roundClose({
        roundNumber: round.id,
        respondedCount: round.respondedAgents.size,
        totalCount: round.expectedAgents.size,
        noResponseCount: 0, // Simplified — we don't track NO_RESPONSE content here
      }),
    );

    // Delegate synthesis
    await this.delegateSynthesis(state, round);
  }

  private async delegateSynthesis(state: ConversationState, round: Round): Promise<void> {
    if (this.signal.aborted) return;

    // Find an agent with synthesis capability
    const synthesisAgents = await this.store.findAgentsByCapability(
      this.config.synthesisCapability,
    );

    // Filter to subscribers of this conversation
    const subscribers = await this.store.getSubscribers(state.conversationId);
    const subscriberIds = new Set(subscribers.map(s => s.agentId));

    let synthAgent = synthesisAgents.find(a =>
      subscriberIds.has(a.id) && a.id !== this.keryxAgent?.id,
    );

    // Fallback: pick the least-active agent in this round
    if (!synthAgent) {
      const leastActive = [...round.expectedAgents]
        .filter(id => !round.respondedAgents.has(id) || round.respondedAgents.has(id))
        .sort()[0]; // Just pick first available
      if (leastActive) {
        synthAgent = await this.store.getAgent(leastActive) ?? undefined;
      }
    }

    if (!synthAgent) {
      // No agent available — skip synthesis, close round
      round.status = "closed";
      state.roundHistory.push(round);
      state.currentRound = null;
      log.warn(`No synthesis agent available for round ${round.id} in ${state.conversationId}`);
      return;
    }

    await this.sendKeryxMessage(
      state.conversationId,
      templates.synthesisRequest({
        roundNumber: round.id,
        agentName: synthAgent.name,
        topic: round.topic,
      }),
    );

    // Set a timeout for synthesis response
    const synthesisTimeout = this.config.baseTimeoutMs * 2;
    round.timeoutHandle = setTimeout(() => {
      if (round.status === "synthesizing") {
        // Synthesis timed out — close without it
        round.status = "closed";
        state.roundHistory.push(round);
        state.currentRound = null;
        log.warn(`Synthesis timed out for round ${round.id} in ${state.conversationId}`);
      }
    }, synthesisTimeout);

    log.info(`Synthesis delegated to ${synthAgent.name} for round ${round.id}`);
  }

  private async handlePotentialSynthesis(state: ConversationState, message: Message): Promise<void> {
    const round = state.currentRound;
    if (!round || round.status !== "synthesizing") return;

    // Accept any non-keryx, non-status message as synthesis
    round.synthesisMessageId = message.id;
    round.status = "closed";

    if (round.timeoutHandle) {
      clearTimeout(round.timeoutHandle);
      round.timeoutHandle = undefined;
    }

    state.roundHistory.push(round);
    state.currentRound = null;

    log.info(`Synthesis received for round ${round.id} from ${message.fromAgent}`);

    // Run pattern detection between rounds (Phase 4 — wired later)
    setImmediate(() => this.runPatternDetection(state));
  }

  // ---------------------------------------------------------------------------
  // Escalation chain
  // ---------------------------------------------------------------------------

  private startEscalationChain(state: ConversationState, baseTimeoutMs: number): void {
    const round = state.currentRound;
    if (!round) return;

    /** Check if there are still non-responders. Returns false if all responded (round should close). */
    const hasNonResponders = (): boolean => {
      for (const id of round.expectedAgents) {
        if (!round.respondedAgents.has(id)) return true;
      }
      return false;
    };

    // Level 0: silent wait at timeout
    round.timeoutHandle = setTimeout(() => {
      if (this.signal.aborted) return;
      if (round.status !== "collecting") return;
      if (!hasNonResponders()) { this.checkRoundCompletion(state); return; }

      round.escalationLevel = 1;
      log.debug(`Round ${round.id} timeout reached (silent wait)`);

      // Level 1: nudge at timeout × 1.5
      round.timeoutHandle = setTimeout(() => {
        if (this.signal.aborted) return;
        if (round.status !== "collecting") return;
        if (!hasNonResponders()) { this.checkRoundCompletion(state); return; }

        this.sendNudge(state, round);
        round.escalationLevel = 2;

        // Level 2: CC backup at timeout × 2.5 (from start)
        round.timeoutHandle = setTimeout(() => {
          if (this.signal.aborted) return;
          if (round.status !== "collecting") return;
          if (!hasNonResponders()) { this.checkRoundCompletion(state); return; }

          round.escalationLevel = 3;

          // Level 3: escalate to human at timeout × 4.0 (from start)
          round.timeoutHandle = setTimeout(() => {
            if (this.signal.aborted) return;
            if (round.status !== "collecting") return;
            if (!hasNonResponders()) { this.checkRoundCompletion(state); return; }

            this.escalateToHuman(state, round);
          }, baseTimeoutMs * 1.5); // 2.5 + 1.5 = 4.0 from start

        }, baseTimeoutMs); // 1.5 + 1.0 = 2.5 from start

      }, baseTimeoutMs * 0.5); // 1.0 + 0.5 = 1.5 from start

    }, baseTimeoutMs);
  }

  private async sendNudge(state: ConversationState, round: Round): Promise<void> {
    const nonResponders: string[] = [];
    for (const agentId of round.expectedAgents) {
      if (!round.respondedAgents.has(agentId)) {
        const agent = await this.store.getAgent(agentId);
        if (agent) nonResponders.push(agent.name);
      }
    }

    if (nonResponders.length === 0) return;

    const elapsed = Math.round((Date.now() - round.openedAt) / 1000);
    await this.sendKeryxMessage(
      state.conversationId,
      templates.nudge({
        agentNames: nonResponders,
        roundNumber: round.id,
        elapsedSeconds: elapsed,
      }),
    );
  }

  private async escalateToHuman(state: ConversationState, round: Round): Promise<void> {
    const nonResponders: string[] = [];
    for (const agentId of round.expectedAgents) {
      if (!round.respondedAgents.has(agentId)) {
        const agent = await this.store.getAgent(agentId);
        if (agent) nonResponders.push(agent.name);
      }
    }

    const elapsed = Math.round((Date.now() - round.openedAt) / 1000);
    await this.sendKeryxMessage(
      state.conversationId,
      templates.escalateToHuman({
        roundNumber: round.id,
        nonResponders,
        elapsedSeconds: elapsed,
      }),
    );

    // Force-close the round after escalation
    round.status = "closed";
    round.closedAt = Date.now();
    state.roundHistory.push(round);
    state.currentRound = null;
  }

  // ---------------------------------------------------------------------------
  // Interrupt flow (Phase 5 — commands wired later)
  // ---------------------------------------------------------------------------

  async interruptRound(state: ConversationState, interruptedBy: string): Promise<void> {
    const round = state.currentRound;
    if (!round || round.status === "closed" || round.status === "interrupted") return;

    round.status = "interrupted";
    round.interruptedBy = interruptedBy;

    if (round.timeoutHandle) {
      clearTimeout(round.timeoutHandle);
      round.timeoutHandle = undefined;
    }

    const agent = await this.store.getAgent(interruptedBy);
    await this.sendKeryxMessage(
      state.conversationId,
      templates.interrupt({
        roundNumber: round.id,
        interruptedBy: agent?.name ?? interruptedBy,
      }),
    );
  }

  private async resumeFromInterrupt(state: ConversationState, message: Message): Promise<void> {
    const round = state.currentRound;
    if (!round || round.status !== "interrupted") return;

    // Close the interrupted round and open a new one with the interrupt message as trigger
    round.status = "closed";
    round.closedAt = Date.now();
    state.roundHistory.push(round);
    state.currentRound = null;

    // Open a new round with the interrupter's message
    await this.openRound(state, message);
  }

  // ---------------------------------------------------------------------------
  // Commands (Phase 5 — stub, wired later)
  // ---------------------------------------------------------------------------

  private isKeryxCommand(content: string): boolean {
    return /@keryx\s+(pause|resume|skip|extend|status|interrupt|enable|disable)/i.test(content);
  }

  async handleCommand(message: Message, state: ConversationState): Promise<void> {
    // Authorization: only non-internal, non-keryx agents
    if (message.fromAgent === this.keryxAgent?.id) return;
    if (message.fromAgent.startsWith("internal:")) {
      // Internal agents cannot issue commands
      return;
    }

    const parsed = parseCommand(message.content);
    if (!parsed) return;

    const { command, args } = parsed;

    switch (command) {
      case "pause":
        state.paused = true;
        await this.sendKeryxMessage(state.conversationId, templates.paused());
        log.info(`Paused by ${message.fromAgent} in ${state.conversationId}`);
        break;

      case "resume":
        state.paused = false;
        await this.sendKeryxMessage(state.conversationId, templates.resumed());
        log.info(`Resumed by ${message.fromAgent} in ${state.conversationId}`);
        break;

      case "skip": {
        const round = state.currentRound;
        if (round && round.status !== "closed") {
          if (round.timeoutHandle) {
            clearTimeout(round.timeoutHandle);
            round.timeoutHandle = undefined;
          }
          round.status = "closed";
          round.closedAt = Date.now();
          state.roundHistory.push(round);
          state.currentRound = null;
          await this.sendKeryxMessage(
            state.conversationId,
            `⏭️ **Round ${round.id} skipped** by request.`,
          );
          log.info(`Round ${round.id} skipped by ${message.fromAgent}`);
        } else {
          await this.sendKeryxMessage(state.conversationId, "No active round to skip.");
        }
        break;
      }

      case "extend": {
        const round = state.currentRound;
        if (!round || round.status === "closed") {
          await this.sendKeryxMessage(state.conversationId, "No active round to extend.");
          break;
        }

        const durationMs = args ? parseDuration(args) : this.config.baseTimeoutMs;
        if (!durationMs) {
          await this.sendKeryxMessage(
            state.conversationId,
            `Invalid duration: "${args}". Use e.g. \`@keryx extend 2m\` or \`@keryx extend 30s\`.`,
          );
          break;
        }

        // Cancel current timer and set a new one
        if (round.timeoutHandle) {
          clearTimeout(round.timeoutHandle);
        }
        round.escalationLevel = 0;
        this.startEscalationChain(state, durationMs);
        await this.sendKeryxMessage(
          state.conversationId,
          `⏱️ Round ${round.id} extended by ${Math.round(durationMs / 1000)}s.`,
        );
        log.info(`Round ${round.id} extended by ${durationMs}ms`);
        break;
      }

      case "status": {
        const round = state.currentRound;
        if (!round) {
          const roundCount = state.roundHistory.length;
          await this.sendKeryxMessage(
            state.conversationId,
            `📊 **Status**: No active round. ${roundCount} rounds completed. ${state.paused ? "⏸️ Paused." : "▶️ Active."}`,
          );
        } else {
          const elapsed = Math.round((Date.now() - round.openedAt) / 1000);
          const responded = round.respondedAgents.size;
          const total = round.expectedAgents.size;
          await this.sendKeryxMessage(
            state.conversationId,
            `📊 **Status**: Round ${round.id} (${round.status}), ${responded}/${total} responded, ${elapsed}s elapsed. Escalation level: ${round.escalationLevel}.`,
          );
        }
        break;
      }

      case "interrupt":
        await this.interruptRound(state, message.fromAgent);
        break;

      case "enable":
        state.disabled = false;
        await this.sendKeryxMessage(state.conversationId, "▶️ Keryx **enabled** for this conversation.");
        log.info(`Enabled by ${message.fromAgent} in ${state.conversationId}`);
        break;

      case "disable":
        state.disabled = true;
        if (state.currentRound?.timeoutHandle) {
          clearTimeout(state.currentRound.timeoutHandle);
        }
        state.currentRound = null;
        await this.sendKeryxMessage(state.conversationId, "⏹️ Keryx **disabled** for this conversation.");
        log.info(`Disabled by ${message.fromAgent} in ${state.conversationId}`);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Pattern detection (Phase 4 — stub, wired later)
  // ---------------------------------------------------------------------------

  private async runPatternDetection(state: ConversationState): Promise<void> {
    if (this.signal.aborted || state.disabled || state.paused) return;

    const window = state.messageWindow;
    if (window.length < 3) return;

    // Loop detection
    const loop = detectLoop(window);
    if (loop) {
      const agent = await this.store.getAgent(loop.agentId);
      if (agent) {
        const lastRound = state.roundHistory[state.roundHistory.length - 1];
        await this.sendKeryxMessage(
          state.conversationId,
          templates.loopDetected({
            agentName: agent.name,
            roundNumber: lastRound?.id ?? 0,
          }),
        );
        log.info(`Loop detected for ${agent.name} in ${state.conversationId}`);
      }
    }

    // Drift detection
    const lastRound = state.roundHistory[state.roundHistory.length - 1];
    if (lastRound) {
      const recentWindow = window.slice(-10);
      const drift = detectDrift(lastRound.topic, recentWindow);
      if (drift) {
        await this.sendKeryxMessage(
          state.conversationId,
          templates.driftDetected({
            originalTopic: lastRound.topic,
            roundNumber: lastRound.id,
          }),
        );
        log.info(`Drift detected in ${state.conversationId} (similarity: ${drift.similarity.toFixed(2)})`);
      }
    }

    // Domination detection
    const subscribers = await this.store.getSubscribers(state.conversationId);
    const domination = detectDomination(window, subscribers.length);
    if (domination) {
      const agent = await this.store.getAgent(domination.agentId);
      if (agent) {
        await this.sendKeryxMessage(
          state.conversationId,
          templates.dominationWarning({
            agentName: agent.name,
            messagePercent: domination.messagePercent,
          }),
        );
        log.info(`Domination detected: ${agent.name} at ${domination.messagePercent}% in ${state.conversationId}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Conversation discovery
  // ---------------------------------------------------------------------------

  private async discoverConversations(): Promise<void> {
    if (!this.keryxAgent) return;

    // Keep Keryx's lastSeenAt fresh so the bridge reports it as online
    await this.store.updateAgentLastSeen(this.keryxAgent.id);

    const projects = await this.store.listProjects(this.keryxAgent.id);

    for (const project of projects) {
      const conversations = await this.store.listConversations(
        project.id,
        this.keryxAgent.id,
      );

      for (const conv of conversations) {
        // Subscribe if not already
        const isSubbed = await this.store.isSubscribed(conv.id, this.keryxAgent.id);
        if (!isSubbed) {
          await this.store.subscribe(conv.id, this.keryxAgent.id, { historyAccess: "full" });
          log.debug(`Subscribed to conversation ${conv.id}`);
        }

        // Initialize state if new
        if (!this.states.has(conv.id)) {
          this.states.set(conv.id, {
            conversationId: conv.id,
            projectId: project.id,
            currentRound: null,
            roundHistory: [],
            lastSeenAt: Date.now(), // Start managing from NOW, not retroactively
            paused: false,
            disabled: false,
            messageWindow: [],
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private isHumanMessage(message: Message): boolean {
    // Heuristic: non-internal, non-keryx, non-system agents are "human"
    // We check the agent type from cache or store
    if (message.fromAgent === this.keryxAgent?.id) return false;

    // Quick check: internal agents have "internal:" prefix
    if (message.fromAgent.startsWith("internal:")) return false;

    // Check agent type
    // We can't make this async in a sync context, so use a conservative approach:
    // If the message is type "message" (not status/system), and not from an internal agent, treat as human trigger
    return message.type === "message";
  }

  async sendKeryxMessage(conversationId: string, content: string): Promise<Message> {
    if (!this.keryxAgent) {
      throw new Error("Keryx not started");
    }

    return this.store.sendMessage({
      conversationId,
      fromAgent: this.keryxAgent.id,
      type: "status",
      content,
      tags: ["keryx"],
    });
  }

  private addToWindow(state: ConversationState, message: Message): void {
    state.messageWindow.push({
      id: message.id,
      fromAgent: message.fromAgent,
      content: message.content,
      timestamp: Date.now(),
    });

    // Trim to max window size
    if (state.messageWindow.length > MAX_WINDOW_SIZE) {
      state.messageWindow = state.messageWindow.slice(-MAX_WINDOW_SIZE);
    }
  }

  private updateAgentProfile(agentId: string, responseTimeMs: number): void {
    const profile = this.agentProfiles.get(agentId);
    if (profile) {
      // Rolling average
      const n = Math.min(profile.responseCount, this.config.healthWindowSize);
      profile.avgResponseTimeMs = (profile.avgResponseTimeMs * n + responseTimeMs) / (n + 1);
      profile.responseCount++;
    } else {
      this.agentProfiles.set(agentId, {
        agentId,
        avgResponseTimeMs: responseTimeMs,
        responseCount: 1,
      });
    }
  }

  private calculateTimeout(
    state: ConversationState,
    topic: string,
    subscriberCount: number,
  ): number {
    return calculateAdaptiveTimeout(
      state,
      topic,
      subscriberCount,
      this.config.baseTimeoutMs,
      this.agentProfiles,
    );
  }

  private async createKeryxSkill(): Promise<void> {
    if (!this.keryxAgent) return;

    try {
      await this.store.setSkill({
        scope: "bridge",
        title: "Keryx Discussion Protocol",
        summary: "Rules for participating in Keryx-managed discussions with rounds.",
        instructions: "Follow Keryx round management. Respond once per round. Use [NO_RESPONSE] if nothing new.",
        tags: ["keryx", "protocol"],
        content: [
          "# Keryx Discussion Protocol",
          "",
          "This bridge uses Keryx, a discussion manager that organizes conversations into rounds.",
          "",
          "## Rules",
          "1. **One response per round**: When Keryx opens a round, provide your perspective once.",
          "2. **[NO_RESPONSE]**: Use this if you have nothing new to add.",
          "3. **Wait for rounds**: Don't post between rounds unless explicitly asked.",
          "4. **Synthesis**: If asked to synthesize, summarize key points, agreements, and open questions.",
          "5. **Commands**: Humans can control rounds with @keryx commands (pause, resume, skip, interrupt, etc.).",
          "",
          "## Round Flow",
          "1. Human posts a message → Keryx opens a round",
          "2. All participants respond (or [NO_RESPONSE])",
          "3. Keryx closes the round and requests a synthesis",
          "4. Synthesis agent summarizes → next round or done",
        ].join("\n"),
        createdBy: this.keryxAgent.id,
      });
      log.debug("Created Keryx behavioral skill");
    } catch {
      // Skill may already exist — that's fine (setSkill upserts by title+scope)
      log.debug("Keryx skill already exists or creation skipped");
    }
  }

  // ---------------------------------------------------------------------------
  // Public accessors (for testing and commands)
  // ---------------------------------------------------------------------------

  getState(conversationId: string): ConversationState | undefined {
    return this.states.get(conversationId);
  }

  getAgentProfile(agentId: string): AgentProfile | undefined {
    return this.agentProfiles.get(agentId);
  }

  getKeryxAgentId(): string | undefined {
    return this.keryxAgent?.id;
  }
}
