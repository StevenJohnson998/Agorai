import { describe, it, expect } from "vitest";
import { detectPlatform, defaultConfigPath, resolveNodePath } from "../config-paths.js";

describe("detectPlatform", () => {
  it("returns a valid platform string", () => {
    const p = detectPlatform();
    expect(["windows", "macos", "linux"]).toContain(p);
  });
});

describe("defaultConfigPath", () => {
  it("returns a string for windows", () => {
    const p = defaultConfigPath("windows");
    expect(p).toContain("Claude");
    expect(p).toContain("claude_desktop_config.json");
  });

  it("returns a string for macos", () => {
    const p = defaultConfigPath("macos");
    expect(p).toContain("Claude");
    expect(p).toContain("claude_desktop_config.json");
    expect(p).toContain("Application Support");
  });

  it("returns a string for linux", () => {
    const p = defaultConfigPath("linux");
    expect(p).toContain("Claude");
    expect(p).toContain("claude_desktop_config.json");
  });
});

describe("resolveNodePath", () => {
  it("returns 'node' on non-windows", () => {
    expect(resolveNodePath("linux")).toBe("node");
    expect(resolveNodePath("macos")).toBe("node");
  });

  it("returns a full path on windows", () => {
    const p = resolveNodePath("windows");
    expect(p).toBeTruthy();
    // On any platform it returns process.execPath for windows
    expect(p).toBe(process.execPath);
  });
});
