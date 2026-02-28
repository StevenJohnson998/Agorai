/**
 * Config manager — programmatic CRUD for agents in agorai.config.json.
 *
 * Reads/writes raw JSON (no Zod parsing) to preserve user formatting and extra fields.
 * Handles both bridge.apiKeys[] (auth) and agents[] (adapter config) in sync.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

// --- Types ---

export type ClearanceLevel = "public" | "team" | "confidential" | "restricted";

/** Agent types and what they create */
export type AgentType = "claude-desktop" | "claude-code" | "openai-compat" | "ollama" | "custom";

/** Types that require an agents[] entry (have their own adapter config) */
const ADAPTER_TYPES: ReadonlySet<AgentType> = new Set(["openai-compat", "ollama"]);

export interface AddAgentOpts {
  name: string;
  type: AgentType;
  model?: string;
  endpoint?: string;
  apiKeyEnv?: string;
  clearance?: ClearanceLevel;
}

export interface UpdateAgentOpts {
  model?: string;
  endpoint?: string;
  apiKeyEnv?: string;
  clearance?: ClearanceLevel;
  enabled?: boolean;
}

export interface AgentInfo {
  name: string;
  type: string;
  model: string | null;
  endpoint: string | null;
  apiKeyEnv: string | null;
  apiKeySet: boolean;
  clearance: ClearanceLevel;
  enabled: boolean;
}

// --- Raw config shape (loose, preserves extra fields) ---

interface RawApiKey {
  key: string;
  agent: string;
  type: string;
  clearanceLevel?: string;
  [k: string]: unknown;
}

interface RawAgentEntry {
  name: string;
  type?: string;
  model?: string;
  endpoint?: string;
  apiKeyEnv?: string;
  enabled?: boolean;
  [k: string]: unknown;
}

interface RawConfig {
  agents?: RawAgentEntry[];
  bridge?: {
    apiKeys?: RawApiKey[];
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

// --- Config file discovery ---

const CONFIG_FILENAMES = ["agorai.config.json", ".agorairc.json"];

/**
 * Find the config file path in cwd.
 * Throws if no config file exists.
 */
export function findConfigPath(): string {
  for (const filename of CONFIG_FILENAMES) {
    const fullPath = resolve(process.cwd(), filename);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }
  throw new Error(
    "No agorai.config.json found in current directory. Run 'agorai init' first."
  );
}

/**
 * Load raw JSON config without Zod validation (preserves all fields).
 */
export function loadRawConfig(configPath?: string): RawConfig {
  const path = configPath ?? findConfigPath();
  const content = readFileSync(path, "utf-8");
  return JSON.parse(content) as RawConfig;
}

/**
 * Write config back to disk with consistent formatting.
 */
export function saveConfig(config: RawConfig, configPath?: string): void {
  const path = configPath ?? findConfigPath();
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
}

/**
 * Generate a random pass-key (base64url, 24 bytes = 32 chars).
 */
export function generatePassKey(): string {
  return randomBytes(24).toString("base64url");
}

// --- Agent CRUD ---

/**
 * Add an agent to the config.
 * Creates a bridge.apiKeys[] entry (always) and an agents[] entry (for adapter types).
 * Returns the generated pass-key for display.
 */
export function addAgent(opts: AddAgentOpts, configPath?: string): { passKey: string } {
  const config = loadRawConfig(configPath);

  // Ensure bridge section exists
  if (!config.bridge) {
    config.bridge = { apiKeys: [] };
  }
  if (!config.bridge.apiKeys) {
    config.bridge.apiKeys = [];
  }
  if (!config.agents) {
    config.agents = [];
  }

  // Check for duplicate name in bridge.apiKeys
  const existing = config.bridge.apiKeys.find(
    (k) => k.agent === opts.name
  );
  if (existing) {
    throw new Error(`Agent "${opts.name}" already exists`);
  }

  // Also check agents[]
  const existingAgent = config.agents.find((a) => a.name === opts.name);
  if (existingAgent) {
    throw new Error(`Agent "${opts.name}" already exists in agents[]`);
  }

  // Generate pass-key
  const passKey = generatePassKey();

  // Validate env var (warn only)
  let envVarWarning: string | undefined;
  if (opts.apiKeyEnv && !process.env[opts.apiKeyEnv]) {
    envVarWarning = opts.apiKeyEnv;
  }

  // Add to bridge.apiKeys
  const apiKeyEntry: RawApiKey = {
    key: passKey,
    agent: opts.name,
    type: opts.type,
    clearanceLevel: opts.clearance ?? "team",
  };
  config.bridge.apiKeys.push(apiKeyEntry);

  // Add to agents[] for adapter types
  if (ADAPTER_TYPES.has(opts.type)) {
    const agentEntry: RawAgentEntry = {
      name: opts.name,
      type: opts.type,
      enabled: true,
    };
    if (opts.model) agentEntry.model = opts.model;
    if (opts.endpoint) agentEntry.endpoint = opts.endpoint;
    if (opts.apiKeyEnv) agentEntry.apiKeyEnv = opts.apiKeyEnv;
    config.agents.push(agentEntry);
  }

  saveConfig(config, configPath);

  return { passKey };
}

/**
 * List all agents by merging bridge.apiKeys[] and agents[].
 */
export function listAgents(configPath?: string): AgentInfo[] {
  const config = loadRawConfig(configPath);
  const apiKeys = config.bridge?.apiKeys ?? [];
  const agents = config.agents ?? [];

  // Build a map of agents[] entries by name
  const agentMap = new Map<string, RawAgentEntry>();
  for (const a of agents) {
    agentMap.set(a.name, a);
  }

  const result: AgentInfo[] = [];

  for (const key of apiKeys) {
    const agentEntry = agentMap.get(key.agent);

    result.push({
      name: key.agent,
      type: key.type ?? "custom",
      model: agentEntry?.model ?? null,
      endpoint: agentEntry?.endpoint ?? null,
      apiKeyEnv: agentEntry?.apiKeyEnv ?? null,
      apiKeySet: agentEntry?.apiKeyEnv
        ? !!process.env[agentEntry.apiKeyEnv]
        : true, // no env var needed
      clearance: (key.clearanceLevel as ClearanceLevel) ?? "team",
      enabled: agentEntry?.enabled !== false,
    });

    // Remove from map so we can detect orphan agents
    agentMap.delete(key.agent);
  }

  // Add orphan agents (in agents[] but not in bridge.apiKeys[])
  for (const [, agentEntry] of agentMap) {
    result.push({
      name: agentEntry.name,
      type: agentEntry.type ?? "unknown",
      model: agentEntry.model ?? null,
      endpoint: agentEntry.endpoint ?? null,
      apiKeyEnv: agentEntry.apiKeyEnv ?? null,
      apiKeySet: agentEntry.apiKeyEnv
        ? !!process.env[agentEntry.apiKeyEnv]
        : true,
      clearance: "team",
      enabled: agentEntry.enabled !== false,
    });
  }

  return result;
}

/**
 * Update an existing agent's configuration.
 */
export function updateAgent(
  name: string,
  opts: UpdateAgentOpts,
  configPath?: string
): { changes: string[] } {
  const config = loadRawConfig(configPath);
  const changes: string[] = [];

  // Find in bridge.apiKeys
  const apiKeyEntry = config.bridge?.apiKeys?.find((k) => k.agent === name);
  // Find in agents[]
  const agentEntry = config.agents?.find((a) => a.name === name);

  if (!apiKeyEntry && !agentEntry) {
    throw new Error(`Agent "${name}" not found`);
  }

  // Update clearance in bridge.apiKeys
  if (opts.clearance !== undefined && apiKeyEntry) {
    const old = apiKeyEntry.clearanceLevel ?? "team";
    apiKeyEntry.clearanceLevel = opts.clearance;
    changes.push(`clearance: ${old} → ${opts.clearance}`);
  }

  // Update adapter fields in agents[]
  if (agentEntry) {
    if (opts.model !== undefined) {
      const old = agentEntry.model ?? "(none)";
      agentEntry.model = opts.model;
      changes.push(`model: ${old} → ${opts.model}`);
    }
    if (opts.endpoint !== undefined) {
      const old = agentEntry.endpoint ?? "(none)";
      agentEntry.endpoint = opts.endpoint;
      changes.push(`endpoint: ${old} → ${opts.endpoint}`);
    }
    if (opts.apiKeyEnv !== undefined) {
      const old = agentEntry.apiKeyEnv ?? "(none)";
      agentEntry.apiKeyEnv = opts.apiKeyEnv;
      changes.push(`apiKeyEnv: ${old} → ${opts.apiKeyEnv}`);
      if (!process.env[opts.apiKeyEnv]) {
        changes.push(`⚠ env var ${opts.apiKeyEnv} is not set`);
      }
    }
    if (opts.enabled !== undefined) {
      const old = agentEntry.enabled !== false;
      agentEntry.enabled = opts.enabled;
      changes.push(`enabled: ${old} → ${opts.enabled}`);
    }
  }

  if (changes.length === 0) {
    throw new Error("No changes specified");
  }

  saveConfig(config, configPath);
  return { changes };
}

/**
 * Remove an agent from both bridge.apiKeys[] and agents[].
 */
export function removeAgent(name: string, configPath?: string): void {
  const config = loadRawConfig(configPath);

  const apiKeyIdx = config.bridge?.apiKeys?.findIndex(
    (k) => k.agent === name
  );
  const agentIdx = config.agents?.findIndex((a) => a.name === name);

  const foundInApiKeys = apiKeyIdx !== undefined && apiKeyIdx >= 0;
  const foundInAgents = agentIdx !== undefined && agentIdx >= 0;

  if (!foundInApiKeys && !foundInAgents) {
    throw new Error(`Agent "${name}" not found`);
  }

  if (foundInApiKeys && config.bridge?.apiKeys) {
    config.bridge.apiKeys.splice(apiKeyIdx!, 1);
  }
  if (foundInAgents && config.agents) {
    config.agents.splice(agentIdx!, 1);
  }

  saveConfig(config, configPath);
}
