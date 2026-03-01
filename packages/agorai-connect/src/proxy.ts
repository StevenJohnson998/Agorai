/**
 * stdio→HTTP proxy for MCP clients (e.g. Claude Desktop).
 *
 * Reads JSON-RPC from stdin, POSTs to bridge /mcp endpoint,
 * writes responses to stdout. Handles SSE and plain JSON responses.
 *
 * Session recovery: when the bridge restarts, the old sessionId becomes
 * invalid (404). The proxy detects this, performs a transparent MCP
 * initialize handshake to create a new session, then retries the
 * original request. Claude Desktop never notices the bridge restarted.
 *
 * Error handling: all errors are returned to the client as JSON-RPC
 * error responses (never swallowed) to prevent client-side hangs.
 */

import { createInterface } from "node:readline";
import { normalizeBridgeUrl, log } from "./utils.js";

export interface ProxyOptions {
  bridgeUrl: string;
  passKey: string;
}

/** Timeout for individual HTTP requests to the bridge (ms). */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Try to extract the JSON-RPC `id` from a raw line so we can return
 * a proper error response on the same id. Returns undefined for
 * notifications (no id) or unparseable input.
 */
function extractRequestId(line: string): string | number | undefined {
  try {
    const parsed = JSON.parse(line);
    return parsed.id ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Check if a raw JSON-RPC line is an "initialize" request.
 */
function isInitializeRequest(line: string): boolean {
  try {
    const parsed = JSON.parse(line);
    return parsed.method === "initialize";
  } catch {
    return false;
  }
}

/**
 * Write a JSON-RPC error response to stdout so the client doesn't hang.
 */
function writeJsonRpcError(id: string | number | undefined, code: number, message: string): void {
  if (id === undefined) return; // notifications don't get error responses
  const error = JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
  process.stdout.write(error + "\n");
}

/**
 * Send a single request to the bridge. Returns the Response.
 */
async function sendRequest(
  endpoint: string,
  passKey: string,
  sessionId: string | undefined,
  body: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "Authorization": `Bearer ${passKey}`,
  };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
  }

  return fetch(endpoint, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

/**
 * Perform a transparent MCP initialize handshake to establish a new session.
 * Returns the new sessionId, or undefined if the handshake failed.
 */
async function reinitializeSession(
  endpoint: string,
  passKey: string,
): Promise<string | undefined> {
  // Step 1: Send initialize request (no sessionId — creates a new session)
  const initBody = JSON.stringify({
    jsonrpc: "2.0",
    id: "__proxy_reinit__",
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "agorai-proxy", version: "1.0.0" },
    },
  });

  const initResp = await sendRequest(endpoint, passKey, undefined, initBody);
  const newSessionId = initResp.headers.get("mcp-session-id") ?? undefined;

  // Drain response body (we don't need the server capabilities)
  await initResp.text();

  if (!initResp.ok || !newSessionId) {
    log("error", `Re-initialize failed: HTTP ${initResp.status}`);
    return undefined;
  }

  // Step 2: Send notifications/initialized to complete the handshake
  const notifBody = JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });

  const notifResp = await sendRequest(endpoint, passKey, newSessionId, notifBody);
  await notifResp.text(); // drain

  log("info", `Re-initialized with new session: ${newSessionId}`);
  return newSessionId;
}

/** Delay helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Open a GET /mcp SSE stream for push notifications and forward them to stdout.
 * Runs in the background — returns an abort function to stop the stream.
 */
function openSSEListener(
  endpoint: string,
  passKey: string,
  getSessionId: () => string | undefined,
): () => void {
  const controller = new AbortController();
  let running = true;

  async function listen(): Promise<void> {
    while (running && !controller.signal.aborted) {
      const sid = getSessionId();
      if (!sid) {
        // No session yet — wait and retry
        await sleep(1000);
        continue;
      }

      try {
        const resp = await fetch(endpoint, {
          method: "GET",
          headers: {
            "Accept": "text/event-stream",
            "Authorization": `Bearer ${passKey}`,
            "mcp-session-id": sid,
          },
          signal: controller.signal,
        });

        if (!resp.ok || !resp.body) {
          log("debug", `SSE stream response: HTTP ${resp.status}`);
          await resp.text(); // drain
          await sleep(3000);
          continue;
        }

        log("info", "SSE notification stream connected");

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (running && !controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? ""; // keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (data) {
                // Forward JSON-RPC notification to stdout (Claude Desktop)
                process.stdout.write(data + "\n");
              }
            }
          }
        }

        log("info", "SSE notification stream disconnected");
      } catch (err) {
        if (controller.signal.aborted) break;
        const msg = err instanceof Error ? err.message : String(err);
        log("debug", `SSE stream error: ${msg}`);
      }

      // Reconnect after a delay (unless aborted)
      if (running && !controller.signal.aborted) {
        await sleep(3000);
      }
    }
  }

  // Fire-and-forget — errors are caught inside the loop
  listen().catch(() => {});

  return () => {
    running = false;
    controller.abort();
  };
}

/**
 * Run the stdio→HTTP proxy. Blocks until stdin closes, then cleans up the session.
 */
export async function runProxy({ bridgeUrl, passKey }: ProxyOptions): Promise<void> {
  const endpoint = normalizeBridgeUrl(bridgeUrl);
  let sessionId: string | undefined;

  log("info", `Proxy started → ${endpoint}`);

  // Start SSE listener in background (uses sessionId via closure)
  const stopSSE = openSSEListener(endpoint, passKey, () => sessionId);

  const rl = createInterface({ input: process.stdin, terminal: false });

  for await (const line of rl) {
    if (!line.trim()) continue;

    const requestId = extractRequestId(line);
    const isInit = isInitializeRequest(line);

    try {
      let resp: Response;

      if (isInit) {
        // Initialize requests always go without sessionId — they create a new session.
        // This handles both first connection and Desktop re-initializing after errors.
        log("info", "Forwarding initialize request (no sessionId)");
        sessionId = undefined;
        resp = await sendRequest(endpoint, passKey, undefined, line);
      } else {
        resp = await sendRequest(endpoint, passKey, sessionId, line);
      }

      // Session recovery: bridge restarted → old sessionId is invalid (404).
      // The MCP SDK requires an "initialize" handshake before any other request,
      // so we transparently re-initialize to get a new session, then retry.
      if (resp.status === 404 && sessionId && !isInit) {
        await resp.text(); // drain body
        log("info", `Session expired (404) — re-initializing`);

        const newSid = await reinitializeSession(endpoint, passKey);
        if (newSid) {
          sessionId = newSid;
          resp = await sendRequest(endpoint, passKey, sessionId, line);
        } else {
          // Re-init failed — tell the client
          sessionId = undefined;
          writeJsonRpcError(requestId, -32000, "Bridge session expired and re-initialization failed");
          continue;
        }
      }

      // Capture session ID
      const sid = resp.headers.get("mcp-session-id");
      if (sid) sessionId = sid;

      // 202 = notification accepted, no response body
      if (resp.status === 202) continue;

      if (!resp.ok) {
        const body = await resp.text();
        log("error", `HTTP ${resp.status}: ${body}`);
        // Return error to client so it doesn't hang
        writeJsonRpcError(requestId, -32000, `Bridge error: HTTP ${resp.status}`);
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
      const msg = err instanceof Error ? err.message : String(err);
      log("error", msg);
      // Return error to client so it doesn't hang
      writeJsonRpcError(requestId, -32000, `Proxy error: ${msg}`);
    }
  }

  // Stdin closed — clean up SSE stream and session
  stopSSE();

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
