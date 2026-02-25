import { describe, it, expect } from "vitest";
import { DebateSession } from "../orchestrator.js";

describe("computeMaxRounds", () => {
  it("returns explicit value when provided", () => {
    expect(DebateSession.computeMaxRounds("full", 0.5, 7)).toBe(7);
  });

  it("returns 1 for quick mode", () => {
    expect(DebateSession.computeMaxRounds("quick", 0.9)).toBe(1);
  });

  it("returns 1 for low thoroughness", () => {
    expect(DebateSession.computeMaxRounds("full", 0.1)).toBe(1);
    expect(DebateSession.computeMaxRounds("full", 0.2)).toBe(1);
  });

  it("returns 2-3 for medium thoroughness", () => {
    expect(DebateSession.computeMaxRounds("full", 0.3)).toBe(2);
    expect(DebateSession.computeMaxRounds("full", 0.4)).toBe(2);
    expect(DebateSession.computeMaxRounds("full", 0.5)).toBe(3);
    expect(DebateSession.computeMaxRounds("full", 0.6)).toBe(3);
  });

  it("returns 4-5 for high thoroughness", () => {
    expect(DebateSession.computeMaxRounds("full", 0.7)).toBe(4);
    expect(DebateSession.computeMaxRounds("full", 0.8)).toBe(4);
    expect(DebateSession.computeMaxRounds("full", 0.9)).toBe(5);
    expect(DebateSession.computeMaxRounds("full", 1.0)).toBe(5);
  });
});

describe("estimate", () => {
  it("estimates tokens correctly", () => {
    const session = new DebateSession(undefined, {
      maxTokensPerDebate: 100000,
      maxTokensPerProject: 0,
      warnAtPercent: 80,
      estimatedTokensPerInvocation: 1500,
    });

    const mockAgents = [
      { name: "a", isAvailable: async () => true, invoke: async () => ({ content: "", confidence: 0, durationMs: 0 }) },
      { name: "b", isAvailable: async () => true, invoke: async () => ({ content: "", confidence: 0, durationMs: 0 }) },
    ];

    const result = session.estimate({
      agents: mockAgents,
      mode: "full",
      thoroughness: 0.5,
    });

    // 2 agents × 3 rounds × 1500 = 9000
    expect(result.estimatedTokens).toBe(9000);
    expect(result.budgetPercent).toBeCloseTo(9, 0);
    expect(result.overBudget).toBe(false);
  });

  it("flags over-budget estimates", () => {
    const session = new DebateSession(undefined, {
      maxTokensPerDebate: 5000,
      maxTokensPerProject: 0,
      warnAtPercent: 80,
      estimatedTokensPerInvocation: 1500,
    });

    const mockAgents = [
      { name: "a", isAvailable: async () => true, invoke: async () => ({ content: "", confidence: 0, durationMs: 0 }) },
      { name: "b", isAvailable: async () => true, invoke: async () => ({ content: "", confidence: 0, durationMs: 0 }) },
    ];

    const result = session.estimate({
      agents: mockAgents,
      mode: "full",
      thoroughness: 0.5,
    });

    // 9000 / 5000 = 180% > 80%
    expect(result.overBudget).toBe(true);
  });
});
