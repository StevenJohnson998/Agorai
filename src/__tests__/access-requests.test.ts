/**
 * Access request tests — store-level CRUD + event bus + handler behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SqliteStore } from "../store/sqlite.js";
import { StoreEventBus, type AccessRequestCreatedEvent } from "../store/events.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let store: SqliteStore;
let eventBus: StoreEventBus;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-access-test-"));
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

async function createProjectAndConversation(agentId: string) {
  const project = await store.createProject({ name: "TestProject", createdBy: agentId });
  const conv = await store.createConversation({ projectId: project.id, title: "TestConv", createdBy: agentId });
  return { project, conv };
}

describe("SqliteStore — Access Requests", () => {
  it("creates an access request with pending status", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await createProjectAndConversation(alice.id);

    const req = await store.createAccessRequest({
      conversationId: conv.id,
      agentId: bob.id,
      agentName: bob.name,
    });

    expect(req.status).toBe("pending");
    expect(req.conversationId).toBe(conv.id);
    expect(req.agentId).toBe(bob.id);
    expect(req.agentName).toBe("bob");
    expect(req.message).toBeNull();
    expect(req.respondedBy).toBeNull();
    expect(req.respondedAt).toBeNull();
    expect(req.id).toBeTruthy();
    expect(req.createdAt).toBeTruthy();
  });

  it("creates an access request with a message", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await createProjectAndConversation(alice.id);

    const req = await store.createAccessRequest({
      conversationId: conv.id,
      agentId: bob.id,
      agentName: bob.name,
      message: "I'd like to join the discussion",
    });

    expect(req.message).toBe("I'd like to join the discussion");
  });

  it("hasPendingAccessRequest returns true when pending", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await createProjectAndConversation(alice.id);

    expect(await store.hasPendingAccessRequest(conv.id, bob.id)).toBe(false);

    await store.createAccessRequest({
      conversationId: conv.id,
      agentId: bob.id,
      agentName: bob.name,
    });

    expect(await store.hasPendingAccessRequest(conv.id, bob.id)).toBe(true);
  });

  it("hasPendingAccessRequest returns false after response", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await createProjectAndConversation(alice.id);

    const req = await store.createAccessRequest({
      conversationId: conv.id,
      agentId: bob.id,
      agentName: bob.name,
    });

    await store.respondToAccessRequest(req.id, "denied", alice.id);
    expect(await store.hasPendingAccessRequest(conv.id, bob.id)).toBe(false);
  });

  it("listAccessRequestsForConversation returns pending requests", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const carol = await createAgent("carol");
    const { conv } = await createProjectAndConversation(alice.id);

    await store.createAccessRequest({ conversationId: conv.id, agentId: bob.id, agentName: bob.name });
    await store.createAccessRequest({ conversationId: conv.id, agentId: carol.id, agentName: carol.name });

    const requests = await store.listAccessRequestsForConversation(conv.id);
    expect(requests).toHaveLength(2);
    expect(requests.map((r) => r.agentName)).toEqual(["bob", "carol"]);
  });

  it("listAccessRequestsForConversation excludes non-pending", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const carol = await createAgent("carol");
    const { conv } = await createProjectAndConversation(alice.id);

    const req1 = await store.createAccessRequest({ conversationId: conv.id, agentId: bob.id, agentName: bob.name });
    await store.createAccessRequest({ conversationId: conv.id, agentId: carol.id, agentName: carol.name });

    await store.respondToAccessRequest(req1.id, "approved", alice.id);

    const requests = await store.listAccessRequestsForConversation(conv.id);
    expect(requests).toHaveLength(1);
    expect(requests[0].agentName).toBe("carol");
  });

  it("listAccessRequestsByAgent returns all requests for an agent", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await createProjectAndConversation(alice.id);
    const conv2 = await store.createConversation({ projectId: (await store.createProject({ name: "P2", createdBy: alice.id })).id, title: "Conv2", createdBy: alice.id });

    await store.createAccessRequest({ conversationId: conv.id, agentId: bob.id, agentName: bob.name });
    await store.createAccessRequest({ conversationId: conv2.id, agentId: bob.id, agentName: bob.name });

    const requests = await store.listAccessRequestsByAgent(bob.id);
    expect(requests).toHaveLength(2);
  });

  it("respondToAccessRequest with approve updates status", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await createProjectAndConversation(alice.id);

    const req = await store.createAccessRequest({ conversationId: conv.id, agentId: bob.id, agentName: bob.name });
    const updated = await store.respondToAccessRequest(req.id, "approved", alice.id);

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("approved");
    expect(updated!.respondedBy).toBe(alice.id);
    expect(updated!.respondedAt).toBeTruthy();
  });

  it("respondToAccessRequest with deny updates status", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await createProjectAndConversation(alice.id);

    const req = await store.createAccessRequest({ conversationId: conv.id, agentId: bob.id, agentName: bob.name });
    const updated = await store.respondToAccessRequest(req.id, "denied", alice.id);

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("denied");
  });

  it("respondToAccessRequest with silent_deny updates status", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await createProjectAndConversation(alice.id);

    const req = await store.createAccessRequest({ conversationId: conv.id, agentId: bob.id, agentName: bob.name });
    const updated = await store.respondToAccessRequest(req.id, "silent_denied", alice.id);

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("silent_denied");
  });

  it("respondToAccessRequest on already-responded returns null", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await createProjectAndConversation(alice.id);

    const req = await store.createAccessRequest({ conversationId: conv.id, agentId: bob.id, agentName: bob.name });
    await store.respondToAccessRequest(req.id, "approved", alice.id);

    const second = await store.respondToAccessRequest(req.id, "denied", alice.id);
    expect(second).toBeNull();
  });

  it("getAccessRequest retrieves by id", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await createProjectAndConversation(alice.id);

    const req = await store.createAccessRequest({ conversationId: conv.id, agentId: bob.id, agentName: bob.name });
    const fetched = await store.getAccessRequest(req.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(req.id);
    expect(fetched!.agentName).toBe("bob");
  });

  it("getAccessRequest returns null for unknown id", async () => {
    const fetched = await store.getAccessRequest("nonexistent");
    expect(fetched).toBeNull();
  });
});

describe("StoreEventBus — Access Requests", () => {
  it("emits access-request:created when createAccessRequest is called", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await createProjectAndConversation(alice.id);

    const received: AccessRequestCreatedEvent[] = [];
    eventBus.onAccessRequest((event) => received.push(event));

    const req = await store.createAccessRequest({ conversationId: conv.id, agentId: bob.id, agentName: bob.name });

    expect(received).toHaveLength(1);
    expect(received[0].accessRequest.id).toBe(req.id);
    expect(received[0].accessRequest.agentName).toBe("bob");
  });

  it("offAccessRequest stops receiving events", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await createProjectAndConversation(alice.id);

    const received: AccessRequestCreatedEvent[] = [];
    const listener = (event: AccessRequestCreatedEvent) => received.push(event);
    eventBus.onAccessRequest(listener);

    await store.createAccessRequest({ conversationId: conv.id, agentId: bob.id, agentName: bob.name });
    expect(received).toHaveLength(1);

    eventBus.offAccessRequest(listener);
    const carol = await createAgent("carol");
    await store.createAccessRequest({ conversationId: conv.id, agentId: carol.id, agentName: carol.name });
    expect(received).toHaveLength(1); // still 1
  });
});
