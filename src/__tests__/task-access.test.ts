/**
 * Task access control tests — visibility, membership, and cross-clearance isolation.
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
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-task-access-test-"));
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
  clearance: "public" | "team" | "confidential" | "restricted" = "team",
  capabilities: string[] = [],
) {
  return store.registerAgent({
    name,
    type: "test",
    capabilities,
    clearanceLevel: clearance,
    apiKeyHash: `hash_${name}`,
  });
}

describe("Task access control — clearance isolation", () => {
  it("public agent cannot list tasks in a team-visibility project", async () => {
    const owner = await createAgent("owner", "team");
    const outsider = await createAgent("outsider", "public");

    const project = await store.createProject({
      name: "Team Project",
      visibility: "team",
      createdBy: owner.id,
    });

    await store.createTask({
      projectId: project.id,
      title: "Secret task",
      createdBy: owner.id,
    });

    const tasks = await store.listTasks(project.id, outsider.id);
    expect(tasks).toEqual([]);
  });

  it("team agent can list tasks in a team-visibility project", async () => {
    const owner = await createAgent("owner", "team");
    const peer = await createAgent("peer", "team");

    const project = await store.createProject({
      name: "Team Project",
      visibility: "team",
      createdBy: owner.id,
    });

    await store.createTask({
      projectId: project.id,
      title: "Visible task",
      createdBy: owner.id,
    });

    const tasks = await store.listTasks(project.id, peer.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Visible task");
  });

  it("confidential project tasks invisible to team-clearance agent", async () => {
    const owner = await createAgent("owner", "confidential");
    const teamAgent = await createAgent("team-agent", "team");

    const project = await store.createProject({
      name: "Confidential Project",
      visibility: "confidential",
      createdBy: owner.id,
    });

    await store.createTask({
      projectId: project.id,
      title: "Confidential task",
      createdBy: owner.id,
    });

    const tasks = await store.listTasks(project.id, teamAgent.id);
    expect(tasks).toEqual([]);
  });
});

describe("Task access control — non-member isolation", () => {
  it("non-member of hidden project can still list tasks by ID (store level — handler must gate)", async () => {
    // NOTE: At the store level, getProject(id, agentId) does NOT enforce hidden-project membership.
    // Only listProjects() filters hidden projects for non-members.
    // The bridge handler must enforce membership before calling task operations.
    const owner = await createAgent("owner", "team");
    const outsider = await createAgent("outsider", "team");

    const project = await store.createProject({
      name: "Hidden Project",
      createdBy: owner.id,
      accessMode: "hidden",
    });

    await store.createTask({
      projectId: project.id,
      title: "Hidden task",
      createdBy: owner.id,
    });

    // Store-level: outsider can access by direct ID (same clearance)
    const tasks = await store.listTasks(project.id, outsider.id);
    expect(tasks).toHaveLength(1);

    // But outsider does NOT see it in listProjects
    const projects = await store.listProjects(outsider.id);
    const found = projects.find((p) => p.id === project.id);
    expect(found).toBeUndefined();
  });

  it("member of hidden project can list tasks", async () => {
    const owner = await createAgent("owner", "team");
    const member = await createAgent("member", "team");

    const project = await store.createProject({
      name: "Hidden Project",
      createdBy: owner.id,
      accessMode: "hidden",
    });

    await store.addMember(project.id, member.id, "member");

    await store.createTask({
      projectId: project.id,
      title: "Hidden but accessible task",
      createdBy: owner.id,
    });

    const tasks = await store.listTasks(project.id, member.id);
    expect(tasks).toHaveLength(1);
  });
});

describe("Task access control — permission boundaries", () => {
  it("non-creator cannot update a task", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");

    const project = await store.createProject({ name: "P", createdBy: alice.id });
    const task = await store.createTask({
      projectId: project.id,
      title: "Alice's task",
      createdBy: alice.id,
    });

    const result = await store.updateTask(task.id, bob.id, { title: "Hijacked" });
    expect(result).toBeNull();

    // Verify task unchanged
    const unchanged = await store.getTask(task.id);
    expect(unchanged!.title).toBe("Alice's task");
  });

  it("non-claimer cannot complete a task", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const carol = await createAgent("carol");

    const project = await store.createProject({ name: "P", createdBy: alice.id });
    const task = await store.createTask({
      projectId: project.id,
      title: "Bob's task",
      createdBy: alice.id,
    });
    await store.claimTask(task.id, bob.id);

    const result = await store.completeTask(task.id, carol.id, "Not mine");
    expect(result).toBeNull();

    // Task still claimed by bob
    const unchanged = await store.getTask(task.id);
    expect(unchanged!.status).toBe("claimed");
    expect(unchanged!.claimedBy).toBe(bob.id);
  });

  it("non-claimer non-creator cannot release a task", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const carol = await createAgent("carol");

    const project = await store.createProject({ name: "P", createdBy: alice.id });
    const task = await store.createTask({
      projectId: project.id,
      title: "Release test",
      createdBy: alice.id,
    });
    await store.claimTask(task.id, bob.id);

    const result = await store.releaseTask(task.id, carol.id);
    expect(result).toBeNull();

    // Task still claimed by bob
    const unchanged = await store.getTask(task.id);
    expect(unchanged!.claimedBy).toBe(bob.id);
  });

  it("cannot claim an already-claimed task", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const carol = await createAgent("carol");

    const project = await store.createProject({ name: "P", createdBy: alice.id });
    const task = await store.createTask({
      projectId: project.id,
      title: "Race condition",
      createdBy: alice.id,
    });

    const first = await store.claimTask(task.id, bob.id);
    const second = await store.claimTask(task.id, carol.id);

    expect(first).not.toBeNull();
    expect(first!.claimedBy).toBe(bob.id);
    expect(second).toBeNull();
  });
});
