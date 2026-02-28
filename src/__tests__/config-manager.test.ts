import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadRawConfig,
  saveConfig,
  generatePassKey,
  addAgent,
  listAgents,
  updateAgent,
  removeAgent,
} from "../config-manager.js";

// Use a temp directory with a fresh config for each test
let tmpDir: string;
let configPath: string;

function writeTestConfig(config: Record<string, unknown>) {
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function readTestConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

/** Minimal config with bridge section */
function baseConfig() {
  return {
    user: "test",
    agents: [],
    bridge: {
      port: 3100,
      host: "127.0.0.1",
      apiKeys: [],
    },
  };
}

beforeEach(() => {
  tmpDir = join(tmpdir(), `agorai-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  configPath = join(tmpDir, "agorai.config.json");
  writeTestConfig(baseConfig());
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadRawConfig / saveConfig", () => {
  it("loads and preserves raw JSON fields", () => {
    writeTestConfig({ user: "steven", customField: 42, agents: [] });
    const config = loadRawConfig(configPath);
    expect(config.user).toBe("steven");
    expect((config as Record<string, unknown>).customField).toBe(42);
  });

  it("round-trips without data loss", () => {
    const original = { user: "steven", agents: [{ name: "test", extra: true }], bridge: { apiKeys: [], foo: "bar" } };
    writeTestConfig(original);
    const loaded = loadRawConfig(configPath);
    saveConfig(loaded, configPath);
    const reloaded = readTestConfig();
    expect(reloaded).toEqual(original);
  });
});

describe("generatePassKey", () => {
  it("returns a base64url string of expected length", () => {
    const key = generatePassKey();
    // 24 bytes → 32 base64url chars
    expect(key).toHaveLength(32);
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates unique keys", () => {
    const keys = new Set(Array.from({ length: 10 }, () => generatePassKey()));
    expect(keys.size).toBe(10);
  });
});

describe("addAgent", () => {
  it("adds openai-compat agent to both bridge.apiKeys and agents[]", () => {
    const { passKey } = addAgent(
      {
        name: "deepseek-chat",
        type: "openai-compat",
        model: "deepseek-chat",
        endpoint: "https://api.deepseek.com",
        apiKeyEnv: "DEEPSEEK_KEY",
        clearance: "team",
      },
      configPath,
    );

    expect(passKey).toBeTruthy();
    expect(passKey).toMatch(/^[A-Za-z0-9_-]+$/);

    const config = readTestConfig() as Record<string, any>;

    // Check bridge.apiKeys
    expect(config.bridge.apiKeys).toHaveLength(1);
    expect(config.bridge.apiKeys[0]).toEqual({
      key: passKey,
      agent: "deepseek-chat",
      type: "openai-compat",
      clearanceLevel: "team",
    });

    // Check agents[]
    expect(config.agents).toHaveLength(1);
    expect(config.agents[0]).toEqual({
      name: "deepseek-chat",
      type: "openai-compat",
      model: "deepseek-chat",
      endpoint: "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_KEY",
      enabled: true,
    });
  });

  it("adds MCP-type agent to bridge.apiKeys only (not agents[])", () => {
    addAgent(
      { name: "claude-desktop", type: "claude-desktop", clearance: "confidential" },
      configPath,
    );

    const config = readTestConfig() as Record<string, any>;
    expect(config.bridge.apiKeys).toHaveLength(1);
    expect(config.bridge.apiKeys[0].agent).toBe("claude-desktop");
    expect(config.bridge.apiKeys[0].type).toBe("claude-desktop");
    expect(config.bridge.apiKeys[0].clearanceLevel).toBe("confidential");

    // Should NOT appear in agents[]
    expect(config.agents).toHaveLength(0);
  });

  it("adds ollama agent to both arrays", () => {
    addAgent(
      { name: "local-llama", type: "ollama", model: "llama3", endpoint: "http://localhost:11434" },
      configPath,
    );

    const config = readTestConfig() as Record<string, any>;
    expect(config.bridge.apiKeys).toHaveLength(1);
    expect(config.agents).toHaveLength(1);
    expect(config.agents[0].type).toBe("ollama");
    expect(config.agents[0].model).toBe("llama3");
  });

  it("throws on duplicate name", () => {
    addAgent({ name: "test-agent", type: "custom" }, configPath);
    expect(() => addAgent({ name: "test-agent", type: "custom" }, configPath)).toThrow(
      'Agent "test-agent" already exists',
    );
  });

  it("defaults clearance to team", () => {
    addAgent({ name: "no-clearance", type: "custom" }, configPath);
    const config = readTestConfig() as Record<string, any>;
    expect(config.bridge.apiKeys[0].clearanceLevel).toBe("team");
  });

  it("creates bridge section if missing", () => {
    writeTestConfig({ user: "test", agents: [] });
    addAgent({ name: "new-agent", type: "custom" }, configPath);
    const config = readTestConfig() as Record<string, any>;
    expect(config.bridge.apiKeys).toHaveLength(1);
  });
});

describe("listAgents", () => {
  it("merges bridge.apiKeys and agents[] by name", () => {
    writeTestConfig({
      agents: [
        { name: "groq", type: "openai-compat", model: "llama-3.3-70b", endpoint: "https://api.groq.com", apiKeyEnv: "GROQ_API_KEY", enabled: true },
      ],
      bridge: {
        apiKeys: [
          { key: "key1", agent: "claude-desktop", type: "claude-desktop", clearanceLevel: "team" },
          { key: "key2", agent: "groq", type: "openai-compat", clearanceLevel: "confidential" },
        ],
      },
    });

    const agents = listAgents(configPath);
    expect(agents).toHaveLength(2);

    const claude = agents.find((a) => a.name === "claude-desktop")!;
    expect(claude.type).toBe("claude-desktop");
    expect(claude.model).toBeNull();
    expect(claude.clearance).toBe("team");

    const groq = agents.find((a) => a.name === "groq")!;
    expect(groq.type).toBe("openai-compat");
    expect(groq.model).toBe("llama-3.3-70b");
    expect(groq.clearance).toBe("confidential");
    expect(groq.apiKeyEnv).toBe("GROQ_API_KEY");
  });

  it("returns empty array for empty config", () => {
    writeTestConfig({ agents: [], bridge: { apiKeys: [] } });
    expect(listAgents(configPath)).toEqual([]);
  });

  it("includes orphan agents (in agents[] but not bridge.apiKeys)", () => {
    writeTestConfig({
      agents: [{ name: "orphan", type: "ollama", model: "test" }],
      bridge: { apiKeys: [] },
    });
    const agents = listAgents(configPath);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("orphan");
    expect(agents[0].type).toBe("ollama");
  });
});

describe("updateAgent", () => {
  beforeEach(() => {
    // Add an agent to update
    addAgent(
      {
        name: "test-agent",
        type: "openai-compat",
        model: "old-model",
        endpoint: "http://old-endpoint",
        clearance: "team",
      },
      configPath,
    );
  });

  it("updates model in agents[]", () => {
    const { changes } = updateAgent("test-agent", { model: "new-model" }, configPath);
    expect(changes).toContain("model: old-model → new-model");

    const config = readTestConfig() as Record<string, any>;
    expect(config.agents[0].model).toBe("new-model");
  });

  it("updates clearance in bridge.apiKeys", () => {
    const { changes } = updateAgent("test-agent", { clearance: "confidential" }, configPath);
    expect(changes).toContain("clearance: team → confidential");

    const config = readTestConfig() as Record<string, any>;
    expect(config.bridge.apiKeys[0].clearanceLevel).toBe("confidential");
  });

  it("updates multiple fields at once", () => {
    const { changes } = updateAgent(
      "test-agent",
      { model: "v2", endpoint: "http://new", clearance: "restricted" },
      configPath,
    );
    expect(changes).toHaveLength(3);
  });

  it("throws for unknown agent", () => {
    expect(() => updateAgent("nonexistent", { model: "x" }, configPath)).toThrow(
      'Agent "nonexistent" not found',
    );
  });

  it("throws when no changes specified", () => {
    expect(() => updateAgent("test-agent", {}, configPath)).toThrow("No changes specified");
  });
});

describe("removeAgent", () => {
  it("removes from both bridge.apiKeys and agents[]", () => {
    addAgent(
      { name: "to-remove", type: "openai-compat", model: "test" },
      configPath,
    );

    const beforeConfig = readTestConfig() as Record<string, any>;
    expect(beforeConfig.bridge.apiKeys).toHaveLength(1);
    expect(beforeConfig.agents).toHaveLength(1);

    removeAgent("to-remove", configPath);

    const afterConfig = readTestConfig() as Record<string, any>;
    expect(afterConfig.bridge.apiKeys).toHaveLength(0);
    expect(afterConfig.agents).toHaveLength(0);
  });

  it("removes MCP agent (bridge.apiKeys only)", () => {
    addAgent({ name: "claude-test", type: "claude-desktop" }, configPath);

    removeAgent("claude-test", configPath);

    const config = readTestConfig() as Record<string, any>;
    expect(config.bridge.apiKeys).toHaveLength(0);
  });

  it("throws for unknown agent", () => {
    expect(() => removeAgent("nonexistent", configPath)).toThrow(
      'Agent "nonexistent" not found',
    );
  });

  it("preserves other agents when removing one", () => {
    addAgent({ name: "keep-me", type: "custom" }, configPath);
    addAgent({ name: "remove-me", type: "custom" }, configPath);

    removeAgent("remove-me", configPath);

    const config = readTestConfig() as Record<string, any>;
    expect(config.bridge.apiKeys).toHaveLength(1);
    expect(config.bridge.apiKeys[0].agent).toBe("keep-me");
  });
});
