import { describe, it, expect } from "vitest";
import { getPersona, resolvePersonas, buildSystemPrompt, listPersonas, BUILTIN_PERSONAS } from "../personas.js";
import type { Config } from "../config.js";

const mockConfig = {
  personas: [
    {
      name: "devops",
      role: "DevOps Engineer",
      systemPrompt: "You are a DevOps engineer focused on CI/CD and infrastructure.",
      consensusBonus: 1.1,
    },
    {
      name: "architect",
      role: "Custom Architect",
      systemPrompt: "Custom architect override.",
      consensusBonus: 1.5,
    },
  ],
} as Config;

describe("getPersona", () => {
  it("returns built-in persona by name", () => {
    const p = getPersona("architect");
    expect(p).toBeDefined();
    expect(p!.role).toBe("Software Architect");
  });

  it("returns undefined for unknown name without config", () => {
    expect(getPersona("nonexistent")).toBeUndefined();
  });

  it("custom config overrides built-in", () => {
    const p = getPersona("architect", mockConfig);
    expect(p!.role).toBe("Custom Architect");
    expect(p!.consensusBonus).toBe(1.5);
  });

  it("returns custom persona from config", () => {
    const p = getPersona("devops", mockConfig);
    expect(p).toBeDefined();
    expect(p!.role).toBe("DevOps Engineer");
  });
});

describe("resolvePersonas", () => {
  it("resolves known persona names", () => {
    const result = resolvePersonas(["architect", "critic"]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("architect");
    expect(result[1].name).toBe("critic");
  });

  it("creates generic persona for unknown name", () => {
    const result = resolvePersonas(["unknown_role"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("unknown_role");
    expect(result[0].consensusBonus).toBe(1.0);
  });

  it("uses config overrides when provided", () => {
    const result = resolvePersonas(["architect"], mockConfig);
    expect(result[0].role).toBe("Custom Architect");
  });
});

describe("buildSystemPrompt", () => {
  it("returns empty string for no personas", () => {
    expect(buildSystemPrompt([])).toBe("");
  });

  it("returns single persona prompt directly", () => {
    const personas = resolvePersonas(["critic"]);
    const prompt = buildSystemPrompt(personas);
    expect(prompt).toContain("critical reviewer");
  });

  it("merges multiple persona prompts", () => {
    const personas = resolvePersonas(["architect", "security"]);
    const prompt = buildSystemPrompt(personas);
    expect(prompt).toContain("multiple roles");
    expect(prompt).toContain("Software Architect");
    expect(prompt).toContain("Security Specialist");
  });
});

describe("listPersonas", () => {
  it("returns all built-in personas without config", () => {
    const all = listPersonas();
    expect(all.length).toBe(BUILTIN_PERSONAS.length);
  });

  it("includes custom personas from config", () => {
    const all = listPersonas(mockConfig);
    const names = all.map((p) => p.name);
    expect(names).toContain("devops");
    expect(names).toContain("critic");
  });

  it("custom overrides built-in with same name", () => {
    const all = listPersonas(mockConfig);
    const arch = all.find((p) => p.name === "architect");
    expect(arch!.role).toBe("Custom Architect");
  });
});
