import { describe, it, expect, afterEach } from "vitest";
import { setLogLevel, getLogLevel, truncate } from "../logger.js";

describe("setLogLevel / getLogLevel", () => {
  afterEach(() => setLogLevel("warn")); // reset

  it("defaults to warn", () => {
    setLogLevel("warn");
    expect(getLogLevel()).toBe("warn");
  });

  it("can set to debug", () => {
    setLogLevel("debug");
    expect(getLogLevel()).toBe("debug");
  });

  it("can set to error", () => {
    setLogLevel("error");
    expect(getLogLevel()).toBe("error");
  });
});

describe("truncate", () => {
  it("returns short strings unchanged", () => {
    expect(truncate("hello", 500)).toBe("hello");
  });

  it("truncates long strings with char count", () => {
    const long = "a".repeat(600);
    const result = truncate(long, 500);
    expect(result.length).toBeLessThan(600);
    expect(result).toContain("600 chars total");
  });

  it("respects custom maxLen", () => {
    const result = truncate("abcdef", 3);
    expect(result).toBe("abc... (6 chars total)");
  });
});
