import { describe, it, expect } from "vitest";
import { createAdapter } from "../adapters/index.js";
import { ClaudeAdapter } from "../adapters/claude.js";
import { GeminiAdapter } from "../adapters/gemini.js";
import { OllamaAdapter } from "../adapters/ollama.js";

describe("createAdapter factory", () => {
  it("creates OllamaAdapter when model is set", () => {
    const adapter = createAdapter({
      name: "test-ollama",
      model: "qwen3",
      endpoint: "http://localhost:11434",
      enabled: true,
      personas: [],
      args: [],
    });
    expect(adapter).toBeInstanceOf(OllamaAdapter);
    expect(adapter.name).toBe("test-ollama");
  });

  it("creates ClaudeAdapter for claude command", () => {
    const adapter = createAdapter({
      name: "claude",
      command: "claude",
      args: ["-p"],
      enabled: true,
      personas: [],
    });
    expect(adapter).toBeInstanceOf(ClaudeAdapter);
  });

  it("creates GeminiAdapter for gemini command", () => {
    const adapter = createAdapter({
      name: "gemini",
      command: "gemini",
      args: ["-p"],
      enabled: true,
      personas: [],
    });
    expect(adapter).toBeInstanceOf(GeminiAdapter);
  });

  it("defaults unknown CLI to ClaudeAdapter", () => {
    const adapter = createAdapter({
      name: "custom",
      command: "my-llm",
      args: [],
      enabled: true,
      personas: [],
    });
    expect(adapter).toBeInstanceOf(ClaudeAdapter);
  });

  it("throws for agent without command or model", () => {
    expect(() =>
      createAdapter({ name: "broken", enabled: true, personas: [], args: [] })
    ).toThrow("must have either");
  });
});
