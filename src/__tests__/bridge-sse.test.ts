/**
 * Bridge SSE dispatch logic tests.
 *
 * Tests the subscriber filtering, visibility gating, and sender exclusion
 * that power the SSE push notification system.
 *
 * Full HTTP-level SSE tests require a running bridge (E2E);
 * these unit tests verify the core dispatch logic independently.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SqliteStore } from "../store/sqlite.js";
import { StoreEventBus, type MessageCreatedEvent } from "../store/events.js";
import { VISIBILITY_ORDER, type VisibilityLevel } from "../store/types.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let store: SqliteStore;
let eventBus: StoreEventBus;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-sse-test-"));
  eventBus = new StoreEventBus();
  store = new SqliteStore(join(tmpDir, "test.db"), eventBus);
  await store.initialize();
});

afterEach(async () => {
  await store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function createAgent(name: string, clearance: VisibilityLevel = "team") {
  return store.registerAgent({
    name,
    type: "test",
    capabilities: ["testing"],
    clearanceLevel: clearance,
    apiKeyHash: `hash_${name}`,
  });
}

describe("SSE dispatch — subscriber filtering", () => {
  it("notifies subscribed agents (excluding sender)", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await store.createProject({ name: "SSEProj", createdBy: alice.id });
    const conv = await store.createConversation({ projectId: project.id, title: "Chat", createdBy: alice.id });
    await store.subscribe(conv.id, alice.id);
    await store.subscribe(conv.id, bob.id);

    const received: MessageCreatedEvent[] = [];
    eventBus.onMessage(async (event) => {
      received.push(event);

      // Simulate dispatch: get subscribers, exclude sender
      const subs = await store.getSubscribers(event.message.conversationId);
      const recipients = subs.filter((s) => s.agentId !== event.message.fromAgent);

      // Bob should be notified, Alice (sender) should not
      expect(recipients).toHaveLength(1);
      expect(recipients[0].agentId).toBe(bob.id);
    });

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Hello Bob!",
    });

    expect(received).toHaveLength(1);
  });

  it("does not notify agents not subscribed to the conversation", async () => {
    const alice = await createAgent("alice-unsub");
    const carol = await createAgent("carol-unsub");
    const project = await store.createProject({ name: "UnsubProj", createdBy: alice.id });
    const conv = await store.createConversation({ projectId: project.id, title: "Private", createdBy: alice.id });
    await store.subscribe(conv.id, alice.id);
    // carol is NOT subscribed

    const received: MessageCreatedEvent[] = [];
    eventBus.onMessage(async (event) => {
      received.push(event);
      const subs = await store.getSubscribers(event.message.conversationId);
      const recipients = subs.filter((s) => s.agentId !== event.message.fromAgent);

      // No one to notify — only subscriber is the sender
      expect(recipients).toHaveLength(0);
    });

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Talking to myself",
    });

    expect(received).toHaveLength(1);
  });
});

describe("SSE dispatch — visibility gating", () => {
  it("team agent receives team-visibility notifications", async () => {
    const sender = await createAgent("conf-sender", "confidential");
    const teamAgent = await createAgent("team-receiver", "team");
    const project = await store.createProject({ name: "VisProj", createdBy: sender.id });
    const conv = await store.createConversation({ projectId: project.id, title: "VisCh", createdBy: sender.id });
    await store.subscribe(conv.id, sender.id);
    await store.subscribe(conv.id, teamAgent.id);

    const received: MessageCreatedEvent[] = [];
    eventBus.onMessage(async (event) => {
      received.push(event);
      const subs = await store.getSubscribers(event.message.conversationId);
      const messageVisInt = VISIBILITY_ORDER[event.message.visibility];

      const eligible = [];
      for (const sub of subs) {
        if (sub.agentId === event.message.fromAgent) continue;
        const agent = await store.getAgent(sub.agentId);
        if (!agent) continue;
        const agentVisInt = VISIBILITY_ORDER[agent.clearanceLevel as VisibilityLevel];
        if (agentVisInt >= messageVisInt) eligible.push(agent);
      }

      // Team agent CAN see team-level messages
      expect(eligible).toHaveLength(1);
      expect(eligible[0].name).toBe("team-receiver");
    });

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: sender.id,
      content: "Team message",
      visibility: "team",
    });

    expect(received).toHaveLength(1);
  });

  it("team agent does NOT receive confidential notifications", async () => {
    const sender = await createAgent("conf-sender2", "confidential");
    const teamAgent = await createAgent("team-blocked", "team");
    const project = await store.createProject({ name: "ConfProj", createdBy: sender.id });
    const conv = await store.createConversation({ projectId: project.id, title: "ConfCh", createdBy: sender.id });
    await store.subscribe(conv.id, sender.id);
    await store.subscribe(conv.id, teamAgent.id);

    const received: MessageCreatedEvent[] = [];
    eventBus.onMessage(async (event) => {
      received.push(event);
      const subs = await store.getSubscribers(event.message.conversationId);
      const messageVisInt = VISIBILITY_ORDER[event.message.visibility];

      const eligible = [];
      for (const sub of subs) {
        if (sub.agentId === event.message.fromAgent) continue;
        const agent = await store.getAgent(sub.agentId);
        if (!agent) continue;
        const agentVisInt = VISIBILITY_ORDER[agent.clearanceLevel as VisibilityLevel];
        if (agentVisInt >= messageVisInt) eligible.push(agent);
      }

      // Team agent CANNOT see confidential messages
      expect(eligible).toHaveLength(0);
    });

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: sender.id,
      content: "Secret message",
      visibility: "confidential",
    });

    expect(received).toHaveLength(1);
  });

  it("confidential agent receives confidential notifications", async () => {
    const sender = await createAgent("conf-sender3", "confidential");
    const confAgent = await createAgent("conf-receiver", "confidential");
    const project = await store.createProject({ name: "ConfOkProj", createdBy: sender.id });
    const conv = await store.createConversation({ projectId: project.id, title: "ConfOk", createdBy: sender.id });
    await store.subscribe(conv.id, sender.id);
    await store.subscribe(conv.id, confAgent.id);

    const received: MessageCreatedEvent[] = [];
    eventBus.onMessage(async (event) => {
      received.push(event);
      const subs = await store.getSubscribers(event.message.conversationId);
      const messageVisInt = VISIBILITY_ORDER[event.message.visibility];

      const eligible = [];
      for (const sub of subs) {
        if (sub.agentId === event.message.fromAgent) continue;
        const agent = await store.getAgent(sub.agentId);
        if (!agent) continue;
        const agentVisInt = VISIBILITY_ORDER[agent.clearanceLevel as VisibilityLevel];
        if (agentVisInt >= messageVisInt) eligible.push(agent);
      }

      expect(eligible).toHaveLength(1);
      expect(eligible[0].name).toBe("conf-receiver");
    });

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: sender.id,
      content: "Confidential ok",
      visibility: "confidential",
    });

    expect(received).toHaveLength(1);
  });
});

describe("SSE dispatch — notification payload", () => {
  it("includes content preview truncated at 200 chars", async () => {
    const agent = await createAgent("preview-agent");
    const project = await store.createProject({ name: "PreviewProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "Preview", createdBy: agent.id });

    const longContent = "A".repeat(300);

    const received: MessageCreatedEvent[] = [];
    eventBus.onMessage((event) => received.push(event));

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent.id,
      content: longContent,
    });

    const msg = received[0].message;
    // Verify the full content is in the message
    expect(msg.content).toBe(longContent);
    expect(msg.content.length).toBe(300);

    // Simulate preview truncation as done in dispatch
    const preview = msg.content.length > 200
      ? msg.content.slice(0, 200) + "..."
      : msg.content;
    expect(preview.length).toBe(203);
    expect(preview.endsWith("...")).toBe(true);
  });

  it("short content is not truncated", async () => {
    const agent = await createAgent("short-agent");
    const project = await store.createProject({ name: "ShortProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "Short", createdBy: agent.id });

    const received: MessageCreatedEvent[] = [];
    eventBus.onMessage((event) => received.push(event));

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent.id,
      content: "Short message",
    });

    const msg = received[0].message;
    const preview = msg.content.length > 200
      ? msg.content.slice(0, 200) + "..."
      : msg.content;
    expect(preview).toBe("Short message");
  });

  it("notification contains all required fields", async () => {
    const agent = await createAgent("fields-agent");
    const project = await store.createProject({ name: "FieldsProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "Fields", createdBy: agent.id });

    const received: MessageCreatedEvent[] = [];
    eventBus.onMessage((event) => received.push(event));

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent.id,
      content: "Test message",
      type: "message",
    });

    const msg = received[0].message;
    expect(msg).toHaveProperty("id");
    expect(msg).toHaveProperty("conversationId", conv.id);
    expect(msg).toHaveProperty("fromAgent", agent.id);
    expect(msg).toHaveProperty("type", "message");
    expect(msg).toHaveProperty("visibility");
    expect(msg).toHaveProperty("content");
    expect(msg).toHaveProperty("createdAt");
  });
});

describe("SSE dispatch — multi-subscriber scenario", () => {
  it("notifies multiple subscribers with appropriate visibility", async () => {
    const sender = await createAgent("multi-sender", "confidential");
    const teamReceiver = await createAgent("multi-team", "team");
    const confReceiver = await createAgent("multi-conf", "confidential");
    const publicReceiver = await createAgent("multi-pub", "public");

    const project = await store.createProject({ name: "MultiProj", createdBy: sender.id });
    const conv = await store.createConversation({ projectId: project.id, title: "Multi", createdBy: sender.id });

    // Subscribe all
    await store.subscribe(conv.id, sender.id);
    await store.subscribe(conv.id, teamReceiver.id);
    await store.subscribe(conv.id, confReceiver.id);
    await store.subscribe(conv.id, publicReceiver.id);

    const received: MessageCreatedEvent[] = [];
    eventBus.onMessage(async (event) => {
      received.push(event);
      const subs = await store.getSubscribers(event.message.conversationId);
      const messageVisInt = VISIBILITY_ORDER[event.message.visibility];

      const eligible = [];
      for (const sub of subs) {
        if (sub.agentId === event.message.fromAgent) continue;
        const agent = await store.getAgent(sub.agentId);
        if (!agent) continue;
        const agentVisInt = VISIBILITY_ORDER[agent.clearanceLevel as VisibilityLevel];
        if (agentVisInt >= messageVisInt) eligible.push(agent.name);
      }

      // Team message: team + confidential can see it, public cannot
      expect(eligible).toContain("multi-team");
      expect(eligible).toContain("multi-conf");
      expect(eligible).not.toContain("multi-pub");
      expect(eligible).not.toContain("multi-sender"); // sender excluded
      expect(eligible).toHaveLength(2);
    });

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: sender.id,
      content: "Team broadcast",
      visibility: "team",
    });

    expect(received).toHaveLength(1);
  });
});
