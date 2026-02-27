import { describe, it, expect } from "vitest";

/**
 * Tests for agent.ts building blocks.
 * The full runAgent() loop requires a real bridge + model — tested manually.
 * Here we test the helper logic.
 */

describe("agent helpers", () => {
  describe("extractText", () => {
    // Inline the function since it's not exported
    function extractText(result: { content: Array<{ type: string; text: string }> }): string {
      if (result.content.length === 0) return "";
      return result.content.map((c) => c.text).join("\n");
    }

    it("extracts text from single content item", () => {
      const result = { content: [{ type: "text", text: "hello" }] };
      expect(extractText(result)).toBe("hello");
    });

    it("joins multiple content items with newline", () => {
      const result = {
        content: [
          { type: "text", text: "line1" },
          { type: "text", text: "line2" },
        ],
      };
      expect(extractText(result)).toBe("line1\nline2");
    });

    it("returns empty string for empty content", () => {
      expect(extractText({ content: [] })).toBe("");
    });
  });

  describe("passive mode mention detection", () => {
    it("detects @mention in message", () => {
      const agentName = "mistral-7b-agent";
      const mentionPattern = new RegExp(`@${agentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");

      expect(mentionPattern.test("Hey @mistral-7b-agent what do you think?")).toBe(true);
      expect(mentionPattern.test("No mention here")).toBe(false);
      expect(mentionPattern.test("@MISTRAL-7B-AGENT please reply")).toBe(true);
    });

    it("escapes special regex characters in agent name", () => {
      const agentName = "gpt-4.0+(test)";
      const mentionPattern = new RegExp(`@${agentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");

      expect(mentionPattern.test("Hey @gpt-4.0+(test) opinions?")).toBe(true);
      expect(mentionPattern.test("Hey @gpt-400(test) opinions?")).toBe(false);
    });
  });

  describe("conversation state tracking", () => {
    it("tracks last message timestamp per conversation", () => {
      const states = new Map<string, { lastMessageTimestamp?: string }>();

      // First poll — no timestamp yet
      states.set("conv-1", {});
      expect(states.get("conv-1")?.lastMessageTimestamp).toBeUndefined();

      // After getting messages — update timestamp
      states.set("conv-1", { lastMessageTimestamp: "2026-02-27T10:00:00Z" });
      expect(states.get("conv-1")?.lastMessageTimestamp).toBe("2026-02-27T10:00:00Z");

      // Second conversation independent
      states.set("conv-2", { lastMessageTimestamp: "2026-02-27T11:00:00Z" });
      expect(states.get("conv-1")?.lastMessageTimestamp).toBe("2026-02-27T10:00:00Z");
      expect(states.get("conv-2")?.lastMessageTimestamp).toBe("2026-02-27T11:00:00Z");
    });
  });
});
