import { describe, it, expect } from "vitest";
import { ConfigSchema, getUserDataDir, loadConfig, resetLoadedConfigDir } from "../config.js";
import { resolve } from "node:path";
import { homedir } from "node:os";

describe("ConfigSchema.parse", () => {
  it("parses empty object with all defaults", () => {
    const config = ConfigSchema.parse({});
    expect(config.user).toBe("default");
    expect(config.thoroughness).toBe(0.5);
    expect(config.agents.length).toBeGreaterThan(0);
    expect(config.budget.maxTokensPerDebate).toBe(0);
    expect(config.budget.warnAtPercent).toBe(80);
  });

  it("accepts valid full config", () => {
    const config = ConfigSchema.parse({
      user: "steven",
      thoroughness: 0.8,
      agents: [
        { name: "claude", command: "claude", args: ["-p"], personas: ["architect"] },
      ],
      budget: { maxTokensPerDebate: 50000, warnAtPercent: 70 },
    });
    expect(config.user).toBe("steven");
    expect(config.thoroughness).toBe(0.8);
    expect(config.agents).toHaveLength(1);
    expect(config.budget.maxTokensPerDebate).toBe(50000);
  });

  it("rejects thoroughness out of range", () => {
    expect(() => ConfigSchema.parse({ thoroughness: 1.5 })).toThrow();
    expect(() => ConfigSchema.parse({ thoroughness: -0.1 })).toThrow();
  });

  it("rejects invalid agent config (no command or model)", () => {
    // Agents without command or model are valid at schema level
    // (createAdapter throws at runtime), but name is required
    expect(() => ConfigSchema.parse({ agents: [{}] })).toThrow();
  });

  it("sets default persona consensusBonus to 1.0", () => {
    const config = ConfigSchema.parse({
      personas: [{ name: "test", role: "Test", systemPrompt: "Test prompt" }],
    });
    expect(config.personas[0].consensusBonus).toBe(1.0);
  });
});

describe("getUserDataDir", () => {
  it("uses XDG fallback when no config file loaded", () => {
    // Force no-config state (loadConfig would find agorai.config.json in cwd)
    resetLoadedConfigDir();
    const config = ConfigSchema.parse({ user: "testuser" });
    const dir = getUserDataDir(config);
    const xdg = process.env.XDG_DATA_HOME || resolve(homedir(), ".local", "share");
    expect(dir).toBe(resolve(xdg, "agorai", "testuser"));
  });

  it("returns an absolute path", () => {
    const config = ConfigSchema.parse({ user: "someone" });
    const dir = getUserDataDir(config);
    expect(dir.startsWith("/")).toBe(true);
  });
});
