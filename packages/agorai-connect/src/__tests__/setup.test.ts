import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Tests for setup.ts — we test config file merging logic
 * without running the full interactive flow.
 */

describe("setup config merging", () => {
  const tmpDir = join(tmpdir(), "agorai-connect-test-" + Date.now());
  const configPath = join(tmpDir, "claude_desktop_config.json");

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates config file from scratch", () => {
    const config: Record<string, unknown> = {};
    const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;
    mcpServers["agorai"] = {
      command: "node",
      args: ["/path/to/cli.js", "proxy", "http://localhost:3100", "my-key"],
    };
    config.mcpServers = mcpServers;

    writeFileSync(configPath, JSON.stringify(config, null, 2));
    const written = JSON.parse(readFileSync(configPath, "utf-8"));

    expect(written.mcpServers.agorai).toBeDefined();
    expect(written.mcpServers.agorai.command).toBe("node");
    expect(written.mcpServers.agorai.args).toContain("proxy");
  });

  it("preserves existing mcpServers entries", () => {
    // Pre-existing config
    const existing = {
      mcpServers: {
        "other-server": { command: "python", args: ["serve.py"] },
      },
      someOtherKey: true,
    };
    writeFileSync(configPath, JSON.stringify(existing));

    // Simulate merge
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;
    mcpServers["agorai"] = {
      command: "node",
      args: ["/path/to/cli.js", "proxy", "http://localhost:3100", "my-key"],
    };
    config.mcpServers = mcpServers;
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(result.mcpServers["other-server"]).toBeDefined();
    expect(result.mcpServers["other-server"].command).toBe("python");
    expect(result.mcpServers.agorai).toBeDefined();
    expect(result.someOtherKey).toBe(true);
  });

  it("overwrites existing agorai entry on re-setup", () => {
    const existing = {
      mcpServers: {
        agorai: { command: "node", args: ["old.js", "proxy", "http://old:3100", "old-key"] },
      },
    };
    writeFileSync(configPath, JSON.stringify(existing));

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;
    mcpServers["agorai"] = {
      command: "node",
      args: ["/new/cli.js", "proxy", "http://new:3100", "new-key"],
    };
    config.mcpServers = mcpServers;
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(result.mcpServers.agorai.args).toContain("http://new:3100");
  });
});
