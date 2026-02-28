/**
 * Interactive setup — configures Claude Desktop to connect to an Agorai bridge.
 *
 * 1. Detects OS
 * 2. Finds Claude Desktop config file (known paths → search fallback → user pick)
 * 3. Prompts for bridge URL, agent name, pass-key (or uses CLI args)
 * 4. Tests bridge health
 * 5. Injects mcpServers.agorai into the config (merge, preserve others)
 * 6. On Windows: uses absolute node.exe path (Claude Desktop doesn't inherit PATH)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import {
  detectPlatform,
  findClaudeConfig,
  findAllClaudeConfigs,
  defaultConfigPath,
  resolveNodePath,
  type Platform,
} from "./config-paths.js";
import {
  prompt,
  promptDefault,
  closePrompt,
  checkHealth,
  log,
} from "./utils.js";

export interface SetupOptions {
  bridge?: string;
  key?: string;
  agent?: string;
  configPath?: string;
}

export interface SetupResult {
  configPath: string;
  bridgeUrl: string;
  agentName: string;
}

/**
 * Resolve the config path — explicit override, single match, or interactive pick.
 */
async function resolveConfigPath(os: Platform, explicit?: string): Promise<string> {
  // Explicit path override — use as-is
  if (explicit) {
    console.log(`Using config path: ${explicit}`);
    return explicit;
  }

  // Try known candidates first
  const found = findClaudeConfig(os);
  if (found) {
    console.log(`Found Claude Desktop config: ${found}`);
    return found;
  }

  // Fall back to filesystem search
  console.log("Config not found at known paths, searching filesystem...");
  const all = findAllClaudeConfigs(os);

  if (all.length === 1) {
    console.log(`Found config: ${all[0]}`);
    const confirm = await prompt("Use this path? [Y/n]: ");
    if (confirm.trim().toLowerCase() === "n") {
      const custom = await prompt("Enter config path: ");
      if (custom.trim()) return custom.trim();
    }
    return all[0];
  }

  if (all.length > 1) {
    console.log("Multiple Claude Desktop configs found:");
    for (let i = 0; i < all.length; i++) {
      console.log(`  ${i + 1}. ${all[i]}`);
    }
    const choice = await prompt(`Pick one (1-${all.length}): `);
    const idx = parseInt(choice.trim(), 10) - 1;
    if (idx >= 0 && idx < all.length) {
      return all[idx];
    }
    console.error("Invalid choice, using default path.");
  }

  // Nothing found — will create at default location
  const def = defaultConfigPath(os);
  console.log(`Claude Desktop config not found.`);
  console.log(`Will create: ${def}`);
  return def;
}

/**
 * Run the setup flow. Accepts optional CLI args — prompts for anything missing.
 */
export async function runSetup(options: SetupOptions = {}): Promise<SetupResult> {
  const os = detectPlatform();
  console.log(`Detected platform: ${os}`);

  const configPath = await resolveConfigPath(os, options.configPath);

  // Prompt for bridge details (use CLI args if provided)
  const bridgeUrl = options.bridge ?? await promptDefault("Bridge URL", "http://localhost:3100");
  const agentName = options.agent ?? await promptDefault("Agent name", "claude-desktop");

  let passKey: string;
  if (options.key) {
    passKey = options.key;
  } else {
    passKey = await prompt("Pass-key: ");
    if (!passKey) {
      console.error("Error: pass-key is required.");
      closePrompt();
      process.exit(1);
    }
  }

  // Test connection
  console.log(`\nTesting connection to ${bridgeUrl}...`);
  const health = await checkHealth(bridgeUrl);
  if (!health.ok) {
    console.error(`Cannot reach bridge: ${health.error}`);
    // In non-interactive mode (all args provided), just warn and continue
    if (!options.bridge || !options.key) {
      const proceed = await prompt("Continue anyway? [y/N]: ");
      if (proceed.trim().toLowerCase() !== "y") {
        closePrompt();
        process.exit(0);
      }
    } else {
      console.log("Continuing anyway (non-interactive mode).");
    }
  } else {
    console.log(`Bridge OK: ${health.name ?? "agorai"} v${health.version ?? "?"}`);
  }

  closePrompt();

  // Resolve the path to the connect proxy script
  const cliPath = pathResolve(dirname(new URL(import.meta.url).pathname), "cli.js");
  const nodePath = resolveNodePath(os);

  // Build the mcpServers entry
  const serverConfig = {
    command: nodePath,
    args: [cliPath, "proxy", bridgeUrl, passKey],
  };

  // Read existing config or start fresh
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    } catch (err) {
      console.error(`Warning: could not parse existing config, will overwrite.`);
    }
  }

  // Merge — preserve existing mcpServers
  const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;
  mcpServers["agorai"] = serverConfig;
  config.mcpServers = mcpServers;

  // Write
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

  console.log(`\nConfig written to: ${configPath}`);
  console.log(`Agent "${agentName}" configured with bridge at ${bridgeUrl}`);
  console.log(`\nRestart Claude Desktop to connect.`);

  return { configPath, bridgeUrl, agentName };
}
