/**
 * DebateSession — orchestrates a single debate between agents.
 *
 * Responsibilities:
 * - Select consensus protocol based on question type
 * - Manage rounds (invoke agents, collect responses, check convergence)
 * - Track token usage and respect budget limits
 * - Adapt when approaching budget (reduce rounds, drop agents, summarize context)
 * - Store results in the Blackboard (when available)
 */

import type { IAgentAdapter, TokenUsage } from "./adapters/base.js";
import type { IBlackboard, RoundRecord, ParticipantResponse } from "./memory/base.js";
import type { ConsensusProtocol, IConsensusProtocol } from "./consensus/base.js";
import type { PersonaConfig, Config } from "./config.js";
import { VoteConsensus } from "./consensus/vote.js";
import { DebateConsensus } from "./consensus/debate.js";
import { buildSystemPrompt } from "./personas.js";
import { randomUUID } from "node:crypto";
import { createLogger, createDebateLog, isValidDebateId } from "./logger.js";

const log = createLogger("orchestrator");

export type DebateMode = "quick" | "full";

export interface DebateOptions {
  projectId: string;
  prompt: string;
  /** Resume an existing debate — loads previous rounds and continues */
  debateId?: string;
  agents: IAgentAdapter[];
  /** Persona assignments per agent: agent name → PersonaConfig[] */
  agentPersonas?: Map<string, PersonaConfig[]>;
  mode: DebateMode;
  thoroughness: number;
  maxRounds?: number;
  /** Override max tokens for this debate (0 = unlimited) */
  maxTokens?: number;
  protocolOverride?: ConsensusProtocol;
}

export interface CostReport {
  totalTokens: TokenUsage;
  totalCostUsd: number;
  perAgent: Map<string, TokenUsage>;
  perRound: Array<{ round: number; tokens: TokenUsage }>;
  budgetUsedPercent: number | null;
  budgetActions: string[];
}

export interface DebateSessionResult {
  debateId: string;
  consensus: string;
  dissent?: string;
  confidenceScore: number;
  protocol: ConsensusProtocol;
  rounds: RoundRecord[];
  cost: CostReport;
  durationMs: number;
}

function emptyTokens(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0 };
}

function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: (a.costUsd ?? 0) + (b.costUsd ?? 0) || undefined,
  };
}

function totalTokenCount(t: TokenUsage): number {
  return t.inputTokens + t.outputTokens;
}

export interface EstimateResult {
  estimatedTokens: number;
  budgetPercent: number | null;
  overBudget: boolean;
}

export class DebateSession {
  private readonly blackboard: IBlackboard | null;
  private readonly budgetConfig: Config["budget"];

  constructor(blackboard?: IBlackboard, budgetConfig?: Config["budget"]) {
    this.blackboard = blackboard ?? null;
    this.budgetConfig = budgetConfig ?? {
      maxTokensPerDebate: 0, maxTokensPerProject: 0,
      warnAtPercent: 80, estimatedTokensPerInvocation: 1500,
    };
  }

  /**
   * Estimate token usage before running a debate.
   * Returns estimated total tokens, budget percentage, and whether it exceeds the warn threshold.
   */
  estimate(options: Pick<DebateOptions, "agents" | "mode" | "thoroughness" | "maxRounds" | "maxTokens">): EstimateResult {
    const rounds = DebateSession.computeMaxRounds(options.mode, options.thoroughness, options.maxRounds);
    const perInvocation = this.budgetConfig.estimatedTokensPerInvocation ?? 1500;
    const estimatedTokens = options.agents.length * rounds * perInvocation;

    const maxTokens = options.maxTokens ?? this.budgetConfig.maxTokensPerDebate ?? 0;
    const hasBudget = maxTokens > 0;
    const budgetPercent = hasBudget ? (estimatedTokens / maxTokens) * 100 : null;
    const warnAt = this.budgetConfig.warnAtPercent ?? 80;
    const overBudget = budgetPercent !== null && budgetPercent > warnAt;

    log.info("estimate:", estimatedTokens, "tokens,", options.agents.length, "agents,", rounds, "rounds" +
      (budgetPercent !== null ? `, ${budgetPercent.toFixed(1)}% of budget` : ""));
    return { estimatedTokens, budgetPercent, overBudget };
  }

  static computeMaxRounds(mode: DebateMode, thoroughness: number, explicit?: number): number {
    if (explicit !== undefined) return explicit;
    if (mode === "quick") return 1;
    // Smooth 1-5 range: 0.01-0.2→1, 0.21-0.4→2, 0.41-0.6→3, 0.61-0.8→4, 0.81-1.0→5
    return Math.min(Math.max(1, Math.ceil(thoroughness * 5)), 5);
  }

  private static readonly QUORUM_KEYWORDS = [
    "security", "vulnerability", "auth", "encryption", "credential",
    "attack", "exploit", "compliance", "critical", "cve", "injection",
  ];
  private static readonly VOTE_KEYWORDS = [
    "which", "compare", "vs", "benchmark", "best practice",
    "what is", "difference between", "pros and cons", "choose",
  ];

  private selectProtocol(prompt: string, override?: ConsensusProtocol): ConsensusProtocol {
    if (override) return override;

    const lower = prompt.toLowerCase();

    // Check quorum first (security topics are highest priority)
    const quorumScore = DebateSession.QUORUM_KEYWORDS.filter((kw) => lower.includes(kw)).length;
    if (quorumScore >= 2) {
      log.info("protocol selected: quorum (score:", quorumScore, "security keywords)");
      return "quorum";
    }

    // Then vote (factual/comparison questions)
    const voteScore = DebateSession.VOTE_KEYWORDS.filter((kw) => lower.includes(kw)).length;
    if (voteScore >= 2) {
      log.info("protocol selected: vote (score:", voteScore, "factual keywords)");
      return "vote";
    }

    // Default to debate
    log.info("protocol selected: debate (default, quorum:", quorumScore, "vote:", voteScore + ")");
    return "debate";
  }

  private getConsensusImpl(protocol: ConsensusProtocol): IConsensusProtocol {
    switch (protocol) {
      case "vote":
      case "quorum":
        return new VoteConsensus();
      case "debate":
        return new DebateConsensus();
    }
  }

  private buildRoundPrompt(
    originalPrompt: string,
    previousRounds: RoundRecord[],
    roundNumber: number,
    maxRounds: number,
    summarize: boolean
  ): string {
    let prompt = originalPrompt;

    if (previousRounds.length > 0) {
      const lastRound = previousRounds[previousRounds.length - 1];

      let prevResponses: string;
      if (summarize) {
        // Budget pressure — shorter context to save tokens
        prevResponses = lastRound.responses
          .map((r) => {
            const label = r.persona ? `${r.agent} (${r.persona})` : r.agent;
            // Truncate to ~200 chars
            const short = r.content.length > 200
              ? r.content.slice(0, 200) + "..."
              : r.content;
            return `[${label}]: ${short}`;
          })
          .join("\n");
      } else {
        prevResponses = lastRound.responses
          .map((r) => {
            const label = r.persona ? `${r.agent} (${r.persona})` : r.agent;
            return `[${label}]:\n${r.content}`;
          })
          .join("\n\n");
      }

      prompt =
        `Question: ${originalPrompt}\n\n` +
        `--- Previous round responses ---\n${prevResponses}\n\n` +
        `--- Round ${roundNumber}/${maxRounds} ---\n` +
        `Consider the other participants' arguments. Acknowledge valid points, ` +
        `push back where you disagree, and refine your position.`;
    }

    return prompt;
  }

  /**
   * Run a debate session, or continue an existing one.
   * Tracks token usage and adapts when approaching budget limits.
   */
  async run(options: DebateOptions): Promise<DebateSessionResult> {
    const start = Date.now();
    const protocol = this.selectProtocol(options.prompt, options.protocolOverride);
    log.info("debate start:", options.agents.length, "agents, mode=" + options.mode,
      "thoroughness=" + options.thoroughness, options.debateId ? "resuming=" + options.debateId : "");

    // Budget setup
    const maxTokens = options.maxTokens
      ?? this.budgetConfig.maxTokensPerDebate
      ?? 0;
    const warnPercent = this.budgetConfig.warnAtPercent ?? 80;
    const hasBudget = maxTokens > 0;
    const budgetActions: string[] = [];

    // Cost tracking
    let runningTotal = emptyTokens();
    const perAgent = new Map<string, TokenUsage>();
    const perRound: Array<{ round: number; tokens: TokenUsage }> = [];

    // Resume or start fresh
    let debateId: string;
    let previousRounds: RoundRecord[] = [];

    if (options.debateId) {
      if (!isValidDebateId(options.debateId)) {
        throw new Error(`Invalid debate ID: "${options.debateId}". Must be alphanumeric/hyphens/underscores, max 128 chars.`);
      }
      debateId = options.debateId;

      if (this.blackboard) {
        const existing = await this.blackboard.getDebate(debateId);
        if (existing) {
          previousRounds = existing.rounds;
        }
      } else {
        log.warn(`--continue: blackboard not available, starting fresh debate with ID ${debateId}`);
      }
    } else {
      debateId = randomUUID();
    }

    // Per-debate log file (full prompts & responses)
    const dlog = createDebateLog(debateId);
    dlog?.write("info", `debate ${debateId} | prompt: ${options.prompt}`);
    dlog?.write("info", `agents: ${options.agents.map(a => a.name).join(", ")} | mode: ${options.mode} | thoroughness: ${options.thoroughness}`);

    let maxNewRounds = DebateSession.computeMaxRounds(options.mode, options.thoroughness, options.maxRounds);
    const startRound = previousRounds.length + 1;
    const rounds: RoundRecord[] = [...previousRounds];

    // Active agents — may be reduced by budget pressure
    let activeAgents = [...options.agents];

    if (activeAgents.length === 0) {
      throw new Error("No agents provided. At least one agent is required for a debate.");
    }

    for (let round = startRound; round <= previousRounds.length + maxNewRounds; round++) {
      // Budget check before each round
      if (hasBudget) {
        const usedPercent = (totalTokenCount(runningTotal) / maxTokens) * 100;

        if (usedPercent >= 100) {
          const msg = `Round ${round}: budget exhausted (${totalTokenCount(runningTotal)}/${maxTokens} tokens). Stopping.`;
          budgetActions.push(msg);
          log.warn(msg);
          break;
        }

        if (usedPercent >= warnPercent) {
          const remainingRounds = (previousRounds.length + maxNewRounds) - round + 1;

          // Adaptive measures, escalating with budget pressure
          if (usedPercent >= 95 && remainingRounds > 1) {
            // Critical — stop after this round
            maxNewRounds = round - previousRounds.length;
            const msg = `Round ${round}: budget critical (${usedPercent.toFixed(0)}%). This will be the last round.`;
            budgetActions.push(msg);
            log.warn(msg);
          } else if (usedPercent >= 90 && activeAgents.length > 1) {
            // Drop to first agent only (cost-per-agent not tracked yet)
            activeAgents = [activeAgents[0]];
            const msg = `Round ${round}: budget tight (${usedPercent.toFixed(0)}%). Reduced to 1 agent.`;
            budgetActions.push(msg);
            log.warn(msg);
          } else if (usedPercent >= warnPercent) {
            const msg = `Round ${round}: budget warning (${usedPercent.toFixed(0)}%). Summarizing context to save tokens.`;
            budgetActions.push(msg);
            log.warn(msg);
          }
        }
      }

      const summarize = hasBudget && (totalTokenCount(runningTotal) / maxTokens) * 100 >= warnPercent;
      const totalRounds = previousRounds.length + maxNewRounds;

      log.info("round", round + "/" + totalRounds, "start,", activeAgents.length, "agents" +
        (summarize ? " (summarized context)" : ""));

      const roundPrompt = this.buildRoundPrompt(
        options.prompt,
        rounds,
        round,
        totalRounds,
        summarize
      );
      log.debug("round prompt length:", roundPrompt.length, "chars");

      // Invoke agents in parallel
      const responsePromises = activeAgents.map(async (agent): Promise<ParticipantResponse & { tokens?: TokenUsage }> => {
        const personas = options.agentPersonas?.get(agent.name) ?? [];
        const systemPrompt = buildSystemPrompt(personas);
        const personaLabel = personas.map((p) => p.name).join("+") || undefined;

        try {
          // Full prompt → debate log; summary → stderr/info
          const promptSummary = `${agent.name} prompt: ${roundPrompt.length} chars` +
            (systemPrompt ? ` (+ ${systemPrompt.length} chars system)` : "");
          log.debug(promptSummary);
          dlog?.write("debug", `--- ${agent.name} prompt ---\n` +
            (systemPrompt ? `[system]\n${systemPrompt}\n` : "") +
            `[user]\n${roundPrompt}`);

          const response = await agent.invoke({
            prompt: roundPrompt,
            systemPrompt: systemPrompt || undefined,
          });

          log.debug(`${agent.name} response: ${response.durationMs}ms, ${response.content.length} chars`);
          dlog?.write("debug", `--- ${agent.name} response (${response.durationMs}ms, confidence: ${response.confidence}) ---\n` +
            response.content);

          return {
            agent: agent.name,
            persona: personaLabel,
            content: response.content,
            confidence: response.confidence,
            durationMs: response.durationMs,
            tokens: response.tokens,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error("agent", agent.name, "failed:", message);
          dlog?.write("error", `${agent.name} failed: ${message}`);
          return {
            agent: agent.name,
            persona: personaLabel,
            content: `[Error: ${message}]`,
            confidence: 0,
            durationMs: Date.now() - start,
          };
        }
      });

      const responsesWithTokens = await Promise.all(responsePromises);

      // Check how many agents are alive
      const allFailed = responsesWithTokens.every((r) => r.confidence === 0 && r.content.startsWith("[Error:"));
      const aliveCount = responsesWithTokens.filter((r) => r.confidence > 0 || !r.content.startsWith("[Error:")).length;
      if (aliveCount < responsesWithTokens.length && !allFailed) {
        log.warn(`Round ${round}: ${responsesWithTokens.length - aliveCount}/${responsesWithTokens.length} agents failed, continuing with ${aliveCount}`);
      }

      // Track costs
      let roundTokens = emptyTokens();
      const roundResponses: ParticipantResponse[] = [];

      for (const r of responsesWithTokens) {
        const { tokens, ...response } = r;
        roundResponses.push(response);

        if (tokens) {
          roundTokens = addTokens(roundTokens, tokens);
          const prev = perAgent.get(r.agent) ?? emptyTokens();
          perAgent.set(r.agent, addTokens(prev, tokens));
        }
      }

      runningTotal = addTokens(runningTotal, roundTokens);
      perRound.push({ round, tokens: roundTokens });
      rounds.push({ roundNumber: round, responses: roundResponses });
      log.debug("round", round, "tokens:", totalTokenCount(roundTokens),
        "| running total:", totalTokenCount(runningTotal));
      dlog?.write("info", `round ${round} complete: ${totalTokenCount(roundTokens)} tokens (running total: ${totalTokenCount(runningTotal)})`);

      // Abort if ALL agents failed this round (after recording it)
      if (allFailed) {
        const msg = `Round ${round}: all ${activeAgents.length} agents failed. Aborting debate.`;
        budgetActions.push(msg);
        log.error(msg);
        dlog?.write("error", msg);
        break;
      }
    }

    const duration = Date.now() - start;
    log.info("debate end:", rounds.length - previousRounds.length, "new rounds,",
      totalTokenCount(runningTotal), "tokens,", duration + "ms");
    dlog?.write("info", `debate end: ${rounds.length - previousRounds.length} new rounds, ${totalTokenCount(runningTotal)} tokens, ${duration}ms`);

    // Build consensus via protocol
    if (rounds.length === 0) {
      throw new Error("No rounds completed — cannot build consensus.");
    }
    const lastRound = rounds[rounds.length - 1];
    const consensusImpl = this.getConsensusImpl(protocol);

    // Build persona bonus map from agentPersonas
    const personaBonuses = new Map<string, number>();
    if (options.agentPersonas) {
      for (const [agentName, personas] of options.agentPersonas) {
        const maxBonus = Math.max(...personas.map((p) => p.consensusBonus), 1.0);
        personaBonuses.set(agentName, maxBonus);
      }
    }

    const consensusResult = consensusImpl.evaluate({
      responses: lastRound.responses,
      personaBonuses,
      allRounds: rounds,
    });

    const consensus = consensusResult.consensus;
    const avgConfidence = consensusResult.confidenceScore;

    // Cost report
    const cost: CostReport = {
      totalTokens: runningTotal,
      totalCostUsd: runningTotal.costUsd ?? 0,
      perAgent,
      perRound,
      budgetUsedPercent: hasBudget
        ? (totalTokenCount(runningTotal) / maxTokens) * 100
        : null,
      budgetActions,
    };

    // Store in blackboard
    if (this.blackboard) {
      try {
        await this.blackboard.saveDebate({
          id: debateId,
          projectId: options.projectId,
          prompt: options.prompt,
          mode: options.mode,
          status: "completed",
          thoroughness: options.thoroughness,
          participants: options.agents.map((a) => a.name),
          rounds,
          result: { consensus, dissent: consensusResult.dissent, confidenceScore: avgConfidence, protocol },
          visibility: "private",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        log.warn("blackboard save failed:", err instanceof Error ? err.message : String(err));
      }
    }

    return {
      debateId,
      consensus,
      dissent: consensusResult.dissent,
      confidenceScore: avgConfidence,
      protocol,
      rounds,
      cost,
      durationMs: Date.now() - start,
    };
  }
}
