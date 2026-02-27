import http from "node:http";
import https from "node:https";
import type { IAgentAdapter, AgentResponse, AgentInvokeOptions, TokenUsage } from "./base.js";
import { extractConfidence, CONFIDENCE_INSTRUCTION, calculateTimeout } from "./base.js";
import type { AgentConfig } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("openai-compat");

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  id?: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens?: number;
  };
}

/**
 * Adapter for any OpenAI-compatible chat completions API.
 *
 * Works with: LM Studio, Ollama (/v1), vLLM, llama.cpp, LocalAI,
 * Groq, Mistral, Deepseek, Together AI, Fireworks, OpenAI.
 *
 * Uses the standard POST /v1/chat/completions endpoint.
 */
export class OpenAICompatAdapter implements IAgentAdapter {
  readonly name: string;
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;

  constructor(config: AgentConfig) {
    this.name = config.name;
    this.endpoint = (config.endpoint ?? "http://localhost:8000").replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.model = config.model ?? "default";
  }

  async isAvailable(): Promise<boolean> {
    try {
      const url = `${this.endpoint}/v1/models`;
      const response = await this.httpRequest("GET", url, undefined, 5000);
      const data = JSON.parse(response) as { data?: Array<{ id: string }> };
      // If model list is available, check if our model is in it
      if (data.data && Array.isArray(data.data)) {
        const found = data.data.some((m) => m.id === this.model || m.id.includes(this.model));
        log.debug(this.name, "isAvailable:", found, "model=" + this.model);
        return found;
      }
      // Some providers don't list models — if we got a response, assume available
      log.debug(this.name, "isAvailable: true (endpoint responded, model list not checked)");
      return true;
    } catch {
      // Fallback: try the completions endpoint directly with a minimal request
      try {
        const url = `${this.endpoint}/v1/chat/completions`;
        await this.httpRequest("POST", url, {
          model: this.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }, 10000);
        log.debug(this.name, "isAvailable: true (completions endpoint responded)");
        return true;
      } catch {
        log.debug(this.name, "isAvailable: false (connection failed)");
        return false;
      }
    }
  }

  async invoke(options: AgentInvokeOptions): Promise<AgentResponse> {
    const { prompt, systemPrompt } = options;
    const timeoutMs = options.timeoutMs ?? calculateTimeout(prompt.length, "http");
    const start = Date.now();
    log.debug(this.name, "invoke start, model=" + this.model + ", prompt length:", prompt.length);

    const messages: ChatMessage[] = [];

    // System prompt with confidence instruction
    const fullSystem = systemPrompt
      ? `${systemPrompt}\n\n${CONFIDENCE_INSTRUCTION}`
      : CONFIDENCE_INSTRUCTION;
    messages.push({ role: "system", content: fullSystem });

    // User prompt
    messages.push({ role: "user", content: prompt });

    const body = {
      model: this.model,
      messages,
      stream: false,
    };

    const url = `${this.endpoint}/v1/chat/completions`;
    const raw = await this.httpRequest("POST", url, body, timeoutMs);
    const durationMs = Date.now() - start;

    const parsed = JSON.parse(raw) as ChatCompletionResponse;

    if (!parsed.choices?.length) {
      throw new Error(`${this.name}: empty response from ${url}`);
    }

    const responseText = parsed.choices[0].message.content ?? "";

    // Token usage
    const tokens: TokenUsage | undefined = parsed.usage
      ? {
          inputTokens: parsed.usage.prompt_tokens ?? 0,
          outputTokens: parsed.usage.completion_tokens ?? 0,
          // Cost not available from most OpenAI-compat APIs
        }
      : undefined;

    log.info(this.name, "invoke complete:", durationMs + "ms" +
      (tokens ? `, ${tokens.inputTokens + tokens.outputTokens} tokens` : ""));

    const { confidence, cleanContent } = extractConfidence(responseText.trim());
    log.debug(this.name, "confidence:", confidence, confidence === 0.5 ? "(default)" : "(extracted)");

    return {
      content: cleanContent,
      confidence,
      tokens,
      raw: parsed,
      durationMs,
    };
  }

  private httpRequest(method: string, url: string, body: object | undefined, timeoutMs: number): Promise<string> {
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

      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
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
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 400) {
              const err = new Error(`${this.name} API error ${res.statusCode}: ${data}`);
              log.error(this.name, err.message);
              reject(err);
            } else {
              resolve(data);
            }
          });
        }
      );

      req.on("error", (err) => {
        log.error(this.name, `HTTP ${method} error:`, err.message);
        reject(err);
      });

      req.on("timeout", () => {
        req.destroy();
        const err = new Error(`${this.name} request timeout after ${timeoutMs}ms`);
        log.error(this.name, err.message);
        reject(err);
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }
}
