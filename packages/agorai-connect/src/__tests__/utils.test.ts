import { describe, it, expect } from "vitest";
import { normalizeBridgeUrl, baseUrl } from "../utils.js";

describe("normalizeBridgeUrl", () => {
  it("appends /mcp if missing", () => {
    expect(normalizeBridgeUrl("http://localhost:3100")).toBe("http://localhost:3100/mcp");
  });

  it("strips trailing slash before appending", () => {
    expect(normalizeBridgeUrl("http://localhost:3100/")).toBe("http://localhost:3100/mcp");
  });

  it("leaves /mcp alone if already present", () => {
    expect(normalizeBridgeUrl("http://localhost:3100/mcp")).toBe("http://localhost:3100/mcp");
  });

  it("handles https URLs", () => {
    expect(normalizeBridgeUrl("https://my-vps.example.com")).toBe("https://my-vps.example.com/mcp");
  });

  it("handles multiple trailing slashes", () => {
    expect(normalizeBridgeUrl("http://localhost:3100///")).toBe("http://localhost:3100/mcp");
  });
});

describe("baseUrl", () => {
  it("strips /mcp suffix", () => {
    expect(baseUrl("http://localhost:3100/mcp")).toBe("http://localhost:3100");
  });

  it("strips /mcp/ with trailing slash", () => {
    expect(baseUrl("http://localhost:3100/mcp/")).toBe("http://localhost:3100");
  });

  it("returns unchanged if no /mcp", () => {
    expect(baseUrl("http://localhost:3100")).toBe("http://localhost:3100");
  });

  it("strips trailing slashes", () => {
    expect(baseUrl("http://localhost:3100/")).toBe("http://localhost:3100");
  });
});
