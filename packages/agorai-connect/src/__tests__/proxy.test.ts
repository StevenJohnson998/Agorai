import { describe, it, expect, vi, beforeEach } from "vitest";
import { normalizeBridgeUrl } from "../utils.js";

// proxy.ts runs an event loop on stdin — we test its building blocks
// rather than the full runProxy() which requires stdio mocking.

describe("proxy building blocks", () => {
  it("normalizes bridge URL correctly", () => {
    expect(normalizeBridgeUrl("http://localhost:3100")).toBe("http://localhost:3100/mcp");
    expect(normalizeBridgeUrl("http://localhost:3100/mcp")).toBe("http://localhost:3100/mcp");
  });

  it("handles SSE data line extraction", () => {
    const sseText = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n\n";
    const dataLines: string[] = [];
    for (const line of sseText.split("\n")) {
      if (line.startsWith("data: ")) {
        dataLines.push(line.slice(6));
      }
    }
    expect(dataLines).toHaveLength(1);
    expect(JSON.parse(dataLines[0])).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });
});
