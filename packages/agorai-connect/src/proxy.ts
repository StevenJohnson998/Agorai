/**
 * stdio→HTTP proxy for MCP clients (e.g. Claude Desktop).
 *
 * Reads JSON-RPC from stdin, POSTs to bridge /mcp endpoint,
 * writes responses to stdout. Handles SSE and plain JSON responses.
 *
 * Extracted from connect.mjs — same proven logic.
 */

import { createInterface } from "node:readline";
import { normalizeBridgeUrl, log } from "./utils.js";

export interface ProxyOptions {
  bridgeUrl: string;
  passKey: string;
}

/**
 * Run the stdio→HTTP proxy. Blocks until stdin closes, then cleans up the session.
 */
export async function runProxy({ bridgeUrl, passKey }: ProxyOptions): Promise<void> {
  const endpoint = normalizeBridgeUrl(bridgeUrl);
  let sessionId: string | undefined;

  log("info", `Proxy started → ${endpoint}`);

  const rl = createInterface({ input: process.stdin, terminal: false });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": `Bearer ${passKey}`,
      };
      if (sessionId) {
        headers["mcp-session-id"] = sessionId;
      }

      const resp = await fetch(endpoint, {
        method: "POST",
        headers,
        body: line,
      });

      // Capture session ID
      const sid = resp.headers.get("mcp-session-id");
      if (sid) sessionId = sid;

      // 202 = notification accepted, no response body
      if (resp.status === 202) continue;

      if (!resp.ok) {
        log("error", `HTTP ${resp.status}: ${await resp.text()}`);
        continue;
      }

      const contentType = resp.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream")) {
        const text = await resp.text();
        for (const sseLine of text.split("\n")) {
          if (sseLine.startsWith("data: ")) {
            process.stdout.write(sseLine.slice(6) + "\n");
          }
        }
      } else {
        const text = await resp.text();
        if (text.trim()) {
          process.stdout.write(text + "\n");
        }
      }
    } catch (err) {
      log("error", err instanceof Error ? err.message : String(err));
    }
  }

  // Stdin closed — clean up session
  if (sessionId) {
    log("info", "Cleaning up session", sessionId);
    try {
      await fetch(endpoint, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${passKey}`,
          "mcp-session-id": sessionId,
        },
      });
    } catch {
      // Best effort cleanup
    }
  }
}
