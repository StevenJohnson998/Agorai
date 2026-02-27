/**
 * Interactive setup — configures Claude Desktop to connect to an Agorai bridge.
 *
 * 1. Detects OS
 * 2. Finds Claude Desktop config file
 * 3. Prompts for bridge URL, agent name, pass-key
 * 4. Tests bridge health
 * 5. Injects mcpServers.agorai into the config (merge, preserve others)
 * 6. On Windows: uses absolute node.exe path (Claude Desktop doesn't inherit PATH)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import {
  detectPlatform,
  findClaudeConfig,
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

export interface SetupResult {
  configPath: string;
  bridgeUrl: string;
  agentName: string;
}

/**
 * Run the interactive setup flow.
 */
export async function runSetup(): Promise<SetupResult> {
  const os = detectPlatform();
  console.log(`Detected platform: ${os}`);

  // Find or create config path
  let configPath = findClaudeConfig(os);
  if (configPath) {
    console.log(`Found Claude Desktop config: ${configPath}`);
  } else {
    configPath = defaultConfigPath(os);
    console.log(`Claude Desktop config not found.`);
    console.log(`Will create: ${configPath}`);
  }

  // Prompt for bridge details
  const bridgeUrl = await promptDefault("Bridge URL", "http://localhost:3100");
  const agentName = await promptDefault("Agent name", "claude-desktop");
  const passKey = await prompt("Pass-key: ");

  if (!passKey) {
    console.error("Error: pass-key is required.");
    closePrompt();
    process.exit(1);
  }

  // Test connection
  console.log(`\nTesting connection to ${bridgeUrl}...`);
  const health = await checkHealth(bridgeUrl);
  if (!health.ok) {
    console.error(`Cannot reach bridge: ${health.error}`);
    const proceed = await prompt("Continue anyway? [y/N]: ");
    if (proceed.trim().toLowerCase() !== "y") {
      closePrompt();
      process.exit(0);
    }
  } else {
    console.log(`Bridge OK: ${health.name ?? "agorai"} v${health.version ?? "?"}`);
  }

  closePrompt();

  // Resolve the path to the connect proxy script
  // When installed via npm, the proxy is at ./dist/cli.js in the package
  // We need the absolute path to this package's cli.js
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
