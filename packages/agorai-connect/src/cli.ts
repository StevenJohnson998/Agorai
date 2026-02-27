#!/usr/bin/env node

/**
 * agorai-connect CLI — connect agents to an Agorai bridge.
 *
 * Commands:
 *   agorai-connect proxy <bridge-url> <pass-key>
 *   agorai-connect setup
 *   agorai-connect agent --bridge <url> --key <key> --model <model> --endpoint <endpoint> [--api-key <key>] [--mode passive|active]
 */

import { parseArgs } from "node:util";
import { setLogLevel } from "./utils.js";

const USAGE = `Usage: agorai-connect <command> [options]

Commands:
  proxy <bridge-url> <pass-key>     stdio→HTTP proxy for MCP clients (e.g. Claude Desktop)
  setup                              Interactive setup for Claude Desktop
  agent [options]                    Run an AI model as a bridge agent

Agent options:
  --bridge <url>         Bridge URL (required)
  --key <pass-key>       Pass-key for authentication (required)
  --model <model>        Model name, e.g. mistral:7b (required)
  --endpoint <url>       OpenAI-compatible endpoint (required)
  --api-key <key>        API key for the model endpoint (optional)
  --mode <passive|active> passive = respond only when @mentioned (default: passive)
  --system <prompt>      Custom system prompt (optional)
  --poll <ms>            Poll interval in ms (default: 3000)

Global options:
  --verbose              Show info-level logs
  --debug                Show debug-level logs
  --help                 Show this help
  --version              Show version

Examples:
  agorai-connect proxy http://my-vps:3100 my-pass-key
  agorai-connect setup
  agorai-connect agent --bridge http://my-vps:3100 --key my-pass-key --model mistral:7b --endpoint http://localhost:11434
`;

async function main() {
  const rawArgs = process.argv.slice(2);

  // Global flags
  if (rawArgs.includes("--debug")) {
    setLogLevel("debug");
  } else if (rawArgs.includes("--verbose")) {
    setLogLevel("info");
  }
  const args = rawArgs.filter((a) => a !== "--verbose" && a !== "--debug");

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  if (args[0] === "--version" || args[0] === "-v") {
    console.log("agorai-connect v0.0.1");
    process.exit(0);
  }

  const command = args[0];

  switch (command) {
    case "proxy":
      await cmdProxy(args.slice(1));
      break;
    case "setup":
      await cmdSetup();
      break;
    case "agent":
      await cmdAgent(args.slice(1));
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

async function cmdProxy(args: string[]) {
  const bridgeUrl = args[0];
  const passKey = args[1];

  if (!bridgeUrl || !passKey) {
    console.error("Usage: agorai-connect proxy <bridge-url> <pass-key>");
    console.error("Example: agorai-connect proxy http://my-vps:3100 my-pass-key");
    process.exit(1);
  }

  const { runProxy } = await import("./proxy.js");
  await runProxy({ bridgeUrl, passKey });
}

async function cmdSetup() {
  const { runSetup } = await import("./setup.js");
  await runSetup();
}

async function cmdAgent(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      bridge: { type: "string" },
      key: { type: "string" },
      model: { type: "string" },
      endpoint: { type: "string" },
      "api-key": { type: "string" },
      mode: { type: "string" },
      system: { type: "string" },
      poll: { type: "string" },
    },
  });

  if (!values.bridge || !values.key || !values.model || !values.endpoint) {
    console.error("Error: --bridge, --key, --model, and --endpoint are required.");
    console.error("\nExample:");
    console.error("  agorai-connect agent --bridge http://my-vps:3100 --key my-pass-key --model mistral:7b --endpoint http://localhost:11434");
    process.exit(1);
  }

  const mode = values.mode ?? "passive";
  if (mode !== "passive" && mode !== "active") {
    console.error(`Error: --mode must be "passive" or "active" (got "${mode}")`);
    process.exit(1);
  }

  const pollIntervalMs = values.poll ? parseInt(values.poll, 10) : undefined;
  if (pollIntervalMs !== undefined && (isNaN(pollIntervalMs) || pollIntervalMs < 500)) {
    console.error(`Error: --poll must be a number >= 500 (got "${values.poll}")`);
    process.exit(1);
  }

  const { runAgent } = await import("./agent.js");
  await runAgent({
    bridgeUrl: values.bridge,
    passKey: values.key,
    model: values.model,
    endpoint: values.endpoint,
    apiKey: values["api-key"],
    mode,
    pollIntervalMs,
    systemPrompt: values.system,
  });
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
