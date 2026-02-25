import type { IConsensusProtocol, ConsensusInput, ConsensusOutput } from "./base.js";

/**
 * Iterative debate consensus.
 * Used for architecture/design questions that benefit from discussion.
 *
 * Agents see each other's responses and refine their positions over rounds.
 * A synthesis agent (or the orchestrator) produces the final consensus.
 *
 * Stub for v0.1 — full implementation in v0.2.
 */
export class DebateConsensus implements IConsensusProtocol {
  readonly protocol = "debate" as const;

  evaluate(_input: ConsensusInput): ConsensusOutput {
    // TODO v0.2: implement iterative debate synthesis
    // Algorithm:
    // 1. Collect all responses for this round
    // 2. Identify points of agreement and disagreement
    // 3. Score convergence across rounds
    // 4. If convergence threshold met → synthesize consensus
    // 5. If not → signal orchestrator to run another round
    throw new Error("DebateConsensus.evaluate: not implemented (v0.2)");
  }
}
