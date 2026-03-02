/**
 * Message tags & fromAgent filter tests — store-level.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStore } from "../store/sqlite.js";
import { StoreEventBus } from "../store/events.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let store: SqliteStore;
let eventBus: StoreEventBus;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-msgtags-test-"));
  eventBus = new StoreEventBus();
  store = new SqliteStore(join(tmpDir, "test.db"), eventBus);
  await store.initialize();
});

afterEach(async () => {
  await store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function createAgent(name: string) {
  return store.registerAgent({
    name,
    type: "test",
    capabilities: [],
    clearanceLevel: "team",
    apiKeyHash: `hash_${name}`,
  });
}

async function setupConversation(agentId: string) {
  const project = await store.createProject({ name: "TestProject", createdBy: agentId });
  const conv = await store.createConversation({ projectId: project.id, title: "Test", createdBy: agentId });
  await store.subscribe(conv.id, agentId);
  return { project, conv };
}

describe("SqliteStore — Message Tags", () => {
  it("sendMessage stores tags and returns them", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupConversation(alice.id);

    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Hello with tags",
      tags: ["urgent", "review"],
    });

    expect(msg.tags).toEqual(["urgent", "review"]);
  });

  it("sendMessage defaults tags to empty array", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupConversation(alice.id);

    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Hello without tags",
    });

    expect(msg.tags).toEqual([]);
  });

  it("getMessages returns tags on messages", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupConversation(alice.id);

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Tagged message",
      tags: ["status-update"],
    });

    const messages = await store.getMessages(conv.id, alice.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].tags).toEqual(["status-update"]);
  });

  it("getMessages filters by tags (any match)", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupConversation(alice.id);

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Message A",
      tags: ["urgent", "review"],
    });
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Message B",
      tags: ["info"],
    });
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Message C",
      tags: ["review", "code"],
    });

    // Filter by "review" — should get A and C
    const results = await store.getMessages(conv.id, alice.id, { tags: ["review"] });
    expect(results).toHaveLength(2);
    expect(results.map((m) => m.content)).toEqual(["Message A", "Message C"]);
  });

  it("getMessages filters by multiple tags (any match)", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupConversation(alice.id);

    await store.sendMessage({ conversationId: conv.id, fromAgent: alice.id, content: "A", tags: ["urgent"] });
    await store.sendMessage({ conversationId: conv.id, fromAgent: alice.id, content: "B", tags: ["info"] });
    await store.sendMessage({ conversationId: conv.id, fromAgent: alice.id, content: "C", tags: ["code"] });

    // Filter by "urgent" or "code" — should get A and C
    const results = await store.getMessages(conv.id, alice.id, { tags: ["urgent", "code"] });
    expect(results).toHaveLength(2);
    expect(results.map((m) => m.content)).toEqual(["A", "C"]);
  });

  it("getMessages with empty tags filter returns all messages", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupConversation(alice.id);

    await store.sendMessage({ conversationId: conv.id, fromAgent: alice.id, content: "A", tags: ["x"] });
    await store.sendMessage({ conversationId: conv.id, fromAgent: alice.id, content: "B" });

    const results = await store.getMessages(conv.id, alice.id, { tags: [] });
    expect(results).toHaveLength(2);
  });

  it("getMessages with non-matching tags returns empty", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupConversation(alice.id);

    await store.sendMessage({ conversationId: conv.id, fromAgent: alice.id, content: "A", tags: ["x"] });

    const results = await store.getMessages(conv.id, alice.id, { tags: ["nonexistent"] });
    expect(results).toHaveLength(0);
  });
});

describe("SqliteStore — Filter by fromAgent", () => {
  it("getMessages filters by fromAgent", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await setupConversation(alice.id);
    await store.subscribe(conv.id, bob.id);

    await store.sendMessage({ conversationId: conv.id, fromAgent: alice.id, content: "From Alice" });
    await store.sendMessage({ conversationId: conv.id, fromAgent: bob.id, content: "From Bob" });
    await store.sendMessage({ conversationId: conv.id, fromAgent: alice.id, content: "From Alice again" });

    const aliceMessages = await store.getMessages(conv.id, alice.id, { fromAgent: alice.id });
    expect(aliceMessages).toHaveLength(2);
    expect(aliceMessages.map((m) => m.content)).toEqual(["From Alice", "From Alice again"]);

    const bobMessages = await store.getMessages(conv.id, alice.id, { fromAgent: bob.id });
    expect(bobMessages).toHaveLength(1);
    expect(bobMessages[0].content).toBe("From Bob");
  });

  it("getMessages with unknown fromAgent returns empty", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupConversation(alice.id);

    await store.sendMessage({ conversationId: conv.id, fromAgent: alice.id, content: "Hello" });

    const results = await store.getMessages(conv.id, alice.id, { fromAgent: "nonexistent-id" });
    expect(results).toHaveLength(0);
  });
});

describe("SqliteStore — Combined filters", () => {
  it("getMessages combines tags + fromAgent + limit", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await setupConversation(alice.id);
    await store.subscribe(conv.id, bob.id);

    await store.sendMessage({ conversationId: conv.id, fromAgent: alice.id, content: "A1", tags: ["review"] });
    await store.sendMessage({ conversationId: conv.id, fromAgent: bob.id, content: "B1", tags: ["review"] });
    await store.sendMessage({ conversationId: conv.id, fromAgent: alice.id, content: "A2", tags: ["review"] });
    await store.sendMessage({ conversationId: conv.id, fromAgent: alice.id, content: "A3", tags: ["info"] });

    // Filter: from alice + tag "review" + limit 1
    const results = await store.getMessages(conv.id, alice.id, {
      fromAgent: alice.id,
      tags: ["review"],
      limit: 1,
    });
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("A1");
  });
});

describe("SqliteStore — Tags migration", () => {
  it("messages without tags column get default empty array", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupConversation(alice.id);

    // Simulate a pre-migration message by inserting directly without tags
    const db = (store as any).db;
    db.prepare(`
      INSERT INTO messages (id, conversation_id, from_agent, type, visibility, content, created_at)
      VALUES (?, ?, ?, 'message', 'team', 'legacy message', ?)
    `).run("legacy-id", conv.id, alice.id, new Date().toISOString());

    const messages = await store.getMessages(conv.id, alice.id);
    const legacy = messages.find((m) => m.id === "legacy-id");
    expect(legacy).toBeDefined();
    expect(legacy!.tags).toEqual([]);
  });
});
