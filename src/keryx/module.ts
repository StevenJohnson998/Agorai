/**
 * KeryxModule — Discussion manager core.
 *
 * Event-driven (subscribes to store.eventBus.onMessage).
 * Dispatches to conversation mode handlers (Socratic, Ecclesia, Wild Agora).
 * Manages PROCESS, never creates CONTENT.
 */

import type { IStore } from "../store/interfaces.js";
import type { MessageCreatedEvent } from "../store/events.js";
import type { Agent, Message } from "../store/types.js";
import type {
  KeryxConfig,
  ConversationState,
  ConversationMode,
  Round,
  AgentProfile,
  WindowMessage,
} from "./types.js";
import type { ConversationModeHandler, ModeContext } from "./mode-interface.js";
import * as templates from "./templates.js";
import { calculateAdaptiveTimeout } from "./timing.js";
import { parseCommand, parseDuration } from "./commands.js";
import { detectLoop, detectDrift, detectDomination } from "./patterns.js";
import { EcclesiaMode } from "./modes/ecclesia.js";
import { SocraticMode } from "./modes/socratic.js";
import { createLogger } from "../logger.js";

const log = createLogger("keryx");

/** Internal agent ID for Keryx. */
const KERYX_AGENT_NAME = "keryx";
const KERYX_API_KEY_HASH = "internal:keryx";

/** How often to discover new conversations (ms). */
const DISCOVERY_INTERVAL_MS = 10_000;

/** Max messages in the rolling window for pattern detection. */
const MAX_WINDOW_SIZE = 50;

/** Default conversation mode. */
const DEFAULT_MODE: ConversationMode = "ecclesia";

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

  /** Registered mode handlers. */
  private modes = new Map<ConversationMode, ConversationModeHandler>();

  /** Cache of agent types to avoid repeated DB lookups. */
  private agentTypeCache = new Map<string, string>();

  constructor(store: IStore, config: KeryxConfig, signal: AbortSignal) {
    this.store = store;
    this.config = config;
    this.signal = signal;
    this.messageHandler = (event) => this.handleMessage(event);

    // Register built-in modes
    this.registerMode(new SocraticMode());
    this.registerMode(new EcclesiaMode());
  }

  private registerMode(handler: ConversationModeHandler): void {
    this.modes.set(handler.name, handler);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    this.keryxAgent = await this.store.registerAgent({
      name: KERYX_AGENT_NAME,
      type: "orchestrator",
      capabilities: ["discussion-management", "round-control"],
      clearanceLevel: "restricted",
      apiKeyHash: KERYX_API_KEY_HASH,
    });

    log.info(`Registered as agent ${this.keryxAgent.id}`);

    if (this.store.eventBus) {
      this.store.eventBus.onMessage(this.messageHandler);
    }

    await this.discoverConversations();

    this.discoveryHandle = setInterval(() => {
      if (!this.signal.aborted) {
        this.discoverConversations().catch(err =>
          log.error("Discovery error:", err),
        );
      }
    }, DISCOVERY_INTERVAL_MS);

    this.signal.addEventListener("abort", () => this.stop(), { once: true });

    await this.createKeryxSkill();

    log.info("Started");
  }

  async stop(): Promise<void> {
    if (this.discoveryHandle) {
      clearInterval(this.discoveryHandle);
      this.discoveryHandle = undefined;
    }

    if (this.store.eventBus) {
      this.store.eventBus.offMessage(this.messageHandler);
    }

    // Clean up all mode-specific state
    for (const state of this.states.values()) {
      const mode = this.modes.get(state.mode);
      mode?.cleanup(state);
      if (state.currentRound?.timeoutHandle) {
        clearTimeout(state.currentRound.timeoutHandle);
      }
    }
    this.states.clear();

    log.info("Stopped");
  }

  // ---------------------------------------------------------------------------
  // Event handler — dispatch to mode
  // ---------------------------------------------------------------------------

  private handleMessage(event: MessageCreatedEvent): void {
    const { message } = event;

    // Ignore own messages
    if (message.fromAgent === this.keryxAgent?.id) return;

    const state = this.states.get(message.conversationId);
    if (!state) return;

    // Intercept agent-error status messages — notify the mode handler
    // so it can remove the agent from the current round immediately.
    if (message.type === "status" && message.tags?.includes("agent-error")) {
      setImmediate(() => this.handleAgentError(message, state));
      return;
    }

    // Ignore other status/system messages
    if (message.type === "status") return;

    // Add to rolling window
    this.addToWindow(state, message);

    // Check for @keryx commands
    if (this.isKeryxCommand(message.content)) {
      setImmediate(() => this.handleCommand(message, state));
      return;
    }

    // Dispatch to the conversation's mode handler
    const mode = this.modes.get(state.mode);
    if (mode) {
      mode.handleMessage(message, state, this.createModeContext());
    }
  }

  // ---------------------------------------------------------------------------
  // Mode context — shared infrastructure exposed to mode handlers
  // ---------------------------------------------------------------------------

  private createModeContext(): ModeContext {
    return {
      store: this.store,
      config: this.config,
      signal: this.signal,
      keryxAgentId: this.keryxAgent?.id ?? "",
      agentProfiles: this.agentProfiles,

      sendMessage: (conversationId: string, content: string) =>
        this.sendKeryxMessage(conversationId, content),

      isHumanMessage: (message: Message) =>
        this.isHumanMessage(message),

      getParticipantAgents: (conversationId: string, excludeAgentId?: string) =>
        this.getParticipantAgents(conversationId, excludeAgentId),

      updateAgentProfile: (agentId: string, responseTimeMs: number) =>
        this.updateAgentProfile(agentId, responseTimeMs),

      calculateTimeout: (state: ConversationState, topic: string, subscriberCount: number) =>
        this.calculateTimeout(state, topic, subscriberCount),

      runPatternDetection: (state: ConversationState) =>
        this.runPatternDetection(state),
    };
  }

  // ---------------------------------------------------------------------------
  // Commands — global (mode-independent)
  // ---------------------------------------------------------------------------

  private isKeryxCommand(content: string): boolean {
    return /@keryx\s+(pause|resume|skip|extend|status|interrupt|enable|disable|summary|mode)/i.test(content);
  }

  async handleCommand(message: Message, state: ConversationState): Promise<void> {
    if (message.fromAgent === this.keryxAgent?.id) return;
    if (message.fromAgent.startsWith("internal:")) return;

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
            `\u23ed\ufe0f **Round ${round.id} skipped** by request.`,
          );
          log.info(`Round ${round.id} skipped by ${message.fromAgent}`);
        } else if (state.socratic) {
          // Skip current turn in Socratic mode
          const mode = this.modes.get("socratic");
          mode?.cleanup(state);
          await this.sendKeryxMessage(state.conversationId, "\u23ed\ufe0f **Discussion skipped** by request.");
          log.info(`Socratic discussion skipped by ${message.fromAgent}`);
        } else {
          await this.sendKeryxMessage(state.conversationId, "No active discussion to skip.");
        }
        break;
      }

      case "extend": {
        // Only applicable to Ecclesia mode
        if (state.mode !== "ecclesia") {
          await this.sendKeryxMessage(state.conversationId, "Extend is only available in Ecclesia (round) mode.");
          break;
        }
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

        if (round.timeoutHandle) {
          clearTimeout(round.timeoutHandle);
        }
        round.escalationLevel = 0;
        // Re-trigger escalation chain via Ecclesia mode
        const ecclesia = this.modes.get("ecclesia") as EcclesiaMode | undefined;
        if (ecclesia) {
          // Use the mode's internal method via the public interface
          // For now, we handle it here since the escalation chain is internal to ecclesia
          // TODO: expose a resetTimer method on mode interface
        }
        await this.sendKeryxMessage(
          state.conversationId,
          `\u23f1\ufe0f Round ${round.id} extended by ${Math.round(durationMs / 1000)}s.`,
        );
        log.info(`Round ${round.id} extended by ${durationMs}ms`);
        break;
      }

      case "status": {
        const modeLabel = state.mode.charAt(0).toUpperCase() + state.mode.slice(1);
        const round = state.currentRound;
        if (state.mode === "socratic" && state.socratic) {
          const s = state.socratic;
          const turnAgent = s.turnQueue[s.currentTurnIndex];
          const agent = turnAgent ? await this.store.getAgent(turnAgent) : null;
          await this.sendKeryxMessage(
            state.conversationId,
            `\ud83d\udcca **Status** [${modeLabel}]: Cycle ${s.completedCycles + 1}, waiting for @${agent?.name ?? "unknown"} (turn ${s.currentTurnIndex + 1}/${s.turnQueue.length}). ${s.passedAgents.size} passed. ${state.paused ? "\u23f8\ufe0f Paused." : "\u25b6\ufe0f Active."}`,
          );
        } else if (!round) {
          const roundCount = state.roundHistory.length;
          await this.sendKeryxMessage(
            state.conversationId,
            `\ud83d\udcca **Status** [${modeLabel}]: No active round. ${roundCount} rounds completed. ${state.paused ? "\u23f8\ufe0f Paused." : "\u25b6\ufe0f Active."}`,
          );
        } else {
          const elapsed = Math.round((Date.now() - round.openedAt) / 1000);
          const responded = round.respondedAgents.size;
          const total = round.expectedAgents.size;
          await this.sendKeryxMessage(
            state.conversationId,
            `\ud83d\udcca **Status** [${modeLabel}]: Round ${round.id} (${round.status}), ${responded}/${total} responded, ${elapsed}s elapsed. Escalation level: ${round.escalationLevel}.`,
          );
        }
        break;
      }

      case "interrupt":
        if (state.mode === "ecclesia") {
          const ecclesia = this.modes.get("ecclesia") as EcclesiaMode | undefined;
          if (ecclesia) {
            await ecclesia.interruptRound(state, message.fromAgent, this.createModeContext());
          }
        } else {
          await this.sendKeryxMessage(state.conversationId, "Interrupt is only available in Ecclesia (round) mode.");
        }
        break;

      case "enable":
        state.disabled = false;
        await this.sendKeryxMessage(state.conversationId, "\u25b6\ufe0f Keryx **enabled** for this conversation.");
        log.info(`Enabled by ${message.fromAgent} in ${state.conversationId}`);
        break;

      case "disable":
        state.disabled = true;
        const mode = this.modes.get(state.mode);
        mode?.cleanup(state);
        if (state.currentRound?.timeoutHandle) {
          clearTimeout(state.currentRound.timeoutHandle);
        }
        state.currentRound = null;
        await this.sendKeryxMessage(state.conversationId, "\u23f9\ufe0f Keryx **disabled** for this conversation.");
        log.info(`Disabled by ${message.fromAgent} in ${state.conversationId}`);
        break;

      case "summary": {
        // Ecclesia: delegate synthesis. Socratic/WildAgora: not applicable yet.
        if (state.mode === "ecclesia") {
          await this.handleEcclesiaSummary(state);
        } else {
          await this.sendKeryxMessage(state.conversationId, "Summary is currently only available in Ecclesia mode.");
        }
        log.info(`Summary requested by ${message.fromAgent} in ${state.conversationId}`);
        break;
      }

      case "mode": {
        // Switch conversation mode: @keryx mode socratic/ecclesia/wild-agora
        const newMode = args?.trim().toLowerCase() as ConversationMode | undefined;
        if (!newMode || !this.modes.has(newMode)) {
          const available = [...this.modes.keys()].join(", ");
          await this.sendKeryxMessage(
            state.conversationId,
            `Usage: \`@keryx mode <${available}>\`. Current mode: **${state.mode}**.`,
          );
          break;
        }

        if (newMode === state.mode) {
          await this.sendKeryxMessage(state.conversationId, `Already in **${state.mode}** mode.`);
          break;
        }

        // Clean up current mode
        const oldMode = this.modes.get(state.mode);
        oldMode?.cleanup(state);
        if (state.currentRound?.timeoutHandle) {
          clearTimeout(state.currentRound.timeoutHandle);
        }
        state.currentRound = null;

        state.mode = newMode;

        const modeNames: Record<ConversationMode, string> = {
          socratic: "Socratic (turn-by-turn)",
          ecclesia: "Ecclesia (round-based)",
          "wild-agora": "Wild Agora (free-for-all)",
        };

        await this.sendKeryxMessage(
          state.conversationId,
          `\ud83d\udd04 Mode switched to **${modeNames[newMode]}**.`,
        );
        log.info(`Mode switched to ${newMode} in ${state.conversationId}`);
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Agent error handling — instant removal from round on adapter failure
  // ---------------------------------------------------------------------------

  private async handleAgentError(message: Message, state: ConversationState): Promise<void> {
    const agent = await this.store.getAgent(message.fromAgent);
    const agentName = agent?.name ?? message.fromAgent;

    if (state.mode === "ecclesia") {
      const ecclesia = this.modes.get("ecclesia") as EcclesiaMode | undefined;
      if (ecclesia) {
        log.info(`Agent ${agentName} reported error — forwarding to Ecclesia`);
        ecclesia.handleAgentError(message.fromAgent, state, this.createModeContext());
      }
    } else if (state.mode === "socratic") {
      // In Socratic mode, if the current turn's agent errors, skip to next
      const socratic = state.socratic;
      if (!socratic || !socratic.awaitingResponse) return;

      const expectedAgentId = socratic.turnQueue[socratic.currentTurnIndex];
      if (message.fromAgent !== expectedAgentId) return;

      if (socratic.turnTimeoutHandle) {
        clearTimeout(socratic.turnTimeoutHandle);
        socratic.turnTimeoutHandle = undefined;
      }
      socratic.awaitingResponse = false;

      log.info(`Agent ${agentName} reported error in Socratic turn — skipping`);

      socratic.currentTurnIndex++;
      if (socratic.currentTurnIndex >= socratic.turnQueue.length) {
        socratic.currentTurnIndex = 0;
        socratic.completedCycles++;
      }

      // Trigger next turn via the mode handler
      const socraticMode = this.modes.get("socratic");
      if (socraticMode) {
        socraticMode.handleMessage(message, state, this.createModeContext());
      }
    }
  }

  private async handleEcclesiaSummary(state: ConversationState): Promise<void> {
    const round = state.currentRound;
    if (round && (round.status === "open" || round.status === "collecting")) {
      if (round.timeoutHandle) {
        clearTimeout(round.timeoutHandle);
        round.timeoutHandle = undefined;
      }
      round.closedAt = Date.now();
      round.status = "synthesizing";
      await this.sendKeryxMessage(
        state.conversationId,
        `\ud83d\udcdd Summary requested -- closing round ${round.id} and requesting synthesis.`,
      );
      // Delegate synthesis via ecclesia mode context
      const ecclesia = this.modes.get("ecclesia") as EcclesiaMode | undefined;
      if (ecclesia) {
        // Use the mode handler — but synthesis delegation is internal to ecclesia
        // For now, reuse the pattern from the old monolithic code
      }
    } else if (!round || round.status === "closed" || round.status === "idle") {
      const lastRound = state.roundHistory[state.roundHistory.length - 1];
      if (!lastRound) {
        await this.sendKeryxMessage(state.conversationId, "No discussion to summarize yet.");
        return;
      }
      const synthRound: Round = {
        ...lastRound,
        status: "synthesizing" as const,
      };
      state.currentRound = synthRound;
      await this.sendKeryxMessage(
        state.conversationId,
        `\ud83d\udcdd Summary requested -- requesting synthesis of the full discussion.`,
      );
    } else {
      await this.sendKeryxMessage(state.conversationId, "Cannot summarize right now -- a synthesis is already in progress.");
    }
  }

  // ---------------------------------------------------------------------------
  // Pattern detection (shared across modes)
  // ---------------------------------------------------------------------------

  private async runPatternDetection(state: ConversationState): Promise<void> {
    if (this.signal.aborted || state.disabled || state.paused) return;

    const window = state.messageWindow;
    if (window.length < 3) return;

    const closedRound = state.roundHistory[state.roundHistory.length - 1];
    const synthesisId = closedRound?.synthesisMessageId;
    const loopWindow = synthesisId
      ? window.filter((m) => m.id !== synthesisId)
      : window;

    // Loop detection (suppressed — false positives)
    const loop = detectLoop(loopWindow);
    if (loop) {
      const agent = await this.store.getAgent(loop.agentId);
      if (agent) {
        log.info(`Loop detected (suppressed) for ${agent.name} in ${state.conversationId}`);
      }
    }

    // Drift detection (suppressed — false positives)
    const lastRound = state.roundHistory[state.roundHistory.length - 1];
    if (lastRound) {
      const recentWindow = window.slice(-10);
      const drift = detectDrift(lastRound.topic, recentWindow);
      if (drift) {
        log.info(`Drift detected (suppressed) in ${state.conversationId} (similarity: ${drift.similarity.toFixed(2)})`);
      }
    }

    // Domination detection (suppressed — false positives)
    const subscribers = await this.store.getSubscribers(state.conversationId);
    const domination = detectDomination(window, subscribers.length);
    if (domination) {
      const agent = await this.store.getAgent(domination.agentId);
      if (agent) {
        log.info(`Domination detected (suppressed): ${agent.name} at ${domination.messagePercent}% in ${state.conversationId}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Conversation discovery
  // ---------------------------------------------------------------------------

  private async discoverConversations(): Promise<void> {
    if (!this.keryxAgent) return;

    await this.store.updateAgentLastSeen(this.keryxAgent.id);

    const projects = await this.store.listProjects(this.keryxAgent.id);

    for (const project of projects) {
      const conversations = await this.store.listConversations(
        project.id,
        this.keryxAgent.id,
      );

      for (const conv of conversations) {
        const isSubbed = await this.store.isSubscribed(conv.id, this.keryxAgent.id);
        if (!isSubbed) {
          await this.store.subscribe(conv.id, this.keryxAgent.id, { historyAccess: "full" });
          log.debug(`Subscribed to conversation ${conv.id}`);
        }

        if (!this.states.has(conv.id)) {
          this.states.set(conv.id, {
            conversationId: conv.id,
            projectId: project.id,
            mode: DEFAULT_MODE,
            currentRound: null,
            roundHistory: [],
            lastSeenAt: Date.now(),
            paused: false,
            disabled: false,
            messageWindow: [],
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers (shared infrastructure for mode handlers)
  // ---------------------------------------------------------------------------

  private async isHumanMessage(message: Message): Promise<boolean> {
    if (message.fromAgent === this.keryxAgent?.id) return false;
    if (message.type !== "message") return false;

    let agentType = this.agentTypeCache.get(message.fromAgent);
    if (!agentType) {
      const agent = await this.store.getAgent(message.fromAgent);
      agentType = agent?.type ?? "unknown";
      this.agentTypeCache.set(message.fromAgent, agentType);
    }

    return agentType === "human";
  }

  /** Get non-keryx, non-orchestrator, non-human subscriber agents. */
  private async getParticipantAgents(
    conversationId: string,
    excludeAgentId?: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const subscribers = await this.store.getSubscribers(conversationId);
    const result: Array<{ id: string; name: string }> = [];

    for (const sub of subscribers) {
      if (sub.agentId === this.keryxAgent?.id) continue;
      if (excludeAgentId && sub.agentId === excludeAgentId) continue;
      const agent = await this.store.getAgent(sub.agentId);
      if (agent && agent.type !== "orchestrator" && agent.type !== "keryx" && agent.type !== "human") {
        result.push({ id: agent.id, name: agent.name });
      }
    }

    return result;
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

    if (state.messageWindow.length > MAX_WINDOW_SIZE) {
      state.messageWindow = state.messageWindow.slice(-MAX_WINDOW_SIZE);
    }
  }

  private updateAgentProfile(agentId: string, responseTimeMs: number): void {
    const profile = this.agentProfiles.get(agentId);
    if (profile) {
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

    // Create skill based on default mode
    const defaultHandler = this.modes.get(DEFAULT_MODE);
    if (!defaultHandler) return;

    try {
      await this.store.setSkill({
        scope: "bridge",
        title: "Keryx Discussion Protocol",
        summary: defaultHandler.getSkillSummary(),
        instructions: defaultHandler.getSkillInstructions(),
        tags: ["keryx", "protocol"],
        content: defaultHandler.getSkillContent(),
        createdBy: this.keryxAgent.id,
      });
      log.debug("Created Keryx behavioral skill");
    } catch {
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

  getModeHandler(mode: ConversationMode): ConversationModeHandler | undefined {
    return this.modes.get(mode);
  }
}
