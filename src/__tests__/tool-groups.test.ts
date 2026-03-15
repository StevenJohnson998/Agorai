/**
 * Tool groups tests — verify per-agent tool filtering.
 *
 * Tests that createBridgeMcpServer registers the correct tools
 * based on the toolGroups configuration.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStore } from "../store/sqlite.js";
import { createBridgeMcpServer, TOOL_GROUPS, TOOL_PROFILES } from "../bridge/server.js";
import { LocalFileStore } from "../store/file-store.js";
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
      ["access", "attachments", "core", "members", "memory", "skills", "tasks"]
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

  it("attachments group has 4 tools", () => {
    expect(TOOL_GROUPS.attachments).toHaveLength(4);
  });

  it("all groups sum to 42 tools", () => {
    const total = Object.values(TOOL_GROUPS).reduce((sum, tools) => sum + tools.length, 0);
    expect(total).toBe(42);
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

  it("attachment tools only register when fileStore is provided", () => {
    // Without fileStore: 38 tools (no attachments)
    const serverNoStore = createBridgeMcpServer(store, agentId);
    expect(getToolNames(serverNoStore)).toHaveLength(38);
    for (const tool of TOOL_GROUPS.attachments) {
      expect(getToolNames(serverNoStore)).not.toContain(tool);
    }

    // With fileStore: 42 tools (all groups including attachments)
    const fileStore = new LocalFileStore(join(tmpDir, "attachments"));
    const serverWithStore = createBridgeMcpServer(store, agentId, undefined, fileStore);
    expect(getToolNames(serverWithStore)).toHaveLength(42);
    for (const tool of TOOL_GROUPS.attachments) {
      expect(getToolNames(serverWithStore)).toContain(tool);
    }
  });

  it('["attachments"] with fileStore registers 18 tools (core + attachments)', () => {
    const fileStore = new LocalFileStore(join(tmpDir, "attachments"));
    const server = createBridgeMcpServer(store, agentId, ["attachments"], fileStore);
    const tools = getToolNames(server);
    expect(tools).toHaveLength(18);
  });
});

describe("TOOL_PROFILES constant", () => {
  it("agent profile has 11 tools", () => {
    expect(TOOL_PROFILES.agent).toHaveLength(11);
  });

  it("orchestrator profile has 20 tools", () => {
    expect(TOOL_PROFILES.orchestrator).toHaveLength(20);
  });

  it("admin profile has all 42 tools", () => {
    expect(TOOL_PROFILES.admin).toHaveLength(42);
  });

  it("orchestrator includes all agent tools", () => {
    for (const tool of TOOL_PROFILES.agent) {
      expect(TOOL_PROFILES.orchestrator).toContain(tool);
    }
  });

  it("admin includes all orchestrator tools", () => {
    for (const tool of TOOL_PROFILES.orchestrator) {
      expect(TOOL_PROFILES.admin).toContain(tool);
    }
  });

  it("all profile tools exist in TOOL_GROUPS", () => {
    const allGroupTools = Object.values(TOOL_GROUPS).flat();
    for (const [profileName, tools] of Object.entries(TOOL_PROFILES)) {
      for (const tool of tools) {
        expect(allGroupTools, `${profileName}.${tool} not found in any group`).toContain(tool);
      }
    }
  });
});

describe("createBridgeMcpServer with toolProfile", () => {
  it('"agent" profile registers exactly 11 tools', () => {
    const server = createBridgeMcpServer(store, agentId, undefined, undefined, undefined, "agent");
    const tools = getToolNames(server);
    expect(tools).toHaveLength(11);
    for (const tool of TOOL_PROFILES.agent) {
      expect(tools).toContain(tool);
    }
  });

  it('"orchestrator" profile registers exactly 20 tools', () => {
    const server = createBridgeMcpServer(store, agentId, undefined, undefined, undefined, "orchestrator");
    const tools = getToolNames(server);
    expect(tools).toHaveLength(20);
    for (const tool of TOOL_PROFILES.orchestrator) {
      expect(tools).toContain(tool);
    }
  });

  it('"admin" profile registers all tools (no fileStore = 38)', () => {
    const server = createBridgeMcpServer(store, agentId, undefined, undefined, undefined, "admin");
    const tools = getToolNames(server);
    // admin profile allows all 42, but attachments need fileStore — so 38
    expect(tools).toHaveLength(38);
  });

  it('"admin" profile with fileStore registers all 42 tools', () => {
    const fileStore = new LocalFileStore(join(tmpDir, "attachments"));
    const server = createBridgeMcpServer(store, agentId, undefined, fileStore, undefined, "admin");
    const tools = getToolNames(server);
    expect(tools).toHaveLength(42);
  });

  it("profile takes precedence over toolGroups", () => {
    // toolGroups says ["all"] but profile says "agent" — agent wins
    const server = createBridgeMcpServer(store, agentId, ["all"], undefined, undefined, "agent");
    const tools = getToolNames(server);
    expect(tools).toHaveLength(11);
  });

  it("unknown profile falls back to toolGroups behavior", () => {
    const server = createBridgeMcpServer(store, agentId, undefined, undefined, undefined, "nonexistent");
    const tools = getToolNames(server);
    // Unknown profile → allowedTools is null → falls through to toolGroups (default = all)
    expect(tools).toHaveLength(38);
  });

  it("no profile and no toolGroups = default 38 tools", () => {
    const server = createBridgeMcpServer(store, agentId);
    const tools = getToolNames(server);
    expect(tools).toHaveLength(38);
  });

  it("agent profile excludes admin/discovery tools", () => {
    const server = createBridgeMcpServer(store, agentId, undefined, undefined, undefined, "agent");
    const tools = getToolNames(server);
    const excluded = ["register_agent", "list_agents", "discover_capabilities",
      "create_project", "create_conversation", "list_subscribers"];
    for (const tool of excluded) {
      expect(tools, `${tool} should be excluded from agent profile`).not.toContain(tool);
    }
  });
});
