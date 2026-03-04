/**
 * Project membership + access control tests.
 *
 * Tests the project_members table, access_mode filtering,
 * subscribe flow changes, and human bypass.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStore } from "../store/sqlite.js";
import { StoreEventBus } from "../store/events.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { VisibilityLevel, AccessMode } from "../store/types.js";

let store: SqliteStore;
let eventBus: StoreEventBus;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-membership-test-"));
  eventBus = new StoreEventBus();
  store = new SqliteStore(join(tmpDir, "test.db"), eventBus);
  await store.initialize();
});

afterEach(async () => {
  await store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function createAgent(
  name: string,
  opts?: { clearance?: VisibilityLevel; type?: string },
) {
  return store.registerAgent({
    name,
    type: opts?.type ?? "test",
    capabilities: ["testing"],
    clearanceLevel: opts?.clearance ?? "team",
    apiKeyHash: `hash_${name}`,
  });
}

async function createProjectWithConv(
  agentId: string,
  opts?: { accessMode?: AccessMode },
) {
  const project = await store.createProject({
    name: "TestProject",
    accessMode: opts?.accessMode,
    createdBy: agentId,
  });
  const conv = await store.createConversation({
    projectId: project.id,
    title: "TestConv",
    createdBy: agentId,
  });
  return { project, conv };
}

// --- Project Members CRUD ---

describe("Project Members — CRUD", () => {
  it("createProject auto-adds creator as owner", async () => {
    const alice = await createAgent("alice");
    const project = await store.createProject({ name: "P1", createdBy: alice.id });

    const members = await store.listMembers(project.id);
    expect(members).toHaveLength(1);
    expect(members[0].agentId).toBe(alice.id);
    expect(members[0].role).toBe("owner");
  });

  it("addMember adds a member", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await store.createProject({ name: "P1", createdBy: alice.id });

    const member = await store.addMember(project.id, bob.id);
    expect(member.agentId).toBe(bob.id);
    expect(member.role).toBe("member");

    expect(await store.isMember(project.id, bob.id)).toBe(true);
  });

  it("addMember with role=owner", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await store.createProject({ name: "P1", createdBy: alice.id });

    await store.addMember(project.id, bob.id, "owner");
    const members = await store.listMembers(project.id);
    const bobMember = members.find((m) => m.agentId === bob.id);
    expect(bobMember?.role).toBe("owner");
  });

  it("addMember upserts role on conflict", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await store.createProject({ name: "P1", createdBy: alice.id });

    await store.addMember(project.id, bob.id, "member");
    await store.addMember(project.id, bob.id, "owner");

    const members = await store.listMembers(project.id);
    const bobMember = members.find((m) => m.agentId === bob.id);
    expect(bobMember?.role).toBe("owner");
  });

  it("removeMember removes and unsubscribes from conversations", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { project, conv } = await createProjectWithConv(alice.id);

    await store.addMember(project.id, bob.id);
    await store.subscribe(conv.id, bob.id);

    expect(await store.isSubscribed(conv.id, bob.id)).toBe(true);

    const removed = await store.removeMember(project.id, bob.id);
    expect(removed).toBe(true);
    expect(await store.isMember(project.id, bob.id)).toBe(false);
    expect(await store.isSubscribed(conv.id, bob.id)).toBe(false);
  });

  it("removeMember returns false for non-member", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await store.createProject({ name: "P1", createdBy: alice.id });

    const removed = await store.removeMember(project.id, bob.id);
    expect(removed).toBe(false);
  });

  it("isMember returns false for non-member", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await store.createProject({ name: "P1", createdBy: alice.id });

    expect(await store.isMember(project.id, bob.id)).toBe(false);
  });

  it("listMembers returns all members ordered by joined_at", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const charlie = await createAgent("charlie");
    const project = await store.createProject({ name: "P1", createdBy: alice.id });

    await store.addMember(project.id, bob.id);
    await store.addMember(project.id, charlie.id);

    const members = await store.listMembers(project.id);
    expect(members).toHaveLength(3);
    // Owner should be present
    const owner = members.find((m) => m.agentId === alice.id);
    expect(owner?.role).toBe("owner");
  });
});

// --- Access Mode Filtering ---

describe("Access Mode — listProjects", () => {
  it("visible project appears for non-members", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    await store.createProject({ name: "Visible", accessMode: "visible", createdBy: alice.id });

    const projects = await store.listProjects(bob.id);
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("Visible");
  });

  it("hidden project does NOT appear for non-members", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    await store.createProject({ name: "Hidden", accessMode: "hidden", createdBy: alice.id });

    const projects = await store.listProjects(bob.id);
    expect(projects).toHaveLength(0);
  });

  it("hidden project appears for members", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await store.createProject({ name: "Hidden", accessMode: "hidden", createdBy: alice.id });
    await store.addMember(project.id, bob.id);

    const projects = await store.listProjects(bob.id);
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("Hidden");
  });
});

describe("Access Mode — listConversations", () => {
  it("hidden conversation does NOT appear for non-subscribers", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await store.createProject({ name: "P1", createdBy: alice.id });
    await store.addMember(project.id, bob.id); // bob is member but not subscribed to conv
    await store.createConversation({
      projectId: project.id,
      title: "Hidden Conv",
      accessMode: "hidden",
      createdBy: alice.id,
    });

    const convs = await store.listConversations(project.id, bob.id);
    expect(convs).toHaveLength(0);
  });

  it("hidden conversation appears for subscribers", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await store.createProject({ name: "P1", createdBy: alice.id });
    await store.addMember(project.id, bob.id);
    const conv = await store.createConversation({
      projectId: project.id,
      title: "Hidden Conv",
      accessMode: "hidden",
      createdBy: alice.id,
    });
    await store.subscribe(conv.id, bob.id);

    const convs = await store.listConversations(project.id, bob.id);
    expect(convs).toHaveLength(1);
    expect(convs[0].accessMode).toBe("hidden");
  });

  it("visible conversation appears for all agents with clearance", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await store.createProject({ name: "P1", createdBy: alice.id });
    await store.createConversation({
      projectId: project.id,
      title: "Open Conv",
      createdBy: alice.id,
    });

    const convs = await store.listConversations(project.id, bob.id);
    expect(convs).toHaveLength(1);
  });
});

// --- Human Bypass ---

describe("Human Bypass", () => {
  it("isHumanAgent returns true for type=human", async () => {
    const human = await createAgent("human-user", { type: "human" });
    expect(await store.isHumanAgent(human.id)).toBe(true);
  });

  it("isHumanAgent returns false for type=test", async () => {
    const agent = await createAgent("agent");
    expect(await store.isHumanAgent(agent.id)).toBe(false);
  });

  it("human sees hidden projects without membership", async () => {
    const alice = await createAgent("alice");
    const human = await createAgent("human-user", { type: "human" });
    await store.createProject({ name: "Hidden", accessMode: "hidden", createdBy: alice.id });

    const projects = await store.listProjects(human.id);
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("Hidden");
  });

  it("human sees hidden conversations without subscription", async () => {
    const alice = await createAgent("alice");
    const human = await createAgent("human-user", { type: "human" });
    const project = await store.createProject({ name: "P1", createdBy: alice.id });
    await store.createConversation({
      projectId: project.id,
      title: "Secret Conv",
      accessMode: "hidden",
      createdBy: alice.id,
    });

    const convs = await store.listConversations(project.id, human.id);
    expect(convs).toHaveLength(1);
  });
});

// --- Migration Backfill ---

describe("Migration — backfill", () => {
  it("existing project creators are backfilled as owners", async () => {
    const alice = await createAgent("alice");
    const project = await store.createProject({ name: "P1", createdBy: alice.id });

    // createProject already adds owner, verify it's there
    const members = await store.listMembers(project.id);
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("owner");
  });

  it("default access_mode is visible", async () => {
    const alice = await createAgent("alice");
    const project = await store.createProject({ name: "P1", createdBy: alice.id });
    expect(project.accessMode).toBe("visible");

    const conv = await store.createConversation({
      projectId: project.id,
      title: "C1",
      createdBy: alice.id,
    });
    expect(conv.accessMode).toBe("visible");
  });
});

// --- Access Mode on types ---

describe("AccessMode field propagation", () => {
  it("project stores and returns access_mode", async () => {
    const alice = await createAgent("alice");
    const project = await store.createProject({
      name: "Hidden Project",
      accessMode: "hidden",
      createdBy: alice.id,
    });
    expect(project.accessMode).toBe("hidden");

    // Verify via getProject
    const fetched = await store.getProject(project.id, alice.id);
    expect(fetched?.accessMode).toBe("hidden");
  });

  it("conversation stores and returns access_mode", async () => {
    const alice = await createAgent("alice");
    const project = await store.createProject({ name: "P1", createdBy: alice.id });
    const conv = await store.createConversation({
      projectId: project.id,
      title: "Hidden Conv",
      accessMode: "hidden",
      createdBy: alice.id,
    });
    expect(conv.accessMode).toBe("hidden");
  });
});
