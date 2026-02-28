/**
 * Uninstall — removes agorai from Claude Desktop config.
 *
 * Only removes the mcpServers.agorai entry; preserves everything else.
 * If mcpServers becomes empty, removes the mcpServers key too.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  detectPlatform,
  findAllClaudeConfigs,
  loadInstallMeta,
  removeInstallMeta,
} from "./config-paths.js";
import { prompt, closePrompt } from "./utils.js";

export interface UninstallOptions {
  configPath?: string;
}

export interface UninstallResult {
  configPath: string;
  removed: boolean;
}

/**
 * Remove the agorai entry from Claude Desktop config.
 */
export async function runUninstall(options: UninstallOptions = {}): Promise<UninstallResult> {
  const os = detectPlatform();

  // Resolve config path: explicit arg → saved from setup → detection
  let configPath: string | null = options.configPath ?? null;

  if (!configPath) {
    const meta = loadInstallMeta();
    if (meta && existsSync(meta.configPath)) {
      configPath = meta.configPath;
      console.log(`Found install record: ${configPath}`);
    }
  }

  if (!configPath) {
    const all = findAllClaudeConfigs(os);

    if (all.length === 1) {
      configPath = all[0];
    } else if (all.length > 1) {
      console.log("Multiple Claude Desktop configs found:");
      for (let i = 0; i < all.length; i++) {
        console.log(`  ${i + 1}. ${all[i]}`);
      }
      const choice = await prompt(`Which one? (1-${all.length}): `);
      closePrompt();
      const idx = parseInt(choice.trim(), 10) - 1;
      if (idx >= 0 && idx < all.length) {
        configPath = all[idx];
      } else {
        console.error("Invalid choice.");
        return { configPath: "", removed: false };
      }
    }
  }

  if (!configPath || !existsSync(configPath)) {
    console.error("Claude Desktop config not found. Nothing to uninstall.");
    closePrompt();
    return { configPath: configPath ?? "", removed: false };
  }

  closePrompt();

  // Parse config
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    console.error(`Error: could not parse config at ${configPath}`);
    return { configPath, removed: false };
  }

  const mcpServers = config.mcpServers as Record<string, unknown> | undefined;

  if (!mcpServers || !("agorai" in mcpServers)) {
    console.log("Agorai is not configured in Claude Desktop. Nothing to remove.");
    return { configPath, removed: false };
  }

  // Remove the agorai entry
  delete mcpServers["agorai"];

  // Clean up empty mcpServers
  if (Object.keys(mcpServers).length === 0) {
    delete config.mcpServers;
  }

  // Write back
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

  // Clean up install metadata
  removeInstallMeta();

  console.log(`Removed agorai from: ${configPath}`);
  console.log("Restart Claude Desktop to apply.");

  return { configPath, removed: true };
}
