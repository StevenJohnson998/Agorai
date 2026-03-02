/**
 * Task tests — store-level CRUD, atomic claiming, auto-release, permissions, event bus.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStore } from "../store/sqlite.js";
import { StoreEventBus, type TaskCreatedEvent, type TaskUpdatedEvent } from "../store/events.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let store: SqliteStore;
let eventBus: StoreEventBus;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-task-test-"));
  eventBus = new StoreEventBus();
  store = new SqliteStore(join(tmpDir, "test.db"), eventBus);
  await store.initialize();
});

afterEach(async () => {
  await store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function createAgent(name: string, clearance: "public" | "team" | "confidential" | "restricted" = "team") {
  return store.registerAgent({
    name,
    type: "test",
    capabilities: ["testing"],
    clearanceLevel: clearance,
    apiKeyHash: `hash_${name}`,
  });
}

async function createAgentWithCaps(name: string, capabilities: string[]) {
  return store.registerAgent({
    name,
    type: "test",
    capabilities,
    clearanceLevel: "team",
    apiKeyHash: `hash_${name}`,
  });
}

async function createProject(agentId: string) {
  return store.createProject({ name: "TestProject", createdBy: agentId });
}

describe("SqliteStore — Tasks", () => {
  it("createTask creates a task with correct defaults", async () => {
    const alice = await createAgent("alice");
    const project = await createProject(alice.id);

    const task = await store.createTask({
      projectId: project.id,
      title: "Implement feature X",
      createdBy: alice.id,
    });

    expect(task.id).toBeTruthy();
    expect(task.projectId).toBe(project.id);
    expect(task.conversationId).toBeNull();
    expect(task.title).toBe("Implement feature X");
    expect(task.description).toBeNull();
    expect(task.status).toBe("open");
    expect(task.requiredCapabilities).toEqual([]);
    expect(task.createdBy).toBe(alice.id);
    expect(task.claimedBy).toBeNull();
    expect(task.claimedAt).toBeNull();
    expect(task.completedAt).toBeNull();
    expect(task.result).toBeNull();
    expect(task.createdAt).toBeTruthy();
    expect(task.updatedAt).toBeTruthy();
  });

  it("createTask with all fields populated", async () => {
    const alice = await createAgent("alice");
    const project = await createProject(alice.id);
    const conv = await store.createConversation({
      projectId: project.id,
      title: "TaskConv",
      createdBy: alice.id,
    });

    const task = await store.createTask({
      projectId: project.id,
      conversationId: conv.id,
      title: "Review PR #42",
      description: "Review and approve the pull request",
      requiredCapabilities: ["code-review", "testing"],
      createdBy: alice.id,
    });

    expect(task.conversationId).toBe(conv.id);
    expect(task.title).toBe("Review PR #42");
    expect(task.description).toBe("Review and approve the pull request");
    expect(task.requiredCapabilities).toEqual(["code-review", "testing"]);
  });

  it("getTask returns null for unknown ID", async () => {
    const task = await store.getTask("nonexistent");
    expect(task).toBeNull();
  });

  it("getTask returns a task by ID", async () => {
    const alice = await createAgent("alice");
    const project = await createProject(alice.id);
    const created = await store.createTask({
      projectId: project.id,
      title: "Test task",
      createdBy: alice.id,
    });

    const fetched = await store.getTask(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.title).toBe("Test task");
  });

  it("listTasks returns tasks for project", async () => {
    const alice = await createAgent("alice");
    const project = await createProject(alice.id);

    await store.createTask({ projectId: project.id, title: "Task 1", createdBy: alice.id });
    await store.createTask({ projectId: project.id, title: "Task 2", createdBy: alice.id });

    const tasks = await store.listTasks(project.id, alice.id);
    expect(tasks).toHaveLength(2);
  });

  it("listTasks filters by status", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await createProject(alice.id);

    const task1 = await store.createTask({ projectId: project.id, title: "Open task", createdBy: alice.id });
    const task2 = await store.createTask({ projectId: project.id, title: "To claim", createdBy: alice.id });
    await store.claimTask(task2.id, bob.id);

    const openTasks = await store.listTasks(project.id, alice.id, { status: "open" });
    expect(openTasks).toHaveLength(1);
    expect(openTasks[0].id).toBe(task1.id);

    const claimedTasks = await store.listTasks(project.id, alice.id, { status: "claimed" });
    expect(claimedTasks).toHaveLength(1);
    expect(claimedTasks[0].id).toBe(task2.id);
  });

  it("listTasks filters by capability", async () => {
    const alice = await createAgent("alice");
    const project = await createProject(alice.id);

    await store.createTask({
      projectId: project.id,
      title: "Code review task",
      requiredCapabilities: ["code-review"],
      createdBy: alice.id,
    });
    await store.createTask({
      projectId: project.id,
      title: "Testing task",
      requiredCapabilities: ["testing"],
      createdBy: alice.id,
    });

    const reviewTasks = await store.listTasks(project.id, alice.id, { capability: "code-review" });
    expect(reviewTasks).toHaveLength(1);
    expect(reviewTasks[0].title).toBe("Code review task");
  });

  it("listTasks filters by claimedBy", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await createProject(alice.id);

    const task1 = await store.createTask({ projectId: project.id, title: "Task 1", createdBy: alice.id });
    await store.createTask({ projectId: project.id, title: "Task 2", createdBy: alice.id });
    await store.claimTask(task1.id, bob.id);

    const bobsTasks = await store.listTasks(project.id, alice.id, { claimedBy: bob.id });
    expect(bobsTasks).toHaveLength(1);
    expect(bobsTasks[0].id).toBe(task1.id);
  });

  it("claimTask claims an open task atomically", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await createProject(alice.id);
    const task = await store.createTask({ projectId: project.id, title: "Claimable", createdBy: alice.id });

    const claimed = await store.claimTask(task.id, bob.id);
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe("claimed");
    expect(claimed!.claimedBy).toBe(bob.id);
    expect(claimed!.claimedAt).toBeTruthy();
  });

  it("claimTask returns null for already-claimed task (race condition protection)", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const carol = await createAgent("carol");
    const project = await createProject(alice.id);
    const task = await store.createTask({ projectId: project.id, title: "Race", createdBy: alice.id });

    const first = await store.claimTask(task.id, bob.id);
    const second = await store.claimTask(task.id, carol.id);

    expect(first).not.toBeNull();
    expect(first!.claimedBy).toBe(bob.id);
    expect(second).toBeNull();
  });

  it("completeTask completes a claimed task with result", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await createProject(alice.id);
    const task = await store.createTask({ projectId: project.id, title: "Complete me", createdBy: alice.id });
    await store.claimTask(task.id, bob.id);

    const completed = await store.completeTask(task.id, bob.id, "Done — all tests pass");
    expect(completed).not.toBeNull();
    expect(completed!.status).toBe("completed");
    expect(completed!.completedAt).toBeTruthy();
    expect(completed!.result).toBe("Done — all tests pass");
  });

  it("completeTask fails if not the claimer", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const carol = await createAgent("carol");
    const project = await createProject(alice.id);
    const task = await store.createTask({ projectId: project.id, title: "Wrong claimer", createdBy: alice.id });
    await store.claimTask(task.id, bob.id);

    const result = await store.completeTask(task.id, carol.id, "Nope");
    expect(result).toBeNull();
  });

  it("releaseTask returns task to open", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await createProject(alice.id);
    const task = await store.createTask({ projectId: project.id, title: "Release me", createdBy: alice.id });
    await store.claimTask(task.id, bob.id);

    const released = await store.releaseTask(task.id, bob.id);
    expect(released).not.toBeNull();
    expect(released!.status).toBe("open");
    expect(released!.claimedBy).toBeNull();
    expect(released!.claimedAt).toBeNull();
  });

  it("releaseTask allowed by creator (not just claimer)", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await createProject(alice.id);
    const task = await store.createTask({ projectId: project.id, title: "Creator release", createdBy: alice.id });
    await store.claimTask(task.id, bob.id);

    // Alice (creator) releases Bob's claim
    const released = await store.releaseTask(task.id, alice.id);
    expect(released).not.toBeNull();
    expect(released!.status).toBe("open");
  });

  it("updateTask updates title and description by creator", async () => {
    const alice = await createAgent("alice");
    const project = await createProject(alice.id);
    const task = await store.createTask({
      projectId: project.id,
      title: "Original",
      description: "Old desc",
      createdBy: alice.id,
    });

    const updated = await store.updateTask(task.id, alice.id, {
      title: "Updated title",
      description: "New description",
    });

    expect(updated).not.toBeNull();
    expect(updated!.title).toBe("Updated title");
    expect(updated!.description).toBe("New description");
  });

  it("updateTask fails for non-creator", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await createProject(alice.id);
    const task = await store.createTask({ projectId: project.id, title: "No update", createdBy: alice.id });

    const result = await store.updateTask(task.id, bob.id, { title: "Hacked" });
    expect(result).toBeNull();
  });

  it("updateTask can cancel a task", async () => {
    const alice = await createAgent("alice");
    const project = await createProject(alice.id);
    const task = await store.createTask({ projectId: project.id, title: "Cancel me", createdBy: alice.id });

    const cancelled = await store.updateTask(task.id, alice.id, { status: "cancelled" });
    expect(cancelled).not.toBeNull();
    expect(cancelled!.status).toBe("cancelled");
  });

  it("auto-release: stale claims released on listTasks", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await createProject(alice.id);
    const task = await store.createTask({ projectId: project.id, title: "Stale claim", createdBy: alice.id });
    await store.claimTask(task.id, bob.id);

    // Simulate stale agent by setting last_seen_at to 10 minutes ago
    const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    // Access the internal db to manipulate last_seen_at directly
    (store as any).db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(staleTime, bob.id);

    // listTasks triggers releaseStaleTaskClaims
    const tasks = await store.listTasks(project.id, alice.id);
    const staleTask = tasks.find((t) => t.id === task.id);
    expect(staleTask).not.toBeUndefined();
    expect(staleTask!.status).toBe("open");
    expect(staleTask!.claimedBy).toBeNull();
  });

  it("listTasks returns empty for inaccessible project", async () => {
    const alice = await createAgent("alice", "public");
    const bob = await createAgent("bob");
    // Bob creates a team-visibility project — alice with public clearance can't see it
    const project = await createProject(bob.id);

    const tasks = await store.listTasks(project.id, alice.id);
    expect(tasks).toEqual([]);
  });
});

describe("StoreEventBus — Tasks", () => {
  it("emits task:created when createTask is called", async () => {
    const alice = await createAgent("alice");
    const project = await createProject(alice.id);

    const received: TaskCreatedEvent[] = [];
    eventBus.onTaskCreated((event) => received.push(event));

    const task = await store.createTask({ projectId: project.id, title: "Event test", createdBy: alice.id });

    expect(received).toHaveLength(1);
    expect(received[0].task.id).toBe(task.id);
  });

  it("emits task:updated with 'claimed' action on claimTask", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await createProject(alice.id);
    const task = await store.createTask({ projectId: project.id, title: "Claim event", createdBy: alice.id });

    const received: TaskUpdatedEvent[] = [];
    eventBus.onTaskUpdated((event) => received.push(event));

    await store.claimTask(task.id, bob.id);

    expect(received).toHaveLength(1);
    expect(received[0].action).toBe("claimed");
    expect(received[0].task.claimedBy).toBe(bob.id);
  });

  it("emits task:updated with 'completed' action on completeTask", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const project = await createProject(alice.id);
    const task = await store.createTask({ projectId: project.id, title: "Complete event", createdBy: alice.id });
    await store.claimTask(task.id, bob.id);

    const received: TaskUpdatedEvent[] = [];
    eventBus.onTaskUpdated((event) => received.push(event));

    await store.completeTask(task.id, bob.id, "Result");

    expect(received).toHaveLength(1);
    expect(received[0].action).toBe("completed");
  });

  it("emits task:updated with 'cancelled' action on updateTask cancel", async () => {
    const alice = await createAgent("alice");
    const project = await createProject(alice.id);
    const task = await store.createTask({ projectId: project.id, title: "Cancel event", createdBy: alice.id });

    const received: TaskUpdatedEvent[] = [];
    eventBus.onTaskUpdated((event) => received.push(event));

    await store.updateTask(task.id, alice.id, { status: "cancelled" });

    expect(received).toHaveLength(1);
    expect(received[0].action).toBe("cancelled");
  });
});
