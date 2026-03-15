/**
 * Socratic mode — Turn-by-turn ordered discussion.
 *
 * Named after Socratic dialogue: structured, sequential exchange where
 * each participant speaks in turn, building on what came before.
 *
 * Flow:
 *   1. Human posts a question/topic
 *   2. Keryx assigns turn order (alphabetical by agent name)
 *   3. Agent 1 speaks, then Agent 2, then Agent 3...
 *   4. After all agents have spoken = 1 cycle
 *   5. Agents who said [NO_RESPONSE] are skipped in subsequent cycles
 *   6. Discussion ends when all remaining agents pass, or max cycles reached
 *
 * Error handling:
 *   - If an agent times out, skip and move to next (no nudge, no block)
 *   - Timed-out agents are still included in the next cycle
 */

import type { Message } from "../../store/types.js";
import type { ConversationState, SocraticState } from "../types.js";
import type { ConversationModeHandler, ModeContext } from "../mode-interface.js";
import { createLogger } from "../../logger.js";

const log = createLogger("keryx:socratic");

export class SocraticMode implements ConversationModeHandler {
  readonly name = "socratic" as const;

  handleMessage(message: Message, state: ConversationState, ctx: ModeContext): void {
    if (state.disabled || state.paused) return;

    const socratic = state.socratic;

    if (!socratic) {
      // No active discussion — start one if human message
      setImmediate(async () => {
        if (await ctx.isHumanMessage(message)) {
          await this.startDiscussion(state, message, ctx);
        }
      });
      return;
    }

    if (!socratic.awaitingResponse) return;

    // Check if this is the expected agent's response
    const expectedAgentId = socratic.turnQueue[socratic.currentTurnIndex];
    if (message.fromAgent === expectedAgentId) {
      setImmediate(() => this.handleTurnResponse(state, message, ctx));
      return;
    }

    // Human message during discussion — interrupt and restart with new topic
    setImmediate(async () => {
      if (await ctx.isHumanMessage(message)) {
        this.cleanup(state);
        await this.startDiscussion(state, message, ctx);
      }
      // Ignore unexpected agent messages (they'll get their turn)
    });
  }

  cleanup(state: ConversationState): void {
    if (state.socratic?.turnTimeoutHandle) {
      clearTimeout(state.socratic.turnTimeoutHandle);
      state.socratic.turnTimeoutHandle = undefined;
    }
    state.socratic = undefined;
  }

  getSkillContent(): string {
    return [
      "# Keryx Discussion Protocol -- Socratic Mode",
      "",
      "This conversation uses Socratic mode: structured turn-by-turn discussion.",
      "",
      "**Note**: Socratic mode is best suited for 2-3 agents. For larger groups,",
      "consider switching to Ecclesia mode (`@keryx mode ecclesia`) which runs",
      "agents in parallel rounds and is significantly faster.",
      "",
      "## Rules",
      "1. **Wait for your turn**: Keryx will @mention you when it's your turn to speak.",
      "2. **One response per turn**: Provide your perspective when called upon.",
      "3. **[NO_RESPONSE]**: Use this if you have nothing to add. You'll be skipped in future cycles.",
      "4. **Build on previous**: You can see and reference what previous speakers said.",
      "5. **Commands**: Humans can control the discussion with @keryx commands.",
      "",
      "## Turn Flow",
      "1. Human posts a question or topic",
      "2. Keryx calls on each agent in subscription order",
      "3. Each agent responds when called (or [NO_RESPONSE])",
      "4. After all agents have spoken = 1 cycle",
      "5. Discussion continues until all agents pass or max cycles reached",
    ].join("\n");
  }

  getSkillSummary(): string {
    return "Rules for participating in Keryx-managed turn-by-turn discussions (Socratic mode).";
  }

  getSkillInstructions(): string {
    return "Wait for your turn. Respond only when Keryx @mentions you. Use [NO_RESPONSE] if nothing new.";
  }

  // ---------------------------------------------------------------------------
  // Discussion lifecycle
  // ---------------------------------------------------------------------------

  private async startDiscussion(state: ConversationState, triggerMessage: Message, ctx: ModeContext): Promise<void> {
    if (ctx.signal.aborted) return;

    const participants = await ctx.getParticipantAgents(state.conversationId, triggerMessage.fromAgent);

    if (participants.length === 0) {
      log.debug(`No agents to participate in discussion for ${state.conversationId}`);
      return;
    }

    // Sort alphabetically by name for deterministic turn order
    participants.sort((a, b) => a.name.localeCompare(b.name));

    const topic = triggerMessage.content.slice(0, 100) +
      (triggerMessage.content.length > 100 ? "\u2026" : "");

    const socratic: SocraticState = {
      turnQueue: participants.map(p => p.id),
      currentTurnIndex: 0,
      topic,
      triggerMessageId: triggerMessage.id,
      awaitingResponse: false,
      completedCycles: 0,
      passedAgents: new Set(),
    };

    state.socratic = socratic;

    const agentList = participants.map(p => `@${p.name}`).join(" -> ");
    await ctx.sendMessage(
      state.conversationId,
      [
        `\ud83c\udfdb\ufe0f **Socratic Discussion** -- Topic: ${topic}`,
        `Turn order: ${agentList}`,
        `Each agent speaks in turn. Use [NO_RESPONSE] to pass.`,
      ].join("\n"),
    );

    log.info(`Socratic discussion started in ${state.conversationId} (${participants.length} agents)`);

    // Call the first agent
    await this.callNextAgent(state, ctx);
  }

  private async callNextAgent(state: ConversationState, ctx: ModeContext): Promise<void> {
    if (ctx.signal.aborted) return;

    const socratic = state.socratic;
    if (!socratic) return;

    // Find the next agent that hasn't passed
    let attempts = 0;
    while (attempts < socratic.turnQueue.length) {
      const agentId = socratic.turnQueue[socratic.currentTurnIndex];

      if (!socratic.passedAgents.has(agentId)) {
        // This agent hasn't passed — call them
        const agent = await ctx.store.getAgent(agentId);
        if (!agent) {
          // Agent no longer exists — skip
          this.advanceTurn(socratic);
          attempts++;
          continue;
        }

        socratic.awaitingResponse = true;

        const cycleLabel = socratic.completedCycles > 0
          ? ` (cycle ${socratic.completedCycles + 1})`
          : "";

        await ctx.sendMessage(
          state.conversationId,
          `\ud83c\udf99\ufe0f @${agent.name} -- Your turn${cycleLabel}. Please share your perspective on: ${socratic.topic}`,
        );

        // Set timeout for this turn
        const timeoutMs = ctx.calculateTimeout(state, socratic.topic, socratic.turnQueue.length);
        socratic.turnTimeoutHandle = setTimeout(() => {
          if (ctx.signal.aborted) return;
          if (!state.socratic || !state.socratic.awaitingResponse) return;

          log.info(`Agent ${agentId} timed out in Socratic turn for ${state.conversationId}`);

          // Skip this agent for now (they stay in the queue for next cycle)
          setImmediate(async () => {
            const timedOutAgent = await ctx.store.getAgent(agentId);
            await ctx.sendMessage(
              state.conversationId,
              `\u23f0 @${timedOutAgent?.name ?? agentId} timed out. Moving to next speaker.`,
            );
            state.socratic!.awaitingResponse = false;
            this.advanceTurn(state.socratic!);
            await this.callNextAgent(state, ctx);
          });
        }, timeoutMs);

        log.debug(`Called @${agent.name} in ${state.conversationId} (turn ${socratic.currentTurnIndex + 1}/${socratic.turnQueue.length})`);
        return;
      }

      // This agent passed — skip them
      this.advanceTurn(socratic);
      attempts++;
    }

    // All remaining agents have passed — discussion complete
    await this.concludeDiscussion(state, ctx);
  }

  private async handleTurnResponse(state: ConversationState, message: Message, ctx: ModeContext): Promise<void> {
    const socratic = state.socratic;
    if (!socratic || !socratic.awaitingResponse) return;

    // Clear timeout
    if (socratic.turnTimeoutHandle) {
      clearTimeout(socratic.turnTimeoutHandle);
      socratic.turnTimeoutHandle = undefined;
    }

    socratic.awaitingResponse = false;

    // Update agent profile
    ctx.updateAgentProfile(message.fromAgent, Date.now());

    // Check if agent passed
    const content = message.content.trim();
    if (/^\[NO[_\s]?RESPONSE\]$/i.test(content) || content.toLowerCase() === "no response") {
      socratic.passedAgents.add(message.fromAgent);
      log.debug(`Agent ${message.fromAgent} passed in Socratic discussion`);
    }

    // Advance to next turn
    this.advanceTurn(socratic);
    await this.callNextAgent(state, ctx);
  }

  private advanceTurn(socratic: SocraticState): void {
    socratic.currentTurnIndex++;
    if (socratic.currentTurnIndex >= socratic.turnQueue.length) {
      // Completed a full cycle
      socratic.currentTurnIndex = 0;
      socratic.completedCycles++;
    }
  }

  private async concludeDiscussion(state: ConversationState, ctx: ModeContext): Promise<void> {
    const socratic = state.socratic;
    if (!socratic) return;

    const cycleCount = socratic.completedCycles + 1;
    const activeAgents = socratic.turnQueue.length - socratic.passedAgents.size;

    await ctx.sendMessage(
      state.conversationId,
      [
        `\ud83c\udfc1 **Discussion concluded** after ${cycleCount} cycle${cycleCount > 1 ? "s" : ""}.`,
        activeAgents === 0
          ? "All participants have passed."
          : `${activeAgents} agent${activeAgents > 1 ? "s" : ""} still active but max cycles reached.`,
      ].join("\n"),
    );

    // Request synthesis from a random participant who didn't pass
    const activeIds = socratic.turnQueue.filter(id => !socratic.passedAgents.has(id));
    if (activeIds.length > 0) {
      const synthId = activeIds[Math.floor(Math.random() * activeIds.length)];
      const synthAgent = await ctx.store.getAgent(synthId);
      if (synthAgent) {
        await ctx.sendMessage(
          state.conversationId,
          `\ud83d\udd04 @${synthAgent.name} -- Please synthesize the key points from this discussion on: ${socratic.topic}`,
        );
      }
    }

    // Clean up
    this.cleanup(state);

    log.info(`Socratic discussion concluded in ${state.conversationId} (${cycleCount} cycles)`);
  }
}
