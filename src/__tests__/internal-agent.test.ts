/**
 * Internal agent tests — uses real SqliteStore (tmpdir) + mock adapter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SqliteStore } from "../store/sqlite.js";
import { runInternalAgent, type InternalAgentOptions } from "../agent/internal-agent.js";
import type { IAgentAdapter, AgentInvokeOptions, AgentResponse } from "../adapters/base.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let store: SqliteStore;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-agent-test-"));
  store = new SqliteStore(join(tmpDir, "test.db"));
  await store.initialize();
});

afterEach(async () => {
  await store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// --- Mock adapter ---

function createMockAdapter(
  name: string,
  response: string = "Hello from mock",
  shouldFail: boolean = false,
): IAgentAdapter {
  return {
    name,
    async isAvailable() {
      return true;
    },
    async invoke(_opts: AgentInvokeOptions): Promise<AgentResponse> {
      if (shouldFail) {
        throw new Error("Adapter failure");
      }
      return {
        content: response,
        confidence: 0.8,
        durationMs: 50,
      };
    },
  };
}

// --- Helpers ---

async function createTestAgent(storeName: string, clearance: "public" | "team" | "confidential" | "restricted" = "team") {
  return store.registerAgent({
    name: storeName,
    type: "test",
    capabilities: ["chat"],
    clearanceLevel: clearance,
    apiKeyHash: `hash_${storeName}`,
  });
}

async function setupConversation(creatorId: string) {
  const project = await store.createProject({
    name: "Test Project",
    createdBy: creatorId,
  });
  const conv = await store.createConversation({
    projectId: project.id,
    title: "Test Conversation",
    createdBy: creatorId,
  });
  return { project, conv };
}

/**
 * Run the agent for a fixed number of poll cycles by aborting after a delay.
 */
async function runAgentBriefly(
  options: Omit<InternalAgentOptions, "signal">,
  durationMs: number = 150,
): Promise<void> {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), durationMs);
  try {
    await runInternalAgent({ ...options, signal: ac.signal });
  } finally {
    clearTimeout(timeout);
  }
}

describe("Internal Agent — Discovery & Subscription", () => {
  it("discovers and subscribes to existing conversations", async () => {
    const other = await createTestAgent("other-agent");
    const { conv } = await setupConversation(other.id);

    const adapter = createMockAdapter("test-bot");

    await runAgentBriefly({
      store,
      adapter,
      agentId: "internal:test-bot",
      agentName: "test-bot",
      mode: "active",
      pollIntervalMs: 50,
    });

    // Agent should have subscribed to the conversation
    const isSubbed = await store.isSubscribed(conv.id, (await store.getAgentByApiKey("internal:test-bot"))!.id);
    expect(isSubbed).toBe(true);
  });
});

describe("Internal Agent — Active Mode", () => {
  it("responds to unread messages", async () => {
    const other = await createTestAgent("sender");
    const { conv } = await setupConversation(other.id);
    await store.subscribe(conv.id, other.id);

    // Send a message from another agent
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: other.id,
      content: "What do you think about this architecture?",
    });

    const adapter = createMockAdapter("responder", "I think it looks great!");

    await runAgentBriefly({
      store,
      adapter,
      agentId: "internal:responder",
      agentName: "responder",
      mode: "active",
      pollIntervalMs: 50,
    }, 300);

    // Check that the agent sent a response
    const agentRecord = await store.getAgentByApiKey("internal:responder");
    const messages = await store.getMessages(conv.id, agentRecord!.id);
    const agentMessages = messages.filter((m) => m.fromAgent === agentRecord!.id);
    expect(agentMessages.length).toBeGreaterThanOrEqual(1);
    expect(agentMessages[0].content).toBe("I think it looks great!");
  });
});

describe("Internal Agent — Passive Mode", () => {
  it("only responds to @mentions", async () => {
    const other = await createTestAgent("chatter");
    const { conv } = await setupConversation(other.id);
    await store.subscribe(conv.id, other.id);

    // Send a message WITHOUT @mention
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: other.id,
      content: "Just talking to myself here",
    });

    const adapter = createMockAdapter("passive-bot", "I was mentioned!");

    await runAgentBriefly({
      store,
      adapter,
      agentId: "internal:passive-bot",
      agentName: "passive-bot",
      mode: "passive",
      pollIntervalMs: 50,
    }, 300);

    // Agent should NOT have responded (no @mention)
    const agentRecord = await store.getAgentByApiKey("internal:passive-bot");
    const messages = await store.getMessages(conv.id, agentRecord!.id);
    const agentMessages = messages.filter((m) => m.fromAgent === agentRecord!.id);
    expect(agentMessages).toHaveLength(0);
  });

  it("responds when @mentioned", async () => {
    const other = await createTestAgent("mentioner");
    const { conv } = await setupConversation(other.id);
    await store.subscribe(conv.id, other.id);

    // Send a message WITH @mention
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: other.id,
      content: "Hey @mention-bot what do you think?",
    });

    const adapter = createMockAdapter("mention-bot", "Thanks for asking!");

    await runAgentBriefly({
      store,
      adapter,
      agentId: "internal:mention-bot",
      agentName: "mention-bot",
      mode: "passive",
      pollIntervalMs: 50,
    }, 300);

    // Agent SHOULD have responded
    const agentRecord = await store.getAgentByApiKey("internal:mention-bot");
    const messages = await store.getMessages(conv.id, agentRecord!.id);
    const agentMessages = messages.filter((m) => m.fromAgent === agentRecord!.id);
    expect(agentMessages.length).toBeGreaterThanOrEqual(1);
    expect(agentMessages[0].content).toBe("Thanks for asking!");
  });
});

describe("Internal Agent — Self-filtering", () => {
  it("does not respond to its own messages", async () => {
    const other = await createTestAgent("starter");
    const { conv } = await setupConversation(other.id);
    await store.subscribe(conv.id, other.id);

    // First, send a real message to trigger a response
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: other.id,
      content: "Hello @self-filter what's up?",
    });

    let invokeCount = 0;
    const adapter: IAgentAdapter = {
      name: "self-filter",
      async isAvailable() { return true; },
      async invoke(): Promise<AgentResponse> {
        invokeCount++;
        return { content: `Response #${invokeCount}`, confidence: 0.8, durationMs: 10 };
      },
    };

    await runAgentBriefly({
      store,
      adapter,
      agentId: "internal:self-filter",
      agentName: "self-filter",
      mode: "active",
      pollIntervalMs: 50,
    }, 400);

    // Should only have invoked once (for the starter's message).
    // After agent replies, its own message should not re-trigger.
    expect(invokeCount).toBe(1);
  });
});

describe("Internal Agent — Mark Read", () => {
  it("marks messages read after successful send", async () => {
    const other = await createTestAgent("mark-sender");
    const { conv } = await setupConversation(other.id);
    await store.subscribe(conv.id, other.id);

    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: other.id,
      content: "Please respond",
    });

    const adapter = createMockAdapter("mark-bot", "Done!");

    await runAgentBriefly({
      store,
      adapter,
      agentId: "internal:mark-bot",
      agentName: "mark-bot",
      mode: "active",
      pollIntervalMs: 50,
    }, 300);

    // The original message should be marked as read by the agent
    const agentRecord = await store.getAgentByApiKey("internal:mark-bot");
    const unread = await store.getMessages(conv.id, agentRecord!.id, { unreadOnly: true });
    // The only unread should be the agent's own response (if any), not the original
    const originalStillUnread = unread.find((m) => m.id === msg.id);
    expect(originalStillUnread).toBeUndefined();
  });

  it("does NOT mark read on adapter failure", async () => {
    const other = await createTestAgent("fail-sender");
    const { conv } = await setupConversation(other.id);
    await store.subscribe(conv.id, other.id);

    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: other.id,
      content: "This should fail to process",
    });

    const failAdapter = createMockAdapter("fail-bot", "", true);

    await runAgentBriefly({
      store,
      adapter: failAdapter,
      agentId: "internal:fail-bot",
      agentName: "fail-bot",
      mode: "active",
      pollIntervalMs: 50,
    }, 300);

    // Message should still be unread (adapter failed, so no markRead)
    const agentRecord = await store.getAgentByApiKey("internal:fail-bot");
    const unread = await store.getMessages(conv.id, agentRecord!.id, { unreadOnly: true });
    const originalStillUnread = unread.find((m) => m.id === msg.id);
    expect(originalStillUnread).toBeDefined();
  });
});

describe("Internal Agent — Shutdown", () => {
  it("stops gracefully via AbortSignal", async () => {
    const adapter = createMockAdapter("shutdown-bot");
    const ac = new AbortController();

    // Abort after 100ms
    setTimeout(() => ac.abort(), 100);

    const start = Date.now();
    await runInternalAgent({
      store,
      adapter,
      agentId: "internal:shutdown-bot",
      agentName: "shutdown-bot",
      mode: "active",
      pollIntervalMs: 50,
      signal: ac.signal,
    });
    const elapsed = Date.now() - start;

    // Should have stopped within a reasonable time (not hung)
    expect(elapsed).toBeLessThan(2000);
  });
});
