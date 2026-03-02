/**
 * Whisper (directed message) tests — store-level.
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
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-whisper-test-"));
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

describe("SqliteStore — Whispers (Directed Messages)", () => {
  it("sendMessage with recipients stores them and sets bridgeMetadata.whisper", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await setupConversation(alice.id);
    await store.subscribe(conv.id, bob.id);

    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Secret message for Bob",
      recipients: [bob.id],
    });

    expect(msg.recipients).toEqual([bob.id]);
    expect(msg.bridgeMetadata?.whisper).toBe(true);
    expect(msg.bridgeMetadata?.recipients).toEqual([bob.id]);
  });

  it("sendMessage without recipients is a broadcast (no whisper)", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupConversation(alice.id);

    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Public message",
    });

    expect(msg.recipients).toBeNull();
    expect(msg.bridgeMetadata?.whisper).toBeUndefined();
    expect(msg.bridgeMetadata?.recipients).toBeUndefined();
  });

  it("sendMessage with empty recipients array is a broadcast", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupConversation(alice.id);

    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Public message",
      recipients: [],
    });

    expect(msg.recipients).toBeNull();
    expect(msg.bridgeMetadata?.whisper).toBeUndefined();
  });

  it("getMessages: recipient can see whisper", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await setupConversation(alice.id);
    await store.subscribe(conv.id, bob.id);

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Whisper to Bob",
      recipients: [bob.id],
    });

    const bobMessages = await store.getMessages(conv.id, bob.id);
    expect(bobMessages).toHaveLength(1);
    expect(bobMessages[0].content).toBe("Whisper to Bob");
  });

  it("getMessages: sender always sees their own whisper", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await setupConversation(alice.id);
    await store.subscribe(conv.id, bob.id);

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Whisper to Bob only",
      recipients: [bob.id],
    });

    // Alice is sender but NOT in recipients — should still see it
    const aliceMessages = await store.getMessages(conv.id, alice.id);
    expect(aliceMessages).toHaveLength(1);
    expect(aliceMessages[0].content).toBe("Whisper to Bob only");
  });

  it("getMessages: non-recipient subscriber CANNOT see whisper", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const charlie = await createAgent("charlie");
    const { conv } = await setupConversation(alice.id);
    await store.subscribe(conv.id, bob.id);
    await store.subscribe(conv.id, charlie.id);

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Whisper to Bob",
      recipients: [bob.id],
    });

    // Charlie is subscribed but not in recipients — should NOT see it
    const charlieMessages = await store.getMessages(conv.id, charlie.id);
    expect(charlieMessages).toHaveLength(0);
  });

  it("getMessages: broadcast messages visible to all regardless of whisper filter", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const charlie = await createAgent("charlie");
    const { conv } = await setupConversation(alice.id);
    await store.subscribe(conv.id, bob.id);
    await store.subscribe(conv.id, charlie.id);

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Broadcast message",
    });
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Whisper to Bob",
      recipients: [bob.id],
    });

    const bobMessages = await store.getMessages(conv.id, bob.id);
    expect(bobMessages).toHaveLength(2);

    const charlieMessages = await store.getMessages(conv.id, charlie.id);
    expect(charlieMessages).toHaveLength(1);
    expect(charlieMessages[0].content).toBe("Broadcast message");
  });

  it("whisper to multiple recipients", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const charlie = await createAgent("charlie");
    const dave = await createAgent("dave");
    const { conv } = await setupConversation(alice.id);
    await store.subscribe(conv.id, bob.id);
    await store.subscribe(conv.id, charlie.id);
    await store.subscribe(conv.id, dave.id);

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Private group message",
      recipients: [bob.id, charlie.id],
    });

    // Bob and Charlie see it
    expect(await store.getMessages(conv.id, bob.id)).toHaveLength(1);
    expect(await store.getMessages(conv.id, charlie.id)).toHaveLength(1);
    // Dave does not
    expect(await store.getMessages(conv.id, dave.id)).toHaveLength(0);
    // Alice (sender) sees it
    expect(await store.getMessages(conv.id, alice.id)).toHaveLength(1);
  });

  it("whisper + visibility: both filters apply", async () => {
    const alice = await createAgent("alice");
    const bob = await store.registerAgent({
      name: "bob",
      type: "test",
      capabilities: [],
      clearanceLevel: "public",
      apiKeyHash: "hash_bob",
    });
    const { conv } = await setupConversation(alice.id);
    await store.subscribe(conv.id, bob.id);

    // Whisper to Bob at team visibility — Bob has public clearance
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Team whisper to Bob",
      visibility: "team",
      recipients: [bob.id],
    });

    // Bob is in recipients but clearance < visibility → blocked by visibility filter
    const bobMessages = await store.getMessages(conv.id, bob.id);
    expect(bobMessages).toHaveLength(0);
  });

  it("whisper persists through DB (rowToMessage parses recipients)", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await setupConversation(alice.id);
    await store.subscribe(conv.id, bob.id);

    const sent = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Persisted whisper",
      recipients: [bob.id],
    });

    // Re-read from DB
    const messages = await store.getMessages(conv.id, bob.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].recipients).toEqual([bob.id]);
    expect(messages[0].bridgeMetadata?.whisper).toBe(true);
    expect(messages[0].bridgeMetadata?.recipients).toEqual([bob.id]);
  });

  it("pre-migration messages without recipients column return null", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupConversation(alice.id);

    // Simulate a pre-migration message by inserting directly without recipients
    const db = (store as any).db;
    db.prepare(`
      INSERT INTO messages (id, conversation_id, from_agent, type, visibility, content, created_at)
      VALUES (?, ?, ?, 'message', 'team', 'legacy message', ?)
    `).run("legacy-id", conv.id, alice.id, new Date().toISOString());

    const messages = await store.getMessages(conv.id, alice.id);
    const legacy = messages.find((m) => m.id === "legacy-id");
    expect(legacy).toBeDefined();
    expect(legacy!.recipients).toBeNull();
  });

  it("event bus emits message with recipients for whispers", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await setupConversation(alice.id);
    await store.subscribe(conv.id, bob.id);

    let emitted: any = null;
    eventBus.onMessage((event) => {
      emitted = event.message;
    });

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Whisper event",
      recipients: [bob.id],
    });

    expect(emitted).not.toBeNull();
    expect(emitted.recipients).toEqual([bob.id]);
    expect(emitted.bridgeMetadata?.whisper).toBe(true);
  });
});
