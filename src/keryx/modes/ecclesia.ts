/**
 * Ecclesia mode — Round-based parallel debate with synthesis and consensus.
 *
 * Named after the Athenian Ecclesia (ἐκκλησία): all citizens speak in parallel
 * rounds, with synthesis after each round and consensus detection.
 *
 * Flow:
 *   1. Human posts → Keryx opens Round 1
 *   2. All participants respond in parallel (or [NO_RESPONSE])
 *   3. Keryx closes round → requests synthesis if consensus or max rounds
 *   4. Otherwise auto-opens next round
 *   5. Repeats until consensus or max rounds reached
 */

import type { Message } from "../../store/types.js";
import type { ConversationState, Round } from "../types.js";
import type { ConversationModeHandler, ModeContext } from "../mode-interface.js";
import * as templates from "../templates.js";
import { isConsensusResponse } from "../patterns.js";
import { createLogger } from "../../logger.js";

const log = createLogger("keryx:ecclesia");

export class EcclesiaMode implements ConversationModeHandler {
  readonly name = "ecclesia" as const;

  handleMessage(message: Message, state: ConversationState, ctx: ModeContext): void {
    if (state.disabled || state.paused) return;

    const currentRound = state.currentRound;

    if (!currentRound || currentRound.status === "idle" || currentRound.status === "closed") {
      setImmediate(async () => {
        if (await ctx.isHumanMessage(message)) {
          this.openRound(state, message, ctx);
        }
      });
      return;
    }

    if (currentRound.status === "open" || currentRound.status === "collecting") {
      if (currentRound.expectedAgents.has(message.fromAgent)) {
        setImmediate(() => this.recordResponse(state, message, ctx));
      }
      return;
    }

    if (currentRound.status === "synthesizing") {
      setImmediate(() => this.handlePotentialSynthesis(state, message, ctx));
      return;
    }

    if (currentRound.status === "interrupted") {
      if (message.fromAgent === currentRound.interruptedBy) {
        setImmediate(() => this.resumeFromInterrupt(state, message, ctx));
      }
      return;
    }
  }

  cleanup(state: ConversationState): void {
    if (state.currentRound?.timeoutHandle) {
      clearTimeout(state.currentRound.timeoutHandle);
      state.currentRound.timeoutHandle = undefined;
    }
  }

  getSkillContent(): string {
    return [
      "# Keryx Discussion Protocol — Ecclesia Mode",
      "",
      "This conversation uses Ecclesia mode: round-based parallel debate.",
      "",
      "## Rules",
      "1. **One response per round**: When Keryx opens a round, provide your perspective once.",
      "2. **[NO_RESPONSE]**: Use this if you have nothing new to add.",
      "3. **Wait for rounds**: Don't post between rounds unless explicitly asked.",
      "4. **Synthesis**: If asked to synthesize, summarize key points, agreements, and open questions.",
      "5. **Commands**: Humans can control rounds with @keryx commands (pause, resume, skip, interrupt, etc.).",
      "",
      "## Round Flow",
      "1. Human posts a message -> Keryx opens Round 1",
      "2. All participants respond in parallel (or [NO_RESPONSE])",
      "3. Keryx closes the round -> auto-opens next round if discussion continues",
      "4. Rounds repeat until all agents say [NO_RESPONSE] or max rounds reached",
      "5. Keryx requests a final synthesis covering the full discussion",
    ].join("\n");
  }

  getSkillSummary(): string {
    return "Rules for participating in Keryx-managed round-based discussions (Ecclesia mode).";
  }

  getSkillInstructions(): string {
    return "Follow Keryx round management. Respond once per round. Use [NO_RESPONSE] if nothing new.";
  }

  // ---------------------------------------------------------------------------
  // Round lifecycle
  // ---------------------------------------------------------------------------

  private async openRound(state: ConversationState, triggerMessage: Message, ctx: ModeContext): Promise<void> {
    if (ctx.signal.aborted) return;

    const roundNumber = state.roundHistory.length + 1;

    if (roundNumber > ctx.config.maxRoundsPerTopic) {
      log.info(`Max rounds (${ctx.config.maxRoundsPerTopic}) reached for ${state.conversationId}`);
      return;
    }

    const participants = await ctx.getParticipantAgents(state.conversationId, triggerMessage.fromAgent);
    const expectedAgents = new Set(participants.map(p => p.id));
    const agentNames = participants.map(p => p.name);

    if (expectedAgents.size === 0) {
      log.debug(`No agents to participate in round for ${state.conversationId}`);
      return;
    }

    const topic = triggerMessage.content.slice(0, 100) +
      (triggerMessage.content.length > 100 ? "\u2026" : "");

    const timeoutMs = ctx.calculateTimeout(state, topic, expectedAgents.size);

    const round: Round = {
      id: roundNumber,
      topic,
      status: "open",
      openedAt: Date.now(),
      triggerMessageId: triggerMessage.id,
      expectedAgents,
      respondedAgents: new Set(),
      responseContents: new Map(),
      responseMessageIds: [],
      escalationLevel: 0,
    };

    state.currentRound = round;

    await ctx.sendMessage(
      state.conversationId,
      templates.roundOpen({
        roundNumber,
        topic,
        expectedAgents: agentNames,
        timeoutSeconds: Math.round(timeoutMs / 1000),
      }),
    );

    round.status = "collecting";
    this.startEscalationChain(state, timeoutMs, ctx);

    log.info(`Round ${roundNumber} opened in ${state.conversationId} (${expectedAgents.size} agents, ${Math.round(timeoutMs / 1000)}s timeout)`);
  }

  private async recordResponse(state: ConversationState, message: Message, ctx: ModeContext): Promise<void> {
    const round = state.currentRound;
    if (!round || (round.status !== "open" && round.status !== "collecting")) return;

    if (round.respondedAgents.has(message.fromAgent)) {
      log.debug(`Agent ${message.fromAgent} already responded in round ${round.id} -- ignoring duplicate`);
      return;
    }

    round.respondedAgents.add(message.fromAgent);
    round.responseContents.set(message.fromAgent, message.content);
    round.responseMessageIds.push(message.id);

    ctx.updateAgentProfile(message.fromAgent, Date.now() - round.openedAt);

    log.debug(`Agent ${message.fromAgent} responded in round ${round.id} (${round.respondedAgents.size}/${round.expectedAgents.size})`);

    this.checkRoundCompletion(state, ctx);
  }

  private checkRoundCompletion(state: ConversationState, ctx: ModeContext): void {
    const round = state.currentRound;
    if (!round || (round.status !== "open" && round.status !== "collecting")) return;

    const allResponded = [...round.expectedAgents].every(id =>
      round.respondedAgents.has(id),
    );

    if (allResponded) {
      setImmediate(() => this.closeRound(state, ctx));
    }
  }

  private async closeRound(state: ConversationState, ctx: ModeContext): Promise<void> {
    const round = state.currentRound;
    if (!round) return;

    if (round.status === "closed" || round.status === "synthesizing") return;

    if (round.timeoutHandle) {
      clearTimeout(round.timeoutHandle);
      round.timeoutHandle = undefined;
    }

    round.closedAt = Date.now();

    let consensusCount = 0;
    for (const content of round.responseContents.values()) {
      if (isConsensusResponse(content)) consensusCount++;
    }

    await ctx.sendMessage(
      state.conversationId,
      templates.roundClose({
        roundNumber: round.id,
        respondedCount: round.respondedAgents.size,
        totalCount: round.expectedAgents.size,
        noResponseCount: consensusCount,
      }),
    );

    const allConsensus = consensusCount === round.respondedAgents.size && round.respondedAgents.size > 0;

    if (allConsensus) {
      await ctx.sendMessage(
        state.conversationId,
        templates.discussionConcluded({ reason: "consensus", roundNumber: round.id }),
      );
      round.status = "synthesizing";
      await this.delegateFinalSynthesis(state, round, ctx);
    } else if (round.id >= ctx.config.maxRoundsPerTopic) {
      await ctx.sendMessage(
        state.conversationId,
        templates.discussionConcluded({
          reason: "max_rounds",
          roundNumber: round.id,
          maxRounds: ctx.config.maxRoundsPerTopic,
        }),
      );
      round.status = "synthesizing";
      await this.delegateFinalSynthesis(state, round, ctx);
    } else {
      round.status = "closed";
      state.roundHistory.push(round);
      state.currentRound = null;

      setImmediate(() => ctx.runPatternDetection(state));
      await this.autoOpenNextRound(state, ctx);
    }
  }

  private async delegateFinalSynthesis(state: ConversationState, round: Round, ctx: ModeContext): Promise<void> {
    if (ctx.signal.aborted) return;

    const synthesisAgents = await ctx.store.findAgentsByCapability(
      ctx.config.synthesisCapability,
    );

    const subscribers = await ctx.store.getSubscribers(state.conversationId);
    const subscriberIds = new Set(subscribers.map(s => s.agentId));

    let synthAgent = synthesisAgents.find(a =>
      subscriberIds.has(a.id) && a.id !== ctx.keryxAgentId,
    );

    if (!synthAgent) {
      const responders = [...round.respondedAgents];
      if (responders.length > 0) {
        const randomId = responders[Math.floor(Math.random() * responders.length)];
        synthAgent = await ctx.store.getAgent(randomId) ?? undefined;
      }
    }

    if (!synthAgent) {
      round.status = "closed";
      state.roundHistory.push(round);
      state.currentRound = null;
      log.warn(`No synthesis agent available for round ${round.id} in ${state.conversationId}`);
      return;
    }

    await ctx.sendMessage(
      state.conversationId,
      templates.synthesisRequest({
        roundNumber: round.id,
        agentName: synthAgent.name,
        topic: round.topic,
      }),
    );

    const synthesisTimeout = ctx.config.baseTimeoutMs * 2;
    round.timeoutHandle = setTimeout(() => {
      if (round.status === "synthesizing") {
        round.status = "closed";
        state.roundHistory.push(round);
        state.currentRound = null;
        log.warn(`Synthesis timed out for round ${round.id} in ${state.conversationId}`);
      }
    }, synthesisTimeout);

    log.info(`Final synthesis delegated to ${synthAgent.name} for round ${round.id}`);
  }

  private async autoOpenNextRound(state: ConversationState, ctx: ModeContext): Promise<void> {
    if (ctx.signal.aborted) return;

    const roundNumber = state.roundHistory.length + 1;
    if (roundNumber > ctx.config.maxRoundsPerTopic) return;

    const originalTopic = state.roundHistory[0]?.topic ?? "Discussion";

    const participants = await ctx.getParticipantAgents(state.conversationId);
    const expectedAgents = new Set(participants.map(p => p.id));
    const agentNames = participants.map(p => p.name);

    if (expectedAgents.size === 0) {
      log.debug(`No agents for auto round ${roundNumber} in ${state.conversationId}`);
      return;
    }

    const timeoutMs = ctx.calculateTimeout(state, originalTopic, expectedAgents.size);

    const round: Round = {
      id: roundNumber,
      topic: originalTopic,
      status: "open",
      openedAt: Date.now(),
      triggerMessageId: state.roundHistory[0]?.triggerMessageId ?? "",
      expectedAgents,
      respondedAgents: new Set(),
      responseContents: new Map(),
      responseMessageIds: [],
      escalationLevel: 0,
    };

    state.currentRound = round;

    await ctx.sendMessage(
      state.conversationId,
      templates.roundContinue({
        roundNumber,
        topic: originalTopic,
        expectedAgents: agentNames,
        timeoutSeconds: Math.round(timeoutMs / 1000),
      }),
    );

    round.status = "collecting";
    this.startEscalationChain(state, timeoutMs, ctx);

    log.info(`Auto round ${roundNumber} opened in ${state.conversationId} (${expectedAgents.size} agents)`);
  }

  private async handlePotentialSynthesis(state: ConversationState, message: Message, ctx: ModeContext): Promise<void> {
    const round = state.currentRound;
    if (!round || round.status !== "synthesizing") return;

    round.synthesisMessageId = message.id;
    round.status = "closed";

    if (round.timeoutHandle) {
      clearTimeout(round.timeoutHandle);
      round.timeoutHandle = undefined;
    }

    state.roundHistory.push(round);
    state.currentRound = null;

    log.info(`Synthesis received for round ${round.id} from ${message.fromAgent}`);

    setImmediate(() => ctx.runPatternDetection(state));
  }

  // ---------------------------------------------------------------------------
  // Escalation chain
  // ---------------------------------------------------------------------------

  private startEscalationChain(state: ConversationState, baseTimeoutMs: number, ctx: ModeContext): void {
    const round = state.currentRound;
    if (!round) return;

    const hasNonResponders = (): boolean => {
      for (const id of round.expectedAgents) {
        if (!round.respondedAgents.has(id)) return true;
      }
      return false;
    };

    const hasMajority = (): boolean => {
      return round.respondedAgents.size > 0 &&
        round.respondedAgents.size > round.expectedAgents.size / 2;
    };

    round.timeoutHandle = setTimeout(() => {
      if (ctx.signal.aborted) return;
      if (round.status !== "collecting") return;
      if (!hasNonResponders()) { this.checkRoundCompletion(state, ctx); return; }

      if (hasMajority()) {
        log.info(`Round ${round.id}: majority responded (${round.respondedAgents.size}/${round.expectedAgents.size}), waiting 10s for stragglers`);
        round.timeoutHandle = setTimeout(() => {
          if (ctx.signal.aborted) return;
          if (round.status !== "collecting") return;
          log.info(`Round ${round.id}: grace period ended (${round.respondedAgents.size}/${round.expectedAgents.size}), closing`);
          this.closeRound(state, ctx);
        }, 10_000);
        return;
      }

      round.escalationLevel = 1;
      this.sendNudge(state, round, ctx);
      log.debug(`Round ${round.id} nudge sent`);

      round.timeoutHandle = setTimeout(() => {
        if (ctx.signal.aborted) return;
        if (round.status !== "collecting") return;
        if (!hasNonResponders()) { this.checkRoundCompletion(state, ctx); return; }

        round.escalationLevel = 2;
        log.info(`Round ${round.id}: force-closing after timeout (${round.respondedAgents.size}/${round.expectedAgents.size} responded)`);
        this.closeRound(state, ctx);
      }, baseTimeoutMs * 0.5);
    }, baseTimeoutMs);
  }

  private async sendNudge(state: ConversationState, round: Round, ctx: ModeContext): Promise<void> {
    const nonResponders: string[] = [];
    for (const agentId of round.expectedAgents) {
      if (!round.respondedAgents.has(agentId)) {
        const agent = await ctx.store.getAgent(agentId);
        if (agent) nonResponders.push(agent.name);
      }
    }

    if (nonResponders.length === 0) return;

    const elapsed = Math.round((Date.now() - round.openedAt) / 1000);
    await ctx.sendMessage(
      state.conversationId,
      templates.nudge({
        agentNames: nonResponders,
        roundNumber: round.id,
        elapsedSeconds: elapsed,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Agent error handling
  // ---------------------------------------------------------------------------

  /** Remove a failed agent from the current round and check completion. */
  handleAgentError(agentId: string, state: ConversationState, ctx: ModeContext): void {
    const round = state.currentRound;
    if (!round || (round.status !== "open" && round.status !== "collecting")) return;
    if (!round.expectedAgents.has(agentId)) return;

    round.expectedAgents.delete(agentId);
    log.info(`Agent ${agentId} error — removed from round ${round.id} (${round.respondedAgents.size}/${round.expectedAgents.size} remaining)`);

    this.checkRoundCompletion(state, ctx);
  }

  // ---------------------------------------------------------------------------
  // Interrupt flow
  // ---------------------------------------------------------------------------

  async interruptRound(state: ConversationState, interruptedBy: string, ctx: ModeContext): Promise<void> {
    const round = state.currentRound;
    if (!round || round.status === "closed" || round.status === "interrupted") return;

    round.status = "interrupted";
    round.interruptedBy = interruptedBy;

    if (round.timeoutHandle) {
      clearTimeout(round.timeoutHandle);
      round.timeoutHandle = undefined;
    }

    const agent = await ctx.store.getAgent(interruptedBy);
    await ctx.sendMessage(
      state.conversationId,
      templates.interrupt({
        roundNumber: round.id,
        interruptedBy: agent?.name ?? interruptedBy,
      }),
    );
  }

  private async resumeFromInterrupt(state: ConversationState, message: Message, ctx: ModeContext): Promise<void> {
    const round = state.currentRound;
    if (!round || round.status !== "interrupted") return;

    round.status = "closed";
    round.closedAt = Date.now();
    state.roundHistory.push(round);
    state.currentRound = null;

    await this.openRound(state, message, ctx);
  }
}
