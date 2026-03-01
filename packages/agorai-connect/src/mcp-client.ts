/**
 * Lightweight MCP client for bridge communication.
 *
 * Only needs 3 operations: initialize, call tools, send notifications.
 * ~200 lines instead of pulling in @modelcontextprotocol/sdk + zod.
 *
 * Uses fetch (available in Node 18+).
 */

import { log } from "./utils.js";
import { SessionExpiredError, BridgeUnreachableError } from "./errors.js";

export interface McpClientOptions {
  bridgeUrl: string;
  passKey: string;
}

export interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export interface SSENotification {
  method: string;
  params: Record<string, unknown>;
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
   * Reset session state — used for recovery after bridge restart.
   * Clears sessionId and resets message counter.
   */
  resetSession(): void {
    this.sessionId = undefined;
    this.nextId = 1;
    log("debug", "Session state reset");
  }

  /**
   * Initialize MCP session with the bridge.
   * Returns server capabilities and info.
   */
  async initialize(): Promise<{ serverInfo: Record<string, unknown>; capabilities: Record<string, unknown> }> {
    const result = await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "agorai-connect", version: "0.0.3" },
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
   * Close the MCP session (DELETE). Fire-and-forget — errors are swallowed.
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
      // Best effort — bridge may already be down
    }
  }

  // -------------------------------------------------------------------------
  // SSE stream for push notifications
  // -------------------------------------------------------------------------

  /**
   * Open a Server-Sent Events stream to receive push notifications.
   *
   * Requires an active session (call initialize() first).
   * Auto-reconnects on disconnect with a 3s delay.
   * Returns an AbortController — call .abort() to close the stream.
   */
  openSSEStream(onNotification: (notification: SSENotification) => void): AbortController {
    const controller = new AbortController();

    if (!this.sessionId) {
      log("error", "Cannot open SSE stream without session ID. Call initialize() first.");
      return controller;
    }

    const endpoint = this.endpoint;
    const passKey = this.passKey;
    const signal = controller.signal;
    const getSessionId = () => this.sessionId;

    const reconnectDelayMs = 3000;

    const connect = async () => {
      while (!signal.aborted) {
        const sessionId = getSessionId();
        if (!sessionId) {
          log("debug", "SSE: no session ID, waiting before retry...");
          await sleep(reconnectDelayMs);
          continue;
        }

        try {
          log("debug", "SSE: opening stream...");
          const resp = await fetch(endpoint, {
            method: "GET",
            headers: {
              "Accept": "text/event-stream",
              "Authorization": `Bearer ${passKey}`,
              "mcp-session-id": sessionId,
            },
            signal,
          });

          if (!resp.ok) {
            log("info", `SSE: HTTP ${resp.status} — retrying in ${reconnectDelayMs / 1000}s`);
            await sleep(reconnectDelayMs);
            continue;
          }

          if (!resp.body) {
            log("info", "SSE: no response body — retrying...");
            await sleep(reconnectDelayMs);
            continue;
          }

          log("info", "SSE: stream connected");

          // Read SSE stream
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (!signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete lines
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? ""; // keep incomplete line in buffer

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (!data) continue;

              try {
                const parsed = JSON.parse(data) as {
                  jsonrpc?: string;
                  method?: string;
                  params?: Record<string, unknown>;
                };

                // Only process notifications (no id field = notification)
                if (parsed.jsonrpc === "2.0" && parsed.method && !("id" in parsed)) {
                  onNotification({
                    method: parsed.method,
                    params: parsed.params ?? {},
                  });
                }
              } catch {
                log("debug", `SSE: failed to parse data line: ${data.slice(0, 100)}`);
              }
            }
          }

          log("debug", "SSE: stream ended");
        } catch (err: unknown) {
          if (signal.aborted) return;
          const msg = err instanceof Error ? err.message : String(err);
          log("debug", `SSE: connection error: ${msg}`);
        }

        // Reconnect after delay (unless aborted)
        if (!signal.aborted) {
          log("debug", `SSE: reconnecting in ${reconnectDelayMs / 1000}s...`);
          await sleep(reconnectDelayMs);
        }
      }
    };

    // Start in background — don't block the caller
    connect().catch((err) => {
      if (!signal.aborted) {
        log("error", `SSE: fatal error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    return controller;
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

    let resp: Response;
    try {
      resp = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body,
      });
    } catch (err: unknown) {
      // Network-level errors: ECONNREFUSED, DNS, timeout, etc.
      const msg = err instanceof Error ? err.message : String(err);
      throw new BridgeUnreachableError(`Bridge unreachable: ${msg}`);
    }

    // Capture session ID
    const sid = resp.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    if (!resp.ok) {
      const text = await resp.text();

      // 404 with "Session not found" → bridge restarted, session is gone
      if (resp.status === 404 && text.toLowerCase().includes("session not found")) {
        throw new SessionExpiredError();
      }

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

    try {
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
    } catch {
      // Fire-and-forget — bridge may be down during notification
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
