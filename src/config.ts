import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";

// --- Schemas ---

export const AgentConfigSchema = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  /** Default personas assigned to this agent (can be overridden per debate) */
  personas: z.array(z.string()).default([]),

  // CLI-based agents (claude, gemini, etc.)
  command: z.string().optional().describe("CLI command (e.g. 'claude', 'gemini')"),
  args: z.array(z.string()).default([]),

  // Ollama HTTP API agents
  model: z.string().optional().describe("Ollama model name (e.g. 'qwen3', 'llama3')"),
  endpoint: z.string().default("http://localhost:11434").describe("Ollama API endpoint"),
});

export const PersonaConfigSchema = z.object({
  name: z.string(),
  role: z.string(),
  systemPrompt: z.string(),
  consensusBonus: z.number().min(0).max(2).default(1.0),
});

export const ConfigSchema = z.object({
  /** User identifier. Determines the data directory: data/<user>/. */
  user: z.string().default("default"),

  thoroughness: z
    .number()
    .min(0)
    .max(1)
    .default(0.5)
    .describe("Balance completeness vs cost (0=cheap, 1=thorough)"),

  agents: z.array(AgentConfigSchema).default([
    {
      name: "claude",
      command: "claude",
      args: ["-p", "--output-format", "json"],
      personas: ["architect"],
      enabled: true,
    },
    {
      name: "gemini",
      command: "gemini",
      args: ["-p", "--output-format", "json"],
      personas: ["pragmatist"],
      enabled: false,
    },
  ]),

  /** Custom persona definitions (extend or override built-ins) */
  personas: z.array(PersonaConfigSchema).default([]),

  budget: z
    .object({
      /** Max total tokens (input + output) per debate. 0 = unlimited. */
      maxTokensPerDebate: z.number().int().min(0).default(0),
      /** Max total tokens per project (across all debates). 0 = unlimited. */
      maxTokensPerProject: z.number().int().min(0).default(0),
      /** Warn user when this percentage of budget is consumed (0-100) */
      warnAtPercent: z.number().min(0).max(100).default(80),
      /** Estimated tokens per agent invocation (for pre-debate cost estimation). */
      estimatedTokensPerInvocation: z.number().int().min(0).default(1500),
    })
    .default({})
    .describe("Token budget limits. The orchestrator adapts when approaching the cap."),

  database: z
    .object({
      path: z.string().default("./data/agorai.db"),
    })
    .default({}),

  logging: z
    .object({
      /** info.log purge config (global metrics file) */
      info: z.object({
        /** Purge strategy: "date" (by age), "size" (by file size). Default: "date" */
        purge: z.enum(["date", "size"]).default("date"),
        /** Max age in days (for "date" strategy). Default: 30 */
        maxDays: z.number().int().min(1).default(30),
        /** Max file size in bytes (for "size" strategy). Default: 50MB */
        maxBytes: z.number().int().min(0).default(50 * 1024 * 1024),
      }).default({}),
      /** Per-debate debug log purge config (data/logs/debates/) */
      debates: z.object({
        /** Purge strategy: "count" (N newest), "date" (by age), "size" (total size). Default: "count" */
        purge: z.enum(["count", "date", "size"]).default("count"),
        /** Max number of debate log files (for "count" strategy). Default: 50 */
        maxFiles: z.number().int().min(1).default(50),
        /** Max age in days (for "date" strategy). Default: 14 */
        maxDays: z.number().int().min(1).default(14),
        /** Max total size in bytes of all debate logs (for "size" strategy). Default: 100MB */
        maxBytes: z.number().int().min(0).default(100 * 1024 * 1024),
      }).default({}),
    })
    .default({}),

  privacy: z
    .object({
      sensitivePatterns: z
        .array(z.string())
        .default([
          "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z]{2,}\\b",
          "\\b(?:sk|pk|api|token|key|secret)[_-]?[a-zA-Z0-9]{16,}\\b",
          "\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b",
          "\\bpassword\\s*[:=]\\s*\\S+",
        ]),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type PersonaConfig = z.infer<typeof PersonaConfigSchema>;

/** Directory where the loaded config file was found (null if defaults used). */
let loadedConfigDir: string | null = null;

/** Reset loadedConfigDir to null. Exported for testing only. */
export function resetLoadedConfigDir(): void {
  loadedConfigDir = null;
}

/**
 * Base data directory for a user.
 * - If a config file was loaded: resolves relative to its directory → <configDir>/data/<user>/
 * - Otherwise: uses XDG_DATA_HOME/agorai/<user> (fallback ~/.local/share/agorai/<user>)
 */
export function getUserDataDir(config: Config): string {
  if (loadedConfigDir) {
    return resolve(loadedConfigDir, "data", config.user);
  }
  const xdg = process.env.XDG_DATA_HOME || resolve(homedir(), ".local", "share");
  return resolve(xdg, "agorai", config.user);
}

// --- Loader ---

const CONFIG_FILENAMES = ["agorai.config.json", ".agorairc.json"];

export function loadConfig(explicitPath?: string): Config {
  if (explicitPath) {
    loadedConfigDir = dirname(resolve(explicitPath));
    const raw = JSON.parse(readFileSync(explicitPath, "utf-8"));
    return ConfigSchema.parse(raw);
  }

  for (const filename of CONFIG_FILENAMES) {
    const fullPath = resolve(process.cwd(), filename);
    if (existsSync(fullPath)) {
      loadedConfigDir = dirname(fullPath);
      const raw = JSON.parse(readFileSync(fullPath, "utf-8"));
      return ConfigSchema.parse(raw);
    }
  }

  // No config file found — use defaults (XDG path via getUserDataDir)
  loadedConfigDir = null;
  return ConfigSchema.parse({});
}
