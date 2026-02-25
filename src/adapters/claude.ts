import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IAgentAdapter, AgentResponse, AgentInvokeOptions, TokenUsage } from "./base.js";
import { extractConfidence, CONFIDENCE_INSTRUCTION, calculateTimeout } from "./base.js";
import type { AgentConfig } from "../config.js";
import { createLogger } from "../logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("claude");

/** Build a clean env without Claude Code session markers so nested invocations work. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

/**
 * Adapter for Claude Code CLI.
 * Invokes `claude -p --output-format json` as a subprocess.
 */
export class ClaudeAdapter implements IAgentAdapter {
  readonly name: string;
  private readonly command: string;
  private readonly baseArgs: string[];

  constructor(config: AgentConfig) {
    this.name = config.name;
    this.command = config.command ?? "claude";
    this.baseArgs = config.args ?? ["-p", "--output-format", "json"];
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync(this.command, ["--version"], { timeout: 5000, env: cleanEnv() });
      log.debug(this.name, "isAvailable: true");
      return true;
    } catch {
      log.debug(this.name, "isAvailable: false");
      return false;
    }
  }

  /** Spawn claude with prompt on stdin — avoids arg-size limits and exec quirks. */
  private spawnWithStdin(args: string[], input: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, args, {
        env: cleanEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        // Escalate to SIGKILL after 2s if still alive
        const killTimer = setTimeout(() => { child.kill("SIGKILL"); }, 2000);
        killTimer.unref();
        reject(new Error(`claude timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (err) => { clearTimeout(timer); reject(err); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(stderr.trim() || `claude exited with code ${code}`));
        } else {
          resolve(stdout);
        }
      });

      child.stdin.write(input);
      child.stdin.end();
    });
  }

  async invoke(options: AgentInvokeOptions): Promise<AgentResponse> {
    const { prompt, systemPrompt } = options;
    const timeoutMs = options.timeoutMs ?? calculateTimeout(prompt.length, "cli");
    const start = Date.now();

    // Build args: add --system-prompt with confidence instruction
    const args = [...this.baseArgs];
    const fullSystem = systemPrompt
      ? `${systemPrompt}\n\n${CONFIDENCE_INSTRUCTION}`
      : CONFIDENCE_INSTRUCTION;
    args.push("--system-prompt", fullSystem);

    log.debug(this.name, "invoke start, prompt length:", prompt.length,
      systemPrompt ? `(+ system-prompt ${systemPrompt.length} chars)` : "");

    // Pass user prompt via stdin — more reliable than as a CLI argument
    const stdout = await this.spawnWithStdin(
      args,
      prompt,
      timeoutMs
    );

    const durationMs = Date.now() - start;

    let content: string;
    let raw: unknown;
    let tokens: TokenUsage | undefined;

    try {
      raw = JSON.parse(stdout);
      const obj = raw as Record<string, unknown>;
      // Claude Code JSON output: { result, total_cost_usd, usage: { input_tokens, output_tokens, ... }, ... }
      content = "result" in obj ? String(obj.result) : stdout.trim();

      // Extract tokens from usage object (available in current Claude CLI)
      const usage = obj.usage as Record<string, number> | undefined;
      const costUsd =
        typeof obj.total_cost_usd === "number" ? obj.total_cost_usd
        : typeof obj.cost_usd === "number" ? obj.cost_usd  // legacy fallback
        : undefined;

      if (usage || costUsd !== undefined) {
        tokens = {
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          costUsd,
        };
      }
    } catch {
      log.warn(this.name, "JSON parse failed, using raw stdout");
      content = stdout.trim();
      raw = stdout;
    }

    log.info(this.name, "invoke complete:", durationMs + "ms" +
      (tokens?.costUsd ? ", $" + tokens.costUsd.toFixed(4) : ""));

    // Extract self-reported confidence from response
    const { confidence, cleanContent } = extractConfidence(content);
    log.debug(this.name, "confidence:", confidence, confidence === 0.5 ? "(default)" : "(extracted)");

    return {
      content: cleanContent,
      confidence,
      tokens,
      raw,
      durationMs,
    };
  }
}
