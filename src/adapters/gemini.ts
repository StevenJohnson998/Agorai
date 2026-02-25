import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IAgentAdapter, AgentResponse, AgentInvokeOptions } from "./base.js";
import { extractConfidence, CONFIDENCE_INSTRUCTION, calculateTimeout } from "./base.js";
import type { AgentConfig } from "../config.js";
import { createLogger } from "../logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("gemini");

/**
 * Adapter for Gemini CLI.
 * Invokes `gemini -p --output-format json` as a subprocess.
 *
 * NOTE: This adapter has not been tested against a real Gemini CLI installation.
 * It follows the same pattern as ClaudeAdapter but Gemini CLI flags and JSON
 * output format may differ. Contributions welcome.
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
        const killTimer = setTimeout(() => { child.kill("SIGKILL"); }, 2000);
        killTimer.unref();
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
    const { prompt, systemPrompt } = options;
    const timeoutMs = options.timeoutMs ?? calculateTimeout(prompt.length, "cli");
    const start = Date.now();

    // TODO: Gemini CLI may support a --system-prompt flag. Since this adapter
    // is untested, we keep the concatenation approach for now.
    const systemWithConf = systemPrompt
      ? `${systemPrompt}\n\n${CONFIDENCE_INSTRUCTION}`
      : CONFIDENCE_INSTRUCTION;
    const fullPrompt = `[Your role]\n${systemWithConf}\n\n[Question]\n${prompt}`;

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

    const { confidence, cleanContent } = extractConfidence(content);
    log.debug(this.name, "confidence:", confidence, confidence === 0.5 ? "(default)" : "(extracted)");

    return {
      content: cleanContent,
      confidence,
      raw,
      durationMs,
    };
  }
}
