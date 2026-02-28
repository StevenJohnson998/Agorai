#!/usr/bin/env node

/**
 * agorai-connect CLI — connect agents to an Agorai bridge.
 *
 * Commands:
 *   agorai-connect proxy <bridge-url> <pass-key>
 *   agorai-connect setup
 *   agorai-connect agent --bridge <url> --key <key> --model <model> --endpoint <endpoint> [--api-key <key>] [--api-key-env <VAR>] [--mode passive|active]
 */

import { parseArgs } from "node:util";
import { setLogLevel } from "./utils.js";

const USAGE = `Usage: agorai-connect <command> [options]

Commands:
  proxy <bridge-url> <pass-key>     stdio→HTTP proxy for MCP clients (e.g. Claude Desktop)
  setup                              Interactive setup for Claude Desktop
  agent [options]                    Run an AI model as a bridge agent
  doctor [options]                   Check bridge and model connectivity

Agent options:
  --bridge <url>         Bridge URL (required)
  --key <pass-key>       Pass-key for authentication (required)
  --model <model>        Model name, e.g. mistral:7b (required)
  --endpoint <url>       OpenAI-compatible endpoint (required)
  --api-key <key>        API key for the model endpoint (optional, visible in ps)
  --api-key-env <VAR>    Read API key from environment variable (recommended)
  --mode <passive|active> passive = respond only when @mentioned (default: passive)
  --system <prompt>      Custom system prompt (optional)
  --poll <ms>            Poll interval in ms (default: 3000)

Doctor options:
  --bridge <url>         Bridge URL (required)
  --key <pass-key>       Pass-key for authentication (required)
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
    console.log("agorai-connect v0.0.3");
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
      "api-key-env": { type: "string" },
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
    bridgeUrl: values.bridge,
    passKey: values.key,
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

  if (!values.bridge || !values.key) {
    console.error("Usage: agorai-connect doctor --bridge <url> --key <pass-key>");
    process.exit(1);
  }

  const bridgeUrl = values.bridge;
  const passKey = values.key;

  let ok = true;
  const pass = (msg: string) => console.log(`  [PASS] ${msg}`);
  const fail = (msg: string) => { console.log(`  [FAIL] ${msg}`); ok = false; };
  const info = (msg: string) => console.log(`  [INFO] ${msg}`);

  console.log("\nagorai-connect doctor\n");

  // 1. Node.js version
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split(".")[0], 10);
  if (major >= 18) {
    pass(`Node.js ${nodeVersion} (>= 18 required)`);
  } else {
    fail(`Node.js ${nodeVersion} — version 18+ required`);
  }

  // 2. Bridge health
  const healthUrl = new URL("/health", bridgeUrl).href;
  try {
    const resp = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const data = await resp.json() as { version?: string };
      pass(`Bridge reachable at ${healthUrl} (v${data.version ?? "?"})`);
    } else {
      fail(`Bridge health returned HTTP ${resp.status}`);
    }
  } catch (err) {
    fail(`Bridge unreachable at ${healthUrl} — ${err instanceof Error ? err.message : err}`);
  }

  // 3. Auth check — initialize MCP session
  try {
    const { McpClient } = await import("./mcp-client.js");
    const client = new McpClient({ bridgeUrl, passKey });
    const initResult = await client.initialize();
    const srvName = (initResult.serverInfo as Record<string, unknown>).name ?? "?";
    const srvVersion = (initResult.serverInfo as Record<string, unknown>).version ?? "?";
    pass(`Auth OK — session established (server: ${srvName} v${srvVersion})`);

    // 3b. Check agent registration
    try {
      const result = await client.callTool("get_status", {});
      const text = result.content?.[0]?.text;
      if (text) {
        const status = JSON.parse(text);
        pass(`Status: ${status.projects} project(s), ${status.agents?.online ?? "?"} agent(s) online, ${status.unread_messages} unread`);
      }
    } catch {
      info("Could not fetch bridge status (non-critical)");
    }

    await client.close();
  } catch (err) {
    fail(`Auth failed — ${err instanceof Error ? err.message : err}`);
  }

  // 4. Model endpoint (optional)
  if (values.model && values.endpoint) {
    let apiKey = values["api-key"];
    if (values["api-key-env"]) {
      const envVal = process.env[values["api-key-env"]];
      if (envVal) {
        apiKey = envVal;
      } else {
        fail(`Environment variable ${values["api-key-env"]} is not set`);
      }
    }

    const modelsUrl = new URL(
      values.endpoint.includes("/v1") ? "/v1/models" : "/api/tags",
      values.endpoint,
    ).href;

    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const resp = await fetch(modelsUrl, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        pass(`Model endpoint reachable at ${values.endpoint}`);
      } else {
        fail(`Model endpoint returned HTTP ${resp.status} at ${modelsUrl}`);
      }
    } catch (err) {
      fail(`Model endpoint unreachable at ${values.endpoint} — ${err instanceof Error ? err.message : err}`);
    }

    // Quick model call test
    if (ok && apiKey !== undefined) {
      try {
        const { callModel } = await import("./model-caller.js");
        const response = await callModel(
          [{ role: "user", content: "Say 'hello' in one word." }],
          { model: values.model, endpoint: values.endpoint, apiKey, timeoutMs: 30_000 },
        );
        if (response && response.content.length > 0) {
          pass(`Model ${values.model} responds ("${response.content.slice(0, 50).trim()}")`);
        } else {
          fail(`Model ${values.model} returned empty response`);
        }
      } catch (err) {
        fail(`Model ${values.model} call failed — ${err instanceof Error ? err.message : err}`);
      }
    }
  } else if (values.model || values.endpoint) {
    info("Both --model and --endpoint needed for model check (skipping)");
  }

  // Summary
  console.log("");
  if (ok) {
    console.log("All checks passed.");
  } else {
    console.log("Some checks failed. Fix the issues above and re-run.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
