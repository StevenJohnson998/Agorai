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

describe("VISIBILITY_ORDER", () => {
  it("maintains correct ordering", async () => {
    const { VISIBILITY_ORDER } = await import("../store/types.js");
    expect(VISIBILITY_ORDER.public).toBeLessThan(VISIBILITY_ORDER.team);
    expect(VISIBILITY_ORDER.team).toBeLessThan(VISIBILITY_ORDER.confidential);
    expect(VISIBILITY_ORDER.confidential).toBeLessThan(VISIBILITY_ORDER.restricted);
  });
});
