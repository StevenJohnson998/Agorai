import { describe, it, expect } from "vitest";
import { SqliteBlackboard } from "../memory/sqlite.js";
import type { Config } from "../config.js";
import { ConfigSchema } from "../config.js";

describe("scanForSensitiveData", () => {
  const config = ConfigSchema.parse({}) as Config;
  const bb = new SqliteBlackboard(config);

  it("detects email addresses", () => {
    const findings = bb.scanForSensitiveData("Contact me at user@example.com for details");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.includes("@"))).toBe(true);
  });

  it("detects API key patterns", () => {
    const findings = bb.scanForSensitiveData("Use key sk-abc123def456ghi789jkl012");
    expect(findings.length).toBeGreaterThan(0);
  });

  it("detects IP addresses", () => {
    const findings = bb.scanForSensitiveData("Server is at 192.168.1.100");
    expect(findings.length).toBeGreaterThan(0);
  });

  it("returns empty for clean text", () => {
    const findings = bb.scanForSensitiveData("This is a normal discussion about Redis vs Memcached.");
    expect(findings).toHaveLength(0);
  });
});
