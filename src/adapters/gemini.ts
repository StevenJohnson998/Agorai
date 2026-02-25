import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IAgentAdapter, AgentResponse, AgentInvokeOptions } from "./base.js";
import type { AgentConfig } from "../config.js";
import { createLogger } from "../logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("gemini");

/**
 * Adapter for Gemini CLI.
 * Invokes `gemini -p --output-format json` as a subprocess.
 */
export class GeminiAdapter implements IAgentAdapter {
  readonly name: string;
  private readonly command: string;
  private readonly baseArgs: string[];

  constructor(config: AgentConfig) {
    this.name = config.name;
    this.command = config.command ?? "gemini";
    this.baseArgs = config.args ?? ["-p", "--output-format", "json"];
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync(this.command, ["--version"], { timeout: 5000 });
      log.debug(this.name, "isAvailable: true");
      return true;
    } catch {
      log.debug(this.name, "isAvailable: false");
      return false;
    }
  }

  /** Spawn gemini with prompt on stdin. */
  private spawnWithStdin(args: string[], input: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`gemini timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (err) => { clearTimeout(timer); reject(err); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(stderr.trim() || `gemini exited with code ${code}`));
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

    const fullPrompt = systemPrompt
      ? `[Your role]\n${systemPrompt}\n\n[Question]\n${prompt}`
      : prompt;

    log.debug(this.name, "invoke start, prompt length:", fullPrompt.length);

    const stdout = await this.spawnWithStdin(
      this.baseArgs,
      fullPrompt,
      timeoutMs
    );

    const durationMs = Date.now() - start;

    let content: string;
    let raw: unknown;

    try {
      raw = JSON.parse(stdout);
      content =
        typeof raw === "object" && raw !== null && "result" in raw
          ? String((raw as Record<string, unknown>).result)
          : stdout.trim();
    } catch {
      log.warn(this.name, "JSON parse failed, using raw stdout");
      content = stdout.trim();
      raw = stdout;
    }

    log.info(this.name, "invoke complete:", durationMs + "ms");

    return {
      content,
      confidence: 0.5,
      raw,
      durationMs,
    };
  }
}
