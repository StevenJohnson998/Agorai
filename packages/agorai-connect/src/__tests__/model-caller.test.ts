import { describe, it, expect, vi } from "vitest";
import http from "node:http";
import { callModel } from "../model-caller.js";

describe("callModel", () => {
  it("constructs the correct URL from endpoint", async () => {
    // We create a local HTTP server to test against
    const response = {
      choices: [{ message: { content: "Hello!" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };

    const server = http.createServer((_req, res) => {
      let body = "";
      _req.on("data", (chunk) => (body += chunk));
      _req.on("end", () => {
        // Verify the request
        expect(_req.url).toBe("/v1/chat/completions");
        expect(_req.method).toBe("POST");
        expect(_req.headers["content-type"]).toBe("application/json");

        const parsed = JSON.parse(body);
        expect(parsed.model).toBe("test-model");
        expect(parsed.messages).toHaveLength(1);
        expect(parsed.stream).toBe(false);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    try {
      const result = await callModel(
        [{ role: "user", content: "Hi" }],
        {
          endpoint: `http://127.0.0.1:${addr.port}`,
          model: "test-model",
          timeoutMs: 5000,
        },
      );

      expect(result.content).toBe("Hello!");
      expect(result.promptTokens).toBe(10);
      expect(result.completionTokens).toBe(5);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      server.close();
    }
  });

  it("sends Authorization header when apiKey provided", async () => {
    let receivedAuth: string | undefined;

    const server = http.createServer((_req, res) => {
      receivedAuth = _req.headers.authorization;
      let body = "";
      _req.on("data", (chunk) => (body += chunk));
      _req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          choices: [{ message: { content: "ok" } }],
        }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    try {
      await callModel(
        [{ role: "user", content: "test" }],
        {
          endpoint: `http://127.0.0.1:${addr.port}`,
          model: "test",
          apiKey: "sk-test-123",
          timeoutMs: 5000,
        },
      );

      expect(receivedAuth).toBe("Bearer sk-test-123");
    } finally {
      server.close();
    }
  });

  it("throws on empty choices", async () => {
    const server = http.createServer((_req, res) => {
      let body = "";
      _req.on("data", (chunk) => (body += chunk));
      _req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [] }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    try {
      await expect(
        callModel(
          [{ role: "user", content: "test" }],
          {
            endpoint: `http://127.0.0.1:${addr.port}`,
            model: "test",
            timeoutMs: 5000,
          },
        ),
      ).rejects.toThrow("Empty response");
    } finally {
      server.close();
    }
  });

  it("throws on HTTP error", async () => {
    const server = http.createServer((_req, res) => {
      let body = "";
      _req.on("data", (chunk) => (body += chunk));
      _req.on("end", () => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end("Internal Server Error");
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    try {
      await expect(
        callModel(
          [{ role: "user", content: "test" }],
          {
            endpoint: `http://127.0.0.1:${addr.port}`,
            model: "test",
            timeoutMs: 5000,
          },
        ),
      ).rejects.toThrow("Model API error 500");
    } finally {
      server.close();
    }
  });
});
