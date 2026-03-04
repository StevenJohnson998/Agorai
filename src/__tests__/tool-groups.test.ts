/**
 * Tool groups tests — verify per-agent tool filtering.
 *
 * Tests that createBridgeMcpServer registers the correct tools
 * based on the toolGroups configuration.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStore } from "../store/sqlite.js";
import { createBridgeMcpServer, TOOL_GROUPS } from "../bridge/server.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let store: SqliteStore;
let tmpDir: string;
let agentId: string;

/** Extract registered tool names from an McpServer instance. */
function getToolNames(server: ReturnType<typeof createBridgeMcpServer>): string[] {
  // Access private _registeredTools (acceptable in tests)
  const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
  return Object.keys(tools).sort();
}

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-toolgroup-test-"));
  store = new SqliteStore(join(tmpDir, "test.db"));
  await store.initialize();

  // Register a test agent
  const agent = await store.registerAgent({
    name: "test-agent",
    type: "claude-code",
    capabilities: [],
    clearanceLevel: "team",
    apiKeyHash: "test-hash",
  });
  agentId = agent.id;
});

afterEach(async () => {
  await store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("TOOL_GROUPS constant", () => {
  it("defines all expected groups", () => {
    expect(Object.keys(TOOL_GROUPS).sort()).toEqual(
      ["access", "core", "members", "memory", "skills", "tasks"]
    );
  });

  it("core group has 14 tools", () => {
    expect(TOOL_GROUPS.core).toHaveLength(14);
  });

  it("memory group has 6 tools", () => {
    expect(TOOL_GROUPS.memory).toHaveLength(6);
  });

  it("tasks group has 6 tools", () => {
    expect(TOOL_GROUPS.tasks).toHaveLength(6);
  });

  it("skills group has 6 tools", () => {
    expect(TOOL_GROUPS.skills).toHaveLength(6);
  });

  it("access group has 3 tools", () => {
    expect(TOOL_GROUPS.access).toHaveLength(3);
  });

  it("members group has 3 tools", () => {
    expect(TOOL_GROUPS.members).toHaveLength(3);
  });

  it("all groups sum to 38 tools", () => {
    const total = Object.values(TOOL_GROUPS).reduce((sum, tools) => sum + tools.length, 0);
    expect(total).toBe(38);
  });
});

describe("createBridgeMcpServer tool filtering", () => {
  it("default (no toolGroups) registers all 38 tools", () => {
    const server = createBridgeMcpServer(store, agentId);
    const tools = getToolNames(server);
    expect(tools).toHaveLength(38);
  });

  it('["all"] registers all 38 tools', () => {
    const server = createBridgeMcpServer(store, agentId, ["all"]);
    const tools = getToolNames(server);
    expect(tools).toHaveLength(38);
  });

  it("empty array registers all 38 tools", () => {
    const server = createBridgeMcpServer(store, agentId, []);
    const tools = getToolNames(server);
    expect(tools).toHaveLength(38);
  });

  it('["core"] only registers 14 core tools', () => {
    const server = createBridgeMcpServer(store, agentId, ["core"]);
    const tools = getToolNames(server);
    expect(tools).toHaveLength(14);

    // Verify all core tools are present
    for (const tool of TOOL_GROUPS.core) {
      expect(tools).toContain(tool);
    }

    // Verify non-core tools are absent
    for (const tool of TOOL_GROUPS.memory) {
      expect(tools).not.toContain(tool);
    }
    for (const tool of TOOL_GROUPS.tasks) {
      expect(tools).not.toContain(tool);
    }
  });

  it('["tasks", "memory"] registers 26 tools (core is implicit)', () => {
    const server = createBridgeMcpServer(store, agentId, ["tasks", "memory"]);
    const tools = getToolNames(server);
    expect(tools).toHaveLength(26);

    // Core tools always present
    for (const tool of TOOL_GROUPS.core) {
      expect(tools).toContain(tool);
    }

    // Requested groups present
    for (const tool of TOOL_GROUPS.tasks) {
      expect(tools).toContain(tool);
    }
    for (const tool of TOOL_GROUPS.memory) {
      expect(tools).toContain(tool);
    }

    // Skills and access absent
    for (const tool of TOOL_GROUPS.skills) {
      expect(tools).not.toContain(tool);
    }
    for (const tool of TOOL_GROUPS.access) {
      expect(tools).not.toContain(tool);
    }
  });

  it('["tasks"] registers 20 tools', () => {
    const server = createBridgeMcpServer(store, agentId, ["tasks"]);
    const tools = getToolNames(server);
    expect(tools).toHaveLength(20);
  });

  it('["skills", "access"] registers 23 tools', () => {
    const server = createBridgeMcpServer(store, agentId, ["skills", "access"]);
    const tools = getToolNames(server);
    expect(tools).toHaveLength(23);

    for (const tool of TOOL_GROUPS.skills) {
      expect(tools).toContain(tool);
    }
    for (const tool of TOOL_GROUPS.access) {
      expect(tools).toContain(tool);
    }
  });
});
