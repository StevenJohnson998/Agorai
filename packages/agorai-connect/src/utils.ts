/**
 * Shared utilities — logging, prompts, URL normalization, health check.
 * Zero dependencies (node:readline, node:https, node:http only).
 */

import { createInterface, type Interface } from "node:readline";
import http from "node:http";
import https from "node:https";

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export type LogLevel = "silent" | "error" | "info" | "debug";

let currentLevel: LogLevel = "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  info: 2,
  debug: 3,
};

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function log(level: Exclude<LogLevel, "silent">, ...args: unknown[]): void {
  if (LEVEL_RANK[level] <= LEVEL_RANK[currentLevel]) {
    const prefix = `[agorai-connect] [${level}]`;
    console.error(prefix, ...args);
  }
}

// ---------------------------------------------------------------------------
// URL normalization
// ---------------------------------------------------------------------------

/** Ensure URL ends with /mcp */
export function normalizeBridgeUrl(url: string): string {
  const base = url.replace(/\/+$/, "");
  return base.endsWith("/mcp") ? base : base + "/mcp";
}

/** Strip /mcp to get the base URL */
export function baseUrl(url: string): string {
  return url.replace(/\/mcp\/?$/, "").replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export interface HealthResult {
  ok: boolean;
  name?: string;
  version?: string;
  error?: string;
}

/** Check bridge /health endpoint. Returns parsed result or error. */
export async function checkHealth(bridgeBaseUrl: string, timeoutMs = 5000): Promise<HealthResult> {
  const url = `${baseUrl(bridgeBaseUrl)}/health`;
  try {
    const body = await httpGet(url, timeoutMs);
    const data = JSON.parse(body) as Record<string, unknown>;
    return {
      ok: true,
      name: data.name as string | undefined,
      version: data.version as string | undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Simple HTTP GET (no deps)
// ---------------------------------------------------------------------------

export function httpGet(url: string, timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;

    const req = transport.get(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          } else {
            resolve(data);
          }
        });
      },
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeoutMs}ms`));
    });
  });
}

// ---------------------------------------------------------------------------
// Interactive prompt
// ---------------------------------------------------------------------------

let sharedRl: Interface | undefined;

function getRl(): Interface {
  if (!sharedRl) {
    sharedRl = createInterface({ input: process.stdin, output: process.stderr });
  }
  return sharedRl;
}

export function closePrompt(): void {
  sharedRl?.close();
  sharedRl = undefined;
}

export function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    getRl().question(question, (answer) => resolve(answer));
  });
}

export function promptDefault(question: string, defaultValue: string): Promise<string> {
  return prompt(`${question} [${defaultValue}]: `).then((v) => v.trim() || defaultValue);
}
