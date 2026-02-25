import { describe, it, expect } from "vitest";
import { VoteConsensus } from "../consensus/vote.js";
import { DebateConsensus } from "../consensus/debate.js";
import type { ParticipantResponse } from "../memory/base.js";

function makeResponse(agent: string, content: string, confidence: number, persona?: string): ParticipantResponse {
  return { agent, persona, content, confidence, durationMs: 100 };
}

describe("VoteConsensus", () => {
  const vote = new VoteConsensus();

  it("picks highest-confidence response as consensus", () => {
    const result = vote.evaluate({
      responses: [
        makeResponse("claude", "Redis", 0.9, "architect"),
        makeResponse("ollama", "Memcached", 0.6, "critic"),
      ],
    });
    expect(result.consensus).toBe("Redis");
    expect(result.protocol).toBe("vote");
  });

  it("applies persona bonus to scoring", () => {
    const bonuses = new Map([["ollama", 1.5]]);
    const result = vote.evaluate({
      responses: [
        makeResponse("claude", "Redis", 0.7, "architect"),
        makeResponse("ollama", "Memcached", 0.6, "security"),
      ],
      personaBonuses: bonuses,
    });
    // claude: 0.7 * 1.0 = 0.7, ollama: 0.6 * 1.5 = 0.9
    expect(result.consensus).toBe("Memcached");
  });

  it("filters below confidence threshold", () => {
    const result = vote.evaluate({
      responses: [
        makeResponse("claude", "Redis", 0.3),
        makeResponse("ollama", "Memcached", 0.05),
      ],
      confidenceThreshold: 0.1,
    });
    // ollama filtered out (0.05 < 0.1)
    expect(result.consensus).toBe("Redis");
  });

  it("includes dissent when close in weight", () => {
    const result = vote.evaluate({
      responses: [
        makeResponse("claude", "Redis", 0.8),
        makeResponse("ollama", "Memcached", 0.7),
      ],
    });
    // 0.7 / 0.8 = 0.875 ≥ 0.5 → dissent
    expect(result.dissent).toBeDefined();
    expect(result.dissent).toContain("Memcached");
  });

  it("no dissent when gap is large", () => {
    const result = vote.evaluate({
      responses: [
        makeResponse("claude", "Redis", 0.9),
        makeResponse("ollama", "Memcached", 0.2),
      ],
    });
    // 0.2 / 0.9 = 0.22 < 0.5 → no dissent
    expect(result.dissent).toBeUndefined();
  });

  it("handles single response", () => {
    const result = vote.evaluate({
      responses: [makeResponse("claude", "Redis", 0.8)],
    });
    expect(result.consensus).toBe("Redis");
    expect(result.dissent).toBeUndefined();
  });
});

describe("DebateConsensus", () => {
  const debate = new DebateConsensus();

  it("picks highest-weighted response", () => {
    const result = debate.evaluate({
      responses: [
        makeResponse("claude", "Use microservices", 0.85),
        makeResponse("ollama", "Use monolith", 0.6),
      ],
    });
    expect(result.consensus).toBe("Use microservices");
    expect(result.protocol).toBe("debate");
  });

  it("uses lower dissent threshold (30%)", () => {
    const result = debate.evaluate({
      responses: [
        makeResponse("claude", "Microservices", 0.8),
        makeResponse("ollama", "Monolith", 0.3),
      ],
    });
    // 0.3 / 0.8 = 0.375 ≥ 0.3 → dissent included
    expect(result.dissent).toBeDefined();
    expect(result.dissent).toContain("Monolith");
  });

  it("handles empty responses", () => {
    const result = debate.evaluate({ responses: [] });
    expect(result.consensus).toBe("");
    expect(result.confidenceScore).toBe(0);
  });
});
