import http from "node:http";
import type { IAgentAdapter, AgentResponse, AgentInvokeOptions, TokenUsage } from "./base.js";
import { extractConfidence, CONFIDENCE_INSTRUCTION, calculateTimeout } from "./base.js";
import type { AgentConfig } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("ollama");

interface OllamaGenerateResponse {
  response: string;
  done: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Adapter for Ollama via HTTP API.
 * Calls POST /api/generate on the configured endpoint.
 *
 * Uses http module (not fetch) for Node 18 compatibility.
 * Supports system prompts natively via Ollama's "system" field.
 */
export class OllamaAdapter implements IAgentAdapter {
  readonly name: string;
  private readonly model: string;
  private readonly endpoint: string;

  constructor(config: AgentConfig) {
    this.name = config.name;
    this.model = config.model ?? "llama3";
    this.endpoint = config.endpoint ?? "http://localhost:11434";
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.httpGet(`${this.endpoint}/api/tags`);
      const data = JSON.parse(response) as { models?: Array<{ name: string }> };
      // Check if our specific model is pulled
      const available = data.models?.some((m) => m.name.startsWith(this.model)) ?? false;
      log.debug(this.name, "isAvailable:", available, "model=" + this.model);
      return available;
    } catch {
      log.debug(this.name, "isAvailable: false (connection failed)");
      return false;
    }
  }

  async invoke(options: AgentInvokeOptions): Promise<AgentResponse> {
    const { prompt, systemPrompt } = options;
    const timeoutMs = options.timeoutMs ?? calculateTimeout(prompt.length, "http");
    const start = Date.now();
    log.debug(this.name, "invoke start, model=" + this.model + ", prompt length:", prompt.length);

    const fullSystem = systemPrompt
      ? `${systemPrompt}\n\n${CONFIDENCE_INSTRUCTION}`
      : CONFIDENCE_INSTRUCTION;

    const body = {
      model: this.model,
      prompt,
      system: fullSystem,
      stream: false,
    };

    const raw = await this.httpPost(
      `${this.endpoint}/api/generate`,
      body,
      timeoutMs
    );

    const durationMs = Date.now() - start;
    const parsed = JSON.parse(raw) as OllamaGenerateResponse;

    // Ollama reports token counts directly
    const tokens: TokenUsage | undefined =
      parsed.prompt_eval_count !== undefined || parsed.eval_count !== undefined
        ? {
            inputTokens: parsed.prompt_eval_count ?? 0,
            outputTokens: parsed.eval_count ?? 0,
            // Local models — no monetary cost
          }
        : undefined;

    log.info(this.name, "invoke complete:", durationMs + "ms" +
      (tokens ? `, ${tokens.inputTokens + tokens.outputTokens} tokens` : ""));

    const { confidence, cleanContent } = extractConfidence(parsed.response.trim());
    log.debug(this.name, "confidence:", confidence, confidence === 0.5 ? "(default)" : "(extracted)");

    return {
      content: cleanContent,
      confidence,
      tokens,
      raw: parsed,
      durationMs,
    };
  }

  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const req = http.get(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname,
          timeout: 5000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve(data));
        }
      );
      req.on("error", (err) => { log.error(this.name, "HTTP GET error:", err.message); reject(err); });
      req.on("timeout", () => {
        req.destroy();
        const err = new Error("Ollama connection timeout");
        log.error(this.name, err.message);
        reject(err);
      });
    });
  }

  private httpPost(url: string, body: object, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const payload = JSON.stringify(body);

      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
          timeout: timeoutMs,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 400) {
              const err = new Error(`Ollama API error ${res.statusCode}: ${data}`);
              log.error(this.name, err.message);
              reject(err);
            } else {
              resolve(data);
            }
          });
        }
      );
      req.on("error", (err) => { log.error(this.name, "HTTP POST error:", err.message); reject(err); });
      req.on("timeout", () => {
        req.destroy();
        const err = new Error(`Ollama request timeout after ${timeoutMs}ms`);
        log.error(this.name, err.message);
        reject(err);
      });
      req.write(payload);
      req.end();
    });
  }
}
