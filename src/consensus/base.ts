/**
 * Consensus protocol interfaces.
 *
 * The DebateSession picks a protocol based on the question type:
 * - Vote: factual/technical questions (majority wins)
 * - Debate: architecture/design questions (iterative + synthesis)
 * - Quorum: security/critical questions (confidence-weighted, persona bonus)
 */

import type { ParticipantResponse } from "../memory/base.js";

export type ConsensusProtocol = "vote" | "debate" | "quorum";

export interface ConsensusInput {
  /** All responses from participants for this round */
  responses: ParticipantResponse[];
  /** Persona bonus weights (agent name → multiplier, default 1.0) */
  personaBonuses?: Map<string, number>;
  /** Minimum confidence threshold to count a vote */
  confidenceThreshold?: number;
}

export interface ConsensusOutput {
  /** The consensus result text */
  consensus: string;
  /** Dissenting opinion, if any */
  dissent?: string;
  /** Overall confidence in the consensus (0-1) */
  confidenceScore: number;
  /** Which protocol produced this result */
  protocol: ConsensusProtocol;
}

export interface IConsensusProtocol {
  readonly protocol: ConsensusProtocol;

  /**
   * Evaluate responses and produce a consensus.
   * For "debate" protocol, this may be called multiple times (one per round).
   */
  evaluate(input: ConsensusInput): ConsensusOutput;
}
