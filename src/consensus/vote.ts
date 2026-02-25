import type { IConsensusProtocol, ConsensusInput, ConsensusOutput } from "./base.js";

/**
 * Majority vote consensus.
 * Used for factual/technical questions where a clear answer exists.
 *
 * Each agent's vote is weighted by their confidence score.
 * The response with the highest weighted vote total wins.
 *
 * Stub for v0.1 — full implementation in v0.2.
 */
export class VoteConsensus implements IConsensusProtocol {
  readonly protocol = "vote" as const;

  evaluate(_input: ConsensusInput): ConsensusOutput {
    // TODO v0.2: implement weighted majority vote
    // Algorithm:
    // 1. Group responses by similarity (fuzzy match or embedding distance)
    // 2. Sum confidence scores per group
    // 3. Winner = group with highest total confidence
    // 4. Dissent = second-place group's representative response
    throw new Error("VoteConsensus.evaluate: not implemented (v0.2)");
  }
}
