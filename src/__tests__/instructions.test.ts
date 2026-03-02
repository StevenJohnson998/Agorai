/**
 * Instruction Matrix tests — scope × selector, creator-only writes, runtime matching.
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
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-instructions-test-"));
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

async function setupConversation(agentId: string) {
  const project = await store.createProject({ name: "TestProject", createdBy: agentId });
  const conv = await store.createConversation({ projectId: project.id, title: "Test", createdBy: agentId });
  await store.subscribe(conv.id, agentId);
  return { project, conv };
}

describe("SqliteStore — Instructions", () => {
  // --- Basic CRUD ---

  it("set and list project-scoped instruction", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    const instr = await store.setInstruction({
      scope: "project",
      scopeId: project.id,
      content: "Always respond in French",
      createdBy: alice.id,
    });

    expect(instr.scope).toBe("project");
    expect(instr.scopeId).toBe(project.id);
    expect(instr.selector).toBeNull();
    expect(instr.content).toBe("Always respond in French");
    expect(instr.createdBy).toBe(alice.id);
    expect(instr.id).toBeDefined();

    const list = await store.listInstructions("project", project.id);
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe("Always respond in French");
  });

  it("set and list conversation-scoped instruction", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupConversation(alice.id);

    await store.setInstruction({
      scope: "conversation",
      scopeId: conv.id,
      content: "This is a code review conversation",
      createdBy: alice.id,
    });

    const list = await store.listInstructions("conversation", conv.id);
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe("This is a code review conversation");
  });

  it("upsert: same scope + selector overwrites content", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    await store.setInstruction({
      scope: "project",
      scopeId: project.id,
      content: "Version 1",
      createdBy: alice.id,
    });

    await store.setInstruction({
      scope: "project",
      scopeId: project.id,
      content: "Version 2",
      createdBy: alice.id,
    });

    const list = await store.listInstructions("project", project.id);
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe("Version 2");
  });

  it("different selectors create separate instructions", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    await store.setInstruction({
      scope: "project",
      scopeId: project.id,
      content: "General instructions",
      createdBy: alice.id,
    });

    await store.setInstruction({
      scope: "project",
      scopeId: project.id,
      selector: { type: "claude-code" },
      content: "Claude Code specific instructions",
      createdBy: alice.id,
    });

    await store.setInstruction({
      scope: "project",
      scopeId: project.id,
      selector: { capability: "code-execution" },
      content: "Code execution instructions",
      createdBy: alice.id,
    });

    const list = await store.listInstructions("project", project.id);
    expect(list).toHaveLength(3);
  });

  it("delete instruction by creator", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    const instr = await store.setInstruction({
      scope: "project",
      scopeId: project.id,
      content: "To be deleted",
      createdBy: alice.id,
    });

    const deleted = await store.deleteInstruction(instr.id, alice.id);
    expect(deleted).toBe(true);

    const list = await store.listInstructions("project", project.id);
    expect(list).toHaveLength(0);
  });

  it("delete instruction fails for non-creator", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { project } = await setupConversation(alice.id);

    const instr = await store.setInstruction({
      scope: "project",
      scopeId: project.id,
      content: "Alice's instruction",
      createdBy: alice.id,
    });

    const deleted = await store.deleteInstruction(instr.id, bob.id);
    expect(deleted).toBe(false);

    const list = await store.listInstructions("project", project.id);
    expect(list).toHaveLength(1);
  });

  // --- Runtime matching ---

  it("getMatchingInstructions returns instructions matching agent type", async () => {
    const alice = await createAgent("alice", "claude-code");
    const { project, conv } = await setupConversation(alice.id);

    // General instruction (applies to all)
    await store.setInstruction({
      scope: "project",
      scopeId: project.id,
      content: "General for all",
      createdBy: alice.id,
    });

    // Type-specific instruction for claude-code
    await store.setInstruction({
      scope: "project",
      scopeId: project.id,
      selector: { type: "claude-code" },
      content: "For Claude Code only",
      createdBy: alice.id,
    });

    // Type-specific instruction for ollama (should NOT match)
    await store.setInstruction({
      scope: "project",
      scopeId: project.id,
      selector: { type: "ollama" },
      content: "For Ollama only",
      createdBy: alice.id,
    });

    const matched = await store.getMatchingInstructions(
      { type: "claude-code", capabilities: [] },
      conv.id,
    );

    expect(matched).toHaveLength(2);
    expect(matched.map((m) => m.content)).toContain("General for all");
    expect(matched.map((m) => m.content)).toContain("For Claude Code only");
    expect(matched.map((m) => m.content)).not.toContain("For Ollama only");
  });

  it("getMatchingInstructions returns instructions matching agent capability", async () => {
    const alice = await createAgent("alice", "test", ["code-execution", "review"]);
    const { project, conv } = await setupConversation(alice.id);

    await store.setInstruction({
      scope: "project",
      scopeId: project.id,
      selector: { capability: "code-execution" },
      content: "For code executors",
      createdBy: alice.id,
    });

    await store.setInstruction({
      scope: "project",
      scopeId: project.id,
      selector: { capability: "analysis" },
      content: "For analysts",
      createdBy: alice.id,
    });

    const matched = await store.getMatchingInstructions(
      { type: "test", capabilities: ["code-execution", "review"] },
      conv.id,
    );

    expect(matched).toHaveLength(1);
    expect(matched[0].content).toBe("For code executors");
  });

  it("getMatchingInstructions cascades bridge + project + conversation scopes", async () => {
    const alice = await createAgent("alice");
    const { project, conv } = await setupConversation(alice.id);

    // Bridge-level
    await store.setInstruction({
      scope: "bridge",
      content: "Bridge-wide instruction",
      createdBy: alice.id,
    });

    // Project-level
    await store.setInstruction({
      scope: "project",
      scopeId: project.id,
      content: "Project instruction",
      createdBy: alice.id,
    });

    // Conversation-level
    await store.setInstruction({
      scope: "conversation",
      scopeId: conv.id,
      content: "Conversation instruction",
      createdBy: alice.id,
    });

    const matched = await store.getMatchingInstructions(
      { type: "test", capabilities: [] },
      conv.id,
    );

    expect(matched).toHaveLength(3);
    // Order: bridge → project → conversation
    expect(matched[0].content).toBe("Bridge-wide instruction");
    expect(matched[1].content).toBe("Project instruction");
    expect(matched[2].content).toBe("Conversation instruction");
  });

  it("getMatchingInstructions returns empty for unknown conversation", async () => {
    const matched = await store.getMatchingInstructions(
      { type: "test", capabilities: [] },
      "nonexistent",
    );
    expect(matched).toHaveLength(0);
  });

  it("selector matching is case-insensitive", async () => {
    const alice = await createAgent("alice", "Claude-Code", ["Code-Execution"]);
    const { project, conv } = await setupConversation(alice.id);

    await store.setInstruction({
      scope: "project",
      scopeId: project.id,
      selector: { type: "claude-code" },
      content: "Matched by type (case-insensitive)",
      createdBy: alice.id,
    });

    await store.setInstruction({
      scope: "project",
      scopeId: project.id,
      selector: { capability: "code-execution" },
      content: "Matched by capability (case-insensitive)",
      createdBy: alice.id,
    });

    const matched = await store.getMatchingInstructions(
      { type: "Claude-Code", capabilities: ["Code-Execution"] },
      conv.id,
    );

    expect(matched).toHaveLength(2);
  });

  // --- Scope isolation ---

  it("instructions from different projects are separate", async () => {
    const alice = await createAgent("alice");
    const p1 = await store.createProject({ name: "P1", createdBy: alice.id });
    const p2 = await store.createProject({ name: "P2", createdBy: alice.id });

    await store.setInstruction({
      scope: "project",
      scopeId: p1.id,
      content: "P1 instruction",
      createdBy: alice.id,
    });

    await store.setInstruction({
      scope: "project",
      scopeId: p2.id,
      content: "P2 instruction",
      createdBy: alice.id,
    });

    const list1 = await store.listInstructions("project", p1.id);
    const list2 = await store.listInstructions("project", p2.id);

    expect(list1).toHaveLength(1);
    expect(list1[0].content).toBe("P1 instruction");
    expect(list2).toHaveLength(1);
    expect(list2[0].content).toBe("P2 instruction");
  });

  it("list bridge-level instructions", async () => {
    const alice = await createAgent("alice");

    await store.setInstruction({
      scope: "bridge",
      content: "Bridge instruction",
      createdBy: alice.id,
    });

    const list = await store.listInstructions("bridge");
    expect(list).toHaveLength(1);
    expect(list[0].scope).toBe("bridge");
    expect(list[0].scopeId).toBeNull();
    expect(list[0].content).toBe("Bridge instruction");
  });
});
