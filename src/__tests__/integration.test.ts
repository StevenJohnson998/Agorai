import { describe, it, expect } from "vitest";
import { DebateSession } from "../orchestrator.js";
import type { IAgentAdapter, AgentResponse, AgentInvokeOptions } from "../adapters/base.js";
import type { PersonaConfig } from "../config.js";
import { resolvePersonas } from "../personas.js";

/** Mock adapter for integration tests — returns a fixed response with configurable confidence. */
class MockAdapter implements IAgentAdapter {
  readonly name: string;
  constructor(name: string, private response: string, private conf = 0.8) {
    this.name = name;
  }
  async isAvailable() { return true; }
  async invoke(_options: AgentInvokeOptions): Promise<AgentResponse> {
    return {
      content: this.response,
      confidence: this.conf,
      durationMs: 50,
      tokens: { inputTokens: 100, outputTokens: 50 },
    };
  }
}

describe("DebateSession.run (integration)", () => {
  it("runs a simple debate with mock adapters", async () => {
    const session = new DebateSession();
    const agents = [
      new MockAdapter("agent-a", "Redis is better for caching.", 0.8),
      new MockAdapter("agent-b", "Memcached is simpler.", 0.6),
    ];

    const result = await session.run({
      projectId: "test",
      prompt: "Redis vs Memcached?",
      agents,
      mode: "quick",
      thoroughness: 0.3,
    });

    expect(result.rounds).toHaveLength(1);
    expect(result.consensus).toBeTruthy();
    expect(result.confidenceScore).toBeGreaterThan(0);
    expect(result.protocol).toBe("debate"); // default
    expect(result.cost.totalTokens.inputTokens).toBe(200); // 2 agents × 100
    expect(result.cost.totalTokens.outputTokens).toBe(100); // 2 agents × 50
  });

  it("selects vote protocol for comparison questions", async () => {
    const session = new DebateSession();
    const agents = [
      new MockAdapter("a", "Redis wins", 0.9),
      new MockAdapter("b", "Memcached wins", 0.7),
    ];

    const result = await session.run({
      projectId: "test",
      prompt: "Which is the best practice? Compare Redis vs Memcached.",
      agents,
      mode: "quick",
      thoroughness: 0.3,
    });

    expect(result.protocol).toBe("vote");
    expect(result.consensus).toBe("Redis wins"); // highest confidence
  });

  it("selects quorum protocol for security questions", async () => {
    const session = new DebateSession();
    const agents = [
      new MockAdapter("a", "Use JWT carefully", 0.8),
      new MockAdapter("b", "Sessions are safer", 0.85),
    ];

    const result = await session.run({
      projectId: "test",
      prompt: "What are the security vulnerabilities and attack vectors of JWT auth?",
      agents,
      mode: "quick",
      thoroughness: 0.3,
    });

    expect(result.protocol).toBe("quorum");
  });

  it("applies persona bonuses to consensus", async () => {
    const session = new DebateSession();
    const agents = [
      new MockAdapter("claude", "Design A", 0.7),
      new MockAdapter("ollama", "Design B", 0.65),
    ];

    const personas = new Map<string, PersonaConfig[]>();
    personas.set("ollama", resolvePersonas(["security"])); // 1.3x bonus

    const result = await session.run({
      projectId: "test",
      prompt: "Best architecture?",
      agents,
      agentPersonas: personas,
      mode: "quick",
      thoroughness: 0.3,
    });

    // ollama: 0.65 * 1.3 = 0.845 > claude: 0.7 * 1.0 = 0.7
    expect(result.consensus).toBe("Design B");
  });

  it("includes dissent in result", async () => {
    const session = new DebateSession();
    const agents = [
      new MockAdapter("a", "Answer A", 0.8),
      new MockAdapter("b", "Answer B", 0.75),
    ];

    const result = await session.run({
      projectId: "test",
      prompt: "Discuss this topic",
      agents,
      mode: "quick",
      thoroughness: 0.3,
    });

    // debate protocol: 0.75/0.8 = 0.9375 ≥ 0.3 → dissent
    expect(result.dissent).toBeDefined();
    expect(result.dissent).toContain("Answer B");
  });

  it("aborts when all agents fail", async () => {
    const failingAdapter: IAgentAdapter = {
      name: "failing",
      isAvailable: async () => true,
      invoke: async () => { throw new Error("connection refused"); },
    };

    const session = new DebateSession();
    const result = await session.run({
      projectId: "test",
      prompt: "Will this work?",
      agents: [failingAdapter],
      mode: "full",
      thoroughness: 0.5,
      maxRounds: 3,
    });

    // Should abort after first round (all agents failed)
    expect(result.rounds).toHaveLength(1);
    expect(result.cost.budgetActions.some((a) => a.includes("all") && a.includes("failed"))).toBe(true);
  });

  it("defaults to debate protocol for generic prompts", async () => {
    const session = new DebateSession();
    const agents = [new MockAdapter("a", "Answer", 0.8)];
    const result = await session.run({
      projectId: "test",
      prompt: "Tell me about Rust.",
      agents,
      mode: "quick",
      thoroughness: 0.3,
    });
    expect(result.protocol).toBe("debate");
  });

  it("needs 2+ keywords to trigger vote or quorum", async () => {
    const session = new DebateSession();
    const agents = [new MockAdapter("a", "Answer", 0.8)];

    // Only 1 security keyword → not enough for quorum
    const result = await session.run({
      projectId: "test",
      prompt: "What about security?",
      agents,
      mode: "quick",
      thoroughness: 0.3,
    });
    expect(result.protocol).toBe("debate");
  });

  it("quorum takes priority over vote when both match", async () => {
    const session = new DebateSession();
    const agents = [new MockAdapter("a", "Answer", 0.8)];

    // Both quorum (security, vulnerability, attack) and vote (which, compare) keywords
    const result = await session.run({
      projectId: "test",
      prompt: "Which security vulnerability should we compare for attack prevention?",
      agents,
      mode: "quick",
      thoroughness: 0.3,
    });
    expect(result.protocol).toBe("quorum");
  });

  it("runs multi-round debate", async () => {
    const session = new DebateSession();
    const agents = [
      new MockAdapter("a", "Position A", 0.8),
      new MockAdapter("b", "Position B", 0.7),
    ];

    const result = await session.run({
      projectId: "test",
      prompt: "Discuss architecture",
      agents,
      mode: "full",
      thoroughness: 0.5,
      maxRounds: 2,
    });

    expect(result.rounds).toHaveLength(2);
  });
});
