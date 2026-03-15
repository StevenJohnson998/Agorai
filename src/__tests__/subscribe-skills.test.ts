/**
 * Subscribe + Skills metadata tests — verifies that subscribe returns matching
 * skill metadata (tier 1: id, title, summary, instructions, tags, scope, agents, files)
 * and does NOT include full content.
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
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-sub-skills-test-"));
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
  type = "test",
  capabilities: string[] = [],
  clearance: "public" | "team" | "confidential" | "restricted" = "team",
) {
  return store.registerAgent({
    name,
    type,
    capabilities,
    clearanceLevel: clearance,
    apiKeyHash: `hash_${name}`,
  });
}

async function setupProject(agentId: string) {
  const project = await store.createProject({ name: "SkillProject", createdBy: agentId });
  const conv = await store.createConversation({
    projectId: project.id,
    title: "SkillConv",
    createdBy: agentId,
  });
  return { project, conv };
}

describe("getMatchingSkills — subscribe handshake metadata", () => {
  it("returns matching bridge-scoped skill for subscribed agent", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupProject(alice.id);

    await store.setSkill({
      scope: "bridge",
      title: "Bridge Rule",
      summary: "Global rule for all agents",
      instructions: "Follow the rules",
      content: "Full detailed content that should NOT be in subscribe response",
      tags: ["global"],
      createdBy: alice.id,
    });

    const skills = await store.getMatchingSkills(
      { name: alice.name, type: alice.type, capabilities: alice.capabilities },
      conv.id,
    );

    expect(skills).toHaveLength(1);
    expect(skills[0].title).toBe("Bridge Rule");
    expect(skills[0].summary).toBe("Global rule for all agents");
    expect(skills[0].instructions).toBe("Follow the rules");
    expect(skills[0].tags).toEqual(["global"]);
    expect(skills[0].scope).toBe("bridge");
  });

  it("returns project-scoped skill matching agent", async () => {
    const alice = await createAgent("alice");
    const { project, conv } = await setupProject(alice.id);

    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Project Guide",
      summary: "How to work in this project",
      content: "Detailed guide content",
      tags: ["onboarding"],
      createdBy: alice.id,
    });

    const skills = await store.getMatchingSkills(
      { name: alice.name, type: alice.type, capabilities: alice.capabilities },
      conv.id,
    );

    expect(skills).toHaveLength(1);
    expect(skills[0].scope).toBe("project");
    expect(skills[0].title).toBe("Project Guide");
  });

  it("returns conversation-scoped skill", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupProject(alice.id);

    await store.setSkill({
      scope: "conversation",
      scopeId: conv.id,
      title: "Conv Context",
      summary: "Context for this conversation",
      content: "Detailed context",
      tags: ["context"],
      createdBy: alice.id,
    });

    const skills = await store.getMatchingSkills(
      { name: alice.name, type: alice.type, capabilities: alice.capabilities },
      conv.id,
    );

    expect(skills).toHaveLength(1);
    expect(skills[0].scope).toBe("conversation");
  });

  it("cascading: returns skills from all scopes in order (bridge → project → conversation)", async () => {
    const alice = await createAgent("alice");
    const { project, conv } = await setupProject(alice.id);

    await store.setSkill({
      scope: "bridge",
      title: "Bridge Skill",
      content: "b",
      tags: [],
      createdBy: alice.id,
    });
    await store.setSkill({
      scope: "project",
      scopeId: project.id,
      title: "Project Skill",
      content: "p",
      tags: [],
      createdBy: alice.id,
    });
    await store.setSkill({
      scope: "conversation",
      scopeId: conv.id,
      title: "Conv Skill",
      content: "c",
      tags: [],
      createdBy: alice.id,
    });

    const skills = await store.getMatchingSkills(
      { name: alice.name, type: alice.type, capabilities: alice.capabilities },
      conv.id,
    );

    expect(skills).toHaveLength(3);
    expect(skills[0].scope).toBe("bridge");
    expect(skills[1].scope).toBe("project");
    expect(skills[2].scope).toBe("conversation");
  });

  it("filters by agents[] — only matching agent sees the skill", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await setupProject(alice.id);

    await store.setSkill({
      scope: "bridge",
      title: "Alice Only Skill",
      content: "For alice",
      tags: [],
      agents: ["alice"],
      createdBy: alice.id,
    });

    const aliceSkills = await store.getMatchingSkills(
      { name: alice.name, type: alice.type, capabilities: alice.capabilities },
      conv.id,
    );
    const bobSkills = await store.getMatchingSkills(
      { name: bob.name, type: bob.type, capabilities: bob.capabilities },
      conv.id,
    );

    expect(aliceSkills).toHaveLength(1);
    expect(bobSkills).toHaveLength(0);
  });

  it("filters by selector type — only matching type sees the skill", async () => {
    const reviewer = await createAgent("reviewer", "code-reviewer");
    const builder = await createAgent("builder", "code-builder");
    const { conv } = await setupProject(reviewer.id);

    await store.setSkill({
      scope: "bridge",
      title: "Review Guidelines",
      content: "How to review",
      tags: [],
      selector: { type: "code-reviewer" },
      createdBy: reviewer.id,
    });

    const reviewerSkills = await store.getMatchingSkills(
      { name: reviewer.name, type: reviewer.type, capabilities: reviewer.capabilities },
      conv.id,
    );
    const builderSkills = await store.getMatchingSkills(
      { name: builder.name, type: builder.type, capabilities: builder.capabilities },
      conv.id,
    );

    expect(reviewerSkills).toHaveLength(1);
    expect(builderSkills).toHaveLength(0);
  });

  it("filters by selector capability — only agents with capability see the skill", async () => {
    const withCap = await createAgent("with-cap", "test", ["code-review"]);
    const withoutCap = await createAgent("without-cap", "test", ["testing"]);
    const { conv } = await setupProject(withCap.id);

    await store.setSkill({
      scope: "bridge",
      title: "Review Checklist",
      content: "Checklist",
      tags: [],
      selector: { capability: "code-review" },
      createdBy: withCap.id,
    });

    const withCapSkills = await store.getMatchingSkills(
      { name: withCap.name, type: withCap.type, capabilities: withCap.capabilities },
      conv.id,
    );
    const withoutCapSkills = await store.getMatchingSkills(
      { name: withoutCap.name, type: withoutCap.type, capabilities: withoutCap.capabilities },
      conv.id,
    );

    expect(withCapSkills).toHaveLength(1);
    expect(withoutCapSkills).toHaveLength(0);
  });

  it("empty agents[] matches all agents", async () => {
    const alice = await createAgent("alice");
    const bob = await createAgent("bob");
    const { conv } = await setupProject(alice.id);

    await store.setSkill({
      scope: "bridge",
      title: "Universal Skill",
      content: "For everyone",
      tags: [],
      agents: [],
      createdBy: alice.id,
    });

    const aliceSkills = await store.getMatchingSkills(
      { name: alice.name, type: alice.type, capabilities: alice.capabilities },
      conv.id,
    );
    const bobSkills = await store.getMatchingSkills(
      { name: bob.name, type: bob.type, capabilities: bob.capabilities },
      conv.id,
    );

    expect(aliceSkills).toHaveLength(1);
    expect(bobSkills).toHaveLength(1);
  });

  it("returns files list (names only) in skill metadata", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupProject(alice.id);

    const skill = await store.setSkill({
      scope: "bridge",
      title: "Skill With Files",
      content: "Has files",
      tags: [],
      createdBy: alice.id,
    });

    await store.setSkillFile(skill.id, "checklist.md", "# Checklist\n- Item 1", alice.id);
    await store.setSkillFile(skill.id, "template.json", '{"key": "value"}', alice.id);

    const skills = await store.getMatchingSkills(
      { name: alice.name, type: alice.type, capabilities: alice.capabilities },
      conv.id,
    );

    expect(skills).toHaveLength(1);
    expect(skills[0].files).toHaveLength(2);
    // files is string[] (filenames only, not objects)
    expect([...skills[0].files].sort()).toEqual(["checklist.md", "template.json"]);
  });

  it("returns empty skills for conversation with no matching skills", async () => {
    const alice = await createAgent("alice");
    const { conv } = await setupProject(alice.id);

    // No skills created
    const skills = await store.getMatchingSkills(
      { name: alice.name, type: alice.type, capabilities: alice.capabilities },
      conv.id,
    );

    expect(skills).toEqual([]);
  });

  it("returns empty for nonexistent conversation", async () => {
    const alice = await createAgent("alice");

    const skills = await store.getMatchingSkills(
      { name: alice.name, type: alice.type, capabilities: alice.capabilities },
      "nonexistent-conv-id",
    );

    expect(skills).toEqual([]);
  });
});
