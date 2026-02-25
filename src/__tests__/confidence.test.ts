import { describe, it, expect } from "vitest";
import { extractConfidence, calculateTimeout } from "../adapters/base.js";

describe("extractConfidence", () => {
  it("extracts confidence from [confidence: 0.85]", () => {
    const text = "Redis is better for sessions.\n\n[confidence: 0.85]";
    const { confidence, cleanContent } = extractConfidence(text);
    expect(confidence).toBe(0.85);
    expect(cleanContent).toBe("Redis is better for sessions.");
  });

  it("extracts confidence without brackets", () => {
    const text = "My analysis shows...\nconfidence: 0.72";
    const { confidence, cleanContent } = extractConfidence(text);
    expect(confidence).toBe(0.72);
    expect(cleanContent).toBe("My analysis shows...");
  });

  it("handles confidence: 1.0", () => {
    const { confidence } = extractConfidence("Absolutely certain.\n[confidence: 1.0]");
    expect(confidence).toBe(1.0);
  });

  it("handles confidence: 0", () => {
    const { confidence } = extractConfidence("Not sure at all.\nconfidence: 0");
    expect(confidence).toBe(0);
  });

  it("returns 0.5 default when no marker found", () => {
    const { confidence, cleanContent } = extractConfidence("Just a normal response with no confidence marker.");
    expect(confidence).toBe(0.5);
    expect(cleanContent).toBe("Just a normal response with no confidence marker.");
  });

  it("is case insensitive", () => {
    const { confidence } = extractConfidence("Answer.\n[Confidence: 0.9]");
    expect(confidence).toBe(0.9);
  });

  it("strips trailing whitespace around marker", () => {
    const { cleanContent } = extractConfidence("Content here.\n  [confidence: 0.7]  ");
    expect(cleanContent).toBe("Content here.");
  });
});

describe("calculateTimeout", () => {
  it("returns base timeout for short prompts (cli)", () => {
    const timeout = calculateTimeout(100, "cli");
    // 100/4 = 25 tokens → 30000 + 25*20 = 30500
    expect(timeout).toBe(30500);
  });

  it("caps at 5 minutes for cli", () => {
    const timeout = calculateTimeout(1_000_000, "cli");
    expect(timeout).toBe(300_000);
  });

  it("returns base timeout for short prompts (http)", () => {
    const timeout = calculateTimeout(100, "http");
    // 100/4 = 25 tokens → 15000 + 25*15 = 15375
    expect(timeout).toBe(15375);
  });

  it("caps at 10 minutes for http", () => {
    const timeout = calculateTimeout(1_000_000, "http");
    expect(timeout).toBe(600_000);
  });
});
