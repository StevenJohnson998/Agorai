/**
 * OS detection + Claude Desktop config file paths.
 * Zero dependencies (node:os, node:path, node:fs).
 */

import { platform, homedir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";

export type Platform = "windows" | "macos" | "linux";

export function detectPlatform(): Platform {
  const p = platform();
  if (p === "win32") return "windows";
  if (p === "darwin") return "macos";
  return "linux";
}

const CONFIG_FILENAME = "claude_desktop_config.json";

/**
 * Known paths for Claude Desktop's config file, per platform.
 * Ordered from most common to least.
 */
export function configCandidates(os: Platform): string[] {
  const home = homedir();

  switch (os) {
    case "windows":
      return [
        join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Claude", CONFIG_FILENAME),
        // Windows Store install uses a package-scoped LocalCache directory
        join(
          process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"),
          "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "Claude",
          CONFIG_FILENAME,
        ),
        join(home, ".config", "Claude", CONFIG_FILENAME),
      ];
    case "macos":
      return [
        join(home, "Library", "Application Support", "Claude", CONFIG_FILENAME),
      ];
    case "linux":
      return [
        join(home, ".config", "Claude", CONFIG_FILENAME),
        join(home, ".local", "share", "Claude", CONFIG_FILENAME),
      ];
  }
}

/**
 * Find the Claude Desktop config file on this system.
 * Tries known candidates first, then falls back to a filesystem search.
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
 * Search common directories for claude_desktop_config.json.
 * Used as a fallback when known candidates don't match.
 * Returns all found paths (may be empty).
 */
export function searchClaudeConfig(os?: Platform): string[] {
  const p = os ?? detectPlatform();
  const home = homedir();

  const roots: string[] = [];
  switch (p) {
    case "windows":
      roots.push(
        process.env.APPDATA ?? join(home, "AppData", "Roaming"),
        process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"),
      );
      break;
    case "macos":
      roots.push(join(home, "Library"));
      break;
    case "linux":
      roots.push(join(home, ".config"), join(home, ".local"));
      break;
  }

  const results: string[] = [];
  const MAX_DEPTH = 5;

  function walk(dir: string, depth: number): void {
    if (depth > MAX_DEPTH) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // permission denied, etc.
    }
    for (const entry of entries) {
      if (entry === CONFIG_FILENAME) {
        results.push(join(dir, entry));
        continue;
      }
      // Skip common heavy directories that won't contain config
      if (entry === "node_modules" || entry === ".git" || entry === "Cache" || entry === "CachedData") {
        continue;
      }
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full, depth + 1);
        }
      } catch {
        // skip inaccessible
      }
    }
  }

  for (const root of roots) {
    if (existsSync(root)) {
      walk(root, 0);
    }
  }

  return results;
}

/**
 * Find all Claude Desktop config files: known candidates + search fallback.
 * Deduplicates results.
 */
export function findAllClaudeConfigs(os?: Platform): string[] {
  const p = os ?? detectPlatform();
  const found = new Set<string>();

  // Check known candidates first
  for (const candidate of configCandidates(p)) {
    if (existsSync(candidate)) {
      found.add(candidate);
    }
  }

  // Fall back to search if nothing found via candidates
  if (found.size === 0) {
    for (const path of searchClaudeConfig(p)) {
      found.add(path);
    }
  }

  return [...found];
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
