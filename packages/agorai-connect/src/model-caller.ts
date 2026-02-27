/**
 * OpenAI-compatible chat completions caller.
 *
 * Uses node:http/https for controllable timeouts on long model calls.
 * Extracted from src/adapters/openai-compat.ts.
 */

import http from "node:http";
import https from "node:https";
import { log } from "./utils.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelCallerOptions {
  endpoint: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface ModelResponse {
  content: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

/**
 * Call an OpenAI-compatible /v1/chat/completions endpoint.
 */
export async function callModel(
  messages: ChatMessage[],
  options: ModelCallerOptions,
): Promise<ModelResponse> {
  const { endpoint, model, apiKey, timeoutMs = 120_000 } = options;
  const url = `${endpoint.replace(/\/+$/, "")}/v1/chat/completions`;
  const start = Date.now();

  log("debug", `callModel → ${url} model=${model}`);

  const body = { model, messages, stream: false };
  const raw = await httpRequest("POST", url, body, apiKey, timeoutMs);
  const durationMs = Date.now() - start;

  const parsed = JSON.parse(raw) as {
    choices?: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  if (!parsed.choices?.length) {
    throw new Error(`Empty response from model at ${url}`);
  }

  const content = parsed.choices[0].message.content ?? "";

  log("info", `callModel complete: ${durationMs}ms, ${content.length} chars`);

  return {
    content,
    promptTokens: parsed.usage?.prompt_tokens ?? 0,
    completionTokens: parsed.usage?.completion_tokens ?? 0,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// HTTP request with controllable timeout (node:http/https)
// ---------------------------------------------------------------------------

function httpRequest(
  method: string,
  url: string,
  body: object | undefined,
  apiKey: string | undefined,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const transport = isHttps ? https : http;

    const headers: Record<string, string> = {
      "Accept": "application/json",
    };

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const payload = body ? JSON.stringify(body) : undefined;
    if (payload) {
      headers["Content-Length"] = String(Buffer.byteLength(payload));
    }

    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer | string) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Model API error ${res.statusCode}: ${data}`));
          } else {
            resolve(data);
          }
        });
      },
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Model request timeout after ${timeoutMs}ms`));
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}
