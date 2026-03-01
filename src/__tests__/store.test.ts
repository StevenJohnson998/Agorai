/**
 * SQLite store tests — CRUD + visibility filtering.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStore } from "../store/sqlite.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let store: SqliteStore;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-test-"));
  store = new SqliteStore(join(tmpDir, "test.db"));
  await store.initialize();
});

afterEach(async () => {
  await store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// --- Helper ---

async function createAgent(name: string, clearance: "public" | "team" | "confidential" | "restricted" = "team") {
  return store.registerAgent({
    name,
    type: "test",
    capabilities: ["testing"],
    clearanceLevel: clearance,
    apiKeyHash: `hash_${name}`,
  });
}

describe("SqliteStore — Agents", () => {
  it("registers a new agent", async () => {
    const agent = await createAgent("alice");
    expect(agent.name).toBe("alice");
    expect(agent.type).toBe("test");
    expect(agent.clearanceLevel).toBe("team");
    expect(agent.id).toBeTruthy();
  });

  it("updates existing agent on re-register", async () => {
    const first = await createAgent("bob");
    const second = await store.registerAgent({
      name: "bob",
      type: "updated",
      capabilities: ["new-cap"],
      clearanceLevel: "confidential",
      apiKeyHash: "hash_bob_v2",
    });
    expect(second.id).toBe(first.id);
    expect(second.type).toBe("updated");
    expect(second.clearanceLevel).toBe("confidential");
  });

  it("finds agent by API key hash", async () => {
    await createAgent("carol");
    const found = await store.getAgentByApiKey("hash_carol");
    expect(found).not.toBeNull();
    expect(found!.name).toBe("carol");
  });

  it("returns null for unknown API key", async () => {
    const found = await store.getAgentByApiKey("nonexistent");
    expect(found).toBeNull();
  });

  it("lists all agents", async () => {
    await createAgent("a1");
    await createAgent("a2");
    const agents = await store.listAgents();
    expect(agents).toHaveLength(2);
  });

  it("removes an agent", async () => {
    const agent = await createAgent("doomed");
    const removed = await store.removeAgent(agent.id);
    expect(removed).toBe(true);
    const found = await store.getAgent(agent.id);
    expect(found).toBeNull();
  });

  it("updates lastSeenAt", async () => {
    const agent = await createAgent("seen");
    const before = agent.lastSeenAt;
    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 10));
    await store.updateAgentLastSeen(agent.id);
    const updated = await store.getAgent(agent.id);
    expect(updated!.lastSeenAt >= before).toBe(true);
  });
});

describe("SqliteStore — Projects", () => {
  it("creates a project with defaults", async () => {
    const agent = await createAgent("creator");
    const project = await store.createProject({
      name: "Test Project",
      createdBy: agent.id,
    });
    expect(project.name).toBe("Test Project");
    expect(project.visibility).toBe("team");
  });

  it("lists projects filtered by agent clearance", async () => {
    const teamAgent = await createAgent("team-agent", "team");
    const confAgent = await createAgent("conf-agent", "confidential");

    await store.createProject({ name: "Public Proj", visibility: "public", createdBy: teamAgent.id });
    await store.createProject({ name: "Team Proj", visibility: "team", createdBy: teamAgent.id });
    await store.createProject({ name: "Conf Proj", visibility: "confidential", createdBy: confAgent.id });

    const teamView = await store.listProjects(teamAgent.id);
    expect(teamView).toHaveLength(2); // public + team

    const confView = await store.listProjects(confAgent.id);
    expect(confView).toHaveLength(3); // all three
  });

  it("getProject respects visibility", async () => {
    const publicAgent = await createAgent("pub", "public");
    const teamAgent = await createAgent("team", "team");

    const project = await store.createProject({
      name: "Team Only",
      visibility: "team",
      createdBy: teamAgent.id,
    });

    const found = await store.getProject(project.id, teamAgent.id);
    expect(found).not.toBeNull();

    const hidden = await store.getProject(project.id, publicAgent.id);
    expect(hidden).toBeNull();
  });
});

describe("SqliteStore — Memory", () => {
  it("creates and retrieves memory entries", async () => {
    const agent = await createAgent("mem-agent");
    const project = await store.createProject({ name: "MemProj", createdBy: agent.id });

    const entry = await store.setMemory({
      projectId: project.id,
      type: "decision",
      title: "Use PostgreSQL",
      tags: ["db", "infrastructure"],
      content: "We decided to use PostgreSQL for persistence.",
      createdBy: agent.id,
    });

    expect(entry.title).toBe("Use PostgreSQL");
    expect(entry.tags).toEqual(["db", "infrastructure"]);

    const retrieved = await store.getMemory(project.id, agent.id);
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].id).toBe(entry.id);
  });

  it("filters memory by visibility", async () => {
    const teamAgent = await createAgent("team-mem", "team");
    const confAgent = await createAgent("conf-mem", "confidential");
    const project = await store.createProject({ name: "MemVis", createdBy: confAgent.id });

    await store.setMemory({
      projectId: project.id,
      type: "note",
      title: "Public Note",
      tags: [],
      content: "...",
      visibility: "public",
      createdBy: confAgent.id,
    });

    await store.setMemory({
      projectId: project.id,
      type: "note",
      title: "Confidential Note",
      tags: [],
      content: "secret stuff",
      visibility: "confidential",
      createdBy: confAgent.id,
    });

    const teamView = await store.getMemory(project.id, teamAgent.id);
    expect(teamView).toHaveLength(1);
    expect(teamView[0].title).toBe("Public Note");

    const confView = await store.getMemory(project.id, confAgent.id);
    expect(confView).toHaveLength(2);
  });

  it("filters by type and tags", async () => {
    const agent = await createAgent("filter-agent");
    const project = await store.createProject({ name: "FilterProj", createdBy: agent.id });

    await store.setMemory({ projectId: project.id, type: "decision", title: "D1", tags: ["api"], content: "...", createdBy: agent.id });
    await store.setMemory({ projectId: project.id, type: "note", title: "N1", tags: ["api"], content: "...", createdBy: agent.id });
    await store.setMemory({ projectId: project.id, type: "decision", title: "D2", tags: ["db"], content: "...", createdBy: agent.id });

    const decisions = await store.getMemory(project.id, agent.id, { type: "decision" });
    expect(decisions).toHaveLength(2);

    const apiTagged = await store.getMemory(project.id, agent.id, { tags: ["api"] });
    expect(apiTagged).toHaveLength(2);
  });

  it("limit applies after visibility filter, not before", async () => {
    const teamAgent = await createAgent("limit-team", "team");
    const confAgent = await createAgent("limit-conf", "confidential");
    const project = await store.createProject({ name: "LimitProj", createdBy: confAgent.id });

    // Create 3 confidential + 3 team entries
    for (let i = 0; i < 3; i++) {
      await store.setMemory({ projectId: project.id, type: "note", title: `conf-${i}`, tags: [], content: "...", visibility: "confidential", createdBy: confAgent.id });
      await store.setMemory({ projectId: project.id, type: "note", title: `team-${i}`, tags: [], content: "...", visibility: "team", createdBy: confAgent.id });
    }

    // Team agent with limit 3 should get 3 team entries (not 3 random from the 6)
    const teamView = await store.getMemory(project.id, teamAgent.id, { limit: 3 });
    expect(teamView).toHaveLength(3);
    expect(teamView.every((e) => e.visibility === "team")).toBe(true);
  });

  it("deletes memory entries", async () => {
    const agent = await createAgent("del-agent");
    const project = await store.createProject({ name: "DelProj", createdBy: agent.id });

    const entry = await store.setMemory({
      projectId: project.id,
      type: "note",
      title: "Deletable",
      tags: [],
      content: "...",
      createdBy: agent.id,
    });

    const deleted = await store.deleteMemory(entry.id);
    expect(deleted).toBe(true);

    const remaining = await store.getMemory(project.id, agent.id);
    expect(remaining).toHaveLength(0);
  });
});

describe("SqliteStore — Conversations & Messages", () => {
  it("creates conversation and subscribes creator", async () => {
    const agent = await createAgent("conv-agent");
    const project = await store.createProject({ name: "ConvProj", createdBy: agent.id });

    const conv = await store.createConversation({
      projectId: project.id,
      title: "Architecture Discussion",
      createdBy: agent.id,
    });

    expect(conv.title).toBe("Architecture Discussion");
    expect(conv.status).toBe("active");
  });

  it("subscribe and unsubscribe", async () => {
    const agent = await createAgent("sub-agent");
    const project = await store.createProject({ name: "SubProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "Test", createdBy: agent.id });

    await store.subscribe(conv.id, agent.id);
    let subs = await store.getSubscribers(conv.id);
    expect(subs).toHaveLength(1);

    await store.unsubscribe(conv.id, agent.id);
    subs = await store.getSubscribers(conv.id);
    expect(subs).toHaveLength(0);
  });

  it("sends and retrieves messages", async () => {
    const agent = await createAgent("msg-agent");
    const project = await store.createProject({ name: "MsgProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "Chat", createdBy: agent.id });

    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent.id,
      content: "Hello world",
    });

    expect(msg.content).toBe("Hello world");
    expect(msg.type).toBe("message");
    expect(msg.visibility).toBe("team");

    const messages = await store.getMessages(conv.id, agent.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(msg.id);
  });

  it("filters messages by visibility", async () => {
    const teamAgent = await createAgent("team-msg", "team");
    const confAgent = await createAgent("conf-msg", "confidential");
    const project = await store.createProject({ name: "VisMsgProj", createdBy: confAgent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "Mixed", createdBy: confAgent.id });

    await store.sendMessage({ conversationId: conv.id, fromAgent: confAgent.id, content: "public msg", visibility: "public" });
    await store.sendMessage({ conversationId: conv.id, fromAgent: confAgent.id, content: "team msg", visibility: "team" });
    await store.sendMessage({ conversationId: conv.id, fromAgent: confAgent.id, content: "conf msg", visibility: "confidential" });

    const teamView = await store.getMessages(conv.id, teamAgent.id);
    expect(teamView).toHaveLength(2); // public + team

    const confView = await store.getMessages(conv.id, confAgent.id);
    expect(confView).toHaveLength(3); // all three
  });

  it("caps message visibility at sender clearance", async () => {
    const teamAgent = await createAgent("team-sender", "team");
    const confAgent = await createAgent("conf-reader", "confidential");
    const project = await store.createProject({ name: "CapProj", createdBy: confAgent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "CapTest", createdBy: confAgent.id });

    // Team agent tries to send as confidential — should be capped to team
    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: teamAgent.id,
      content: "I tried to be confidential",
      visibility: "confidential",
    });

    expect(msg.visibility).toBe("team");
  });

  it("marks messages as read", async () => {
    const agent = await createAgent("read-agent");
    const project = await store.createProject({ name: "ReadProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "ReadTest", createdBy: agent.id });
    await store.subscribe(conv.id, agent.id);

    const msg1 = await store.sendMessage({ conversationId: conv.id, fromAgent: agent.id, content: "msg1" });
    await store.sendMessage({ conversationId: conv.id, fromAgent: agent.id, content: "msg2" });

    let unread = await store.getUnreadCount(agent.id);
    expect(unread).toBe(2);

    await store.markRead([msg1.id], agent.id);

    unread = await store.getUnreadCount(agent.id);
    expect(unread).toBe(1);
  });

  it("gets unread messages only", async () => {
    const agent = await createAgent("unread-agent");
    const project = await store.createProject({ name: "UnreadProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "UnreadTest", createdBy: agent.id });

    const msg1 = await store.sendMessage({ conversationId: conv.id, fromAgent: agent.id, content: "read me" });
    await store.sendMessage({ conversationId: conv.id, fromAgent: agent.id, content: "unread" });

    await store.markRead([msg1.id], agent.id);

    const unreadMessages = await store.getMessages(conv.id, agent.id, { unreadOnly: true });
    expect(unreadMessages).toHaveLength(1);
    expect(unreadMessages[0].content).toBe("unread");
  });

  it("filters messages by since timestamp", async () => {
    const agent = await createAgent("since-agent");
    const project = await store.createProject({ name: "SinceProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "SinceTest", createdBy: agent.id });

    await store.sendMessage({ conversationId: conv.id, fromAgent: agent.id, content: "old message" });
    const cutoff = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 10));
    await store.sendMessage({ conversationId: conv.id, fromAgent: agent.id, content: "new message" });

    const sinceMessages = await store.getMessages(conv.id, agent.id, { since: cutoff });
    expect(sinceMessages).toHaveLength(1);
    expect(sinceMessages[0].content).toBe("new message");
  });

  it("lists conversations filtered by visibility", async () => {
    const teamAgent = await createAgent("conv-team", "team");
    const confAgent = await createAgent("conv-conf", "confidential");
    const project = await store.createProject({ name: "ConvVisProj", visibility: "public", createdBy: confAgent.id });

    await store.createConversation({ projectId: project.id, title: "Public Conv", defaultVisibility: "public", createdBy: confAgent.id });
    await store.createConversation({ projectId: project.id, title: "Team Conv", defaultVisibility: "team", createdBy: confAgent.id });
    await store.createConversation({ projectId: project.id, title: "Conf Conv", defaultVisibility: "confidential", createdBy: confAgent.id });

    const teamConvs = await store.listConversations(project.id, teamAgent.id);
    expect(teamConvs).toHaveLength(2); // public + team

    const confConvs = await store.listConversations(project.id, confAgent.id);
    expect(confConvs).toHaveLength(3);
  });

  it("message limit applies after visibility filter", async () => {
    const teamAgent = await createAgent("mlimit-team", "team");
    const confAgent = await createAgent("mlimit-conf", "confidential");
    const project = await store.createProject({ name: "MLimitProj", createdBy: confAgent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "MLimitChat", createdBy: confAgent.id });

    // Send 3 confidential + 3 team messages
    for (let i = 0; i < 3; i++) {
      await store.sendMessage({ conversationId: conv.id, fromAgent: confAgent.id, content: `conf-${i}`, visibility: "confidential" });
      await store.sendMessage({ conversationId: conv.id, fromAgent: confAgent.id, content: `team-${i}`, visibility: "team" });
    }

    // Team agent with limit 2 should get 2 (from the 3 visible), not 2 from first 2 rows
    const teamView = await store.getMessages(conv.id, teamAgent.id, { limit: 2 });
    expect(teamView).toHaveLength(2);
    expect(teamView.every((m) => m.visibility === "team")).toBe(true);
  });

  it("handles message metadata (agentMetadata + bridgeMetadata)", async () => {
    const agent = await createAgent("meta-agent");
    const project = await store.createProject({ name: "MetaProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "MetaTest", createdBy: agent.id });

    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent.id,
      content: "with metadata",
      metadata: { key: "value", nested: { a: 1 } },
    });

    // agentMetadata should contain the cleaned metadata
    expect(msg.agentMetadata).toEqual({ key: "value", nested: { a: 1 } });
    // bridgeMetadata should be present
    expect(msg.bridgeMetadata).not.toBeNull();
    expect(msg.bridgeMetadata!.visibility).toBe("team");
    expect(msg.bridgeMetadata!.senderClearance).toBe("team");
    expect(msg.bridgeMetadata!.visibilityCapped).toBe(false);
    expect(msg.bridgeMetadata!.timestamp).toBeTruthy();

    const retrieved = await store.getMessages(conv.id, agent.id);
    expect(retrieved[0].agentMetadata).toEqual({ key: "value", nested: { a: 1 } });
    expect(retrieved[0].bridgeMetadata).not.toBeNull();
  });
});

describe("SqliteStore — Bridge Metadata", () => {
  it("generates bridgeMetadata on normal send", async () => {
    const agent = await createAgent("bridge-agent", "confidential");
    const project = await store.createProject({ name: "BridgeProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "BridgeTest", createdBy: agent.id });

    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent.id,
      content: "hello",
      visibility: "team",
    });

    expect(msg.bridgeMetadata).not.toBeNull();
    expect(msg.bridgeMetadata!.visibility).toBe("team");
    expect(msg.bridgeMetadata!.senderClearance).toBe("confidential");
    expect(msg.bridgeMetadata!.visibilityCapped).toBe(false);
    expect(msg.bridgeMetadata!.originalVisibility).toBeUndefined();
    expect(msg.bridgeMetadata!.instructions).toBeDefined();
    expect(msg.bridgeMetadata!.instructions.mode).toBe("normal");
  });

  it("sets visibilityCapped and originalVisibility when capped", async () => {
    const teamAgent = await createAgent("team-cap", "team");
    const confAgent = await createAgent("conf-cap", "confidential");
    const project = await store.createProject({ name: "CapBridgeProj", createdBy: confAgent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "CapBridgeTest", createdBy: confAgent.id });

    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: teamAgent.id,
      content: "trying confidential",
      visibility: "confidential",
    });

    expect(msg.visibility).toBe("team");
    expect(msg.bridgeMetadata!.visibilityCapped).toBe(true);
    expect(msg.bridgeMetadata!.originalVisibility).toBe("confidential");
    expect(msg.bridgeMetadata!.visibility).toBe("team");
  });

  it("agentMetadata round-trip (send → get by sender)", async () => {
    const agent = await createAgent("round-trip", "team");
    const project = await store.createProject({ name: "RoundTripProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "RoundTrip", createdBy: agent.id });

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent.id,
      content: "with meta",
      metadata: { cost: 0.05, model: "gpt-4", tokens: 1234 },
    });

    const messages = await store.getMessages(conv.id, agent.id);
    expect(messages[0].agentMetadata).toEqual({ cost: 0.05, model: "gpt-4", tokens: 1234 });
  });

  it("strips _bridge keys from agent metadata (anti-forge)", async () => {
    const agent = await createAgent("forge-agent", "team");
    const project = await store.createProject({ name: "ForgeProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "ForgeTest", createdBy: agent.id });

    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent.id,
      content: "forged",
      metadata: {
        _bridgeAdmin: true,
        bridgeMetadata: { fake: true },
        bridge_metadata: "injected",
        legit: "data",
      },
    });

    // Only legit key should survive
    expect(msg.agentMetadata).toEqual({ legit: "data" });
    expect(msg.metadata).toEqual({ legit: "data" });
    // bridgeMetadata should be the real one from the bridge
    expect(msg.bridgeMetadata!.senderClearance).toBe("team");
  });

  it("handles null metadata gracefully", async () => {
    const agent = await createAgent("null-meta", "team");
    const project = await store.createProject({ name: "NullMetaProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "NullMeta", createdBy: agent.id });

    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent.id,
      content: "no meta",
    });

    expect(msg.agentMetadata).toBeNull();
    expect(msg.metadata).toBeNull();
    expect(msg.bridgeMetadata).not.toBeNull();
    expect(msg.bridgeMetadata!.visibility).toBe("team");
  });

  it("strips all _bridge keys resulting in null agentMetadata", async () => {
    const agent = await createAgent("all-bridge", "team");
    const project = await store.createProject({ name: "AllBridgeProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "AllBridge", createdBy: agent.id });

    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent.id,
      content: "only bridge keys",
      metadata: { _bridgeFoo: 1, bridgeMetadata: { x: 1 } },
    });

    expect(msg.agentMetadata).toBeNull();
    expect(msg.metadata).toBeNull();
  });
});

describe("SqliteStore — Project Confidentiality Mode", () => {
  it("defaults to normal mode", async () => {
    const agent = await createAgent("conf-default");
    const project = await store.createProject({ name: "DefaultModeProj", createdBy: agent.id });

    expect(project.confidentialityMode).toBe("normal");
  });

  it("creates project with specified mode", async () => {
    const agent = await createAgent("conf-strict");
    const project = await store.createProject({
      name: "StrictProj",
      confidentialityMode: "strict",
      createdBy: agent.id,
    });

    expect(project.confidentialityMode).toBe("strict");
  });

  it("retrieves project with confidentialityMode", async () => {
    const agent = await createAgent("conf-retrieve");
    const project = await store.createProject({
      name: "FlexProj",
      confidentialityMode: "flexible",
      createdBy: agent.id,
    });

    const retrieved = await store.getProject(project.id, agent.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.confidentialityMode).toBe("flexible");
  });

  it("includes project mode in bridge instructions", async () => {
    const agent = await createAgent("conf-instruct", "team");
    const project = await store.createProject({
      name: "StrictInstrProj",
      confidentialityMode: "strict",
      createdBy: agent.id,
    });
    const conv = await store.createConversation({ projectId: project.id, title: "StrictChat", createdBy: agent.id });

    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent.id,
      content: "strict mode test",
    });

    expect(msg.bridgeMetadata!.instructions.mode).toBe("strict");
    expect(msg.bridgeMetadata!.instructions.confidentiality).toContain("bridge enforces");
  });

  it("flexible mode has correct instructions", async () => {
    const agent = await createAgent("conf-flex-instr", "team");
    const project = await store.createProject({
      name: "FlexInstrProj",
      confidentialityMode: "flexible",
      createdBy: agent.id,
    });
    const conv = await store.createConversation({ projectId: project.id, title: "FlexChat", createdBy: agent.id });

    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: agent.id,
      content: "flex mode test",
    });

    expect(msg.bridgeMetadata!.instructions.mode).toBe("flexible");
    expect(msg.bridgeMetadata!.instructions.confidentiality).toContain("any visibility level");
  });
});

describe("SqliteStore — High-Water Marks", () => {
  it("tracks high-water mark on getMessages", async () => {
    const agent = await createAgent("hwm-agent", "confidential");
    const project = await store.createProject({ name: "HWMProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "HWMTest", createdBy: agent.id });

    await store.sendMessage({ conversationId: conv.id, fromAgent: agent.id, content: "team msg", visibility: "team" });

    // Reading should trigger high-water mark tracking
    await store.getMessages(conv.id, agent.id);

    const hwm = await store.getHighWaterMark(agent.id, project.id);
    expect(hwm).not.toBeNull();
    expect(hwm!.maxVisibility).toBe("team");
  });

  it("increases high-water mark but never decreases", async () => {
    const agent = await createAgent("hwm-increase", "restricted");
    const project = await store.createProject({ name: "HWMIncProj", createdBy: agent.id });
    const conv = await store.createConversation({ projectId: project.id, title: "HWMInc", createdBy: agent.id });

    // First: read team messages
    await store.sendMessage({ conversationId: conv.id, fromAgent: agent.id, content: "team", visibility: "team" });
    await store.getMessages(conv.id, agent.id);
    let hwm = await store.getHighWaterMark(agent.id, project.id);
    expect(hwm!.maxVisibility).toBe("team");

    // Second: read confidential messages — should increase
    await store.sendMessage({ conversationId: conv.id, fromAgent: agent.id, content: "conf", visibility: "confidential" });
    await store.getMessages(conv.id, agent.id);
    hwm = await store.getHighWaterMark(agent.id, project.id);
    expect(hwm!.maxVisibility).toBe("confidential");

    // Third: read only public messages — should NOT decrease
    const conv2 = await store.createConversation({ projectId: project.id, title: "HWMInc2", createdBy: agent.id });
    await store.sendMessage({ conversationId: conv2.id, fromAgent: agent.id, content: "pub", visibility: "public" });
    await store.getMessages(conv2.id, agent.id);
    hwm = await store.getHighWaterMark(agent.id, project.id);
    expect(hwm!.maxVisibility).toBe("confidential"); // still confidential
  });

  it("returns null for unknown agent/project", async () => {
    const hwm = await store.getHighWaterMark("nonexistent", "nonexistent");
    expect(hwm).toBeNull();
  });

  it("tracks per-project independently", async () => {
    const agent = await createAgent("hwm-multi", "restricted");
    const proj1 = await store.createProject({ name: "HWMProj1", createdBy: agent.id });
    const proj2 = await store.createProject({ name: "HWMProj2", createdBy: agent.id });
    const conv1 = await store.createConversation({ projectId: proj1.id, title: "C1", createdBy: agent.id });
    const conv2 = await store.createConversation({ projectId: proj2.id, title: "C2", createdBy: agent.id });

    await store.sendMessage({ conversationId: conv1.id, fromAgent: agent.id, content: "conf", visibility: "confidential" });
    await store.sendMessage({ conversationId: conv2.id, fromAgent: agent.id, content: "pub", visibility: "public" });

    await store.getMessages(conv1.id, agent.id);
    await store.getMessages(conv2.id, agent.id);

    const hwm1 = await store.getHighWaterMark(agent.id, proj1.id);
    const hwm2 = await store.getHighWaterMark(agent.id, proj2.id);

    expect(hwm1!.maxVisibility).toBe("confidential");
    expect(hwm2!.maxVisibility).toBe("public");
  });
});
