/**
 * Store event bus tests — event emission on store mutations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SqliteStore } from "../store/sqlite.js";
import { StoreEventBus, type MessageCreatedEvent } from "../store/events.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let store: SqliteStore;
let eventBus: StoreEventBus;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-events-test-"));
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
    capabilities: ["testing"],
    clearanceLevel: "team",
    apiKeyHash: `hash_${name}`,
  });
}

describe("StoreEventBus", () => {
  it("emits message:created when sendMessage is called", async () => {
    const agent = await createAgent("emitter");
    const project = await store.createProject({ name: "EventProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "EventChat", createdBy: agent.id });

    const received: MessageCreatedEvent[] = [];
    eventBus.onMessage((event) => received.push(event));

    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent.id,
      content: "Hello events!",
    });

    expect(received).toHaveLength(1);
    expect(received[0].message.id).toBe(msg.id);
    expect(received[0].message.content).toBe("Hello events!");
    expect(received[0].message.conversationId).toBe(conv.id);
    expect(received[0].message.fromAgent).toBe(agent.id);
  });

  it("emits for each message sent", async () => {
    const agent = await createAgent("multi-emitter");
    const project = await store.createProject({ name: "MultiProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "MultiChat", createdBy: agent.id });

    const received: MessageCreatedEvent[] = [];
    eventBus.onMessage((event) => received.push(event));

    await store.sendMessage({ conversationId: conv.id, fromAgent: agent.id, content: "msg1" });
    await store.sendMessage({ conversationId: conv.id, fromAgent: agent.id, content: "msg2" });
    await store.sendMessage({ conversationId: conv.id, fromAgent: agent.id, content: "msg3" });

    expect(received).toHaveLength(3);
    expect(received.map((e) => e.message.content)).toEqual(["msg1", "msg2", "msg3"]);
  });

  it("offMessage stops receiving events", async () => {
    const agent = await createAgent("off-emitter");
    const project = await store.createProject({ name: "OffProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "OffChat", createdBy: agent.id });

    const received: MessageCreatedEvent[] = [];
    const listener = (event: MessageCreatedEvent) => received.push(event);
    eventBus.onMessage(listener);

    await store.sendMessage({ conversationId: conv.id, fromAgent: agent.id, content: "before" });
    expect(received).toHaveLength(1);

    eventBus.offMessage(listener);

    await store.sendMessage({ conversationId: conv.id, fromAgent: agent.id, content: "after" });
    expect(received).toHaveLength(1); // still 1
  });

  it("emitted message has capped visibility", async () => {
    const teamAgent = await createAgent("team-emitter");
    const confAgent = await createAgent("conf-emitter");
    await store.registerAgent({
      name: "conf-emitter",
      type: "test",
      capabilities: ["testing"],
      clearanceLevel: "confidential",
      apiKeyHash: "hash_conf-emitter",
    });

    const project = await store.createProject({ name: "VisProj", createdBy: confAgent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "VisChat", createdBy: confAgent.id });

    const received: MessageCreatedEvent[] = [];
    eventBus.onMessage((event) => received.push(event));

    // Team agent tries to send as confidential — should be capped
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: teamAgent.id,
      content: "capped message",
      visibility: "confidential",
    });

    expect(received).toHaveLength(1);
    expect(received[0].message.visibility).toBe("team");
  });

  it("store creates default eventBus when none provided", async () => {
    const tmpDir2 = mkdtempSync(join(tmpdir(), "agorai-events-default-"));
    const store2 = new SqliteStore(join(tmpDir2, "test.db"));
    await store2.initialize();

    expect(store2.eventBus).toBeInstanceOf(StoreEventBus);

    const received: MessageCreatedEvent[] = [];
    store2.eventBus.onMessage((event) => received.push(event));

    const agent = await store2.registerAgent({
      name: "default-bus",
      type: "test",
      capabilities: [],
      apiKeyHash: "hash_default",
    });
    const project = await store2.createProject({ name: "DefaultProj", createdBy: agent.id });
    const conv = await store2.createConversation({ projectId: project.id, title: "DefaultChat", createdBy: agent.id });
    await store2.sendMessage({ conversationId: conv.id, fromAgent: agent.id, content: "default bus works" });

    expect(received).toHaveLength(1);

    await store2.close();
    rmSync(tmpDir2, { recursive: true, force: true });
  });

  it("multiple listeners all receive the event", async () => {
    const agent = await createAgent("multi-listener");
    const project = await store.createProject({ name: "MultiListenerProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "MultiChat", createdBy: agent.id });

    const listener1 = vi.fn();
    const listener2 = vi.fn();
    eventBus.onMessage(listener1);
    eventBus.onMessage(listener2);

    await store.sendMessage({ conversationId: conv.id, fromAgent: agent.id, content: "broadcast" });

    expect(listener1).toHaveBeenCalledOnce();
    expect(listener2).toHaveBeenCalledOnce();
    expect(listener1.mock.calls[0][0].message.content).toBe("broadcast");
    expect(listener2.mock.calls[0][0].message.content).toBe("broadcast");
  });
});
