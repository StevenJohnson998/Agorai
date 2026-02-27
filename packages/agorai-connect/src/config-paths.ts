/**
 * OS detection + Claude Desktop config file paths.
 * Zero dependencies (node:os, node:path, node:fs).
 */

import { platform, homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

export type Platform = "windows" | "macos" | "linux";

export function detectPlatform(): Platform {
  const p = platform();
  if (p === "win32") return "windows";
  if (p === "darwin") return "macos";
  return "linux";
}

/**
 * Known paths for Claude Desktop's config file, per platform.
 * Ordered from most common to least.
 */
function configCandidates(os: Platform): string[] {
  const home = homedir();

  switch (os) {
    case "windows":
      return [
        join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json"),
        join(home, ".config", "Claude", "claude_desktop_config.json"),
      ];
    case "macos":
      return [
        join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
      ];
    case "linux":
      return [
        join(home, ".config", "Claude", "claude_desktop_config.json"),
        join(home, ".local", "share", "Claude", "claude_desktop_config.json"),
      ];
  }
}

/**
 * Find the Claude Desktop config file on this system.
 * Returns the path if found, null otherwise.
 */
export function findClaudeConfig(os?: Platform): string | null {
  const p = os ?? detectPlatform();
  for (const candidate of configCandidates(p)) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Return the best candidate path for creating a new config, even if it doesn't exist yet.
 */
export function defaultConfigPath(os?: Platform): string {
  const p = os ?? detectPlatform();
  return configCandidates(p)[0];
}

/**
 * Resolve node executable path — on Windows, Claude Desktop doesn't inherit PATH,
 * so we need the absolute path to node.exe.
 */
export function resolveNodePath(os?: Platform): string {
  const p = os ?? detectPlatform();
  if (p === "windows") {
    return process.execPath; // Full path like C:\Program Files\nodejs\node.exe
  }
  return "node";
}
