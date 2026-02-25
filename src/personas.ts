import type { PersonaConfig, Config } from "./config.js";

/**
 * Built-in personas for debate sessions.
 * Each persona has a role, a system prompt, and an optional consensus bonus
 * (used in quorum-weighted voting for specialized topics).
 */
export const BUILTIN_PERSONAS: readonly PersonaConfig[] = [
  {
    name: "architect",
    role: "Software Architect",
    systemPrompt:
      "You are a senior software architect. Focus on system design, scalability, " +
      "maintainability, and long-term trade-offs. Evaluate proposals against " +
      "established architectural patterns and principles.",
    consensusBonus: 1.0,
  },
  {
    name: "critic",
    role: "Devil's Advocate",
    systemPrompt:
      "You are a critical reviewer. Your job is to find flaws, edge cases, and " +
      "hidden assumptions in proposals. Challenge claims that lack evidence. " +
      "Be constructive but relentless in finding weaknesses.",
    consensusBonus: 1.0,
  },
  {
    name: "pragmatist",
    role: "Pragmatic Engineer",
    systemPrompt:
      "You are a pragmatic engineer focused on shipping. Evaluate proposals " +
      "based on implementation effort, time to market, and real-world constraints. " +
      "Prefer simple solutions over elegant but complex ones.",
    consensusBonus: 1.0,
  },
  {
    name: "security",
    role: "Security Specialist",
    systemPrompt:
      "You are a security specialist. Analyze proposals for vulnerabilities, " +
      "attack surfaces, data exposure, and compliance risks. Apply defense-in-depth " +
      "thinking and flag any shortcuts that compromise security.",
    consensusBonus: 1.3,
  },
] as const;

/**
 * Look up a persona by name. Checks custom config first, then built-ins.
 */
export function getPersona(name: string, config?: Config): PersonaConfig | undefined {
  // Custom personas in config take priority
  const custom = config?.personas.find((p) => p.name === name);
  if (custom) return custom;
  return BUILTIN_PERSONAS.find((p) => p.name === name);
}

/**
 * Resolve an array of persona names to PersonaConfig objects.
 * Unknown names get a generic persona so the debate can still run.
 */
export function resolvePersonas(names: string[], config?: Config): PersonaConfig[] {
  return names.map((name) => {
    const found = getPersona(name, config);
    if (found) return found;
    // Unknown persona — create a generic one so we don't break
    return {
      name,
      role: name,
      systemPrompt: `You are a ${name}. Analyze the question from this perspective.`,
      consensusBonus: 1.0,
    };
  });
}

/**
 * Build a system prompt from one or more personas.
 * When an agent has multiple roles, their instructions are merged
 * into a single coherent prompt.
 */
export function buildSystemPrompt(personas: PersonaConfig[]): string {
  if (personas.length === 0) return "";

  if (personas.length === 1) {
    return personas[0].systemPrompt;
  }

  // Multiple roles — merge into a combined prompt
  const roleLines = personas.map(
    (p) => `**${p.role}**: ${p.systemPrompt}`
  );

  return (
    "You have multiple roles in this debate. Integrate all perspectives " +
    "into a single coherent response.\n\n" +
    roleLines.join("\n\n")
  );
}

export function listPersonas(config?: Config): PersonaConfig[] {
  const all = new Map<string, PersonaConfig>();
  // Built-ins first
  for (const p of BUILTIN_PERSONAS) {
    all.set(p.name, p);
  }
  // Custom overrides
  if (config) {
    for (const p of config.personas) {
      all.set(p.name, p);
    }
  }
  return [...all.values()];
}
