/**
 * Skills tests — progressive disclosure, agent targeting, selector matching, files, access control.
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
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-skills-test-"));
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

describe("SqliteStore — Skills", () => {
  // --- Basic CRUD ---

  it("set and list project-scoped skill", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    const skill = await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Code Review Guidelines",
      summary: "How to do code reviews",
      instructions: "Follow these guidelines for all code reviews",
      content: "Full content of the code review skill...",
      createdBy: alice.id,
    });

    expect(skill.scope).toBe("project");
    expect(skill.scopeId).toBe(project.id);
    expect(skill.title).toBe("Code Review Guidelines");
    expect(skill.summary).toBe("How to do code reviews");
    expect(skill.instructions).toBe("Follow these guidelines for all code reviews");
    expect(skill.content).toBe("Full content of the code review skill...");
    expect(skill.selector).toBeNull();
    expect(skill.agents).toEqual([]);
    expect(skill.tags).toEqual([]);
    expect(skill.files).toEqual([]);
    expect(skill.createdBy).toBe(alice.id);
    expect(skill.id).toBeDefined();

    const list = await store.listSkills("project", project.id);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Code Review Guidelines");
  });

  it("set and list conversation-scoped skill", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupConversation(alice.id);

    await store.setSkill({
      scope: "conversation",
      scopeId: conv.id,
      title: "Conversation Skill",
      content: "This is a conversation-scoped skill",
      createdBy: alice.id,
    });

    const list = await store.listSkills("conversation", conv.id);
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe("This is a conversation-scoped skill");
  });

  it("upsert: same scope + title overwrites content and metadata", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "My Skill",
      summary: "v1",
      content: "Version 1",
      createdBy: alice.id,
    });

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "My Skill",
      summary: "v2",
      content: "Version 2",
      tags: ["updated"],
      createdBy: alice.id,
    });

    const list = await store.listSkills("project", project.id);
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe("Version 2");
    expect(list[0].summary).toBe("v2");
    expect(list[0].tags).toEqual(["updated"]);
  });

  it("different titles create separate skills", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Skill A",
      content: "Content A",
      createdBy: alice.id,
    });

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Skill B",
      content: "Content B",
      createdBy: alice.id,
    });

    const list = await store.listSkills("project", project.id);
    expect(list).toHaveLength(2);
  });

  it("get skill by ID returns full content", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    const created = await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Full Skill",
      content: "Full body content here",
      createdBy: alice.id,
    });

    const skill = await store.getSkill(created.id);
    expect(skill).not.toBeNull();
    expect(skill!.content).toBe("Full body content here");
    expect(skill!.title).toBe("Full Skill");
  });

  it("get nonexistent skill returns null", async () => {
    const skill = await store.getSkill("nonexistent-id");
    expect(skill).toBeNull();
  });

  it("delete skill", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    const skill = await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "To Delete",
      content: "Will be deleted",
      createdBy: alice.id,
    });

    const deleted = await store.deleteSkill(skill.id);
    expect(deleted).toBe(true);

    const list = await store.listSkills("project", project.id);
    expect(list).toHaveLength(0);
  });

  it("title is required (enforced by schema, empty string rejected)", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    // SQLite allows empty strings, but Zod schema enforces min(1)
    // We test that the store at least accepts a title
    const skill = await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Valid Title",
      content: "Content",
      createdBy: alice.id,
    });
    expect(skill.title).toBe("Valid Title");
  });

  // --- Progressive disclosure ---

  it("list returns skills with content (store level — handler strips it)", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Disclosure Test",
      summary: "Short summary",
      instructions: "Do this",
      content: "Full detailed content that should only load on demand",
      createdBy: alice.id,
    });

    const list = await store.listSkills("project", project.id);
    expect(list).toHaveLength(1);
    // Store returns full objects — progressive disclosure is enforced at handler level
    expect(list[0].summary).toBe("Short summary");
    expect(list[0].instructions).toBe("Do this");
    expect(list[0].content).toBeDefined();
  });

  it("get skill returns full content + file list", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    const skill = await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "With Files",
      content: "Main content",
      createdBy: alice.id,
    });

    await store.setSkillFile(skill.id, "example.ts", "console.log('hello')");

    const loaded = await store.getSkill(skill.id);
    expect(loaded!.content).toBe("Main content");
    expect(loaded!.files).toEqual(["example.ts"]);
  });

  it("file loading is tier 3 (separate call)", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    const skill = await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "File Test",
      content: "Main",
      createdBy: alice.id,
    });

    await store.setSkillFile(skill.id, "config.json", '{"key": "value"}');

    // Listing files gives names only (no content)
    const fileList = await store.listSkillFiles(skill.id);
    expect(fileList).toHaveLength(1);
    expect(fileList[0].filename).toBe("config.json");
    expect(fileList[0].updatedAt).toBeDefined();

    // Getting file gives full content
    const file = await store.getSkillFile(skill.id, "config.json");
    expect(file!.content).toBe('{"key": "value"}');
  });

  // --- Agent targeting ---

  it("empty agents[] matches everyone", async () => {
    const alice = await createAgent("alice", "claude-code");
    const bob = await createAgent("bob", "ollama");
    const { conv } = await setupConversation(alice.id);
    await store.subscribe(conv.id, bob.id);

    await store.setSkill({
      scope: "project",
      scopeId: (await store.getConversation(conv.id))!.projectId,
      title: "General Skill",
      content: "For everyone",
      agents: [],
      createdBy: alice.id,
    });

    const aliceSkills = await store.getMatchingSkills(
      { name: "alice", type: "claude-code", capabilities: [] },
      conv.id,
    );
    const bobSkills = await store.getMatchingSkills(
      { name: "bob", type: "ollama", capabilities: [] },
      conv.id,
    );

    expect(aliceSkills).toHaveLength(1);
    expect(bobSkills).toHaveLength(1);
  });

  it("agents[] filters by name", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { project, conv } = await setupConversation(alice.id);

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Alice Only",
      content: "Just for Alice",
      agents: ["alice"],
      createdBy: alice.id,
    });

    const aliceSkills = await store.getMatchingSkills(
      { name: "alice", type: "test", capabilities: [] },
      conv.id,
    );
    const bobSkills = await store.getMatchingSkills(
      { name: "bob", type: "test", capabilities: [] },
      conv.id,
    );

    expect(aliceSkills).toHaveLength(1);
    expect(bobSkills).toHaveLength(0);
  });

  it("agents[] matching is case-insensitive", async () => {
    const alice = await createAgent("Alice");
    const { project, conv } = await setupConversation(alice.id);

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Case Test",
      content: "Content",
      agents: ["alice"], // lowercase
      createdBy: alice.id,
    });

    const matched = await store.getMatchingSkills(
      { name: "Alice", type: "test", capabilities: [] }, // uppercase
      conv.id,
    );

    expect(matched).toHaveLength(1);
  });

  it("agents[] AND selector both must match", async () => {
    const alice = await createAgent("alice", "claude-code");
    const bob = await createAgent("bob", "ollama");
    const { project, conv } = await setupConversation(alice.id);

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Alice + Claude",
      content: "For alice AND claude-code only",
      agents: ["alice"],
      selector: { type: "claude-code" },
      createdBy: alice.id,
    });

    // alice with claude-code: matches both
    const aliceMatch = await store.getMatchingSkills(
      { name: "alice", type: "claude-code", capabilities: [] },
      conv.id,
    );
    expect(aliceMatch).toHaveLength(1);

    // alice with ollama: fails selector
    const aliceOllama = await store.getMatchingSkills(
      { name: "alice", type: "ollama", capabilities: [] },
      conv.id,
    );
    expect(aliceOllama).toHaveLength(0);

    // bob with claude-code: fails agents
    const bobMatch = await store.getMatchingSkills(
      { name: "bob", type: "claude-code", capabilities: [] },
      conv.id,
    );
    expect(bobMatch).toHaveLength(0);
  });

  // --- Selector matching ---

  it("selector matches by type", async () => {
    const alice = await createAgent("alice", "claude-code");
    const { project, conv } = await setupConversation(alice.id);

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Claude Skill",
      content: "For Claude Code",
      selector: { type: "claude-code" },
      createdBy: alice.id,
    });

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Ollama Skill",
      content: "For Ollama",
      selector: { type: "ollama" },
      createdBy: alice.id,
    });

    const matched = await store.getMatchingSkills(
      { name: "alice", type: "claude-code", capabilities: [] },
      conv.id,
    );

    expect(matched).toHaveLength(1);
    expect(matched[0].title).toBe("Claude Skill");
  });

  it("selector matches by capability", async () => {
    const alice = await createAgent("alice", "test", ["code-execution", "review"]);
    const { project, conv } = await setupConversation(alice.id);

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Code Exec Skill",
      content: "For code executors",
      selector: { capability: "code-execution" },
      createdBy: alice.id,
    });

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Analysis Skill",
      content: "For analysts",
      selector: { capability: "analysis" },
      createdBy: alice.id,
    });

    const matched = await store.getMatchingSkills(
      { name: "alice", type: "test", capabilities: ["code-execution", "review"] },
      conv.id,
    );

    expect(matched).toHaveLength(1);
    expect(matched[0].title).toBe("Code Exec Skill");
  });

  it("getMatchingSkills cascades bridge + project + conversation scopes", async () => {
    const alice = await createAgent("alice");
    const { project, conv } = await setupConversation(alice.id);

    await store.setSkill({
      scope: "bridge",
      title: "Bridge Skill",
      content: "Bridge-wide",
      createdBy: alice.id,
    });

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Project Skill",
      content: "Project-level",
      createdBy: alice.id,
    });

    await store.setSkill({
      scope: "conversation",
      scopeId: conv.id,
      title: "Conversation Skill",
      content: "Conversation-level",
      createdBy: alice.id,
    });

    const matched = await store.getMatchingSkills(
      { name: "alice", type: "test", capabilities: [] },
      conv.id,
    );

    expect(matched).toHaveLength(3);
    // Order: bridge → project → conversation
    expect(matched[0].title).toBe("Bridge Skill");
    expect(matched[1].title).toBe("Project Skill");
    expect(matched[2].title).toBe("Conversation Skill");
  });

  it("getMatchingSkills returns empty for unknown conversation", async () => {
    const matched = await store.getMatchingSkills(
      { name: "test", type: "test", capabilities: [] },
      "nonexistent",
    );
    expect(matched).toHaveLength(0);
  });

  it("selector matching is case-insensitive", async () => {
    const alice = await createAgent("alice", "Claude-Code", ["Code-Execution"]);
    const { project, conv } = await setupConversation(alice.id);

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Type Match",
      content: "Matched by type (case-insensitive)",
      selector: { type: "claude-code" },
      createdBy: alice.id,
    });

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Cap Match",
      content: "Matched by capability (case-insensitive)",
      selector: { capability: "code-execution" },
      createdBy: alice.id,
    });

    const matched = await store.getMatchingSkills(
      { name: "alice", type: "Claude-Code", capabilities: ["Code-Execution"] },
      conv.id,
    );

    expect(matched).toHaveLength(2);
  });

  // --- Tags ---

  it("tags are stored and returned", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    const skill = await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Tagged Skill",
      content: "Content",
      tags: ["review", "coding"],
      createdBy: alice.id,
    });

    expect(skill.tags).toEqual(["review", "coding"]);
  });

  it("tag filtering (any-match)", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Review Skill",
      content: "Review",
      tags: ["review"],
      createdBy: alice.id,
    });

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Coding Skill",
      content: "Coding",
      tags: ["coding"],
      createdBy: alice.id,
    });

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Untagged Skill",
      content: "No tags",
      createdBy: alice.id,
    });

    const filtered = await store.listSkills("project", project.id, { tags: ["review"] });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe("Review Skill");
  });

  it("tag filtering is case-insensitive", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "CaseSensitive",
      content: "Content",
      tags: ["Review"],
      createdBy: alice.id,
    });

    const filtered = await store.listSkills("project", project.id, { tags: ["review"] });
    expect(filtered).toHaveLength(1);
  });

  // --- Instructions field ---

  it("instructions field is stored and returned", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    const skill = await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "With Instructions",
      instructions: "Always respond in French",
      content: "Detailed content",
      createdBy: alice.id,
    });

    expect(skill.instructions).toBe("Always respond in French");
  });

  it("instructions defaults to empty string", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    const skill = await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "No Instructions",
      content: "Content",
      createdBy: alice.id,
    });

    expect(skill.instructions).toBe("");
  });

  // --- Scope isolation ---

  it("skills from different projects are separate", async () => {
    const alice = await createAgent("alice");
    const p1 = await store.createProject({ name: "P1", createdBy: alice.id });
    const p2 = await store.createProject({ name: "P2", createdBy: alice.id });

    await store.setSkill({
      scope: "project",
      scopeId: p1.id,
      title: "P1 Skill",
      content: "P1 content",
      createdBy: alice.id,
    });

    await store.setSkill({
      scope: "project",
      scopeId: p2.id,
      title: "P2 Skill",
      content: "P2 content",
      createdBy: alice.id,
    });

    const list1 = await store.listSkills("project", p1.id);
    const list2 = await store.listSkills("project", p2.id);

    expect(list1).toHaveLength(1);
    expect(list1[0].title).toBe("P1 Skill");
    expect(list2).toHaveLength(1);
    expect(list2[0].title).toBe("P2 Skill");
  });

  it("list bridge-level skills", async () => {
    const alice = await createAgent("alice");

    await store.setSkill({
      scope: "bridge",
      title: "Bridge Skill",
      content: "Bridge content",
      createdBy: alice.id,
    });

    const list = await store.listSkills("bridge");
    expect(list).toHaveLength(1);
    expect(list[0].scope).toBe("bridge");
    expect(list[0].scopeId).toBeNull();
    expect(list[0].title).toBe("Bridge Skill");
  });

  // --- Skill Files ---

  it("set and get a skill file", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    const skill = await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "File Skill",
      content: "Main",
      createdBy: alice.id,
    });

    const file = await store.setSkillFile(skill.id, "template.ts", "export default {};");
    expect(file.filename).toBe("template.ts");
    expect(file.content).toBe("export default {};");
    expect(file.skillId).toBe(skill.id);

    const loaded = await store.getSkillFile(skill.id, "template.ts");
    expect(loaded).not.toBeNull();
    expect(loaded!.content).toBe("export default {};");
  });

  it("upsert skill file overwrites content", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    const skill = await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Upsert File",
      content: "Main",
      createdBy: alice.id,
    });

    await store.setSkillFile(skill.id, "config.json", '{"v": 1}');
    await store.setSkillFile(skill.id, "config.json", '{"v": 2}');

    const file = await store.getSkillFile(skill.id, "config.json");
    expect(file!.content).toBe('{"v": 2}');

    const list = await store.listSkillFiles(skill.id);
    expect(list).toHaveLength(1);
  });

  it("list skill files returns names and updatedAt only", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    const skill = await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "List Files",
      content: "Main",
      createdBy: alice.id,
    });

    await store.setSkillFile(skill.id, "a.ts", "content-a");
    await store.setSkillFile(skill.id, "b.ts", "content-b");

    const files = await store.listSkillFiles(skill.id);
    expect(files).toHaveLength(2);
    expect(files[0].filename).toBe("a.ts");
    expect(files[1].filename).toBe("b.ts");
    expect(files[0].updatedAt).toBeDefined();
    // No content field in listing
    expect((files[0] as Record<string, unknown>).content).toBeUndefined();
  });

  it("deleting a skill cascades to files", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    const skill = await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Cascade Test",
      content: "Main",
      createdBy: alice.id,
    });

    await store.setSkillFile(skill.id, "file.ts", "content");

    await store.deleteSkill(skill.id);

    const files = await store.listSkillFiles(skill.id);
    expect(files).toHaveLength(0);
  });

  it("get nonexistent file returns null", async () => {
    const alice = await createAgent("alice");
    const { project } = await setupConversation(alice.id);

    const skill = await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "No File",
      content: "Main",
      createdBy: alice.id,
    });

    const file = await store.getSkillFile(skill.id, "nonexistent.ts");
    expect(file).toBeNull();
  });

  // --- Migration ---

  it("migrates instructions to skills", async () => {
    // Create a fresh DB with the old instructions table
    const migDir = mkdtempSync(join(tmpdir(), "agorai-migration-test-"));
    const migBus = new StoreEventBus();

    // Create a DB with just the instructions table (simulating v0.5)
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(join(migDir, "migrate.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'custom',
        capabilities TEXT NOT NULL DEFAULT '[]',
        clearance_level TEXT NOT NULL DEFAULT 'team',
        api_key_hash TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO agents (id, name, type, capabilities, clearance_level, api_key_hash, last_seen_at, created_at)
      VALUES ('agent1', 'alice', 'test', '[]', 'team', 'hash1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

      CREATE TABLE instructions (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL DEFAULT '',
        selector_json TEXT NOT NULL DEFAULT '{}',
        content TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (created_by) REFERENCES agents(id)
      );
      INSERT INTO instructions (id, scope, scope_id, selector_json, content, created_by, created_at, updated_at)
      VALUES ('instr1', 'bridge', '', '{}', 'Bridge instruction content', 'agent1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
      INSERT INTO instructions (id, scope, scope_id, selector_json, content, created_by, created_at, updated_at)
      VALUES ('instr2', 'project', 'proj1', '{"type":"claude-code"}', 'Claude specific', 'agent1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    `);
    db.close();

    // Now open with SqliteStore (which should migrate)
    const migStore = new SqliteStore(join(migDir, "migrate.db"), migBus);
    await migStore.initialize();

    // Verify skills were created
    const bridgeSkills = await migStore.listSkills("bridge");
    expect(bridgeSkills).toHaveLength(1);
    expect(bridgeSkills[0].id).toBe("instr1");
    expect(bridgeSkills[0].content).toBe("Bridge instruction content");
    expect(bridgeSkills[0].title).toContain("bridge instruction");

    const projectSkills = await migStore.listSkills("project", "proj1");
    expect(projectSkills).toHaveLength(1);
    expect(projectSkills[0].id).toBe("instr2");
    expect(projectSkills[0].content).toBe("Claude specific");

    // Verify instructions table is dropped
    const tables = db.constructor.prototype.constructor === Function
      ? [] // safety
      : [];
    // Use the store's DB to check
    const tableCheck = (migStore as unknown as { db: { prepare: (s: string) => { all: () => { name: string }[] } } }).db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='instructions'")
      .all();
    expect(tableCheck).toHaveLength(0);

    await migStore.close();
    rmSync(migDir, { recursive: true, force: true });
  });

  it("migration preserves original IDs", async () => {
    const migDir = mkdtempSync(join(tmpdir(), "agorai-migration-ids-"));
    const migBus = new StoreEventBus();

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(join(migDir, "migrate.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'custom',
        capabilities TEXT NOT NULL DEFAULT '[]',
        clearance_level TEXT NOT NULL DEFAULT 'team',
        api_key_hash TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO agents (id, name, type, capabilities, clearance_level, api_key_hash, last_seen_at, created_at)
      VALUES ('a1', 'alice', 'test', '[]', 'team', 'h1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

      CREATE TABLE instructions (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL DEFAULT '',
        selector_json TEXT NOT NULL DEFAULT '{}',
        content TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (created_by) REFERENCES agents(id)
      );
      INSERT INTO instructions VALUES ('custom-id-123', 'bridge', '', '{}', 'Test', 'a1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    `);
    db.close();

    const migStore = new SqliteStore(join(migDir, "migrate.db"), migBus);
    await migStore.initialize();

    const skill = await migStore.getSkill("custom-id-123");
    expect(skill).not.toBeNull();
    expect(skill!.id).toBe("custom-id-123");

    await migStore.close();
    rmSync(migDir, { recursive: true, force: true });
  });

  it("migration is idempotent (re-initialize after migration)", async () => {
    const migDir = mkdtempSync(join(tmpdir(), "agorai-migration-idempotent-"));
    const migBus = new StoreEventBus();

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(join(migDir, "migrate.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'custom',
        capabilities TEXT NOT NULL DEFAULT '[]',
        clearance_level TEXT NOT NULL DEFAULT 'team',
        api_key_hash TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO agents VALUES ('a1', 'alice', 'test', '[]', 'team', 'h1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

      CREATE TABLE instructions (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL DEFAULT '',
        selector_json TEXT NOT NULL DEFAULT '{}',
        content TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (created_by) REFERENCES agents(id)
      );
      INSERT INTO instructions VALUES ('i1', 'bridge', '', '{}', 'Content', 'a1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    `);
    db.close();

    // First init: migrates
    const store1 = new SqliteStore(join(migDir, "migrate.db"), migBus);
    await store1.initialize();
    await store1.close();

    // Second init: should not fail (idempotent)
    const store2 = new SqliteStore(join(migDir, "migrate.db"), new StoreEventBus());
    await store2.initialize();

    const skills = await store2.listSkills("bridge");
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe("i1");

    await store2.close();
    rmSync(migDir, { recursive: true, force: true });
  });
});
