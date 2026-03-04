/**
 * Agent Context tests — buildBridgeRules, renderForMcpInstructions,
 * renderForPrompt, buildAgentContext.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStore } from "../store/sqlite.js";
import {
  buildBridgeRules,
  renderForMcpInstructions,
  renderForPrompt,
  buildAgentContext,
  type AgentContext,
  type BridgeRules,
} from "../agent/context.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let store: SqliteStore;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-context-test-"));
  store = new SqliteStore(join(tmpDir, "test.db"));
  await store.initialize();
});

afterEach(async () => {
  await store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// buildBridgeRules
// ---------------------------------------------------------------------------

describe("buildBridgeRules", () => {
  it("returns all expected fields when all groups active", () => {
    const rules = buildBridgeRules(); // no args = all active
    expect(rules.messageTracking).toContain("mark_read");
    expect(rules.visibilityRules).toContain("public < team < confidential < restricted");
    expect(rules.metadataModel).toContain("bridgeMetadata");
    expect(rules.workflow).toContain("get_status");
    expect(rules.mentionRules).toContain("@agent-name");
    expect(rules.accessRequestRules).toContain("access request");
    expect(rules.skillsRules).toContain("progressive disclosure");
    expect(rules.attachmentRules).toContain("upload_attachment");
    expect(rules.delegationRules).toContain("Delegation protocol");
  });

  it("includes all sections when toolGroups contains 'all'", () => {
    const rules = buildBridgeRules(["all"]);
    expect(rules.accessRequestRules).toBeDefined();
    expect(rules.skillsRules).toBeDefined();
  });

  it("omits access/skills/attachment/delegation rules when only 'core' group active", () => {
    const rules = buildBridgeRules(["core"]);
    expect(rules.accessRequestRules).toBeUndefined();
    expect(rules.skillsRules).toBeUndefined();
    expect(rules.attachmentRules).toBeUndefined();
    expect(rules.delegationRules).toBeUndefined();
    // Core rules still present
    expect(rules.messageTracking).toContain("mark_read");
    expect(rules.visibilityRules).toContain("visibility");
  });

  it("includes access rules when access group present", () => {
    const rules = buildBridgeRules(["core", "access"]);
    expect(rules.accessRequestRules).toContain("access request");
    expect(rules.skillsRules).toBeUndefined();
  });

  it("includes skills rules when skills group present", () => {
    const rules = buildBridgeRules(["core", "skills"]);
    expect(rules.skillsRules).toContain("progressive disclosure");
    expect(rules.accessRequestRules).toBeUndefined();
  });

  it("includes attachment rules when attachments group present", () => {
    const rules = buildBridgeRules(["core", "attachments"]);
    expect(rules.attachmentRules).toContain("upload_attachment");
    expect(rules.delegationRules).toBeUndefined();
  });

  it("includes delegation rules when tasks group present", () => {
    const rules = buildBridgeRules(["core", "tasks"]);
    expect(rules.delegationRules).toContain("Delegation protocol");
    expect(rules.attachmentRules).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// renderForMcpInstructions — regression test
// ---------------------------------------------------------------------------

describe("renderForMcpInstructions", () => {
  /**
   * Build the original hardcoded instructions as they were in server.ts
   * before the context refactor. This serves as a regression reference.
   */
  function buildOriginalInstructions(activeGroupNames: string[]): string {
    const activeGroups = new Set(activeGroupNames);
    const instructionParts: string[] = [
      "You are connected to Agorai, a multi-agent collaboration bridge.",
      "",
      "IMPORTANT — Message read tracking:",
      "After you read messages with get_messages, you MUST call mark_read with the same conversation_id.",
      "This prevents you from seeing the same messages again on the next poll.",
      'Example: get_messages({conversation_id: "abc"}) → process messages → mark_read({conversation_id: "abc"})',
      "",
      "IMPORTANT — Visibility / confidentiality levels:",
      "Messages have a visibility level: public < team < confidential < restricted.",
      "When you send a message, set its visibility to the HIGHEST level among the messages you used as input.",
      "For example, if you read messages at 'team' and 'confidential' level, your reply MUST be 'confidential'.",
      "If unsure, default to the conversation's default visibility. Never downgrade confidentiality.",
      "",
      "IMPORTANT — Message metadata model:",
      "Messages have two metadata fields:",
      "- bridgeMetadata: trusted data injected by the bridge (visibility, capping info, confidentiality instructions). Always present. Read the 'instructions' field for guidance on how to handle confidentiality for this project.",
      "- agentMetadata: your private operational data (cost, model, tokens, etc.). Only visible to you — other agents cannot see it.",
      "When sending a message, pass any operational metadata in the 'metadata' field. Do NOT include keys starting with '_bridge'.",
      "",
      "Typical workflow:",
      "1. get_status — check for unread messages",
      "2. list_projects → list_conversations → subscribe to conversations you want to follow",
      "3. get_messages({conversation_id, unread_only: true}) — fetch new messages",
      "4. Process/respond with send_message (set visibility to max of input messages' visibility)",
      "5. mark_read({conversation_id}) — ALWAYS do this after reading, even if you don't reply",
      "",
      "IMPORTANT — @mentions and context:",
      "All subscribed agents see your messages by default — address the group, not individuals.",
      "Use @agent-name only to request input from a specific agent who hasn't been active, or to delegate a task.",
      "When you do, provide context — they may not have read the conversation history.",
    ];

    if (activeGroups.has("access")) {
      instructionParts.push(
        "",
        "IMPORTANT — Access requests:",
        "If you try to subscribe to a conversation you don't have access to, an access request is created automatically.",
        "Subscribers of that conversation can approve or deny your request via list_access_requests + respond_to_access_request.",
        "Check your request status with get_my_access_requests.",
      );
    }

    if (activeGroups.has("skills")) {
      instructionParts.push(
        "",
        "IMPORTANT — Skills system (progressive disclosure):",
        "Skills provide behavioral instructions and context. They use 3-tier progressive disclosure to save context:",
        "- Tier 1 (metadata): When you subscribe, you receive skill metadata (title, summary, instructions, tags) — NOT the full content.",
        "- Tier 2 (content): Call get_skill(skill_id) to load the full content of a skill you need.",
        "- Tier 3 (files): Call get_skill_file(skill_id, filename) to load supporting files attached to a skill.",
        "Only load tier 2/3 when you actually need the detail. The summary and instructions fields give you enough to decide.",
      );
    }

    if (activeGroups.has("attachments")) {
      instructionParts.push(
        "",
        "IMPORTANT — File attachments:",
        "Agents can share files (images, code, documents) via message attachments.",
        "Two-step workflow: (1) upload_attachment → get attachment ID, (2) send_message with attachment_ids to link them.",
        "To download: get_messages returns attachment metadata, then get_attachment to fetch content as base64.",
        "Attachments belong to a conversation. Only the creator can delete their attachments.",
      );
    }

    if (activeGroups.has("tasks")) {
      instructionParts.push(
        "",
        "IMPORTANT — Delegation protocol:",
        "To delegate work to another agent, use the task system (create_task with required_capabilities).",
        "For informal delegation in conversation, use message type 'proposal' with tag 'action-request'.",
        "When accepting delegated work, respond with type 'status' and tag 'action-accepted'.",
        "When reporting results, use type 'result' with tag 'action-result'.",
        "To decline, explain why in a regular message.",
      );
    }

    return instructionParts.join("\n");
  }

  it("matches original output with all groups", () => {
    const allGroups = ["core", "memory", "tasks", "skills", "access"];
    const original = buildOriginalInstructions(allGroups);
    const rules = buildBridgeRules(allGroups);
    const rendered = renderForMcpInstructions(rules);
    expect(rendered).toBe(original);
  });

  it("matches original output with core-only", () => {
    const original = buildOriginalInstructions(["core"]);
    const rules = buildBridgeRules(["core"]);
    const rendered = renderForMcpInstructions(rules);
    expect(rendered).toBe(original);
  });

  it("matches original output with access group", () => {
    const groups = ["core", "access"];
    const original = buildOriginalInstructions(groups);
    const rules = buildBridgeRules(groups);
    const rendered = renderForMcpInstructions(rules);
    expect(rendered).toBe(original);
  });

  it("matches original output with skills group", () => {
    const groups = ["core", "skills"];
    const original = buildOriginalInstructions(groups);
    const rules = buildBridgeRules(groups);
    const rendered = renderForMcpInstructions(rules);
    expect(rendered).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// renderForPrompt
// ---------------------------------------------------------------------------

describe("renderForPrompt", () => {
  function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
    return {
      identity: {
        agentId: "agent-1",
        agentName: "TestBot",
        agentType: "internal",
        clearanceLevel: "team",
      },
      bridgeRules: buildBridgeRules(),
      skills: [],
      projectMemory: [],
      agentMemory: {},
      ...overrides,
    };
  }

  it("includes identity in system prompt", () => {
    const ctx = makeContext();
    const { systemPrompt } = renderForPrompt(ctx, "active");
    expect(systemPrompt).toContain("You are TestBot");
    expect(systemPrompt).toContain("multi-agent conversation on Agorai");
  });

  it("includes passive mode instruction with [NO_RESPONSE]", () => {
    const ctx = makeContext();
    const { systemPrompt } = renderForPrompt(ctx, "passive");
    expect(systemPrompt).toContain("passive mode");
    expect(systemPrompt).toContain("[NO_RESPONSE]");
    expect(systemPrompt).toContain("@TestBot");
  });

  it("does not include passive instruction in active mode", () => {
    const ctx = makeContext();
    const { systemPrompt } = renderForPrompt(ctx, "active");
    expect(systemPrompt).not.toContain("passive mode");
    // Active mode uses [NO_RESPONSE] for "nothing to add" — but NOT the passive-mode instruction
    expect(systemPrompt).not.toContain("only respond when someone @mentions you");
  });

  it("includes bridge rules in system prompt", () => {
    const ctx = makeContext();
    const { systemPrompt } = renderForPrompt(ctx, "active");
    expect(systemPrompt).toContain("Bridge Rules");
    expect(systemPrompt).toContain("visibility");
    expect(systemPrompt).toContain("@mentions");
  });

  it("includes conversation context when present", () => {
    const ctx = makeContext({
      conversation: {
        conversationId: "conv-1",
        projectId: "proj-1",
        projectName: "My Project",
        confidentialityMode: "normal",
        defaultVisibility: "team",
        subscribers: [
          { name: "Alice", type: "claude-code", online: true },
          { name: "Bob", type: "internal", online: false },
        ],
      },
    });
    const { systemPrompt } = renderForPrompt(ctx, "active");
    expect(systemPrompt).toContain("My Project");
    expect(systemPrompt).toContain("normal mode");
    expect(systemPrompt).toContain("Alice");
    expect(systemPrompt).toContain("Bob");
  });

  it("includes skill instructions when present", () => {
    const ctx = makeContext({
      skills: [
        {
          id: "s1", title: "CodeReview", summary: "", instructions: "Always review diffs",
          scope: "bridge", scopeId: null, selector: null, agents: [], tags: [],
          files: [], createdBy: "x", createdAt: "", updatedAt: "",
        },
      ],
    });
    const { systemPrompt } = renderForPrompt(ctx, "active");
    expect(systemPrompt).toContain("Skills");
    expect(systemPrompt).toContain("[CodeReview]: Always review diffs");
  });

  it("includes project memory when present", () => {
    const ctx = makeContext({
      projectMemory: [
        {
          id: "m1", projectId: "p1", type: "note", title: "API Design",
          tags: [], priority: "normal", visibility: "team",
          content: "Use REST with JSON responses",
          createdBy: "x", createdAt: "", updatedAt: "",
        },
      ],
    });
    const { systemPrompt } = renderForPrompt(ctx, "active");
    expect(systemPrompt).toContain("Project Memory");
    expect(systemPrompt).toContain("[API Design]: Use REST with JSON responses");
  });

  it("includes agent memory when present", () => {
    const ctx = makeContext({
      agentMemory: {
        global: "I prefer concise responses",
        project: "This project uses TypeScript",
      },
    });
    const { systemPrompt } = renderForPrompt(ctx, "active");
    expect(systemPrompt).toContain("Your Memory");
    expect(systemPrompt).toContain("Global: I prefer concise responses");
    expect(systemPrompt).toContain("Project: This project uses TypeScript");
  });

  it("formats conversation messages correctly", () => {
    const agentNameMap = new Map([
      ["agent-1", "TestBot"],
      ["agent-2", "Alice"],
    ]);
    const ctx = makeContext({
      recentMessages: {
        messages: [
          {
            id: "msg-1", conversationId: "c1", fromAgent: "agent-2",
            type: "message", visibility: "team", content: "Hello!",
            tags: [], recipients: null, metadata: null,
            agentMetadata: null, bridgeMetadata: null, createdAt: "",
          },
          {
            id: "msg-2", conversationId: "c1", fromAgent: "agent-1",
            type: "message", visibility: "team", content: "Hi there!",
            tags: [], recipients: null, metadata: null,
            agentMetadata: null, bridgeMetadata: null, createdAt: "",
          },
        ],
        agentNameMap,
      },
    });
    const { conversationPrompt } = renderForPrompt(ctx, "active");
    expect(conversationPrompt).toContain("[Alice]: Hello!");
    expect(conversationPrompt).toContain("[you]: Hi there!");
  });

  it("includes convergence guideline when decisionDepth > 0 in active mode", () => {
    const ctx = makeContext({ decisionDepth: 5 });
    const { systemPrompt } = renderForPrompt(ctx, "active");
    expect(systemPrompt).toContain("maximum of 5 exchanges per topic");
  });

  it("omits convergence guideline when decisionDepth is 0", () => {
    const ctx = makeContext({ decisionDepth: 0 });
    const { systemPrompt } = renderForPrompt(ctx, "active");
    expect(systemPrompt).not.toContain("Aim to reach a conclusion");
  });

  it("omits convergence guideline when decisionDepth is undefined", () => {
    const ctx = makeContext();
    const { systemPrompt } = renderForPrompt(ctx, "active");
    expect(systemPrompt).not.toContain("Aim to reach a conclusion");
  });

  it("shows visibility tag for non-team messages", () => {
    const agentNameMap = new Map([["agent-2", "Alice"]]);
    const ctx = makeContext({
      recentMessages: {
        messages: [
          {
            id: "msg-1", conversationId: "c1", fromAgent: "agent-2",
            type: "message", visibility: "confidential", content: "Secret info",
            tags: [], recipients: null, metadata: null,
            agentMetadata: null, bridgeMetadata: null, createdAt: "",
          },
        ],
        agentNameMap,
      },
    });
    const { conversationPrompt } = renderForPrompt(ctx, "active");
    expect(conversationPrompt).toContain("[Alice] [confidential]: Secret info");
  });
});

// ---------------------------------------------------------------------------
// buildAgentContext — integration with real SqliteStore
// ---------------------------------------------------------------------------

describe("buildAgentContext", () => {
  it("populates identity from store", async () => {
    const agent = await store.registerAgent({
      name: "context-bot",
      type: "internal",
      capabilities: ["chat"],
      clearanceLevel: "team",
      apiKeyHash: "internal:context-bot",
    });

    const ctx = await buildAgentContext({
      store,
      agentId: agent.id,
    });

    expect(ctx.identity.agentName).toBe("context-bot");
    expect(ctx.identity.agentType).toBe("internal");
    expect(ctx.identity.clearanceLevel).toBe("team");
  });

  it("populates conversation context with subscribers", async () => {
    const creator = await store.registerAgent({
      name: "creator", type: "test", capabilities: [],
      clearanceLevel: "team", apiKeyHash: "hash-creator",
    });
    const bot = await store.registerAgent({
      name: "my-bot", type: "internal", capabilities: ["chat"],
      clearanceLevel: "team", apiKeyHash: "internal:my-bot",
    });

    const project = await store.createProject({
      name: "Test Project", createdBy: creator.id,
    });
    const conv = await store.createConversation({
      projectId: project.id, title: "Test Conv", createdBy: creator.id,
    });
    await store.subscribe(conv.id, creator.id);
    await store.subscribe(conv.id, bot.id);

    const ctx = await buildAgentContext({
      store,
      agentId: bot.id,
      conversationId: conv.id,
    });

    expect(ctx.conversation).toBeDefined();
    expect(ctx.conversation!.projectName).toBe("Test Project");
    expect(ctx.conversation!.subscribers.length).toBe(2);
    expect(ctx.conversation!.subscribers.map(s => s.name).sort()).toEqual(["creator", "my-bot"]);
  });

  it("includes matching skills", async () => {
    const agent = await store.registerAgent({
      name: "skill-bot", type: "internal", capabilities: ["code-review"],
      clearanceLevel: "team", apiKeyHash: "internal:skill-bot",
    });
    const project = await store.createProject({
      name: "P1", createdBy: agent.id,
    });
    const conv = await store.createConversation({
      projectId: project.id, title: "C1", createdBy: agent.id,
    });
    await store.subscribe(conv.id, agent.id);

    // Create a skill that targets this agent's capability
    await store.setSkill({
      scope: "bridge",
      title: "Code Review Guide",
      summary: "How to review code",
      instructions: "Check for bugs",
      content: "Full review guidelines...",
      selector: { capability: "code-review" },
      createdBy: agent.id,
    });

    const ctx = await buildAgentContext({
      store,
      agentId: agent.id,
      conversationId: conv.id,
    });

    expect(ctx.skills.length).toBe(1);
    expect(ctx.skills[0].title).toBe("Code Review Guide");
  });

  it("includes agent memory at all scopes", async () => {
    const agent = await store.registerAgent({
      name: "memory-bot", type: "internal", capabilities: [],
      clearanceLevel: "team", apiKeyHash: "internal:memory-bot",
    });
    const project = await store.createProject({
      name: "P1", createdBy: agent.id,
    });
    const conv = await store.createConversation({
      projectId: project.id, title: "C1", createdBy: agent.id,
    });
    await store.subscribe(conv.id, agent.id);

    await store.setAgentMemory(agent.id, "global", "I am a helpful assistant");
    await store.setAgentMemory(agent.id, "project", "This project uses TS", project.id);
    await store.setAgentMemory(agent.id, "conversation", "We discussed APIs", conv.id);

    const ctx = await buildAgentContext({
      store,
      agentId: agent.id,
      conversationId: conv.id,
    });

    expect(ctx.agentMemory.global).toBe("I am a helpful assistant");
    expect(ctx.agentMemory.project).toBe("This project uses TS");
    expect(ctx.agentMemory.conversation).toBe("We discussed APIs");
  });

  it("includes recent messages with agent name map", async () => {
    const alice = await store.registerAgent({
      name: "Alice", type: "claude-code", capabilities: [],
      clearanceLevel: "team", apiKeyHash: "hash-alice",
    });
    const bot = await store.registerAgent({
      name: "my-bot", type: "internal", capabilities: [],
      clearanceLevel: "team", apiKeyHash: "internal:my-bot",
    });

    const project = await store.createProject({
      name: "P1", createdBy: alice.id,
    });
    const conv = await store.createConversation({
      projectId: project.id, title: "C1", createdBy: alice.id,
    });
    await store.subscribe(conv.id, alice.id);
    await store.subscribe(conv.id, bot.id);

    await store.sendMessage({
      conversationId: conv.id,
      fromAgent: alice.id,
      content: "Hello bot!",
    });

    const ctx = await buildAgentContext({
      store,
      agentId: bot.id,
      conversationId: conv.id,
      includeMessages: true,
      messageLimit: 20,
    });

    expect(ctx.recentMessages).toBeDefined();
    expect(ctx.recentMessages!.messages.length).toBe(1);
    expect(ctx.recentMessages!.messages[0].content).toBe("Hello bot!");
    expect(ctx.recentMessages!.agentNameMap.get(alice.id)).toBe("Alice");
    expect(ctx.recentMessages!.agentNameMap.get(bot.id)).toBe("my-bot");
  });

  it("throws for non-existent agent", async () => {
    await expect(
      buildAgentContext({ store, agentId: "nonexistent" }),
    ).rejects.toThrow("Agent nonexistent not found");
  });
});
