import { describe, it, expect } from "vitest";
import { createAdapter } from "../adapters/index.js";
import { ClaudeAdapter } from "../adapters/claude.js";
import { GeminiAdapter } from "../adapters/gemini.js";
import { OllamaAdapter } from "../adapters/ollama.js";
import { OpenAICompatAdapter } from "../adapters/openai-compat.js";

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
    ).toThrow("must have");
  });

  // OpenAI-compat adapter tests
  it("creates OpenAICompatAdapter when type is openai-compat", () => {
    const adapter = createAdapter({
      name: "groq-llama",
      type: "openai-compat",
      model: "llama-3.3-70b-versatile",
      endpoint: "https://api.groq.com/openai",
      apiKey: "gsk_test",
      enabled: true,
      personas: [],
      args: [],
    });
    expect(adapter).toBeInstanceOf(OpenAICompatAdapter);
    expect(adapter.name).toBe("groq-llama");
  });

  it("creates OpenAICompatAdapter for various providers", () => {
    const providers = [
      { name: "mistral", model: "mistral-small-latest", endpoint: "https://api.mistral.ai" },
      { name: "deepseek", model: "deepseek-chat", endpoint: "https://api.deepseek.com" },
      { name: "lmstudio", model: "local-model", endpoint: "http://localhost:1234" },
      { name: "vllm", model: "meta-llama/Llama-3-8B", endpoint: "http://localhost:8000" },
    ];

    for (const p of providers) {
      const adapter = createAdapter({
        ...p,
        type: "openai-compat" as const,
        enabled: true,
        personas: [],
        args: [],
      });
      expect(adapter).toBeInstanceOf(OpenAICompatAdapter);
      expect(adapter.name).toBe(p.name);
    }
  });

  it("explicit type=ollama overrides auto-detect", () => {
    const adapter = createAdapter({
      name: "explicit-ollama",
      type: "ollama",
      model: "qwen3",
      endpoint: "http://localhost:11434",
      enabled: true,
      personas: [],
      args: [],
    });
    expect(adapter).toBeInstanceOf(OllamaAdapter);
  });

  it("explicit type=cli overrides auto-detect", () => {
    const adapter = createAdapter({
      name: "explicit-cli",
      type: "cli",
      command: "claude",
      args: ["-p"],
      enabled: true,
      personas: [],
    });
    expect(adapter).toBeInstanceOf(ClaudeAdapter);
  });
});
