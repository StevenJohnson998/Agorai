/**
 * Message content validation pipeline tests.
 */

import { describe, it, expect } from "vitest";
import { validateMessage, type MessagesConfig } from "../bridge/validation.js";
import { mcpError, ErrorCode } from "../bridge/errors.js";

const defaultConfig: MessagesConfig = { maxContentLength: 10_000 };

// ---------------------------------------------------------------------------
// validateLength
// ---------------------------------------------------------------------------

describe("validateLength", () => {
  it("accepts content at exactly the limit", () => {
    // Each word is unique (hex counter) so abuse detection never triggers
    let text = "";
    for (let i = 0; text.length < 10_010; i++) text += `w${i.toString(16)} `;
    const content = text.slice(0, 10_000);
    const result = validateMessage(content, defaultConfig);
    expect(result.valid).toBe(true);
  });

  it("rejects content exceeding the limit", () => {
    let text = "";
    for (let i = 0; text.length < 10_010; i++) text += `w${i.toString(16)} `;
    const content = text.slice(0, 10_001);
    const result = validateMessage(content, defaultConfig);
    expect(result.valid).toBe(false);
    expect(result.error!.code).toBe(ErrorCode.CONTENT_REJECTED);
    expect(result.error!.message).toBe("content_rejected");
    expect(result.error!.data.reason).toBe("max_length_exceeded");
    expect(result.error!.data.limit).toBe(10_000);
    expect(result.error!.data.actual).toBe(10_001);
  });

  it("respects custom maxContentLength from config", () => {
    const customConfig: MessagesConfig = { maxContentLength: 500 };
    // Each word is unique (hex counter) so abuse detection never triggers
    let text = "";
    for (let i = 0; text.length < 510; i++) text += `w${i.toString(16)} `;
    const at500 = text.slice(0, 500);
    const at501 = text.slice(0, 501);
    expect(validateMessage(at500, customConfig).valid).toBe(true);
    expect(validateMessage(at501, customConfig).valid).toBe(false);
  });

  it("accepts short normal content", () => {
    const result = validateMessage("Hello, this is a normal message.", defaultConfig);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateAbuse
// ---------------------------------------------------------------------------

describe("validateAbuse", () => {
  it("accepts normal text content", () => {
    const content = "This is a thoughtful review of the proposed architecture changes. " +
      "I think we should consider the trade-offs between performance and readability.";
    expect(validateMessage(content, defaultConfig).valid).toBe(true);
  });

  it("rejects excessive character repetition (50+ same char)", () => {
    const content = "a".repeat(50);
    const result = validateMessage(content, defaultConfig);
    expect(result.valid).toBe(false);
    expect(result.error!.data.reason).toBe("content_flagged");
    expect(result.error!.data.details).toBe("excessive character repetition");
  });

  it("accepts 49 repeated characters (just under threshold)", () => {
    const content = "a".repeat(49);
    expect(validateMessage(content, defaultConfig).valid).toBe(true);
  });

  it("rejects excessive word repetition (20+ same word)", () => {
    const content = Array(20).fill("spam").join(" ");
    const result = validateMessage(content, defaultConfig);
    expect(result.valid).toBe(false);
    expect(result.error!.data.reason).toBe("content_flagged");
    expect(result.error!.data.details).toBe("excessive word repetition");
  });

  it("accepts 19 repeated words (just under threshold)", () => {
    const content = Array(19).fill("hello").join(" ");
    expect(validateMessage(content, defaultConfig).valid).toBe(true);
  });

  it("word repetition is case-insensitive", () => {
    const content = Array(10).fill("Spam").concat(Array(10).fill("spam")).join(" ");
    const result = validateMessage(content, defaultConfig);
    expect(result.valid).toBe(false);
    expect(result.error!.data.reason).toBe("content_flagged");
  });
});

// ---------------------------------------------------------------------------
// Pipeline behavior
// ---------------------------------------------------------------------------

describe("validateMessage pipeline", () => {
  it("length check runs before abuse check (short-circuit)", () => {
    // Content that would fail both: too long AND contains spam pattern
    const config: MessagesConfig = { maxContentLength: 100 };
    const spam = "x".repeat(60); // Would trigger abuse (50+ same char)
    const padding = "Some normal words here to pad. ";
    const content = padding + spam + padding; // ~150 chars, exceeds 100 limit
    const result = validateMessage(content, config);
    expect(result.valid).toBe(false);
    // Length fires first since it runs before abuse
    expect(result.error!.data.reason).toBe("max_length_exceeded");
  });

  it("returns valid when all validators pass", () => {
    const content = "A well-formed message with varied words and reasonable length.";
    expect(validateMessage(content, defaultConfig)).toEqual({ valid: true });
  });
});

// ---------------------------------------------------------------------------
// mcpError helper
// ---------------------------------------------------------------------------

describe("mcpError", () => {
  it("produces correct MCP CallToolResult shape", () => {
    const result = mcpError(-32001, "content_rejected", {
      reason: "max_length_exceeded",
      limit: 10_000,
      actual: 12_345,
    });

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.code).toBe(-32001);
    expect(parsed.error.message).toBe("content_rejected");
    expect(parsed.error.data.reason).toBe("max_length_exceeded");
    expect(parsed.error.data.limit).toBe(10_000);
    expect(parsed.error.data.actual).toBe(12_345);
  });
});
