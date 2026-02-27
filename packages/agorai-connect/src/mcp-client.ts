/**
 * Lightweight MCP client for bridge communication.
 *
 * Only needs 3 operations: initialize, call tools, send notifications.
 * ~200 lines instead of pulling in @modelcontextprotocol/sdk + zod.
 *
 * Uses fetch (available in Node 18+).
 */

import { log } from "./utils.js";
import { randomUUID } from "node:crypto";

export interface McpClientOptions {
  bridgeUrl: string;
  passKey: string;
}

export interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export class McpClient {
  private readonly endpoint: string;
  private readonly passKey: string;
  private sessionId: string | undefined;
  private nextId = 1;

  constructor({ bridgeUrl, passKey }: McpClientOptions) {
    const base = bridgeUrl.replace(/\/+$/, "");
    this.endpoint = base.endsWith("/mcp") ? base : base + "/mcp";
    this.passKey = passKey;
  }

  /**
   * Initialize MCP session with the bridge.
   * Returns server capabilities and info.
   */
  async initialize(): Promise<{ serverInfo: Record<string, unknown>; capabilities: Record<string, unknown> }> {
    const result = await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "agorai-connect", version: "0.0.1" },
    });

    // Send initialized notification
    await this.notify("notifications/initialized", {});

    return result as { serverInfo: Record<string, unknown>; capabilities: Record<string, unknown> };
  }

  /**
   * Call a bridge MCP tool by name.
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    const result = await this.request("tools/call", { name, arguments: args });
    return result as ToolCallResult;
  }

  /**
   * List available tools on the bridge.
   */
  async listTools(): Promise<Array<{ name: string; description?: string }>> {
    const result = await this.request("tools/list", {});
    return (result as { tools: Array<{ name: string; description?: string }> }).tools;
  }

  /**
   * Close the MCP session (DELETE).
   */
  async close(): Promise<void> {
    if (!this.sessionId) return;

    try {
      await fetch(this.endpoint, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${this.passKey}`,
          "mcp-session-id": this.sessionId,
        },
      });
      log("debug", "Session closed");
    } catch {
      // Best effort
    }
  }

  // -------------------------------------------------------------------------
  // JSON-RPC transport
  // -------------------------------------------------------------------------

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });

    log("debug", `→ ${method} (id=${id})`);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": `Bearer ${this.passKey}`,
    };
    if (this.sessionId) {
      headers["mcp-session-id"] = this.sessionId;
    }

    const resp = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body,
    });

    // Capture session ID
    const sid = resp.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`MCP request ${method} failed: HTTP ${resp.status} — ${text}`);
    }

    // Parse response — handle SSE or plain JSON
    const contentType = resp.headers.get("content-type") ?? "";
    let responseText: string;

    if (contentType.includes("text/event-stream")) {
      const text = await resp.text();
      // Find the last data line (the actual JSON-RPC response)
      const dataLines = text.split("\n").filter((l) => l.startsWith("data: "));
      responseText = dataLines.length > 0 ? dataLines[dataLines.length - 1].slice(6) : "";
    } else {
      responseText = await resp.text();
    }

    if (!responseText.trim()) {
      throw new Error(`Empty response for ${method}`);
    }

    const rpc = JSON.parse(responseText) as {
      id: number;
      result?: unknown;
      error?: { code: number; message: string };
    };

    if (rpc.error) {
      throw new Error(`MCP error ${rpc.error.code}: ${rpc.error.message}`);
    }

    log("debug", `← ${method} OK`);
    return rpc.result;
  }

  private async notify(method: string, params: Record<string, unknown>): Promise<void> {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.passKey}`,
    };
    if (this.sessionId) {
      headers["mcp-session-id"] = this.sessionId;
    }

    const resp = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body,
    });

    // Capture session ID
    const sid = resp.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    // Notifications return 202 or 200 — both are fine
    if (!resp.ok && resp.status !== 202) {
      log("error", `Notification ${method} failed: HTTP ${resp.status}`);
    }
  }
}
