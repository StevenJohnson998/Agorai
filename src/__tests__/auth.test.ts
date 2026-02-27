/**
 * Auth layer tests — API key validation, auto-registration, clearance levels.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ApiKeyAuthProvider, hashApiKey } from "../bridge/auth.js";
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
  it("produces consistent SHA-256 hashes", () => {
    const h1 = hashApiKey("test-key");
    const h2 = hashApiKey("test-key");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // 256 bits = 64 hex chars
  });

  it("produces different hashes for different keys", () => {
    expect(hashApiKey("key-a")).not.toBe(hashApiKey("key-b"));
  });
});

describe("ApiKeyAuthProvider", () => {
  it("authenticates with valid key", async () => {
    const auth = new ApiKeyAuthProvider(testKeys, store);
    const result = await auth.authenticate("ak_test_desktop_123");

    expect(result.authenticated).toBe(true);
    expect(result.agentName).toBe("claude-desktop");
    expect(result.clearanceLevel).toBe("team");
    expect(result.agentId).toBeTruthy();
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
