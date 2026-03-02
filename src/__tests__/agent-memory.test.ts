/**
 * Agent Memory tests — private per-agent scratchpad, 3 scopes, cleanup on unsubscribe.
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
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-agentmem-test-"));
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

describe("SqliteStore — Agent Memory", () => {
  // --- Global scope ---

  it("set/get global agent memory", async () => {
    const alice = await createAgent("alice");

    const mem = await store.setAgentMemory(alice.id, "global", "My global notes");
    expect(mem.agentId).toBe(alice.id);
    expect(mem.scope).toBe("global");
    expect(mem.scopeId).toBeNull();
    expect(mem.content).toBe("My global notes");
    expect(mem.updatedAt).toBeDefined();

    const fetched = await store.getAgentMemory(alice.id, "global");
    expect(fetched).not.toBeNull();
    expect(fetched!.content).toBe("My global notes");
  });

  it("global memory overwrites on second set", async () => {
    const alice = await createAgent("alice");

    await store.setAgentMemory(alice.id, "global", "Version 1");
    await store.setAgentMemory(alice.id, "global", "Version 2");

    const fetched = await store.getAgentMemory(alice.id, "global");
    expect(fetched!.content).toBe("Version 2");
  });

  it("get returns null for non-existent memory", async () => {
    const alice = await createAgent("alice");
    const fetched = await store.getAgentMemory(alice.id, "global");
    expect(fetched).toBeNull();
  });

  it("delete global memory", async () => {
    const alice = await createAgent("alice");

    await store.setAgentMemory(alice.id, "global", "To be deleted");
    const deleted = await store.deleteAgentMemory(alice.id, "global");
    expect(deleted).toBe(true);

    const fetched = await store.getAgentMemory(alice.id, "global");
    expect(fetched).toBeNull();
  });

  it("delete non-existent memory returns false", async () => {
    const alice = await createAgent("alice");
    const deleted = await store.deleteAgentMemory(alice.id, "global");
    expect(deleted).toBe(false);
  });

  // --- Project scope ---

  it("set/get project-scoped memory", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    await store.setAgentMemory(alice.id, "project", "Project notes", project.id);

    const fetched = await store.getAgentMemory(alice.id, "project", project.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.scope).toBe("project");
    expect(fetched!.scopeId).toBe(project.id);
    expect(fetched!.content).toBe("Project notes");
  });

  it("project memory is separate from global", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    await store.setAgentMemory(alice.id, "global", "Global notes");
    await store.setAgentMemory(alice.id, "project", "Project notes", project.id);

    const global = await store.getAgentMemory(alice.id, "global");
    const proj = await store.getAgentMemory(alice.id, "project", project.id);

    expect(global!.content).toBe("Global notes");
    expect(proj!.content).toBe("Project notes");
  });

  // --- Conversation scope ---

  it("set/get conversation-scoped memory", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupConversation(alice.id);

    await store.setAgentMemory(alice.id, "conversation", "Conv notes", conv.id);

    const fetched = await store.getAgentMemory(alice.id, "conversation", conv.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.scope).toBe("conversation");
    expect(fetched!.scopeId).toBe(conv.id);
    expect(fetched!.content).toBe("Conv notes");
  });

  // --- Privacy ---

  it("agent cannot see another agent's memory", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");

    await store.setAgentMemory(alice.id, "global", "Alice's secret");

    const fetched = await store.getAgentMemory(bob.id, "global");
    expect(fetched).toBeNull();
  });

  // --- Cleanup on unsubscribe ---

  it("unsubscribe deletes conversation-scoped memory", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupConversation(alice.id);

    await store.setAgentMemory(alice.id, "conversation", "Conv notes", conv.id);

    // Verify it exists
    let fetched = await store.getAgentMemory(alice.id, "conversation", conv.id);
    expect(fetched).not.toBeNull();

    // Unsubscribe
    await store.unsubscribe(conv.id, alice.id);

    // Conversation memory should be deleted
    fetched = await store.getAgentMemory(alice.id, "conversation", conv.id);
    expect(fetched).toBeNull();
  });

  it("unsubscribe does not delete global or project memory", async () => {
    const alice = await createAgent("alice");
    const { project, conv } = await setupConversation(alice.id);

    await store.setAgentMemory(alice.id, "global", "Global notes");
    await store.setAgentMemory(alice.id, "project", "Project notes", project.id);
    await store.setAgentMemory(alice.id, "conversation", "Conv notes", conv.id);

    await store.unsubscribe(conv.id, alice.id);

    // Global and project should survive
    expect(await store.getAgentMemory(alice.id, "global")).not.toBeNull();
    expect(await store.getAgentMemory(alice.id, "project", project.id)).not.toBeNull();
    // Conversation should be deleted
    expect(await store.getAgentMemory(alice.id, "conversation", conv.id)).toBeNull();
  });

  // --- Multiple projects/conversations ---

  it("different projects have separate memory", async () => {
    const alice = await createAgent("alice");
    const p1 = await store.createProject({ name: "P1", createdBy: alice.id });
    const p2 = await store.createProject({ name: "P2", createdBy: alice.id });

    await store.setAgentMemory(alice.id, "project", "P1 notes", p1.id);
    await store.setAgentMemory(alice.id, "project", "P2 notes", p2.id);

    expect((await store.getAgentMemory(alice.id, "project", p1.id))!.content).toBe("P1 notes");
    expect((await store.getAgentMemory(alice.id, "project", p2.id))!.content).toBe("P2 notes");
  });
});

describe("SqliteStore — Structured Conversation Protocol", () => {
  it("sendMessage accepts proposal type", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupConversation(alice.id);

    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "I propose we use Redis",
      type: "proposal",
    });

    expect(msg.type).toBe("proposal");
  });

  it("sendMessage accepts decision type", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupConversation(alice.id);

    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Decision: we will use Redis",
      type: "decision",
    });

    expect(msg.type).toBe("decision");
  });
});
