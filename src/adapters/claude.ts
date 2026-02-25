import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IAgentAdapter, AgentResponse, AgentInvokeOptions, TokenUsage } from "./base.js";
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
    const { prompt, systemPrompt, timeoutMs = 120_000 } = options;
    const start = Date.now();

    // Build the full prompt with system context prepended
    const fullPrompt = systemPrompt
      ? `[Your role]\n${systemPrompt}\n\n[Question]\n${prompt}`
      : prompt;

    log.debug(this.name, "invoke start, prompt length:", fullPrompt.length);

    // Pass prompt via stdin — more reliable than as a CLI argument
    const stdout = await this.spawnWithStdin(
      this.baseArgs,
      fullPrompt,
      timeoutMs
    );

    const durationMs = Date.now() - start;

    let content: string;
    let raw: unknown;
    let tokens: TokenUsage | undefined;

    try {
      raw = JSON.parse(stdout);
      const obj = raw as Record<string, unknown>;
      // Claude Code JSON output: { result, cost_usd, ... }
      content = "result" in obj ? String(obj.result) : stdout.trim();

      // Extract cost if available
      if (typeof obj.cost_usd === "number") {
        tokens = {
          // Claude CLI doesn't expose token counts directly,
          // but we can estimate from cost (Sonnet ~$3/1M input, $15/1M output)
          // For now, report what we have — cost_usd is the reliable field.
          inputTokens: 0,
          outputTokens: 0,
          costUsd: obj.cost_usd,
        };
      }
    } catch {
      log.warn(this.name, "JSON parse failed, using raw stdout");
      content = stdout.trim();
      raw = stdout;
    }

    log.info(this.name, "invoke complete:", durationMs + "ms" +
      (tokens?.costUsd ? ", $" + tokens.costUsd.toFixed(4) : ""));

    return {
      content,
      confidence: 0.5,
      tokens,
      raw,
      durationMs,
    };
  }
}
