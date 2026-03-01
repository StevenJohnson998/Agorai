/**
 * Tests for SSE push notification support in McpClient and proxy.
 *
 * McpClient.openSSEStream() opens a GET /mcp connection and parses
 * incoming SSE data lines as JSON-RPC notifications.
 *
 * The proxy's openSSEListener() wraps this for stdio clients (Claude Desktop).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import http from "node:http";
import { McpClient } from "../mcp-client.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a mock bridge that supports both POST (normal RPC) and GET (SSE stream).
 * The returned `pushNotification` function sends an SSE notification to all connected GET clients.
 */
function createSSEBridge() {
  const sseClients: http.ServerResponse[] = [];

  const server = http.createServer((req, res) => {
    // DELETE — session cleanup
    if (req.method === "DELETE") {
      res.writeHead(200);
      res.end();
      return;
    }

    // GET — SSE stream for push notifications
    if (req.method === "GET") {
      const sessionId = req.headers["mcp-session-id"];
      if (!sessionId) {
        res.writeHead(400);
        res.end("Missing session ID");
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "mcp-session-id": sessionId as string,
      });

      sseClients.push(res);

      req.on("close", () => {
        const idx = sseClients.indexOf(res);
        if (idx >= 0) sseClients.splice(idx, 1);
      });

      return;
    }

    // POST — standard JSON-RPC
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (!body.trim()) {
        res.writeHead(202);
        res.end();
        return;
      }

      let rpc: { id?: number; method?: string };
      try {
        rpc = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }

      // Notification (no id) — accept
      if (rpc.id === undefined) {
        res.writeHead(202, { "mcp-session-id": "sse-test-session" });
        res.end();
        return;
      }

      // Initialize
      if (rpc.method === "initialize") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "mcp-session-id": "sse-test-session",
        });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            protocolVersion: "2025-03-26",
            serverInfo: { name: "sse-bridge", version: "1.0.0" },
            capabilities: { tools: {} },
          },
        }));
        return;
      }

      // Default response
      res.writeHead(200, {
        "Content-Type": "application/json",
        "mcp-session-id": "sse-test-session",
      });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: {} }));
    });
  });

  function pushNotification(notification: object): void {
    const data = JSON.stringify(notification);
    for (const client of sseClients) {
      client.write(`event: message\ndata: ${data}\n\n`);
    }
  }

  return { server, pushNotification, getClientCount: () => sseClients.length };
}

describe("McpClient.openSSEStream", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    for (const s of servers) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    servers.length = 0;
  });

  it("receives push notifications via SSE stream", async () => {
    const { server, pushNotification } = createSSEBridge();
    servers.push(server);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    const client = new McpClient({
      bridgeUrl: `http://127.0.0.1:${addr.port}`,
      passKey: "key",
    });

    // Initialize to get session ID
    await client.initialize();

    const received: Array<{ method: string; params: Record<string, unknown> }> = [];
    const controller = client.openSSEStream((notification) => {
      received.push(notification);
    });

    // Wait for SSE stream to connect
    await sleep(200);

    // Push a notification
    pushNotification({
      jsonrpc: "2.0",
      method: "notifications/message",
      params: {
        conversationId: "conv-1",
        messageId: "msg-1",
        fromAgent: "agent-a",
      },
    });

    await sleep(200);

    expect(received).toHaveLength(1);
    expect(received[0].method).toBe("notifications/message");
    expect(received[0].params.conversationId).toBe("conv-1");
    expect(received[0].params.messageId).toBe("msg-1");

    controller.abort();
    await client.close();
  }, 10000);

  it("receives multiple notifications in sequence", async () => {
    const { server, pushNotification } = createSSEBridge();
    servers.push(server);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    const client = new McpClient({
      bridgeUrl: `http://127.0.0.1:${addr.port}`,
      passKey: "key",
    });

    await client.initialize();

    const received: Array<{ method: string; params: Record<string, unknown> }> = [];
    const controller = client.openSSEStream((n) => received.push(n));

    await sleep(200);

    pushNotification({ jsonrpc: "2.0", method: "notifications/message", params: { conversationId: "c1" } });
    pushNotification({ jsonrpc: "2.0", method: "notifications/message", params: { conversationId: "c2" } });
    pushNotification({ jsonrpc: "2.0", method: "notifications/message", params: { conversationId: "c3" } });

    await sleep(300);

    expect(received).toHaveLength(3);
    expect(received.map((r) => r.params.conversationId)).toEqual(["c1", "c2", "c3"]);

    controller.abort();
    await client.close();
  }, 10000);

  it("ignores non-JSON SSE data lines", async () => {
    const { server } = createSSEBridge();
    servers.push(server);

    // Override to send garbage
    const sseClients: http.ServerResponse[] = [];
    server.removeAllListeners("request");
    server.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (req.method === "DELETE") { res.writeHead(200); res.end(); return; }
      if (req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "mcp-session-id": "sse-test-session",
        });
        sseClients.push(res);
        // Send garbage then a valid notification
        res.write("data: not-json\n\n");
        res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: { id: "valid" } })}\n\n`);
        return;
      }
      // POST — simple init
      let body = "";
      req.on("data", (c: Buffer) => (body += c));
      req.on("end", () => {
        const rpc = JSON.parse(body || "{}");
        if (rpc.id === undefined) { res.writeHead(202, { "mcp-session-id": "sse-test-session" }); res.end(); return; }
        res.writeHead(200, { "Content-Type": "application/json", "mcp-session-id": "sse-test-session" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { serverInfo: { name: "t", version: "1" }, capabilities: {} } }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    const client = new McpClient({ bridgeUrl: `http://127.0.0.1:${addr.port}`, passKey: "key" });
    await client.initialize();

    const received: Array<{ method: string; params: Record<string, unknown> }> = [];
    const controller = client.openSSEStream((n) => received.push(n));

    await sleep(300);

    // Only the valid JSON notification should be received
    expect(received).toHaveLength(1);
    expect(received[0].params.id).toBe("valid");

    controller.abort();
    await client.close();
  }, 10000);

  it("abort controller stops the SSE stream", async () => {
    const { server, getClientCount } = createSSEBridge();
    servers.push(server);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    const client = new McpClient({ bridgeUrl: `http://127.0.0.1:${addr.port}`, passKey: "key" });
    await client.initialize();

    const controller = client.openSSEStream(() => {});

    await sleep(200);
    expect(getClientCount()).toBe(1);

    controller.abort();
    await sleep(200);
    expect(getClientCount()).toBe(0);

    await client.close();
  }, 10000);
});

describe("Proxy SSE data parsing", () => {
  it("correctly parses SSE data: prefix lines", () => {
    const sseText = [
      "event: message",
      'data: {"jsonrpc":"2.0","method":"notifications/message","params":{"conversationId":"abc"}}',
      "",
      "event: message",
      'data: {"jsonrpc":"2.0","method":"notifications/message","params":{"conversationId":"def"}}',
      "",
    ].join("\n");

    const dataLines: string[] = [];
    for (const line of sseText.split("\n")) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data) dataLines.push(data);
      }
    }

    expect(dataLines).toHaveLength(2);
    expect(JSON.parse(dataLines[0]).params.conversationId).toBe("abc");
    expect(JSON.parse(dataLines[1]).params.conversationId).toBe("def");
  });

  it("handles buffered/chunked SSE data correctly", () => {
    // Simulate chunked data where a line is split across two chunks
    const chunks = [
      'event: message\ndata: {"jsonrpc":"2.0","me',
      'thod":"notifications/message","params":{"id":"1"}}\n\nevent: message\ndata: ',
      '{"jsonrpc":"2.0","method":"notifications/message","params":{"id":"2"}}\n\n',
    ];

    const dataLines: string[] = [];
    let buffer = "";

    for (const chunk of chunks) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data) dataLines.push(data);
        }
      }
    }

    expect(dataLines).toHaveLength(2);
    expect(JSON.parse(dataLines[0]).params.id).toBe("1");
    expect(JSON.parse(dataLines[1]).params.id).toBe("2");
  });

  it("ignores event: and empty lines", () => {
    const sseText = "event: message\n\ndata: {\"ok\":true}\n\n: comment\n\n";

    const dataLines: string[] = [];
    for (const line of sseText.split("\n")) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data) dataLines.push(data);
      }
    }

    expect(dataLines).toHaveLength(1);
    expect(JSON.parse(dataLines[0])).toEqual({ ok: true });
  });
});
