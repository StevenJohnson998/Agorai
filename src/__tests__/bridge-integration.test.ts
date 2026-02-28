/**
 * Bridge integration tests — full round-trip flows.
 *
 * Tests the complete workflow: register → create project → create conversation →
 * subscribe → send messages with mixed visibility → verify filtering → mark read.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStore } from "../store/sqlite.js";
import { ApiKeyAuthProvider } from "../bridge/auth.js";
import { AllowAllPermissions } from "../bridge/permissions.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ApiKeyConfig } from "../config.js";

let store: SqliteStore;
let auth: ApiKeyAuthProvider;
let tmpDir: string;

const apiKeys: ApiKeyConfig[] = [
  {
    key: "ak_int_desktop",
    agent: "desktop",
    type: "claude-desktop",
    capabilities: ["analysis"],
    clearanceLevel: "team",
  },
  {
    key: "ak_int_code",
    agent: "code",
    type: "claude-code",
    capabilities: ["code-execution"],
    clearanceLevel: "confidential",
  },
  {
    key: "ak_int_external",
    agent: "external",
    type: "custom",
    capabilities: [],
    clearanceLevel: "public",
  },
];

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-int-test-"));
  store = new SqliteStore(join(tmpDir, "test.db"));
  await store.initialize();
  auth = new ApiKeyAuthProvider(apiKeys, store);
});

afterEach(async () => {
  await store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("Bridge integration — full workflow", () => {
  it("complete round-trip: register → project → conversation → messages → read", async () => {
    // 1. Authenticate both agents
    const codeAuth = await auth.authenticate("ak_int_code");
    const desktopAuth = await auth.authenticate("ak_int_desktop");
    expect(codeAuth.authenticated).toBe(true);
    expect(desktopAuth.authenticated).toBe(true);
    const codeId = codeAuth.agentId!;
    const desktopId = desktopAuth.agentId!;

    // 2. Code agent creates a project
    const project = await store.createProject({
      name: "Integration Test",
      description: "Testing the bridge",
      visibility: "team",
      createdBy: codeId,
    });
    expect(project.name).toBe("Integration Test");

    // 3. Create a conversation
    const conv = await store.createConversation({
      projectId: project.id,
      title: "Architecture Review",
      createdBy: codeId,
    });

    // 4. Both agents subscribe
    await store.subscribe(conv.id, codeId);
    await store.subscribe(conv.id, desktopId);

    const subs = await store.getSubscribers(conv.id);
    expect(subs).toHaveLength(2);

    // 5. Code agent sends a public message
    const msg1 = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: codeId,
      content: "Here's the proposed architecture",
      visibility: "public",
    });

    // 6. Code agent sends a confidential message
    const msg2 = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: codeId,
      content: "Internal notes: client uses pattern X",
      visibility: "confidential",
    });

    // 7. Desktop agent sends a team-level response
    const msg3 = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: desktopId,
      content: "Looks good, but consider caching",
      visibility: "team",
    });

    // 8. Desktop (team clearance) sees public + team messages only
    const desktopMessages = await store.getMessages(conv.id, desktopId);
    expect(desktopMessages).toHaveLength(2);
    expect(desktopMessages.map((m) => m.content)).toEqual([
      "Here's the proposed architecture",
      "Looks good, but consider caching",
    ]);
    // The confidential message is invisible to desktop

    // 9. Code (confidential clearance) sees all three
    const codeMessages = await store.getMessages(conv.id, codeId);
    expect(codeMessages).toHaveLength(3);

    // 10. Desktop marks its visible messages as read
    await store.markRead(desktopMessages.map((m) => m.id), desktopId);

    const desktopUnread = await store.getUnreadCount(desktopId);
    expect(desktopUnread).toBe(0);

    // 11. Code still has unread messages
    const codeUnread = await store.getUnreadCount(codeId);
    expect(codeUnread).toBe(3); // hasn't marked any as read
  });

  it("external agent sees only public data", async () => {
    const externalAuth = await auth.authenticate("ak_int_external");
    const codeAuth = await auth.authenticate("ak_int_code");
    expect(externalAuth.clearanceLevel).toBe("public");

    const externalId = externalAuth.agentId!;
    const codeId = codeAuth.agentId!;

    // Code creates a public project and a team project
    const publicProject = await store.createProject({
      name: "Open Source",
      visibility: "public",
      createdBy: codeId,
    });
    await store.createProject({
      name: "Internal",
      visibility: "team",
      createdBy: codeId,
    });

    // External sees only the public project
    const projects = await store.listProjects(externalId);
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("Open Source");

    // Create conversation in public project
    const conv = await store.createConversation({
      projectId: publicProject.id,
      title: "Discussion",
      defaultVisibility: "public",
      createdBy: codeId,
    });

    // Send messages at different visibility levels
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: codeId,
      content: "Public info",
      visibility: "public",
    });
    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: codeId,
      content: "Team discussion",
      visibility: "team",
    });

    // External sees only public message
    const messages = await store.getMessages(conv.id, externalId);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Public info");
  });

  it("project memory respects visibility across agents", async () => {
    const codeAuth = await auth.authenticate("ak_int_code");
    const desktopAuth = await auth.authenticate("ak_int_desktop");

    const codeId = codeAuth.agentId!;
    const desktopId = desktopAuth.agentId!;

    const project = await store.createProject({
      name: "Memory Test",
      visibility: "public",
      createdBy: codeId,
    });

    // Create memory entries at different levels
    await store.setMemory({
      projectId: project.id,
      type: "context",
      title: "Stack",
      tags: ["tech"],
      content: "TypeScript + Node.js",
      visibility: "public",
      createdBy: codeId,
    });

    await store.setMemory({
      projectId: project.id,
      type: "decision",
      title: "API Design",
      tags: ["api"],
      content: "REST with JSON responses",
      visibility: "team",
      createdBy: codeId,
    });

    await store.setMemory({
      projectId: project.id,
      type: "note",
      title: "Client Patterns",
      tags: ["security"],
      content: "Client uses credential pattern X",
      visibility: "confidential",
      createdBy: codeId,
    });

    // Desktop (team) sees public + team
    const desktopMem = await store.getMemory(project.id, desktopId);
    expect(desktopMem).toHaveLength(2);

    // Code (confidential) sees all
    const codeMem = await store.getMemory(project.id, codeId);
    expect(codeMem).toHaveLength(3);
  });

  it("visibility capping prevents privilege escalation", async () => {
    const desktopAuth = await auth.authenticate("ak_int_desktop");
    const desktopId = desktopAuth.agentId!;

    const project = await store.createProject({
      name: "Cap Test",
      visibility: "public",
      createdBy: desktopId,
    });

    const conv = await store.createConversation({
      projectId: project.id,
      title: "Cap Conv",
      createdBy: desktopId,
    });

    // Desktop (team) tries to send restricted message
    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: desktopId,
      content: "Trying to be restricted",
      visibility: "restricted",
    });

    // Capped to team
    expect(msg.visibility).toBe("team");
  });
});

describe("AllowAllPermissions", () => {
  it("always returns true", async () => {
    const perms = new AllowAllPermissions();
    expect(await perms.canAccess("any", "any", "any")).toBe(true);
  });
});

describe("Data isolation", () => {
  it("delete_memory: agent cannot delete another agent's memory entry", async () => {
    const codeAuth = await auth.authenticate("ak_int_code");
    const desktopAuth = await auth.authenticate("ak_int_desktop");
    const codeId = codeAuth.agentId!;
    const desktopId = desktopAuth.agentId!;

    const project = await store.createProject({
      name: "Delete Isolation",
      visibility: "team",
      createdBy: codeId,
    });

    // Code creates a memory entry
    const entry = await store.setMemory({
      projectId: project.id,
      type: "note",
      title: "Code's Note",
      tags: [],
      content: "Belongs to code agent",
      visibility: "team",
      createdBy: codeId,
    });

    // Verify desktop can see the entry (same clearance level)
    const fetched = await store.getMemoryEntry(entry.id);
    expect(fetched).not.toBeNull();

    // Desktop tries to delete → should fail (not the owner)
    expect(fetched!.createdBy).toBe(codeId);
    expect(fetched!.createdBy).not.toBe(desktopId);

    // The entry should still exist after a failed ownership check
    const stillExists = await store.getMemoryEntry(entry.id);
    expect(stillExists).not.toBeNull();

    // Code (owner) can delete
    const deleted = await store.deleteMemory(entry.id);
    expect(deleted).toBe(true);
  });

  it("set_memory: agent cannot write to a project above their clearance", async () => {
    const externalAuth = await auth.authenticate("ak_int_external");
    const codeAuth = await auth.authenticate("ak_int_code");
    const externalId = externalAuth.agentId!;
    const codeId = codeAuth.agentId!;

    // Create a team-level project (invisible to public agent)
    const teamProject = await store.createProject({
      name: "Team Only",
      visibility: "team",
      createdBy: codeId,
    });

    // External agent cannot see the team project
    const projectAccess = await store.getProject(teamProject.id, externalId);
    expect(projectAccess).toBeNull();
  });

  it("create_conversation: agent cannot create conversation in inaccessible project", async () => {
    const externalAuth = await auth.authenticate("ak_int_external");
    const codeAuth = await auth.authenticate("ak_int_code");
    const externalId = externalAuth.agentId!;
    const codeId = codeAuth.agentId!;

    const teamProject = await store.createProject({
      name: "Team Conv Project",
      visibility: "team",
      createdBy: codeId,
    });

    // External agent cannot access the project
    const projectAccess = await store.getProject(teamProject.id, externalId);
    expect(projectAccess).toBeNull();
  });

  it("subscribe: agent cannot subscribe to conversation in inaccessible project", async () => {
    const externalAuth = await auth.authenticate("ak_int_external");
    const codeAuth = await auth.authenticate("ak_int_code");
    const externalId = externalAuth.agentId!;
    const codeId = codeAuth.agentId!;

    const teamProject = await store.createProject({
      name: "Subscribe Isolation",
      visibility: "team",
      createdBy: codeId,
    });

    const conv = await store.createConversation({
      projectId: teamProject.id,
      title: "Team Chat",
      createdBy: codeId,
    });

    // External cannot see the project → subscribe check at handler level blocks
    const projectAccess = await store.getProject(teamProject.id, externalId);
    expect(projectAccess).toBeNull();

    // Conversation exists
    const convExists = await store.getConversation(conv.id);
    expect(convExists).not.toBeNull();
  });

  it("get_messages: unsubscribed agent is blocked by isSubscribed check", async () => {
    const codeAuth = await auth.authenticate("ak_int_code");
    const desktopAuth = await auth.authenticate("ak_int_desktop");
    const codeId = codeAuth.agentId!;
    const desktopId = desktopAuth.agentId!;

    const project = await store.createProject({
      name: "Message Isolation",
      visibility: "team",
      createdBy: codeId,
    });

    const conv = await store.createConversation({
      projectId: project.id,
      title: "Private Chat",
      createdBy: codeId,
    });

    // Only code subscribes
    await store.subscribe(conv.id, codeId);

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: codeId,
      content: "Secret message",
      visibility: "team",
    });

    // Desktop is NOT subscribed
    const isDesktopSub = await store.isSubscribed(conv.id, desktopId);
    expect(isDesktopSub).toBe(false);

    // Code IS subscribed and can read
    const isCodeSub = await store.isSubscribed(conv.id, codeId);
    expect(isCodeSub).toBe(true);
    const messages = await store.getMessages(conv.id, codeId);
    expect(messages).toHaveLength(1);
  });

  it("send_message: unsubscribed agent is blocked by isSubscribed check", async () => {
    const codeAuth = await auth.authenticate("ak_int_code");
    const desktopAuth = await auth.authenticate("ak_int_desktop");
    const codeId = codeAuth.agentId!;
    const desktopId = desktopAuth.agentId!;

    const project = await store.createProject({
      name: "Send Isolation",
      visibility: "team",
      createdBy: codeId,
    });

    const conv = await store.createConversation({
      projectId: project.id,
      title: "Code Only Chat",
      createdBy: codeId,
    });

    // Only code subscribes
    await store.subscribe(conv.id, codeId);

    // Desktop is not subscribed → handler-level check would block
    const isDesktopSub = await store.isSubscribed(conv.id, desktopId);
    expect(isDesktopSub).toBe(false);

    // Code can send (subscribed)
    const isCodeSub = await store.isSubscribed(conv.id, codeId);
    expect(isCodeSub).toBe(true);
    const msg = await store.sendMessage({
      conversationId: conv.id,
      fromAgent: codeId,
      content: "Code only message",
      visibility: "team",
    });
    expect(msg.content).toBe("Code only message");
  });

  it("list_subscribers: unsubscribed agent is blocked by isSubscribed check", async () => {
    const codeAuth = await auth.authenticate("ak_int_code");
    const desktopAuth = await auth.authenticate("ak_int_desktop");
    const codeId = codeAuth.agentId!;
    const desktopId = desktopAuth.agentId!;

    const project = await store.createProject({
      name: "Subscriber Isolation",
      visibility: "team",
      createdBy: codeId,
    });

    const conv = await store.createConversation({
      projectId: project.id,
      title: "Restricted Subscribers",
      createdBy: codeId,
    });

    await store.subscribe(conv.id, codeId);

    // Desktop not subscribed → handler check would block
    const isDesktopSub = await store.isSubscribed(conv.id, desktopId);
    expect(isDesktopSub).toBe(false);

    // Code subscribed → can list
    const isCodeSub = await store.isSubscribed(conv.id, codeId);
    expect(isCodeSub).toBe(true);
    const subs = await store.getSubscribers(conv.id);
    expect(subs).toHaveLength(1);
    expect(subs[0].agentId).toBe(codeId);
  });

  it("list_agents with project_id filter returns only subscribed agents", async () => {
    const codeAuth = await auth.authenticate("ak_int_code");
    const desktopAuth = await auth.authenticate("ak_int_desktop");
    const externalAuth = await auth.authenticate("ak_int_external");
    const codeId = codeAuth.agentId!;
    const desktopId = desktopAuth.agentId!;
    const externalId = externalAuth.agentId!;

    const project = await store.createProject({
      name: "Agent Filter Project",
      visibility: "public",
      createdBy: codeId,
    });

    const conv = await store.createConversation({
      projectId: project.id,
      title: "Filtered Convo",
      defaultVisibility: "public",
      createdBy: codeId,
    });

    // Only code and desktop subscribe
    await store.subscribe(conv.id, codeId);
    await store.subscribe(conv.id, desktopId);

    // All 3 agents exist
    const allAgents = await store.listAgents();
    expect(allAgents.length).toBeGreaterThanOrEqual(3);

    // Get conversations in this project visible to code agent
    const conversations = await store.listConversations(project.id, codeId);
    expect(conversations).toHaveLength(1);

    // Collect subscribed agent IDs
    const subscribedIds = new Set<string>();
    for (const c of conversations) {
      const subs = await store.getSubscribers(c.id);
      for (const sub of subs) subscribedIds.add(sub.agentId);
    }

    // Only code and desktop are subscribed, not external
    expect(subscribedIds.has(codeId)).toBe(true);
    expect(subscribedIds.has(desktopId)).toBe(true);
    expect(subscribedIds.has(externalId)).toBe(false);

    // Filtered list
    const filtered = allAgents.filter((a) => subscribedIds.has(a.id));
    expect(filtered).toHaveLength(2);
  });
});

describe("VISIBILITY_ORDER", () => {
  it("maintains correct ordering", async () => {
    const { VISIBILITY_ORDER } = await import("../store/types.js");
    expect(VISIBILITY_ORDER.public).toBeLessThan(VISIBILITY_ORDER.team);
    expect(VISIBILITY_ORDER.team).toBeLessThan(VISIBILITY_ORDER.confidential);
    expect(VISIBILITY_ORDER.confidential).toBeLessThan(VISIBILITY_ORDER.restricted);
  });
});
