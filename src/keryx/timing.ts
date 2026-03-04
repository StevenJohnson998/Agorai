/**
 * Keryx — Adaptive timing.
 *
 * Calculates dynamic timeouts based on prompt complexity,
 * agent response history, round number, and subscriber count.
 * Fully dynamic — no floor/ceiling.
 */

import type { ConversationState, AgentProfile } from "./types.js";

/**
 * Estimate complexity of a text on a 0-1 scale.
 *
 * Factors:
 * - Word count (longer = more complex)
 * - Code blocks (fenced or indented)
 * - Question marks (more questions = more to address)
 * - Technical terms density (URLs, numbers, special chars)
 */
export function estimateComplexity(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // Word count factor: 0-1, saturates around 500 words
  const wordFactor = Math.min(wordCount / 500, 1);

  // Code blocks
  const codeBlocks = (text.match(/```/g) ?? []).length / 2;
  const codeFactor = Math.min(codeBlocks / 3, 1);

  // Questions
  const questions = (text.match(/\?/g) ?? []).length;
  const questionFactor = Math.min(questions / 5, 1);

  // Technical density: URLs, numbers, special characters
  const technicalTokens = (text.match(/https?:\/\/\S+|\b\d{3,}\b|[{}[\]<>|&]/g) ?? []).length;
  const techFactor = Math.min(technicalTokens / 10, 1);

  // Weighted average
  return (
    wordFactor * 0.4 +
    codeFactor * 0.25 +
    questionFactor * 0.2 +
    techFactor * 0.15
  );
}

/**
 * Calculate adaptive timeout for a round.
 *
 * @param state - Conversation state (for round history)
 * @param topic - The round topic text
 * @param subscriberCount - Number of expected agents
 * @param baseTimeoutMs - Base timeout from config
 * @param agentProfiles - Per-agent response time profiles
 */
export function calculateAdaptiveTimeout(
  state: ConversationState,
  topic: string,
  subscriberCount: number,
  baseTimeoutMs: number,
  agentProfiles: Map<string, AgentProfile>,
): number {
  let timeout = baseTimeoutMs;

  // Factor 1: Prompt complexity (0-1 → 0.5x-2x multiplier)
  const complexity = estimateComplexity(topic);
  const complexityMultiplier = 0.5 + complexity * 1.5; // range: 0.5-2.0
  timeout *= complexityMultiplier;

  // Factor 2: Agent history — use average response time of expected agents
  const relevantProfiles: AgentProfile[] = [];
  for (const [, profile] of agentProfiles) {
    if (state.currentRound?.expectedAgents.has(profile.agentId)) {
      relevantProfiles.push(profile);
    }
  }

  if (relevantProfiles.length > 0) {
    const avgResponseTime =
      relevantProfiles.reduce((sum, p) => sum + p.avgResponseTimeMs, 0) /
      relevantProfiles.length;
    // Blend: 60% calculated, 40% historical average
    timeout = timeout * 0.6 + avgResponseTime * 1.5 * 0.4;
  }

  // Factor 3: Round number — first round gets 1.5x, subsequent rounds 0.8x
  const roundNumber = state.roundHistory.length + 1;
  if (roundNumber === 1) {
    timeout *= 1.5;
  } else {
    timeout *= 0.8;
  }

  // Factor 4: Subscriber count — more agents = slightly more time
  if (subscriberCount > 3) {
    timeout *= 1 + (subscriberCount - 3) * 0.1; // +10% per agent beyond 3
  }

  return Math.round(timeout);
}
