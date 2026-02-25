/**
 * Minimal logger for Agorai — zero dependencies.
 *
 * Two output channels:
 *  1. stderr (console.error) — controlled by --verbose/--debug/AGORAI_LOG_LEVEL
 *  2. Log files (data/<user>/logs/) — always active when initFileLogging() is called
 *     - info.log          : global, info level+, append (lightweight metrics)
 *     - debates/<id>.log  : one per debate, all levels, full prompts/responses
 *
 * Purge strategies (configurable per channel in agorai.config.json):
 *  - info.log  : "date" (max days) or "size" (max bytes, truncates oldest lines)
 *  - debates/  : "count" (keep N newest), "date" (max days), or "size" (max total bytes)
 *
 * CRITICAL: MCP server uses stdio (stdout for JSON-RPC). All log output
 * MUST go to stderr via console.error() to avoid corrupting the protocol.
 */

import {
  appendFileSync, readFileSync, writeFileSync,
  mkdirSync, statSync, readdirSync, unlinkSync,
} from "node:fs";
import { join } from "node:path";

export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVELS: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const LEVEL_TAGS: Record<LogLevel, string> = { error: "ERR", warn: "WRN", info: "INF", debug: "DBG" };

// ── stderr level (interactive) ──────────────────────────────────────────

let stderrLevel: number = LEVELS[(process.env.AGORAI_LOG_LEVEL as LogLevel)] ?? LEVELS.warn;

export function setLogLevel(l: LogLevel): void {
  stderrLevel = LEVELS[l] ?? LEVELS.warn;
}

export function getLogLevel(): LogLevel {
  const entries = Object.entries(LEVELS) as [LogLevel, number][];
  return entries.find(([, v]) => v === stderrLevel)?.[0] ?? "warn";
}

// ── File logging config ─────────────────────────────────────────────────

export interface FileLoggingConfig {
  info?: {
    purge?: "date" | "size";
    maxDays?: number;
    maxBytes?: number;
  };
  debates?: {
    purge?: "count" | "date" | "size";
    maxFiles?: number;
    maxDays?: number;
    maxBytes?: number;
  };
}

interface ResolvedConfig {
  logsDir: string;
  debatesDir: string;
  infoLogPath: string;
  info: { purge: "date" | "size"; maxDays: number; maxBytes: number };
  debates: { purge: "count" | "date" | "size"; maxFiles: number; maxDays: number; maxBytes: number };
}

let cfg: ResolvedConfig | null = null;

/**
 * Initialize file logging. Call once at startup.
 * @param userDataDir  Base data directory for the user (e.g. "data/steven")
 * @param config       Logging config from agorai.config.json
 */
export function initFileLogging(userDataDir: string, config?: FileLoggingConfig): void {
  const logsDir = join(userDataDir, "logs");
  const debatesDir = join(logsDir, "debates");

  cfg = {
    logsDir,
    debatesDir,
    infoLogPath: join(logsDir, "info.log"),
    info: {
      purge: config?.info?.purge ?? "date",
      maxDays: config?.info?.maxDays ?? 30,
      maxBytes: config?.info?.maxBytes ?? 50 * 1024 * 1024,
    },
    debates: {
      purge: config?.debates?.purge ?? "count",
      maxFiles: config?.debates?.maxFiles ?? 50,
      maxDays: config?.debates?.maxDays ?? 14,
      maxBytes: config?.debates?.maxBytes ?? 100 * 1024 * 1024,
    },
  };

  mkdirSync(logsDir, { recursive: true });
  mkdirSync(debatesDir, { recursive: true });

  // Purge on startup
  purgeInfoLog();
  purgeDebateLogs();
}

// ── Formatting ──────────────────────────────────────────────────────────

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

function fullTs(): string {
  return new Date().toISOString();
}

/** Truncate a string for display. Full content goes to debate log files. */
export function truncate(s: string, maxLen = 500): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + `... (${s.length} chars total)`;
}

function formatArgs(args: unknown[]): string {
  return args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
}

// ── Core log function (stderr + info.log) ───────────────────────────────

const STDERR_MAX_LINE = 800;

function log(level: LogLevel, tag: string, args: unknown[]): void {
  const lvl = LEVELS[level];
  const levelTag = LEVEL_TAGS[level];
  const message = formatArgs(args);

  // stderr — truncated for readability
  if (stderrLevel >= lvl) {
    const short = message.length > STDERR_MAX_LINE
      ? message.slice(0, STDERR_MAX_LINE) + `... (${message.length} chars, full in debate log)`
      : message;
    console.error(ts(), levelTag, tag, short);
  }

  // info.log — info level and above only
  if (cfg && lvl <= LEVELS.info) {
    const line = `${fullTs()} ${levelTag} ${tag} ${message}\n`;
    try { appendFileSync(cfg.infoLogPath, line); } catch { /* best effort */ }
  }
}

// ── Per-debate log ──────────────────────────────────────────────────────

export interface DebateLog {
  /** Write a line to the debate log file (with timestamp). */
  write: (level: LogLevel, message: string) => void;
  /** Absolute path to this debate's log file. */
  readonly path: string;
}

/** Validate debateId is safe for use in file paths (UUID or alphanumeric+hyphens). */
const SAFE_DEBATE_ID = /^[a-zA-Z0-9_-]+$/;

export function isValidDebateId(debateId: string): boolean {
  return SAFE_DEBATE_ID.test(debateId) && debateId.length <= 128;
}

/**
 * Create a per-debate log file: data/<user>/logs/debates/<debateId>.log
 * Captures full prompts, responses, and debug details for this debate.
 */
export function createDebateLog(debateId: string): DebateLog | null {
  if (!cfg) return null;
  if (!isValidDebateId(debateId)) {
    log("warn", "[logger]", [`Invalid debateId for log file (rejected): ${debateId}`]);
    return null;
  }

  const path = join(cfg.debatesDir, `${debateId}.log`);

  return {
    write(level: LogLevel, message: string): void {
      const line = `${fullTs()} ${LEVEL_TAGS[level]} ${message}\n`;
      try { appendFileSync(path, line); } catch { /* best effort */ }
    },
    path,
  };
}

// ── Purge: info.log ─────────────────────────────────────────────────────

function purgeInfoLog(): void {
  if (!cfg) return;
  switch (cfg.info.purge) {
    case "date":  purgeInfoByDate(cfg.info.maxDays); break;
    case "size":  purgeInfoBySize(cfg.info.maxBytes); break;
  }
}

function purgeInfoByDate(maxDays: number): void {
  if (!cfg) return;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxDays);
  const cutoffStr = cutoff.toISOString();

  try {
    const content = readFileSync(cfg.infoLogPath, "utf-8");
    const lines = content.split("\n");
    const kept = lines.filter((line) => {
      const lineTs = line.slice(0, 24);
      return lineTs >= cutoffStr || line.trim() === "";
    });
    writeFileSync(cfg.infoLogPath, kept.join("\n"));
  } catch { /* file doesn't exist yet */ }
}

function purgeInfoBySize(maxBytes: number): void {
  if (!cfg) return;
  try {
    const stats = statSync(cfg.infoLogPath);
    if (stats.size <= maxBytes) return;

    const content = readFileSync(cfg.infoLogPath, "utf-8");
    const trimmed = content.slice(content.length - maxBytes);
    const firstNewline = trimmed.indexOf("\n");
    writeFileSync(cfg.infoLogPath, firstNewline >= 0 ? trimmed.slice(firstNewline + 1) : trimmed);
  } catch { /* file doesn't exist yet */ }
}

// ── Purge: debate logs ──────────────────────────────────────────────────

interface DebateFileInfo {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
}

function listDebateFiles(): DebateFileInfo[] {
  if (!cfg) return [];
  try {
    return readdirSync(cfg.debatesDir)
      .filter((f) => f.endsWith(".log"))
      .map((name) => {
        const path = join(cfg!.debatesDir, name);
        const stats = statSync(path);
        return { name, path, size: stats.size, mtimeMs: stats.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first
  } catch {
    return [];
  }
}

function purgeDebateLogs(): void {
  if (!cfg) return;
  switch (cfg.debates.purge) {
    case "count": purgeDebatesByCount(cfg.debates.maxFiles); break;
    case "date":  purgeDebatesByDate(cfg.debates.maxDays); break;
    case "size":  purgeDebatesBySize(cfg.debates.maxBytes); break;
  }
}

function purgeDebatesByCount(maxFiles: number): void {
  const files = listDebateFiles();
  for (const file of files.slice(maxFiles)) {
    try { unlinkSync(file.path); } catch { /* best effort */ }
  }
}

function purgeDebatesByDate(maxDays: number): void {
  const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
  for (const file of listDebateFiles()) {
    if (file.mtimeMs < cutoff) {
      try { unlinkSync(file.path); } catch { /* best effort */ }
    }
  }
}

function purgeDebatesBySize(maxBytes: number): void {
  let totalSize = 0;
  for (const file of listDebateFiles()) { // newest first
    totalSize += file.size;
    if (totalSize > maxBytes) {
      try { unlinkSync(file.path); } catch { /* best effort */ }
    }
  }
}

// ── Logger factory ──────────────────────────────────────────────────────

export function createLogger(namespace: string) {
  const tag = `[${namespace}]`;
  return {
    error: (...args: unknown[]) => log("error", tag, args),
    warn:  (...args: unknown[]) => log("warn", tag, args),
    info:  (...args: unknown[]) => log("info", tag, args),
    debug: (...args: unknown[]) => log("debug", tag, args),
  };
}
