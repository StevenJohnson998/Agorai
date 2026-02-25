import type { IConsensusProtocol, ConsensusInput, ConsensusOutput } from "./base.js";

/**
 * Weighted best-pick consensus.
 * Used for factual/technical questions and quorum (security) topics.
 *
 * Each response is scored: weight = confidence × personaBonus.
 * The highest-weighted response wins.
 * Dissent = any response with ≥ 50% of the winner's weight.
 *
 * Note: v0.1 simplification — no similarity grouping. Each response is
 * treated independently. Similarity-based grouping planned for v0.2.
 */
export class VoteConsensus implements IConsensusProtocol {
  readonly protocol = "vote" as const;

  evaluate(input: ConsensusInput): ConsensusOutput {
    const { responses, personaBonuses, confidenceThreshold = 0.1 } = input;

    // Filter out responses below confidence threshold
    const eligible = responses.filter((r) => r.confidence >= confidenceThreshold);
    if (eligible.length === 0) {
      return {
        consensus: responses[0]?.content ?? "",
        confidenceScore: 0,
        protocol: this.protocol,
      };
    }

    // Score each response: weight = confidence × persona bonus
    const scored = eligible.map((r) => {
      const bonus = personaBonuses?.get(r.agent) ?? 1.0;
      return { response: r, weight: r.confidence * bonus };
    });

    // Sort by weight descending
    scored.sort((a, b) => b.weight - a.weight);

    const winner = scored[0];
    const winnerWeight = winner.weight;

    // Dissent: responses with ≥ 50% of winner's weight (excluding winner)
    const dissentResponses = scored
      .slice(1)
      .filter((s) => s.weight >= winnerWeight * 0.5);

    const dissent = dissentResponses.length > 0
      ? dissentResponses.map((s) => {
          const label = s.response.persona
            ? `${s.response.agent} (${s.response.persona})`
            : s.response.agent;
          return `[${label}, weight: ${s.weight.toFixed(2)}]: ${s.response.content}`;
        }).join("\n\n---\n\n")
      : undefined;

    // Overall confidence = weighted average
    const totalWeight = scored.reduce((sum, s) => sum + s.weight, 0);
    const confidenceScore = totalWeight > 0
      ? scored.reduce((sum, s) => sum + s.weight * s.response.confidence, 0) / totalWeight
      : 0;

    return {
      consensus: winner.response.content,
      dissent,
      confidenceScore,
      protocol: this.protocol,
    };
  }
}
