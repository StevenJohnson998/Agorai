/**
 * Keryx — Discussion manager tests.
 *
 * Grouped by phase:
 *  1. Types & Config
 *  2. Core State Machine
 *  3. Adaptive Timing
 *  4. Pattern Detection
 *  5. Human Commands
 *  6. Integration (CLI wiring tested via build)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SqliteStore } from "../store/sqlite.js";
import { StoreEventBus } from "../store/events.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { KeryxModule } from "../keryx/module.js";
import type { KeryxConfig } from "../keryx/types.js";
import { estimateComplexity, calculateAdaptiveTimeout } from "../keryx/timing.js";
import { parseCommand, parseDuration } from "../keryx/commands.js";
import { detectLoop, detectDrift, detectDomination, isConsensusResponse } from "../keryx/patterns.js";
import type { WindowMessage, ConversationState } from "../keryx/types.js";

// --- Test helpers ---

let store: SqliteStore;
let eventBus: StoreEventBus;
let tmpDir: string;

const defaultKeryxConfig: KeryxConfig = {
  enabled: true,
  baseTimeoutMs: 5_000, // Short for tests
  nudgeAfterMs: 7_000,
  maxRoundsPerTopic: 3,
  synthesisCapability: "synthesis",
  healthWindowSize: 10,
};

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-keryx-test-"));
  eventBus = new StoreEventBus();
  store = new SqliteStore(join(tmpDir, "test.db"), eventBus);
  await store.initialize();
});

afterEach(async () => {
  await store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function createAgent(name: string, type = "test", capabilities: string[] = []) {
  return store.registerAgent({
    name,
    type,
    capabilities,
    clearanceLevel: "team",
    apiKeyHash: `hash_${name}`,
  });
}

async function setupConversation(agentIds: string[]) {
  const creator = agentIds[0];
  const project = await store.createProject({ name: "TestProject", createdBy: creator });
  const conv = await store.createConversation({
    projectId: project.id,
    title: "TestConversation",
    createdBy: creator,
  });
  for (const id of agentIds) {
    await store.subscribe(conv.id, id);
  }
  return { project, conv };
}

// --- Phase 1: Types & Config ---

describe("Phase 1 — Types & Config", () => {
  it("parses keryx config with defaults from ConfigSchema", async () => {
    const { ConfigSchema } = await import("../config.js");
    const config = ConfigSchema.parse({});
    expect(config.keryx).toBeDefined();
    expect(config.keryx.enabled).toBe(true);
    expect(config.keryx.baseTimeoutMs).toBe(45_000);
    expect(config.keryx.nudgeAfterMs).toBe(60_000);
    expect(config.keryx.maxRoundsPerTopic).toBe(3);
    expect(config.keryx.synthesisCapability).toBe("synthesis");
    expect(config.keryx.healthWindowSize).toBe(10);
  });

  it("allows overriding keryx config values", async () => {
    const { ConfigSchema } = await import("../config.js");
    const config = ConfigSchema.parse({
      keryx: { baseTimeoutMs: 60_000, maxRoundsPerTopic: 10 },
    });
    expect(config.keryx.baseTimeoutMs).toBe(60_000);
    expect(config.keryx.maxRoundsPerTopic).toBe(10);
    // Defaults still apply for unset fields
    expect(config.keryx.enabled).toBe(true);
  });

  it("allows disabling keryx", async () => {
    const { ConfigSchema } = await import("../config.js");
    const config = ConfigSchema.parse({ keryx: { enabled: false } });
    expect(config.keryx.enabled).toBe(false);
  });
});

// --- Phase 2: Core State Machine ---

/** Helper: set a conversation's mode after Keryx discovers it. */
function setMode(keryx: KeryxModule, convId: string, mode: "socratic" | "ecclesia" | "wild-agora") {
  const state = keryx.getState(convId);
  if (state) state.mode = mode;
}

describe("Phase 2 — Core State Machine", () => {
  let keryx: KeryxModule;
  let ac: AbortController;

  beforeEach(() => {
    ac = new AbortController();
  });

  afterEach(async () => {
    ac.abort();
    // Small delay for cleanup
    await new Promise(r => setTimeout(r, 50));
  });

  it("registers as an agent on start", async () => {
    keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
    await keryx.start();

    const keryxId = keryx.getKeryxAgentId();
    expect(keryxId).toBeDefined();

    const agent = await store.getAgent(keryxId!);
    expect(agent).not.toBeNull();
    expect(agent!.name).toBe("keryx");
    expect(agent!.type).toBe("orchestrator");
    expect(agent!.capabilities).toContain("discussion-management");

    await keryx.stop();
  });

  it("opens a round when a human sends a message", async () => {
    const human = await createAgent("human", "human");
    const agent1 = await createAgent("agent1");
    const { conv } = await setupConversation([human.id, agent1.id]);

    keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
    await keryx.start();

    // Keryx should auto-discover and subscribe
    await new Promise(r => setTimeout(r, 100));

    // Subscribe keryx to the conversation
    await store.subscribe(conv.id, keryx.getKeryxAgentId()!);

    // Force state initialization
    const keryxId = keryx.getKeryxAgentId()!;
    // Trigger discovery manually
    await (keryx as any).discoverConversations();
    setMode(keryx, conv.id, "ecclesia");

    // Human sends a message
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: human.id,
      content: "What do you think about TypeScript?",
    });

    // Wait for async processing
    await new Promise(r => setTimeout(r, 200));

    const state = keryx.getState(conv.id);
    expect(state).toBeDefined();
    expect(state!.currentRound).not.toBeNull();
    expect(state!.currentRound!.status).toBe("collecting");
    expect(state!.currentRound!.id).toBe(1);

    await keryx.stop();
  });

  it("records responses and tracks agents", async () => {
    const human = await createAgent("human", "human");
    const agent1 = await createAgent("agent1");
    const agent2 = await createAgent("agent2");
    const { conv } = await setupConversation([human.id, agent1.id, agent2.id]);

    keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
    await keryx.start();

    await store.subscribe(conv.id, keryx.getKeryxAgentId()!);
    await (keryx as any).discoverConversations();
    setMode(keryx, conv.id, "ecclesia");

    // Human triggers a round
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: human.id,
      content: "Discuss error handling patterns",
    });
    await new Promise(r => setTimeout(r, 200));

    // Agent1 responds
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent1.id,
      content: "I recommend using Result types for recoverable errors.",
    });
    await new Promise(r => setTimeout(r, 100));

    const state = keryx.getState(conv.id);
    expect(state!.currentRound!.respondedAgents.has(agent1.id)).toBe(true);
    expect(state!.currentRound!.respondedAgents.has(agent2.id)).toBe(false);

    await keryx.stop();
  });

  it("closes a round when all agents respond", async () => {
    const human = await createAgent("human", "human");
    const agent1 = await createAgent("agent1");
    const { conv } = await setupConversation([human.id, agent1.id]);

    keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
    await keryx.start();

    await store.subscribe(conv.id, keryx.getKeryxAgentId()!);
    await (keryx as any).discoverConversations();
    setMode(keryx, conv.id, "ecclesia");

    // Human triggers
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: human.id,
      content: "Simple question",
    });
    await new Promise(r => setTimeout(r, 200));

    // Agent responds
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent1.id,
      content: "Here is my answer.",
    });
    await new Promise(r => setTimeout(r, 300));

    const state = keryx.getState(conv.id);
    // With auto-progression, substantive response → Round 1 closed, Round 2 auto-opened
    expect(state!.roundHistory.length).toBe(1);
    expect(state!.roundHistory[0].id).toBe(1);
    expect(state!.roundHistory[0].status).toBe("closed");
    // Round 2 should now be active
    const round = state!.currentRound;
    expect(round).not.toBeNull();
    expect(round!.id).toBe(2);
    expect(round!.status).toBe("collecting");

    await keryx.stop();
  });

  it("ignores its own messages", async () => {
    const human = await createAgent("human", "human");
    const { conv } = await setupConversation([human.id]);

    keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
    await keryx.start();

    const keryxId = keryx.getKeryxAgentId()!;
    await store.subscribe(conv.id, keryxId);
    await (keryx as any).discoverConversations();

    // Keryx sends its own message — should not trigger a round
    await keryx.sendKeryxMessage(conv.id, "Test message from Keryx");
    await new Promise(r => setTimeout(r, 100));

    const state = keryx.getState(conv.id);
    expect(state!.currentRound).toBeNull();

    await keryx.stop();
  });

  it("ignores status messages", async () => {
    const human = await createAgent("human", "human");
    const { conv } = await setupConversation([human.id]);

    keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
    await keryx.start();

    await store.subscribe(conv.id, keryx.getKeryxAgentId()!);
    await (keryx as any).discoverConversations();

    // Status message — should not trigger a round
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: human.id,
      type: "status",
      content: "User joined",
    });
    await new Promise(r => setTimeout(r, 100));

    const state = keryx.getState(conv.id);
    expect(state!.currentRound).toBeNull();

    await keryx.stop();
  });

  it("removes errored agent from round and completes early", async () => {
    const human = await createAgent("human", "human");
    const agent1 = await createAgent("agent1");
    const agent2 = await createAgent("agent2");
    const { conv } = await setupConversation([human.id, agent1.id, agent2.id]);

    keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
    await keryx.start();

    await store.subscribe(conv.id, keryx.getKeryxAgentId()!);
    await (keryx as any).discoverConversations();
    setMode(keryx, conv.id, "ecclesia");

    // Human triggers a round — both agent1 and agent2 expected
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: human.id,
      content: "Test question for error reporting",
    });
    await new Promise(r => setTimeout(r, 200));

    let state = keryx.getState(conv.id);
    expect(state!.currentRound).not.toBeNull();
    expect(state!.currentRound!.expectedAgents.has(agent1.id)).toBe(true);
    expect(state!.currentRound!.expectedAgents.has(agent2.id)).toBe(true);

    // Agent1 reports an error via agent-error status message
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent1.id,
      type: "status",
      content: "[agent-error] Failed to generate response: API rate limit exceeded",
      tags: ["agent-error"],
    });
    await new Promise(r => setTimeout(r, 200));

    // Agent1 should be removed from expected
    state = keryx.getState(conv.id);
    expect(state!.currentRound!.expectedAgents.has(agent1.id)).toBe(false);

    // Agent2 responds normally — round should complete
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent2.id,
      content: "Here is my answer.",
    });
    await new Promise(r => setTimeout(r, 300));

    state = keryx.getState(conv.id);
    // Round 1 should be closed (moved to history)
    expect(state!.roundHistory.length).toBeGreaterThanOrEqual(1);
    expect(state!.roundHistory[0].status).toBe("closed");

    await keryx.stop();
  });

  it("completes round immediately when all agents error out", async () => {
    const human = await createAgent("human", "human");
    const agent1 = await createAgent("agent1");
    const { conv } = await setupConversation([human.id, agent1.id]);

    keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
    await keryx.start();

    await store.subscribe(conv.id, keryx.getKeryxAgentId()!);
    await (keryx as any).discoverConversations();
    setMode(keryx, conv.id, "ecclesia");

    // Human triggers a round
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: human.id,
      content: "Test question",
    });
    await new Promise(r => setTimeout(r, 200));

    let state = keryx.getState(conv.id);
    expect(state!.currentRound).not.toBeNull();

    // Agent1 errors out — the only expected agent
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent1.id,
      type: "status",
      content: "[agent-error] Failed to generate response: 500 Internal Server Error",
      tags: ["agent-error"],
    });
    await new Promise(r => setTimeout(r, 300));

    state = keryx.getState(conv.id);
    // Round 1 should be closed and moved to history
    expect(state!.roundHistory.length).toBeGreaterThanOrEqual(1);
    expect(state!.roundHistory[0].status).toBe("closed");
    // Auto-progression opens Round 2 (same agents re-enrolled from subscribers)
    expect(state!.currentRound).not.toBeNull();
    expect(state!.currentRound!.id).toBe(2);

    await keryx.stop();
  });

  it("ignores agent-error from agents not in the round", async () => {
    const human = await createAgent("human", "human");
    const agent1 = await createAgent("agent1");
    const agent2 = await createAgent("agent2");
    const { conv } = await setupConversation([human.id, agent1.id]);
    // agent2 is NOT subscribed to this conversation

    keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
    await keryx.start();

    await store.subscribe(conv.id, keryx.getKeryxAgentId()!);
    await (keryx as any).discoverConversations();
    setMode(keryx, conv.id, "ecclesia");

    // Human triggers a round
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: human.id,
      content: "Test question",
    });
    await new Promise(r => setTimeout(r, 200));

    let state = keryx.getState(conv.id);
    const expectedBefore = state!.currentRound!.expectedAgents.size;

    // agent2 sends error — should be ignored (not in round)
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent2.id,
      type: "status",
      content: "[agent-error] Failed",
      tags: ["agent-error"],
    });
    await new Promise(r => setTimeout(r, 200));

    state = keryx.getState(conv.id);
    // Expected agents count unchanged
    expect(state!.currentRound!.expectedAgents.size).toBe(expectedBefore);

    await keryx.stop();
  });
});

// --- Phase 3: Adaptive Timing ---

describe("Phase 3 — Adaptive Timing", () => {
  it("estimates low complexity for short simple text", () => {
    const score = estimateComplexity("Hello world");
    expect(score).toBeLessThan(0.2);
  });

  it("estimates high complexity for long technical text", () => {
    const code = "```typescript\n" + "const x = 1;\n".repeat(50) + "```\n";
    const text = "Here is a complex question with multiple parts? " +
      "What about error handling? And performance? " +
      "Check https://example.com/docs for reference. " +
      code;
    const score = estimateComplexity(text);
    expect(score).toBeGreaterThan(0.3);
  });

  it("produces short timeout for simple prompts", () => {
    const state: ConversationState = {
      conversationId: "test",
      projectId: "proj",
      currentRound: null,
      roundHistory: [],
      lastSeenAt: Date.now(),
      paused: false,
      disabled: false,
      messageWindow: [],
    };

    const timeout = calculateAdaptiveTimeout(
      state,
      "Hi",
      2,
      30_000,
      new Map(),
    );

    // First round (1.5x), simple text (low complexity ~0.5x), so should be < base
    // 30000 * ~0.5 complexity multiplier * 1.5 (round 1) ≈ 22500
    expect(timeout).toBeLessThan(40_000);
  });

  it("produces longer timeout for complex prompts", () => {
    const state: ConversationState = {
      conversationId: "test",
      projectId: "proj",
      currentRound: null,
      roundHistory: [],
      lastSeenAt: Date.now(),
      paused: false,
      disabled: false,
      messageWindow: [],
    };

    const complexTopic = "```\nfunction complex() { return 42; }\n```\n" +
      "What about security? Performance? Scalability? Maintainability? " +
      "Check https://docs.example.com/api/v2/reference for 12345 details.";

    const timeout = calculateAdaptiveTimeout(
      state,
      complexTopic,
      5,
      30_000,
      new Map(),
    );

    // Complex + many subscribers + round 1 → should be longer than base
    expect(timeout).toBeGreaterThan(30_000);
  });

  it("uses agent history for timeout calculation", () => {
    const state: ConversationState = {
      conversationId: "test",
      projectId: "proj",
      currentRound: {
        id: 1,
        topic: "test",
        status: "collecting",
        openedAt: Date.now(),
        triggerMessageId: "msg1",
        expectedAgents: new Set(["agent1"]),
        respondedAgents: new Set(),
        responseContents: new Map(),
        responseMessageIds: [],
        escalationLevel: 0,
      },
      roundHistory: [{ id: 0, topic: "", status: "closed", openedAt: 0, closedAt: 0, triggerMessageId: "", expectedAgents: new Set(), respondedAgents: new Set(), responseContents: new Map(), responseMessageIds: [], escalationLevel: 0 }],
      lastSeenAt: Date.now(),
      paused: false,
      disabled: false,
      messageWindow: [],
    };

    const profiles = new Map([
      ["agent1", { agentId: "agent1", avgResponseTimeMs: 60_000, responseCount: 5 }],
    ]);

    const timeout = calculateAdaptiveTimeout(
      state,
      "Short question",
      2,
      30_000,
      profiles,
    );

    // Should be influenced by agent's slow average response time
    expect(timeout).toBeGreaterThan(10_000);
  });
});

// --- Phase 4: Pattern Detection ---

describe("Phase 4 — Pattern Detection", () => {
  describe("detectLoop", () => {
    it("detects repeated messages from same agent", () => {
      const messages: WindowMessage[] = [
        { id: "1", fromAgent: "a1", content: "I think we should use TypeScript for the project", timestamp: 1 },
        { id: "2", fromAgent: "a1", content: "I think we should use TypeScript for the project", timestamp: 2 },
      ];
      const result = detectLoop(messages);
      expect(result).not.toBeNull();
      expect(result!.agentId).toBe("a1");
      expect(result!.similarity).toBeGreaterThan(0.7);
    });

    it("does not flag different agents", () => {
      const messages: WindowMessage[] = [
        { id: "1", fromAgent: "a1", content: "I think we should use TypeScript", timestamp: 1 },
        { id: "2", fromAgent: "a2", content: "I think we should use TypeScript", timestamp: 2 },
      ];
      const result = detectLoop(messages);
      expect(result).toBeNull();
    });

    it("does not flag [NO_RESPONSE] as loop", () => {
      const messages: WindowMessage[] = [
        { id: "1", fromAgent: "a1", content: "[NO_RESPONSE]", timestamp: 1 },
        { id: "2", fromAgent: "a1", content: "[NO_RESPONSE]", timestamp: 2 },
      ];
      const result = detectLoop(messages);
      expect(result).toBeNull();
    });

    it("returns null for empty window", () => {
      expect(detectLoop([])).toBeNull();
    });

    it("returns null for single message", () => {
      const messages: WindowMessage[] = [
        { id: "1", fromAgent: "a1", content: "Hello", timestamp: 1 },
      ];
      expect(detectLoop(messages)).toBeNull();
    });

    it("detects near-identical messages (high similarity)", () => {
      const messages: WindowMessage[] = [
        { id: "1", fromAgent: "a1", content: "I strongly recommend using TypeScript for the entire project", timestamp: 1 },
        { id: "2", fromAgent: "a1", content: "I strongly recommend using TypeScript for this entire project", timestamp: 2 },
      ];
      const result = detectLoop(messages);
      expect(result).not.toBeNull();
      expect(result!.similarity).toBeGreaterThan(0.7);
    });
  });

  describe("detectDrift", () => {
    it("detects drift when discussion diverges from topic", () => {
      const topic = "Database migration strategy for PostgreSQL";
      const messages: WindowMessage[] = [
        { id: "1", fromAgent: "a1", content: "I think we should redecorate the office and get new furniture", timestamp: 1 },
        { id: "2", fromAgent: "a2", content: "Yes the chairs are really uncomfortable and the carpet needs replacing", timestamp: 2 },
        { id: "3", fromAgent: "a1", content: "Maybe we should also look at the lighting in the conference room", timestamp: 3 },
      ];
      const result = detectDrift(topic, messages);
      expect(result).not.toBeNull();
      expect(result!.similarity).toBeLessThan(0.3);
    });

    it("does not flag on-topic discussion", () => {
      const topic = "Database migration strategy for PostgreSQL";
      const messages: WindowMessage[] = [
        { id: "1", fromAgent: "a1", content: "We should use sequential migrations for the PostgreSQL database schema", timestamp: 1 },
        { id: "2", fromAgent: "a2", content: "Agreed, the migration strategy should include rollback support for database changes", timestamp: 2 },
      ];
      const result = detectDrift(topic, messages);
      expect(result).toBeNull();
    });

    it("returns null for empty messages", () => {
      expect(detectDrift("topic", [])).toBeNull();
    });
  });

  describe("detectDomination", () => {
    it("detects dominant agent when > 40% with 3+ agents", () => {
      const messages: WindowMessage[] = [
        { id: "1", fromAgent: "a1", content: "Point 1", timestamp: 1 },
        { id: "2", fromAgent: "a1", content: "Point 2", timestamp: 2 },
        { id: "3", fromAgent: "a1", content: "Point 3", timestamp: 3 },
        { id: "4", fromAgent: "a2", content: "Response", timestamp: 4 },
        { id: "5", fromAgent: "a3", content: "Response", timestamp: 5 },
      ];
      const result = detectDomination(messages, 3);
      expect(result).not.toBeNull();
      expect(result!.agentId).toBe("a1");
      expect(result!.messagePercent).toBe(60);
    });

    it("does not flag with fewer than 3 subscribers", () => {
      const messages: WindowMessage[] = [
        { id: "1", fromAgent: "a1", content: "Point 1", timestamp: 1 },
        { id: "2", fromAgent: "a1", content: "Point 2", timestamp: 2 },
        { id: "3", fromAgent: "a2", content: "Response", timestamp: 3 },
      ];
      const result = detectDomination(messages, 2);
      expect(result).toBeNull();
    });

    it("does not count [NO_RESPONSE] messages", () => {
      const messages: WindowMessage[] = [
        { id: "1", fromAgent: "a1", content: "[NO_RESPONSE]", timestamp: 1 },
        { id: "2", fromAgent: "a1", content: "[NO_RESPONSE]", timestamp: 2 },
        { id: "3", fromAgent: "a1", content: "[NO_RESPONSE]", timestamp: 3 },
        { id: "4", fromAgent: "a2", content: "Real response one", timestamp: 4 },
        { id: "5", fromAgent: "a3", content: "Real response two", timestamp: 5 },
        { id: "6", fromAgent: "a2", content: "Another real response", timestamp: 6 },
        { id: "7", fromAgent: "a3", content: "Another real response too", timestamp: 7 },
        { id: "8", fromAgent: "a2", content: "Third from a2", timestamp: 8 },
      ];
      const result = detectDomination(messages, 3);
      // Real messages: a1=0, a2=3 (60%), a3=2 (40%). a2 dominates.
      // But the point is [NO_RESPONSE] from a1 is NOT counted.
      // This test verifies a1's NO_RESPONSE don't inflate their count.
      // a2 at 60% IS flagged — but the test verifies a1 is NOT the dominant one.
      expect(result).not.toBeNull();
      expect(result!.agentId).toBe("a2");
      // a1's [NO_RESPONSE] messages were excluded
    });

    it("returns null with insufficient data", () => {
      const messages: WindowMessage[] = [
        { id: "1", fromAgent: "a1", content: "Hi", timestamp: 1 },
      ];
      expect(detectDomination(messages, 3)).toBeNull();
    });
  });
});

// --- Phase 5: Human Commands ---

describe("Phase 5 — Command Parser", () => {
  describe("parseCommand", () => {
    it("parses all valid commands", () => {
      const commands = ["pause", "resume", "skip", "extend", "status", "interrupt", "enable", "disable"];
      for (const cmd of commands) {
        const result = parseCommand(`@keryx ${cmd}`);
        expect(result).not.toBeNull();
        expect(result!.command).toBe(cmd);
      }
    });

    it("parses command with args", () => {
      const result = parseCommand("@keryx extend 2m");
      expect(result).not.toBeNull();
      expect(result!.command).toBe("extend");
      expect(result!.args).toBe("2m");
    });

    it("is case-insensitive", () => {
      const result = parseCommand("@Keryx PAUSE");
      expect(result).not.toBeNull();
      expect(result!.command).toBe("pause");
    });

    it("returns null for non-commands", () => {
      expect(parseCommand("Hello world")).toBeNull();
      expect(parseCommand("@keryx")).toBeNull();
      expect(parseCommand("@keryx invalidcmd")).toBeNull();
    });

    it("parses command embedded in longer text", () => {
      const result = parseCommand("Hey everyone, @keryx pause please");
      expect(result).not.toBeNull();
      expect(result!.command).toBe("pause");
    });
  });

  describe("parseDuration", () => {
    it("parses seconds", () => {
      expect(parseDuration("30s")).toBe(30_000);
      expect(parseDuration("30sec")).toBe(30_000);
      expect(parseDuration("30")).toBe(30_000);
    });

    it("parses minutes", () => {
      expect(parseDuration("2m")).toBe(120_000);
      expect(parseDuration("2min")).toBe(120_000);
    });

    it("parses hours", () => {
      expect(parseDuration("1h")).toBe(3_600_000);
      expect(parseDuration("1hr")).toBe(3_600_000);
    });

    it("handles decimals", () => {
      expect(parseDuration("1.5m")).toBe(90_000);
    });

    it("returns null for invalid input", () => {
      expect(parseDuration("abc")).toBeNull();
      expect(parseDuration("0s")).toBeNull();
      expect(parseDuration("-5s")).toBeNull();
      expect(parseDuration("")).toBeNull();
    });
  });

  describe("Command handling integration", () => {
    let keryx: KeryxModule;
    let ac: AbortController;

    beforeEach(() => {
      ac = new AbortController();
    });

    afterEach(async () => {
      ac.abort();
      await new Promise(r => setTimeout(r, 50));
    });

    it("pauses and resumes via commands", async () => {
      const human = await createAgent("human", "human");
      const { conv } = await setupConversation([human.id]);

      keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
      await keryx.start();

      await store.subscribe(conv.id, keryx.getKeryxAgentId()!);
      await (keryx as any).discoverConversations();

      const state = keryx.getState(conv.id)!;
      expect(state.paused).toBe(false);

      // Pause
      await store.sendMessage({
        conversationId: conv.id,
        fromAgent: human.id,
        content: "@keryx pause",
      });
      await new Promise(r => setTimeout(r, 200));

      expect(keryx.getState(conv.id)!.paused).toBe(true);

      // Resume
      await store.sendMessage({
        conversationId: conv.id,
        fromAgent: human.id,
        content: "@keryx resume",
      });
      await new Promise(r => setTimeout(r, 200));

      expect(keryx.getState(conv.id)!.paused).toBe(false);

      await keryx.stop();
    });

    it("rejects commands from internal agents", async () => {
      const internalAgent = await createAgent("internal-bot", "internal");
      // Give it an internal: prefix ID pattern
      const { conv } = await setupConversation([internalAgent.id]);

      keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
      await keryx.start();

      await store.subscribe(conv.id, keryx.getKeryxAgentId()!);
      await (keryx as any).discoverConversations();

      // Internal agent tries to pause — the agent ID starts with "internal:" in real code
      // but in our test the agent has a regular ID. The module checks fromAgent.startsWith("internal:")
      // so this test verifies the handler path when agent is not internal
      const state = keryx.getState(conv.id)!;

      // Send a pause from a message with an "internal:" prefixed fromAgent
      const msg = await store.sendMessage({
        conversationId: conv.id,
        fromAgent: internalAgent.id,
        content: "@keryx pause",
      });

      // Manually invoke with the right agent ID pattern
      await keryx.handleCommand(
        { ...msg, fromAgent: "internal:test-agent" },
        state,
      );

      // Should still be unpaused since internal agents are rejected
      expect(state.paused).toBe(false);

      await keryx.stop();
    });
  });
});

// --- Phase 6: Consensus Detection ---

describe("Phase 6 — Consensus Detection", () => {
  describe("isConsensusResponse", () => {
    it("detects [NO_RESPONSE]", () => {
      expect(isConsensusResponse("[NO_RESPONSE]")).toBe(true);
      expect(isConsensusResponse("  [NO_RESPONSE]  ")).toBe(true);
    });

    it("detects agreement phrases", () => {
      expect(isConsensusResponse("I have nothing to add.")).toBe(true);
      expect(isConsensusResponse("No further points from me.")).toBe(true);
      expect(isConsensusResponse("I fully agree with the above.")).toBe(true);
      expect(isConsensusResponse("I agree with everything said so far.")).toBe(true);
      expect(isConsensusResponse("Consensus reached on all points.")).toBe(true);
      expect(isConsensusResponse("All points covered by previous speakers.")).toBe(true);
      expect(isConsensusResponse("No new insights to offer.")).toBe(true);
      expect(isConsensusResponse("Nothing new to add here.")).toBe(true);
      expect(isConsensusResponse("I have nothing to add to this discussion.")).toBe(true);
      expect(isConsensusResponse("No additional input from me.")).toBe(true);
    });

    it("is case-insensitive for phrases", () => {
      expect(isConsensusResponse("NOTHING TO ADD")).toBe(true);
      expect(isConsensusResponse("Fully Agree")).toBe(true);
    });

    it("rejects substantive responses", () => {
      expect(isConsensusResponse("I think we should use a different approach.")).toBe(false);
      expect(isConsensusResponse("Here are my thoughts on the topic.")).toBe(false);
      expect(isConsensusResponse("I disagree with point 3.")).toBe(false);
    });
  });
});

// --- Phase 7: Auto-Round Progression ---

describe("Phase 7 — Auto-Round Progression", () => {
  let keryx: KeryxModule;
  let ac: AbortController;

  beforeEach(() => {
    ac = new AbortController();
  });

  afterEach(async () => {
    ac.abort();
    await new Promise(r => setTimeout(r, 50));
  });

  it("auto-opens Round 2 after Round 1 closes with substantive responses", async () => {
    const human = await createAgent("human", "human");
    const agent1 = await createAgent("agent1");
    const agent2 = await createAgent("agent2");
    const { conv } = await setupConversation([human.id, agent1.id, agent2.id]);

    keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
    await keryx.start();

    await store.subscribe(conv.id, keryx.getKeryxAgentId()!);
    await (keryx as any).discoverConversations();
    setMode(keryx, conv.id, "ecclesia");

    // Human triggers Round 1
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: human.id,
      content: "What do you think about microservices?",
    });
    await new Promise(r => setTimeout(r, 200));

    // Both agents respond substantively
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent1.id,
      content: "Microservices provide better scalability but add complexity.",
    });
    await new Promise(r => setTimeout(r, 100));

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent2.id,
      content: "I prefer a modular monolith for smaller teams.",
    });
    await new Promise(r => setTimeout(r, 400));

    const state = keryx.getState(conv.id)!;
    // Round 1 should be in history, Round 2 should be current
    expect(state.roundHistory.length).toBe(1);
    expect(state.roundHistory[0].id).toBe(1);
    expect(state.currentRound).not.toBeNull();
    expect(state.currentRound!.id).toBe(2);
    expect(state.currentRound!.status).toBe("collecting");

    await keryx.stop();
  });

  it("goes to final synthesis when all agents respond with [NO_RESPONSE]", async () => {
    const human = await createAgent("human", "human");
    const agent1 = await createAgent("agent1");
    const { conv } = await setupConversation([human.id, agent1.id]);

    keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
    await keryx.start();

    await store.subscribe(conv.id, keryx.getKeryxAgentId()!);
    await (keryx as any).discoverConversations();
    setMode(keryx, conv.id, "ecclesia");

    // Human triggers Round 1
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: human.id,
      content: "Simple question.",
    });
    await new Promise(r => setTimeout(r, 200));

    // Agent responds with [NO_RESPONSE]
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent1.id,
      content: "[NO_RESPONSE]",
    });
    await new Promise(r => setTimeout(r, 300));

    const state = keryx.getState(conv.id)!;
    // Should go directly to synthesizing (no Round 2)
    const round = state.currentRound;
    if (round) {
      expect(round.status).toBe("synthesizing");
    }
    // No auto-opened Round 2
    expect(state.roundHistory.length).toBe(0); // round stays as currentRound during synthesis

    await keryx.stop();
  });

  it("forces synthesis at max rounds", async () => {
    const human = await createAgent("human", "human");
    const agent1 = await createAgent("agent1");
    const { conv } = await setupConversation([human.id, agent1.id]);

    // maxRoundsPerTopic = 2 for this test
    const config = { ...defaultKeryxConfig, maxRoundsPerTopic: 2 };
    keryx = new KeryxModule(store, config, ac.signal);
    await keryx.start();

    await store.subscribe(conv.id, keryx.getKeryxAgentId()!);
    await (keryx as any).discoverConversations();
    setMode(keryx, conv.id, "ecclesia");

    // Human triggers Round 1
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: human.id,
      content: "Debate topic",
    });
    await new Promise(r => setTimeout(r, 200));

    // Agent responds substantively → Round 1 closes, Round 2 auto-opens
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent1.id,
      content: "Here is my detailed analysis.",
    });
    await new Promise(r => setTimeout(r, 400));

    // Round 2 should be open
    let state = keryx.getState(conv.id)!;
    expect(state.currentRound?.id).toBe(2);

    // Agent responds substantively in Round 2 → should trigger synthesis (max rounds)
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent1.id,
      content: "Further analysis on the topic.",
    });
    await new Promise(r => setTimeout(r, 400));

    state = keryx.getState(conv.id)!;
    // Should be synthesizing (final), not auto-opening Round 3
    if (state.currentRound) {
      expect(state.currentRound.status).toBe("synthesizing");
      expect(state.currentRound.id).toBe(2);
    }

    await keryx.stop();
  });

  it("detects consensus phrases as stop condition", async () => {
    const human = await createAgent("human", "human");
    const agent1 = await createAgent("agent1");
    const agent2 = await createAgent("agent2");
    const { conv } = await setupConversation([human.id, agent1.id, agent2.id]);

    keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
    await keryx.start();

    await store.subscribe(conv.id, keryx.getKeryxAgentId()!);
    await (keryx as any).discoverConversations();
    setMode(keryx, conv.id, "ecclesia");

    // Human triggers Round 1
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: human.id,
      content: "Discuss TypeScript benefits",
    });
    await new Promise(r => setTimeout(r, 200));

    // Both agents respond substantively → Round 2 opens
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent1.id,
      content: "TypeScript improves type safety.",
    });
    await new Promise(r => setTimeout(r, 100));
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent2.id,
      content: "It also has great IDE support.",
    });
    await new Promise(r => setTimeout(r, 400));

    // Round 2 should be open
    let state = keryx.getState(conv.id)!;
    expect(state.currentRound?.id).toBe(2);

    // Both agents respond with consensus phrases → should trigger final synthesis
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent1.id,
      content: "I have nothing to add to this discussion.",
    });
    await new Promise(r => setTimeout(r, 100));
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent2.id,
      content: "Nothing to add from me either.",
    });
    await new Promise(r => setTimeout(r, 400));

    state = keryx.getState(conv.id)!;
    // Should be in synthesis (all consensus), not opening Round 3
    if (state.currentRound) {
      expect(state.currentRound.status).toBe("synthesizing");
    }

    await keryx.stop();
  });
});

// --- Phase 8: Socratic Mode ---

describe("Phase 8 — Socratic Mode", () => {
  let keryx: KeryxModule;
  let ac: AbortController;

  beforeEach(() => {
    ac = new AbortController();
  });

  afterEach(async () => {
    ac.abort();
    await new Promise(r => setTimeout(r, 50));
  });

  it("starts a discussion when a human sends a message", async () => {
    const human = await createAgent("human", "human");
    const agent1 = await createAgent("alpha");
    const agent2 = await createAgent("beta");
    const { conv } = await setupConversation([human.id, agent1.id, agent2.id]);

    keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
    await keryx.start();

    await store.subscribe(conv.id, keryx.getKeryxAgentId()!);
    await (keryx as any).discoverConversations();
    setMode(keryx, conv.id, "socratic");

    // Human sends a message
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: human.id,
      content: "What are the pros and cons of GraphQL?",
    });
    await new Promise(r => setTimeout(r, 300));

    const state = keryx.getState(conv.id)!;
    expect(state.socratic).toBeDefined();
    expect(state.socratic!.turnQueue.length).toBe(2);
    expect(state.socratic!.awaitingResponse).toBe(true);
    expect(state.socratic!.completedCycles).toBe(0);

    // Keryx should have sent an intro + first turn call
    const messages = await store.getMessages(conv.id, keryx.getKeryxAgentId()!);
    const keryxMessages = messages.filter(m => m.fromAgent === keryx.getKeryxAgentId());
    expect(keryxMessages.length).toBeGreaterThanOrEqual(2); // intro + turn call

    await keryx.stop();
  });

  it("uses alphabetical turn order", async () => {
    const human = await createAgent("human", "human");
    // Names chosen so alphabetical order is clear: alpha < beta < gamma
    const agent1 = await createAgent("gamma");
    const agent2 = await createAgent("alpha");
    const agent3 = await createAgent("beta");
    const { conv } = await setupConversation([human.id, agent1.id, agent2.id, agent3.id]);

    keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
    await keryx.start();

    await store.subscribe(conv.id, keryx.getKeryxAgentId()!);
    await (keryx as any).discoverConversations();
    setMode(keryx, conv.id, "socratic");

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: human.id,
      content: "Discuss testing strategies",
    });
    await new Promise(r => setTimeout(r, 300));

    const state = keryx.getState(conv.id)!;
    // Turn queue should be alphabetical: alpha, beta, gamma
    const queueNames: string[] = [];
    for (const id of state.socratic!.turnQueue) {
      const agent = await store.getAgent(id);
      queueNames.push(agent!.name);
    }
    expect(queueNames).toEqual(["alpha", "beta", "gamma"]);

    await keryx.stop();
  });

  it("advances turn when expected agent responds", async () => {
    const human = await createAgent("human", "human");
    const agent1 = await createAgent("alpha");
    const agent2 = await createAgent("beta");
    const { conv } = await setupConversation([human.id, agent1.id, agent2.id]);

    keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
    await keryx.start();

    await store.subscribe(conv.id, keryx.getKeryxAgentId()!);
    await (keryx as any).discoverConversations();
    setMode(keryx, conv.id, "socratic");

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: human.id,
      content: "Discuss error handling",
    });
    await new Promise(r => setTimeout(r, 300));

    const state = keryx.getState(conv.id)!;
    const firstAgentId = state.socratic!.turnQueue[0];
    expect(state.socratic!.currentTurnIndex).toBe(0);

    // First agent responds
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: firstAgentId,
      content: "I recommend using Result types.",
    });
    await new Promise(r => setTimeout(r, 300));

    // Turn should advance to second agent
    expect(state.socratic!.currentTurnIndex).toBe(1);
    expect(state.socratic!.awaitingResponse).toBe(true);

    await keryx.stop();
  });

  it("marks agent as passed on [NO_RESPONSE]", async () => {
    const human = await createAgent("human", "human");
    const agent1 = await createAgent("alpha");
    const agent2 = await createAgent("beta");
    const { conv } = await setupConversation([human.id, agent1.id, agent2.id]);

    keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
    await keryx.start();

    await store.subscribe(conv.id, keryx.getKeryxAgentId()!);
    await (keryx as any).discoverConversations();
    setMode(keryx, conv.id, "socratic");

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: human.id,
      content: "Quick question",
    });
    await new Promise(r => setTimeout(r, 300));

    const state = keryx.getState(conv.id)!;
    const firstAgentId = state.socratic!.turnQueue[0];

    // First agent passes
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: firstAgentId,
      content: "[NO_RESPONSE]",
    });
    await new Promise(r => setTimeout(r, 300));

    expect(state.socratic!.passedAgents.has(firstAgentId)).toBe(true);

    await keryx.stop();
  });

  it("concludes when all agents pass", async () => {
    const human = await createAgent("human", "human");
    const agent1 = await createAgent("alpha");
    const agent2 = await createAgent("beta");
    const { conv } = await setupConversation([human.id, agent1.id, agent2.id]);

    keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
    await keryx.start();

    await store.subscribe(conv.id, keryx.getKeryxAgentId()!);
    await (keryx as any).discoverConversations();
    setMode(keryx, conv.id, "socratic");

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: human.id,
      content: "Any thoughts?",
    });
    await new Promise(r => setTimeout(r, 300));

    const state = keryx.getState(conv.id)!;
    const [firstId, secondId] = state.socratic!.turnQueue;

    // First agent passes
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: firstId,
      content: "[NO_RESPONSE]",
    });
    await new Promise(r => setTimeout(r, 300));

    // Second agent passes
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: secondId,
      content: "[NO_RESPONSE]",
    });
    await new Promise(r => setTimeout(r, 300));

    // Discussion should be concluded — socratic state cleaned up
    expect(state.socratic).toBeUndefined();

    // Conclusion message should exist
    const messages = await store.getMessages(conv.id, keryx.getKeryxAgentId()!);
    const keryxMessages = messages.filter(m => m.fromAgent === keryx.getKeryxAgentId());
    const conclusionMsg = keryxMessages.find(m => m.content.includes("Discussion concluded"));
    expect(conclusionMsg).toBeDefined();

    await keryx.stop();
  });

  it("does not start on non-human message", async () => {
    const human = await createAgent("human", "human");
    const agent1 = await createAgent("alpha");
    const { conv } = await setupConversation([human.id, agent1.id]);

    keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
    await keryx.start();

    await store.subscribe(conv.id, keryx.getKeryxAgentId()!);
    await (keryx as any).discoverConversations();
    setMode(keryx, conv.id, "socratic");

    // Agent sends a message (not human)
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent1.id,
      content: "I have something to say",
    });
    await new Promise(r => setTimeout(r, 200));

    const state = keryx.getState(conv.id)!;
    expect(state.socratic).toBeUndefined();

    await keryx.stop();
  });

  it("cleanup clears socratic state", async () => {
    const human = await createAgent("human", "human");
    const agent1 = await createAgent("alpha");
    const { conv } = await setupConversation([human.id, agent1.id]);

    keryx = new KeryxModule(store, defaultKeryxConfig, ac.signal);
    await keryx.start();

    await store.subscribe(conv.id, keryx.getKeryxAgentId()!);
    await (keryx as any).discoverConversations();
    setMode(keryx, conv.id, "socratic");

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: human.id,
      content: "Start a discussion",
    });
    await new Promise(r => setTimeout(r, 300));

    const state = keryx.getState(conv.id)!;
    expect(state.socratic).toBeDefined();

    // Import and call cleanup directly via the mode handler
    const { SocraticMode } = await import("../keryx/modes/socratic.js");
    const mode = new SocraticMode();
    mode.cleanup(state);

    expect(state.socratic).toBeUndefined();

    await keryx.stop();
  });
});
