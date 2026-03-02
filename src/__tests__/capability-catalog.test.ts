/**
 * Capability catalog tests — findAgentsByCapability + discover_capabilities tool.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStore } from "../store/sqlite.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let store: SqliteStore;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-test-"));
  store = new SqliteStore(join(tmpDir, "test.db"));
  await store.initialize();
});

afterEach(async () => {
  await store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function createAgent(
  name: string,
  capabilities: string[] = [],
  clearance: "public" | "team" | "confidential" | "restricted" = "team",
) {
  return store.registerAgent({
    name,
    type: "test",
    capabilities,
    clearanceLevel: clearance,
    apiKeyHash: `hash_${name}`,
  });
}

describe("findAgentsByCapability", () => {
  it("returns matching agents", async () => {
    await createAgent("alice", ["code-execution", "review"]);
    await createAgent("bob", ["analysis"]);

    const results = await store.findAgentsByCapability("review");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("alice");
  });

  it("is case-insensitive", async () => {
    await createAgent("alice", ["Code-Execution"]);

    const results = await store.findAgentsByCapability("code-execution");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("alice");

    const results2 = await store.findAgentsByCapability("CODE-EXECUTION");
    expect(results2).toHaveLength(1);
    expect(results2[0].name).toBe("alice");
  });

  it("returns empty for unknown capability", async () => {
    await createAgent("alice", ["code-execution"]);

    const results = await store.findAgentsByCapability("flying");
    expect(results).toHaveLength(0);
  });

  it("returns multiple matching agents", async () => {
    await createAgent("alice", ["review", "analysis"]);
    await createAgent("bob", ["review"]);
    await createAgent("charlie", ["code-execution"]);

    const results = await store.findAgentsByCapability("review");
    expect(results).toHaveLength(2);
    const names = results.map((a) => a.name).sort();
    expect(names).toEqual(["alice", "bob"]);
  });

  it("browse mode (no filter via listAgents) returns all agents", async () => {
    await createAgent("alice", ["review"]);
    await createAgent("bob", ["analysis"]);
    await createAgent("charlie", []);

    const all = await store.listAgents();
    expect(all).toHaveLength(3);
  });
});
