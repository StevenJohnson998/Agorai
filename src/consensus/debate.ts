import type { IConsensusProtocol, ConsensusInput, ConsensusOutput } from "./base.js";

/**
 * Iterative debate consensus.
 * Used for architecture/design questions that benefit from discussion.
 *
 * Takes the last round's responses, weights them by confidence × persona bonus,
 * and picks the best response as consensus. Uses a lower dissent threshold (30%)
 * than VoteConsensus (50%) since debate encourages diverse perspectives.
 *
 * Note: v0.1 simplification — no convergence tracking or synthesis.
 * Full iterative convergence detection planned for v0.2.
 */
export class DebateConsensus implements IConsensusProtocol {
  readonly protocol = "debate" as const;

  evaluate(input: ConsensusInput): ConsensusOutput {
    const { responses, personaBonuses } = input;

    if (responses.length === 0) {
      return {
        consensus: "",
        confidenceScore: 0,
        protocol: this.protocol,
      };
    }

    // Score each response: weight = confidence × persona bonus
    const scored = responses.map((r) => {
      const bonus = personaBonuses?.get(r.agent) ?? 1.0;
      return { response: r, weight: r.confidence * bonus };
    });

    // Sort by weight descending
    scored.sort((a, b) => b.weight - a.weight);

    const best = scored[0];
    const bestWeight = best.weight;

    // Dissent: responses with ≥ 30% of best's weight (lower threshold for debate)
    const dissentResponses = scored
      .slice(1)
      .filter((s) => s.weight >= bestWeight * 0.3);

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
      consensus: best.response.content,
      dissent,
      confidenceScore,
      protocol: this.protocol,
    };
  }
}
