#!/usr/bin/env node

/**
 * Agorai Connect — standalone stdio→HTTP proxy for MCP clients.
 *
 * Zero dependencies. Works with just Node.js 18+.
 *
 * Usage:
 *   node connect.mjs <bridge-url> <api-key>
 *   node connect.mjs http://my-vps:3100 my-secret-key
 *
 * Claude Desktop config:
 *   {
 *     "mcpServers": {
 *       "agorai": {
 *         "command": "node",
 *         "args": ["path/to/connect.mjs", "http://my-vps:3100", "my-secret-key"]
 *       }
 *     }
 *   }
 */

import { createInterface } from "node:readline";

const url = process.argv[2];
const apiKey = process.argv[3];

if (!url || !apiKey) {
  console.error("Usage: node connect.mjs <bridge-url> <api-key>");
  console.error("Example: node connect.mjs http://my-vps:3100 my-secret-key");
  process.exit(1);
}

const endpoint = url.endsWith("/mcp") ? url : url.replace(/\/$/, "") + "/mcp";
let sessionId;

const rl = createInterface({ input: process.stdin, terminal: false });

for await (const line of rl) {
  if (!line.trim()) continue;

  try {
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": `Bearer ${apiKey}`,
    };
    if (sessionId) {
      headers["mcp-session-id"] = sessionId;
    }

    const resp = await fetch(endpoint, {
      method: "POST",
      headers,
      body: line,
    });

    const sid = resp.headers.get("mcp-session-id");
    if (sid) sessionId = sid;

    if (resp.status === 202) continue;

    if (!resp.ok) {
      console.error(`[agorai connect] HTTP ${resp.status}: ${await resp.text()}`);
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
    console.error(`[agorai connect] ${err.message || err}`);
  }
}

// Cleanup session on exit
if (sessionId) {
  try {
    await fetch(endpoint, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "mcp-session-id": sessionId,
      },
    });
  } catch {}
}
