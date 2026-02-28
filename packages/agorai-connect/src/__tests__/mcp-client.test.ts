import { describe, it, expect } from "vitest";
import http from "node:http";
import { McpClient } from "../mcp-client.js";
import { SessionExpiredError, BridgeUnreachableError } from "../errors.js";

/**
 * Tests for the lightweight MCP client.
 * Uses a local HTTP server to simulate the bridge.
 */

function createMockBridge(handler: (method: string, req: http.IncomingMessage, body: string) => object | null) {
  const server = http.createServer((req, res) => {
    // Handle DELETE (session cleanup) — always 200
    if (req.method === "DELETE") {
      res.writeHead(200);
      res.end();
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (!body.trim()) {
        res.writeHead(202);
        res.end();
        return;
      }

      let rpc: { method?: string; id?: number };
      try {
        rpc = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end("Bad JSON");
        return;
      }

      // Notifications (no id) — accept silently
      if (rpc.id === undefined) {
        res.writeHead(202, { "mcp-session-id": "test-session-123" });
        res.end();
        return;
      }

      const response = handler(req.method ?? "POST", req, body);
      if (response === null) {
        res.writeHead(202);
        res.end();
        return;
      }

      res.writeHead(200, {
        "Content-Type": "application/json",
        "mcp-session-id": "test-session-123",
      });
      res.end(JSON.stringify(response));
    });
  });

  return server;
}

describe("McpClient", () => {
  it("sends initialize request and captures session ID", async () => {
    let receivedAuth: string | undefined;

    const server = createMockBridge((_method, req, body) => {
      receivedAuth = req.headers.authorization;
      const rpc = JSON.parse(body);

      return {
        jsonrpc: "2.0",
        id: rpc.id,
        result: {
          serverInfo: { name: "test-bridge", version: "1.0.0" },
          capabilities: { tools: {} },
        },
      };
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    try {
      const client = new McpClient({
        bridgeUrl: `http://127.0.0.1:${addr.port}`,
        passKey: "test-key",
      });

      const result = await client.initialize();
      expect(result.serverInfo).toEqual({ name: "test-bridge", version: "1.0.0" });
      expect(receivedAuth).toBe("Bearer test-key");
      await client.close();
    } finally {
      server.close();
    }
  }, 10000);

  it("calls tools with correct JSON-RPC structure", async () => {
    let toolName: string | undefined;
    let toolArgs: Record<string, unknown> | undefined;

    const server = createMockBridge((_method, _req, body) => {
      const rpc = JSON.parse(body);
      if (rpc.method === "tools/call") {
        toolName = rpc.params.name;
        toolArgs = rpc.params.arguments;
        return {
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            content: [{ type: "text", text: '{"status":"ok"}' }],
          },
        };
      }
      return { jsonrpc: "2.0", id: rpc.id, result: {} };
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    try {
      const client = new McpClient({
        bridgeUrl: `http://127.0.0.1:${addr.port}/mcp`,
        passKey: "test-key",
      });

      const result = await client.callTool("register_agent", { name: "test", type: "custom" });
      expect(toolName).toBe("register_agent");
      expect(toolArgs).toEqual({ name: "test", type: "custom" });
      expect(result.content[0].text).toBe('{"status":"ok"}');
      await client.close();
    } finally {
      server.close();
    }
  }, 10000);

  it("handles SSE responses", async () => {
    const server = http.createServer((req, res) => {
      if (req.method === "DELETE") {
        res.writeHead(200);
        res.end();
        return;
      }

      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        if (!body.trim()) {
          res.writeHead(202);
          res.end();
          return;
        }

        let rpc: { id?: number };
        try {
          rpc = JSON.parse(body);
        } catch {
          res.writeHead(400);
          res.end();
          return;
        }

        if (rpc.id === undefined) {
          res.writeHead(202, { "mcp-session-id": "test-session" });
          res.end();
          return;
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "mcp-session-id": "test-session",
        });
        const response = JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          result: { tools: [{ name: "test_tool" }] },
        });
        res.end(`event: message\ndata: ${response}\n\n`);
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    try {
      const client = new McpClient({
        bridgeUrl: `http://127.0.0.1:${addr.port}`,
        passKey: "key",
      });

      const tools = await client.listTools();
      expect(tools).toEqual([{ name: "test_tool" }]);
      await client.close();
    } finally {
      server.close();
    }
  }, 10000);

  it("throws on JSON-RPC error", async () => {
    const server = createMockBridge((_method, _req, body) => {
      const rpc = JSON.parse(body);
      return {
        jsonrpc: "2.0",
        id: rpc.id,
        error: { code: -32600, message: "Invalid request" },
      };
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    try {
      const client = new McpClient({
        bridgeUrl: `http://127.0.0.1:${addr.port}`,
        passKey: "key",
      });

      await expect(client.callTool("bad_tool")).rejects.toThrow("MCP error -32600: Invalid request");
      await client.close();
    } finally {
      server.close();
    }
  }, 10000);

  // --- New tests for error detection ---

  it("throws SessionExpiredError on 404 with 'Session not found'", async () => {
    const server = http.createServer((req, res) => {
      if (req.method === "DELETE") {
        res.writeHead(200);
        res.end();
        return;
      }

      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        if (!body.trim()) {
          res.writeHead(202);
          res.end();
          return;
        }

        let rpc: { id?: number };
        try {
          rpc = JSON.parse(body);
        } catch {
          res.writeHead(400);
          res.end();
          return;
        }

        // Notifications — accept silently
        if (rpc.id === undefined) {
          res.writeHead(202, { "mcp-session-id": "old-session" });
          res.end();
          return;
        }

        // Simulate bridge restart: 404 with "Session not found"
        res.writeHead(404);
        res.end("Session not found");
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    try {
      const client = new McpClient({
        bridgeUrl: `http://127.0.0.1:${addr.port}`,
        passKey: "key",
      });

      await expect(client.callTool("any_tool")).rejects.toThrow(SessionExpiredError);
      await client.close();
    } finally {
      server.close();
    }
  }, 10000);

  it("throws BridgeUnreachableError on connection refused", async () => {
    // Use a port that nothing is listening on
    const client = new McpClient({
      bridgeUrl: "http://127.0.0.1:19999",
      passKey: "key",
    });

    await expect(client.callTool("any_tool")).rejects.toThrow(BridgeUnreachableError);
  }, 10000);

  it("resetSession() clears session state", async () => {
    let requestCount = 0;

    const server = createMockBridge((_method, _req, body) => {
      requestCount++;
      const rpc = JSON.parse(body);
      return {
        jsonrpc: "2.0",
        id: rpc.id,
        result: {
          serverInfo: { name: "test", version: "1.0" },
          capabilities: {},
        },
      };
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    try {
      const client = new McpClient({
        bridgeUrl: `http://127.0.0.1:${addr.port}`,
        passKey: "key",
      });

      // Initialize to get session
      await client.initialize();
      const countAfterInit = requestCount;

      // Reset session
      client.resetSession();

      // Next initialize should work (fresh session)
      await client.initialize();
      expect(requestCount).toBeGreaterThan(countAfterInit);

      await client.close();
    } finally {
      server.close();
    }
  }, 10000);
});
