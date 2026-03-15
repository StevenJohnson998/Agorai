/**
 * Auth layer tests — API key validation, auto-registration, clearance levels, salted hashing.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ApiKeyAuthProvider, DatabaseAuthProvider, ChainAuthProvider, hashApiKey } from "../bridge/auth.js";
import { SqliteStore } from "../store/sqlite.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ApiKeyConfig } from "../config.js";

let store: SqliteStore;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-auth-test-"));
  store = new SqliteStore(join(tmpDir, "test.db"));
  await store.initialize();
});

afterEach(async () => {
  await store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const testKeys: ApiKeyConfig[] = [
  {
    key: "ak_test_desktop_123",
    agent: "claude-desktop",
    type: "claude-desktop",
    capabilities: ["analysis", "review"],
    clearanceLevel: "team",
  },
  {
    key: "ak_test_code_456",
    agent: "claude-code",
    type: "claude-code",
    capabilities: ["code-execution"],
    clearanceLevel: "confidential",
  },
];

describe("hashApiKey", () => {
  it("produces consistent SHA-256 hashes (no salt)", () => {
    const h1 = hashApiKey("test-key");
    const h2 = hashApiKey("test-key");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // 256 bits = 64 hex chars
  });

  it("produces different hashes for different keys", () => {
    expect(hashApiKey("key-a")).not.toBe(hashApiKey("key-b"));
  });

  it("produces different hashes with vs without salt", () => {
    const unsalted = hashApiKey("test-key");
    const salted = hashApiKey("test-key", "my-salt");
    expect(unsalted).not.toBe(salted);
    expect(salted).toHaveLength(64);
  });

  it("produces consistent HMAC hashes with same salt", () => {
    const h1 = hashApiKey("test-key", "salt-abc");
    const h2 = hashApiKey("test-key", "salt-abc");
    expect(h1).toBe(h2);
  });

  it("produces different hashes with different salts", () => {
    const h1 = hashApiKey("test-key", "salt-1");
    const h2 = hashApiKey("test-key", "salt-2");
    expect(h1).not.toBe(h2);
  });
});

describe("ApiKeyAuthProvider", () => {
  it("authenticates with valid key (no salt)", async () => {
    const auth = new ApiKeyAuthProvider(testKeys, store);
    const result = await auth.authenticate("ak_test_desktop_123");

    expect(result.authenticated).toBe(true);
    expect(result.agentName).toBe("claude-desktop");
    expect(result.clearanceLevel).toBe("team");
    expect(result.agentId).toBeTruthy();
  });

  it("authenticates with valid key (salted)", async () => {
    const auth = new ApiKeyAuthProvider(testKeys, store, "test-salt-42");
    const result = await auth.authenticate("ak_test_desktop_123");

    expect(result.authenticated).toBe(true);
    expect(result.agentName).toBe("claude-desktop");
  });

  it("rejects invalid key", async () => {
    const auth = new ApiKeyAuthProvider(testKeys, store);
    const result = await auth.authenticate("ak_wrong_key");

    expect(result.authenticated).toBe(false);
    expect(result.error).toBe("Invalid API key");
  });

  it("rejects empty key", async () => {
    const auth = new ApiKeyAuthProvider(testKeys, store);
    const result = await auth.authenticate("");

    expect(result.authenticated).toBe(false);
    expect(result.error).toBe("Missing API key");
  });

  it("auto-registers agent in store on first auth", async () => {
    const auth = new ApiKeyAuthProvider(testKeys, store);
    const result = await auth.authenticate("ak_test_code_456");

    expect(result.authenticated).toBe(true);

    // Verify agent is in the store
    const agent = await store.getAgent(result.agentId!);
    expect(agent).not.toBeNull();
    expect(agent!.name).toBe("claude-code");
    expect(agent!.type).toBe("claude-code");
    expect(agent!.clearanceLevel).toBe("confidential");
    expect(agent!.capabilities).toEqual(["code-execution"]);
  });

  it("stores salted hash in DB when salt is set", async () => {
    const salt = "unique-salt-123";
    const auth = new ApiKeyAuthProvider(testKeys, store, salt);
    const result = await auth.authenticate("ak_test_desktop_123");

    const agent = await store.getAgent(result.agentId!);
    const expectedHash = hashApiKey("ak_test_desktop_123", salt);
    expect(agent!.apiKeyHash).toBe(expectedHash);
  });

  it("updates lastSeenAt on each auth", async () => {
    const auth = new ApiKeyAuthProvider(testKeys, store);

    const first = await auth.authenticate("ak_test_desktop_123");
    const agent1 = await store.getAgent(first.agentId!);
    const firstSeen = agent1!.lastSeenAt;

    await new Promise((r) => setTimeout(r, 10));

    await auth.authenticate("ak_test_desktop_123");
    const agent2 = await store.getAgent(first.agentId!);
    expect(agent2!.lastSeenAt >= firstSeen).toBe(true);
  });

  it("returns correct clearance level per key", async () => {
    const auth = new ApiKeyAuthProvider(testKeys, store);

    const desktop = await auth.authenticate("ak_test_desktop_123");
    expect(desktop.clearanceLevel).toBe("team");

    const code = await auth.authenticate("ak_test_code_456");
    expect(code.clearanceLevel).toBe("confidential");
  });
});

describe("DatabaseAuthProvider", () => {
  const salt = "test-db-salt";

  it("authenticates agent registered directly in DB", async () => {
    const hash = hashApiKey("db-managed-key-123", salt);
    await store.registerAgent({
      name: "db-agent",
      type: "custom",
      capabilities: ["analysis"],
      clearanceLevel: "team",
      apiKeyHash: hash,
      toolProfile: "agent",
    });

    const auth = new DatabaseAuthProvider(store, salt);
    const result = await auth.authenticate("db-managed-key-123");

    expect(result.authenticated).toBe(true);
    expect(result.agentName).toBe("db-agent");
    expect(result.clearanceLevel).toBe("team");
    expect(result.toolProfile).toBe("agent");
  });

  it("rejects unknown keys", async () => {
    const auth = new DatabaseAuthProvider(store, salt);
    const result = await auth.authenticate("nonexistent-key");

    expect(result.authenticated).toBe(false);
    expect(result.error).toBe("Invalid API key");
  });

  it("rejects empty token", async () => {
    const auth = new DatabaseAuthProvider(store, salt);
    const result = await auth.authenticate("");

    expect(result.authenticated).toBe(false);
    expect(result.error).toBe("Missing API key");
  });

  it("returns toolGroups and toolProfile from DB", async () => {
    const hash = hashApiKey("key-with-groups", salt);
    await store.registerAgent({
      name: "grouped-agent",
      type: "custom",
      capabilities: [],
      clearanceLevel: "team",
      apiKeyHash: hash,
      toolGroups: ["tasks", "memory"],
      toolProfile: "orchestrator",
    });

    const auth = new DatabaseAuthProvider(store, salt);
    const result = await auth.authenticate("key-with-groups");

    expect(result.authenticated).toBe(true);
    expect(result.toolGroups).toEqual(["tasks", "memory"]);
    expect(result.toolProfile).toBe("orchestrator");
  });
});

describe("ChainAuthProvider", () => {
  const salt = "test-chain-salt";

  it("DB provider takes priority over config provider", async () => {
    // Register agent in DB with a DB-managed key
    const dbHash = hashApiKey("db-key", salt);
    await store.registerAgent({
      name: "chain-agent",
      type: "custom",
      capabilities: [],
      clearanceLevel: "confidential",
      apiKeyHash: dbHash,
      toolProfile: "agent",
    });

    // Also set up a config-based key for the same agent
    const configKeys: ApiKeyConfig[] = [{
      key: "config-key",
      agent: "chain-agent",
      type: "custom",
      capabilities: [],
      clearanceLevel: "team", // different clearance
    }];

    const chain = new ChainAuthProvider([
      new DatabaseAuthProvider(store, salt),
      new ApiKeyAuthProvider(configKeys, store, salt),
    ]);

    // DB key should work and return DB clearance
    const dbResult = await chain.authenticate("db-key");
    expect(dbResult.authenticated).toBe(true);
    expect(dbResult.clearanceLevel).toBe("confidential");

    // Config key should also work (fallback)
    const configResult = await chain.authenticate("config-key");
    expect(configResult.authenticated).toBe(true);
  });

  it("falls back to config when DB has no match", async () => {
    const configKeys: ApiKeyConfig[] = [{
      key: "only-in-config",
      agent: "config-only",
      type: "custom",
      capabilities: [],
      clearanceLevel: "team",
    }];

    const chain = new ChainAuthProvider([
      new DatabaseAuthProvider(store, salt),
      new ApiKeyAuthProvider(configKeys, store, salt),
    ]);

    const result = await chain.authenticate("only-in-config");
    expect(result.authenticated).toBe(true);
    expect(result.agentName).toBe("config-only");
  });

  it("rejects when no provider matches", async () => {
    const chain = new ChainAuthProvider([
      new DatabaseAuthProvider(store, salt),
    ]);

    const result = await chain.authenticate("totally-unknown");
    expect(result.authenticated).toBe(false);
  });
});
