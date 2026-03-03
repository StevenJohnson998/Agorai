#!/usr/bin/env node

/**
 * agorai-connect CLI — connect agents to an Agorai bridge.
 *
 * Commands:
 *   agorai-connect proxy <bridge-url> <pass-key>
 *   agorai-connect setup [--bridge <url>] [--key <pass-key>] [--agent <name>] [--config-path <path>]
 *   agorai-connect uninstall [--config-path <path>]
 *   agorai-connect agent --bridge <url> --key <key> --model <model> --endpoint <endpoint> [--api-key <key>] [--api-key-env <VAR>] [--mode passive|active]
 *   agorai-connect doctor --bridge <url> --key <key> [--model <model>] [--endpoint <url>]
 */

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { setLogLevel } from "./utils.js";
import { loadInstallMeta } from "./config-paths.js";

const USAGE = `Usage: agorai-connect <command> [options]

Commands:
  proxy <bridge-url> <pass-key>     stdio→HTTP proxy for MCP clients (e.g. Claude Desktop)
  setup [options]                    Configure Claude Desktop to connect to an Agorai bridge
  uninstall [options]                Remove agorai from Claude Desktop config
  agent [options]                    Run an AI model as a bridge agent
  doctor [options]                   Check bridge and model connectivity

Setup options:
  --bridge <url>         Bridge URL (default: prompt or http://localhost:3100)
  --key <pass-key>       Pass-key for authentication (default: prompt)
  --agent <name>         Agent name (default: prompt or claude-desktop/claude-code)
  --target <target>      Target client: claude-desktop or claude-code (default: prompt)
  --config-path <path>   Config path override (default: auto-detect)

Uninstall options:
  --config-path <path>   Claude Desktop config path (default: auto-detect)

Agent options:
  --bridge <url>         Bridge URL (or AGORAI_BRIDGE_URL env var, or saved config)
  --key <pass-key>       Pass-key (or AGORAI_PASS_KEY env var, or saved config)
  --model <model>        Model name, e.g. mistral:7b (required)
  --endpoint <url>       OpenAI-compatible endpoint (required)
  --api-key <key>        API key for the model endpoint (optional, visible in ps)
  --api-key-env <VAR>    Read API key from environment variable (recommended)
  --mode <passive|active> passive = respond only when @mentioned (default: passive)
  --system <prompt>      Custom system prompt (optional)
  --poll <ms>            Poll interval in ms (default: 3000)

Doctor options:
  --bridge <url>         Bridge URL (or AGORAI_BRIDGE_URL env var, or saved config)
  --key <pass-key>       Pass-key (or AGORAI_PASS_KEY env var, or saved config)
  --model <model>        Model name (optional — checks model endpoint if provided)
  --endpoint <url>       Model endpoint (optional)
  --api-key <key>        Model API key (optional)
  --api-key-env <VAR>    Model API key from env var (optional)

Global options:
  --verbose              Show info-level logs
  --debug                Show debug-level logs
  --help                 Show this help
  --version              Show version

Examples:
  agorai-connect proxy http://my-vps:3100 my-pass-key
  agorai-connect setup
  agorai-connect setup --bridge http://my-vps:3100 --key my-pass-key --agent my-agent
  agorai-connect setup --target claude-code --bridge http://my-vps:3100 --key my-pass-key
  agorai-connect uninstall
  agorai-connect agent --bridge http://my-vps:3100 --key my-pass-key --model mistral:7b --endpoint http://localhost:11434
  agorai-connect doctor --bridge http://my-vps:3100 --key my-pass-key
  DEEPSEEK_KEY=sk-... agorai-connect agent --bridge http://my-vps:3100 --key pk --model deepseek-chat --endpoint https://api.deepseek.com --api-key-env DEEPSEEK_KEY
`;

async function main() {
  const rawArgs = process.argv.slice(2);

  // Global flags (processed before command dispatch)
  let explicitLogLevel = false;
  if (rawArgs.includes("--debug")) {
    setLogLevel("debug");
    explicitLogLevel = true;
  } else if (rawArgs.includes("--verbose")) {
    setLogLevel("info");
    explicitLogLevel = true;
  }
  const args = rawArgs.filter((a) => a !== "--verbose" && a !== "--debug");

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  if (args[0] === "--version" || args[0] === "-v") {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8"));
    console.log(`agorai-connect v${pkg.version}`);
    process.exit(0);
  }

  const command = args[0];

  switch (command) {
    case "proxy":
      // Default to info-level logging for proxy (session recovery, startup, etc.)
      if (!explicitLogLevel) {
        setLogLevel("info");
      }
      await cmdProxy(args.slice(1));
      break;
    case "setup":
      await cmdSetup(args.slice(1));
      break;
    case "uninstall":
      await cmdUninstall(args.slice(1));
      break;
    case "agent":
      // Default to info-level logging for agent (unless user specified --verbose/--debug)
      if (!explicitLogLevel) {
        setLogLevel("info");
      }
      await cmdAgent(args.slice(1));
      break;
    case "doctor":
      if (!explicitLogLevel) {
        setLogLevel("info");
      }
      await cmdDoctor(args.slice(1));
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

async function cmdSetup(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      bridge: { type: "string" },
      key: { type: "string" },
      agent: { type: "string" },
      target: { type: "string" },
      "config-path": { type: "string" },
    },
  });

  // Validate target if provided
  const target = values.target as "claude-desktop" | "claude-code" | undefined;
  if (target && target !== "claude-desktop" && target !== "claude-code") {
    console.error(`Error: --target must be "claude-desktop" or "claude-code" (got "${values.target}")`);
    process.exit(1);
  }

  const { runSetup } = await import("./setup.js");
  await runSetup({
    bridge: values.bridge,
    key: values.key,
    agent: values.agent,
    target,
    configPath: values["config-path"],
  });
}

async function cmdUninstall(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      "config-path": { type: "string" },
    },
  });

  const { runUninstall } = await import("./uninstall.js");
  await runUninstall({
    configPath: values["config-path"],
  });
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
      "api-key-env": { type: "string" },
      mode: { type: "string" },
      system: { type: "string" },
      poll: { type: "string" },
    },
  });

  // Resolve bridge/key: CLI args > env vars > config file
  const savedConfig = (!values.bridge || !values.key) ? loadInstallMeta() : null;
  const bridge = values.bridge ?? process.env.AGORAI_BRIDGE_URL ?? savedConfig?.bridge;
  const key = values.key ?? process.env.AGORAI_PASS_KEY ?? savedConfig?.passKey;

  if (!bridge || !key || !values.model || !values.endpoint) {
    console.error("Error: --model and --endpoint are required. --bridge and --key are required");
    console.error("unless set via AGORAI_BRIDGE_URL/AGORAI_PASS_KEY env vars or saved config.");
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

  // Resolve API key: --api-key-env takes precedence over --api-key
  let apiKey = values["api-key"];
  if (values["api-key-env"]) {
    const envVal = process.env[values["api-key-env"]];
    if (!envVal) {
      console.error(`Error: environment variable ${values["api-key-env"]} is not set or empty`);
      process.exit(1);
    }
    apiKey = envVal;
  }

  const { runAgent } = await import("./agent.js");
  await runAgent({
    bridgeUrl: bridge,
    passKey: key,
    model: values.model,
    endpoint: values.endpoint,
    apiKey,
    mode,
    pollIntervalMs,
    systemPrompt: values.system,
  });
}

async function cmdDoctor(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      bridge: { type: "string" },
      key: { type: "string" },
      model: { type: "string" },
      endpoint: { type: "string" },
      "api-key": { type: "string" },
      "api-key-env": { type: "string" },
    },
  });

  // Resolve bridge/key: CLI args > env vars > config file
  const savedConf = (!values.bridge || !values.key) ? loadInstallMeta() : null;
  const bridge = values.bridge ?? process.env.AGORAI_BRIDGE_URL ?? savedConf?.bridge;
  const key = values.key ?? process.env.AGORAI_PASS_KEY ?? savedConf?.passKey;

  if (!bridge || !key) {
    console.error("Usage: agorai-connect doctor --bridge <url> --key <pass-key>");
    console.error("\nYou can also set AGORAI_BRIDGE_URL and AGORAI_PASS_KEY environment variables,");
    console.error("or run 'agorai-connect setup' first to save defaults.");
    process.exit(1);
  }

  // Resolve API key
  let apiKey = values["api-key"];
  if (values["api-key-env"]) {
    const envVal = process.env[values["api-key-env"]];
    if (envVal) {
      apiKey = envVal;
    } else {
      console.error(`Error: environment variable ${values["api-key-env"]} is not set`);
      process.exit(1);
    }
  }

  const { runDoctor } = await import("./doctor.js");
  await runDoctor({
    bridgeUrl: bridge,
    passKey: key,
    model: values.model,
    endpoint: values.endpoint,
    apiKey,
  });
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
