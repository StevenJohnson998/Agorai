#!/usr/bin/env node

/**
 * Agorai CLI — command-line interface for multi-agent debates.
 *
 * Commands:
 *   agorai debate "prompt" [--agents a,b] [--roles "a=p1+p2,b=p3"] [--mode full] [--thoroughness 0.5]
 *   agorai analyze "prompt" [--thoroughness 0.5]
 *   agorai agents
 *   agorai project create <name> [--description "..."]
 *   agorai project list [--archived]
 *   agorai project switch <id>
 *   agorai project archive [id]
 *   agorai context get [key]
 *   agorai context set <key> <value>
 *   agorai init
 *   agorai start [--http]
 *   agorai connect <url> --key <api-key>
 */

import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { loadConfig, getUserDataDir, type PersonaConfig } from "./config.js";
import { resolvePersonas } from "./personas.js";
import { createAdapter } from "./adapters/index.js";
import { DebateSession, type DebateMode } from "./orchestrator.js";
import { writeFileSync, existsSync } from "node:fs";
import { setLogLevel, initFileLogging } from "./logger.js";
import {
  addAgent,
  listAgents,
  updateAgent,
  removeAgent,
  type AgentType,
  type ClearanceLevel,
} from "./config-manager.js";

const USAGE = `Usage: agorai <command> [options]

Commands:
  debate <prompt>          Start a multi-agent debate
  analyze <prompt>         Decompose a complex task (ProjectManager)
  agents                   List available agents and check availability
  agent add <name>         Add an agent to config
  agent list               List configured agents (bridge + adapters)
  agent update <name>      Update an agent's configuration
  agent remove <name>      Remove an agent from config
  agent run --adapter <n>  Run an internal agent (uses store directly)
  project create <name>    Create a new project
  project list [--archived] List projects (most recent first)
  project switch <id>      Switch to a project
  project archive [id]     Archive a project
  context get [key]        Read from private memory
  context set <key> <val>  Write to private memory
  init                     Create agorai.config.json
  start [--http]           Start MCP server (stdio or HTTP)
  serve                    Start bridge HTTP server (Streamable HTTP)
  connect <url> --key <k>  Connect Claude Desktop to a remote bridge (stdio→HTTP proxy)

Options:
  --agents <a,b>           Comma-separated agent names
  --roles <a=p1+p2,b=p3>  Per-agent role assignment (overrides config defaults)
  --mode <quick|full>      Debate mode (default: full)
  --thoroughness <0-1>     Balance completeness vs cost (default: from config)
  --max-rounds <n>         Override max debate rounds
  --max-tokens <n>         Token budget for this debate (overrides config)
  --continue <debate_id>   Resume an existing debate (add more rounds)
  --force                  Skip pre-estimation budget warning
  --with-agent <name>      (serve) Spawn an internal agent in the same process (repeatable)
  --type <type>            (agent add) claude-desktop|claude-code|openai-compat|ollama|custom
  --model <model>          (agent add/update) Model name
  --endpoint <url>         (agent add/update) API endpoint URL
  --api-key-env <VAR>      (agent add/update) Env var containing the API key
  --clearance <level>      (agent add/update) public|team|confidential|restricted
  --adapter <name>         (agent run) Agent adapter name from config
  --mode <passive|active>  (agent run) Response mode (default: passive)
  --poll <ms>              (agent run) Poll interval in milliseconds (default: 3000)
  --system <prompt>        (agent run) Custom system prompt
  --verbose                Show info-level logs on stderr
  --debug                  Show all logs (debug level) on stderr
  --help                   Show this help
  --version                Show version

Environment:
  AGORAI_LOG_LEVEL         Set log level: error, warn (default), info, debug

Examples:
  agorai debate "Redis vs Memcached for sessions?"
  agorai agent add groq --type openai-compat --model llama-3.3-70b-versatile --endpoint https://api.groq.com/openai --api-key-env GROQ_API_KEY
  agorai agent list
  agorai agent run --adapter groq --mode active
`;

async function main() {
  const rawArgs = process.argv.slice(2);

  // Process global flags before anything else
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
    console.log("agorai v0.2.2");
    process.exit(0);
  }

  const command = args[0];

  // Initialize file logging (always active, independent of stderr level)
  // Skip for "init" command (no config yet), "start" (server inits its own), "serve" (handles its own)
  // Skip for "agent" (subcommands handle their own, "run" inits logging)
  if (command !== "init" && command !== "start" && command !== "serve" && command !== "connect" && command !== "agent") {
    const cfg = loadConfig();
    initFileLogging(getUserDataDir(cfg), cfg.logging);
  }

  switch (command) {
    case "debate":
      await cmdDebate(args.slice(1));
      break;
    case "analyze":
      cmdAnalyze(args.slice(1));
      break;
    case "agents":
      await cmdAgents();
      break;
    case "project":
      cmdProject(args.slice(1));
      break;
    case "context":
      cmdContext(args.slice(1));
      break;
    case "init":
      cmdInit();
      break;
    case "start":
      cmdStart(args.slice(1));
      break;
    case "serve":
      await cmdServe(args.slice(1));
      break;
    case "agent":
      await cmdAgent(args.slice(1));
      break;
    case "connect":
      await cmdConnect(args.slice(1));
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

/**
 * Parse role assignments from CLI string.
 * Format: "claude=architect+security,ollama=critic+pragmatist"
 */
function parseRoles(rolesStr: string, config: ReturnType<typeof loadConfig>): Map<string, PersonaConfig[]> {
  const map = new Map<string, PersonaConfig[]>();
  const pairs = rolesStr.split(",");

  for (const pair of pairs) {
    const [agent, personaStr] = pair.split("=");
    if (!agent || !personaStr) {
      console.error(`Invalid role format: "${pair}". Expected: agent=role1+role2`);
      process.exit(1);
    }
    const personaNames = personaStr.split("+");
    map.set(agent.trim(), resolvePersonas(personaNames, config));
  }

  return map;
}

async function cmdDebate(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      agents: { type: "string" },
      roles: { type: "string" },
      mode: { type: "string" },
      thoroughness: { type: "string" },
      "max-rounds": { type: "string" },
      "max-tokens": { type: "string" },
      continue: { type: "string" },
      force: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const prompt = positionals[0];
  if (!prompt) {
    console.error("Error: debate requires a prompt\n");
    console.log('Usage: agorai debate "your question" [--agents a,b] [--roles "a=p1+p2"] [--continue <debate_id>]');
    process.exit(1);
  }

  const config = loadConfig();
  const thoroughness = values.thoroughness
    ? parseFloat(values.thoroughness)
    : config.thoroughness;
  if (isNaN(thoroughness) || thoroughness < 0 || thoroughness > 1) {
    console.error(`Error: --thoroughness must be a number between 0 and 1 (got "${values.thoroughness}")`);
    process.exit(1);
  }

  const mode = values.mode ?? "full";
  if (mode !== "quick" && mode !== "full") {
    console.error(`Error: --mode must be "quick" or "full" (got "${values.mode}")`);
    process.exit(1);
  }

  const maxRounds = values["max-rounds"]
    ? parseInt(values["max-rounds"], 10)
    : undefined;
  if (maxRounds !== undefined && (isNaN(maxRounds) || maxRounds < 1)) {
    console.error(`Error: --max-rounds must be a positive integer (got "${values["max-rounds"]}")`);
    process.exit(1);
  }

  const maxTokens = values["max-tokens"]
    ? parseInt(values["max-tokens"], 10)
    : undefined;
  if (maxTokens !== undefined && (isNaN(maxTokens) || maxTokens < 1)) {
    console.error(`Error: --max-tokens must be a positive integer (got "${values["max-tokens"]}")`);
    process.exit(1);
  }

  // Resolve agents
  const agentNames = values.agents
    ? values.agents.split(",").map((s) => s.trim())
    : config.agents.filter((a) => a.enabled).map((a) => a.name);

  const agentConfigs = agentNames.map((name) => {
    const found = config.agents.find((a) => a.name === name);
    if (!found) {
      console.error(`Unknown agent: "${name}". Available: ${config.agents.map((a) => a.name).join(", ")}`);
      process.exit(1);
    }
    return found;
  });

  // Create adapters
  const adapters = agentConfigs.map(createAdapter);

  // Check availability
  console.log("Checking agent availability...");
  for (const adapter of adapters) {
    const available = await adapter.isAvailable();
    const status = available ? "OK" : "NOT AVAILABLE";
    console.log(`  ${adapter.name}: ${status}`);
    if (!available) {
      console.error(`\nAgent "${adapter.name}" is not available. Check that it's installed and reachable.`);
      process.exit(1);
    }
  }

  // Resolve personas: per-debate override or config defaults
  let agentPersonas: Map<string, PersonaConfig[]>;

  if (values.roles) {
    agentPersonas = parseRoles(values.roles, config);
  } else {
    agentPersonas = new Map();
    for (const ac of agentConfigs) {
      if (ac.personas.length > 0) {
        agentPersonas.set(ac.name, resolvePersonas(ac.personas, config));
      }
    }
  }

  // Display config
  const resuming = values.continue;
  if (resuming) {
    console.log(`\nNote: --continue sets the debate ID to "${resuming}" but resume is not yet available (requires SQLite blackboard, v0.2). Starting a new debate with this ID.`);
  }
  console.log(`\nDebate: "${prompt}"`);
  console.log(`  Mode: ${mode} | Thoroughness: ${thoroughness}`);
  for (const ac of agentConfigs) {
    const personas = agentPersonas.get(ac.name);
    const roleStr = personas?.map((p) => p.name).join(" + ") ?? "(no role)";
    console.log(`  ${ac.name}: ${roleStr}`);
  }
  console.log("");

  // Pre-estimation budget check
  const session = new DebateSession(undefined, config.budget);
  const estimate = session.estimate({
    agents: adapters,
    mode,
    thoroughness,
    maxRounds,
    maxTokens,
  });

  if (estimate.overBudget && !values.force) {
    const pct = estimate.budgetPercent!.toFixed(1);
    console.log(
      `Warning: estimated token usage ~${estimate.estimatedTokens.toLocaleString()} (${pct}% of budget). Continue? [y/N]`
    );
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) =>
      rl.question("", (ans) => { rl.close(); resolve(ans); })
    );
    if (answer.trim().toLowerCase() !== "y") {
      process.exit(0);
    }
  }

  // Run debate
  const result = await session.run({
    projectId: "cli-session",
    debateId: resuming,
    prompt,
    agents: adapters,
    agentPersonas,
    mode,
    thoroughness,
    maxRounds,
    maxTokens,
  });

  // Display results
  console.log("=".repeat(60));
  for (const round of result.rounds) {
    console.log(`\n--- Round ${round.roundNumber} ---\n`);
    for (const response of round.responses) {
      const label = response.persona
        ? `${response.agent} (${response.persona})`
        : response.agent;
      const time = (response.durationMs / 1000).toFixed(1);
      console.log(`[${label}] (${time}s, confidence: ${response.confidence})`);
      console.log(response.content);
      console.log("");
    }
  }

  // Budget actions (if any)
  if (result.cost.budgetActions.length > 0) {
    console.log("--- Budget actions ---");
    for (const action of result.cost.budgetActions) {
      console.log(`  ${action}`);
    }
    console.log("");
  }

  // Consensus + dissent
  console.log("--- Consensus ---");
  console.log(result.consensus);
  if (result.dissent) {
    console.log("\n--- Dissent ---");
    console.log(result.dissent);
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log(`\nDebate ${result.debateId}`);
  console.log(`Protocol: ${result.protocol} | Rounds: ${result.rounds.length} | Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`Average confidence: ${result.confidenceScore.toFixed(2)}`);

  // Cost summary
  const { totalTokens, totalCostUsd, perAgent, budgetUsedPercent } = result.cost;
  const totalTok = totalTokens.inputTokens + totalTokens.outputTokens;
  if (totalTok > 0 || totalCostUsd > 0) {
    console.log(`\nTokens: ${totalTok.toLocaleString()} (${totalTokens.inputTokens.toLocaleString()} in / ${totalTokens.outputTokens.toLocaleString()} out)`);
    if (totalCostUsd > 0) {
      console.log(`Cost: $${totalCostUsd.toFixed(4)}`);
    }
    if (budgetUsedPercent !== null) {
      console.log(`Budget: ${budgetUsedPercent.toFixed(1)}% used`);
    }
    // Per-agent breakdown
    if (perAgent.size > 1) {
      console.log("Per agent:");
      for (const [name, tokens] of perAgent) {
        const agentTotal = tokens.inputTokens + tokens.outputTokens;
        const costStr = tokens.costUsd ? ` ($${tokens.costUsd.toFixed(4)})` : "";
        console.log(`  ${name}: ${agentTotal.toLocaleString()} tokens${costStr}`);
      }
    }
  }
}

function cmdAnalyze(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      thoroughness: { type: "string" },
    },
    allowPositionals: true,
  });

  const prompt = positionals[0];
  if (!prompt) {
    console.error("Error: analyze requires a prompt\n");
    console.log('Usage: agorai analyze "your complex task" [--thoroughness 0.5]');
    process.exit(1);
  }

  const config = loadConfig();
  const thoroughness = values.thoroughness
    ? parseFloat(values.thoroughness)
    : config.thoroughness;

  console.log(`Analyze: "${prompt}"`);
  console.log(`  Thoroughness: ${thoroughness}`);
  console.log(`\n[v0.1 stub] ProjectManager not implemented yet. Coming in v0.3.`);
}

async function cmdAgents() {
  const config = loadConfig();
  console.log("Configured agents:\n");

  for (const agentConfig of config.agents) {
    const adapter = createAdapter(agentConfig);
    const available = await adapter.isAvailable();
    const status = agentConfig.enabled
      ? available
        ? "enabled, available"
        : "enabled, NOT AVAILABLE"
      : "disabled";
    const roles = agentConfig.personas.length > 0
      ? ` [${agentConfig.personas.join(", ")}]`
      : "";
    const type = agentConfig.model ? `ollama/${agentConfig.model}` : agentConfig.command ?? "?";
    console.log(`  ${agentConfig.name} (${type}) — ${status}${roles}`);
  }
}

function cmdProject(args: string[]) {
  const subcommand = args[0];

  switch (subcommand) {
    case "create": {
      const { values, positionals } = parseArgs({
        args: args.slice(1),
        options: {
          description: { type: "string" },
        },
        allowPositionals: true,
      });
      const name = positionals[0];
      if (!name) {
        console.error('Usage: agorai project create <name> [--description "..."]');
        process.exit(1);
      }
      console.log(`Create project: "${name}"`);
      if (values.description) console.log(`  Description: ${values.description}`);
      console.log(`\n[v0.1 stub] Project persistence not implemented yet. Coming in v0.2.`);
      break;
    }
    case "list": {
      const { values } = parseArgs({
        args: args.slice(1),
        options: {
          archived: { type: "boolean", default: false },
        },
      });
      console.log(`List projects (most recent first)${values.archived ? " — including archived" : ""}`);
      console.log(`\n[v0.1 stub] Project persistence not implemented yet. Coming in v0.2.`);
      break;
    }
    case "switch": {
      const id = args[1];
      if (!id) {
        console.error("Usage: agorai project switch <id>");
        process.exit(1);
      }
      console.log(`Switch to project: ${id}`);
      console.log(`\n[v0.1 stub] Project persistence not implemented yet. Coming in v0.2.`);
      break;
    }
    case "archive": {
      const id = args[1];
      console.log(`Archive project: ${id ?? "(active project)"}`);
      console.log(`\n[v0.1 stub] Project persistence not implemented yet. Coming in v0.2.`);
      break;
    }
    default:
      console.error("Usage: agorai project <create|list|switch|archive> [args]");
      process.exit(1);
  }
}

function cmdContext(args: string[]) {
  const subcommand = args[0];

  if (subcommand === "get") {
    const key = args[1];
    if (key) {
      console.log(`context get "${key}" — [v0.1 stub] not implemented yet.`);
    } else {
      console.log("context list — [v0.1 stub] not implemented yet.");
    }
  } else if (subcommand === "set") {
    const key = args[1];
    const value = args[2];
    if (!key || !value) {
      console.error("Usage: agorai context set <key> <value>");
      process.exit(1);
    }
    console.log(`context set "${key}" = "${value}" — [v0.1 stub] not implemented yet.`);
  } else {
    console.error("Usage: agorai context <get|set> [args]");
    process.exit(1);
  }
}

function cmdInit() {
  const filename = "agorai.config.json";
  if (existsSync(filename)) {
    console.log(`${filename} already exists. Skipping.`);
    return;
  }

  const defaultConfig = {
    user: "default",
    thoroughness: 0.5,
    agents: [
      {
        name: "claude",
        command: "claude",
        args: ["-p", "--output-format", "json"],
        personas: ["architect"],
        enabled: true,
      },
      {
        name: "ollama",
        model: "qwen3",
        endpoint: "http://localhost:11434",
        personas: ["critic"],
        enabled: false,
      },
    ],
    database: { path: "./data/agorai.db" },
  };

  writeFileSync(filename, JSON.stringify(defaultConfig, null, 2) + "\n");
  console.log(`Created ${filename}`);
  console.log("Edit it to enable agents and configure personas.");
}

function cmdStart(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      http: { type: "boolean", default: false },
    },
  });

  if (values.http) {
    console.log("[v0.2+] Streamable HTTP transport not implemented yet.");
    process.exit(1);
  }

  console.log("Starting Agorai MCP server (stdio)...");
  import("./server.js").catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}

async function cmdServe(args: string[]) {
  // Parse --with-agent flags (can be repeated)
  const withAgents: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--with-agent" && args[i + 1]) {
      withAgents.push(args[i + 1]);
      i++; // skip value
    }
  }

  const config = loadConfig();
  initFileLogging(getUserDataDir(config), config.logging);

  if (!config.bridge) {
    console.error('Error: bridge not configured. Add a "bridge" section to agorai.config.json.');
    console.error("See agorai.config.json.example for reference.");
    process.exit(1);
  }

  if (config.bridge.apiKeys.length === 0) {
    console.error("Error: bridge.apiKeys is empty. At least one API key is required.");
    process.exit(1);
  }

  // Dynamic imports to avoid loading bridge deps when not needed
  const { SqliteStore } = await import("./store/sqlite.js");
  const { ApiKeyAuthProvider } = await import("./bridge/auth.js");
  const { startBridgeServer } = await import("./bridge/server.js");

  const dbPath = config.database.path;
  const store = new SqliteStore(dbPath);
  await store.initialize();

  const auth = new ApiKeyAuthProvider(config.bridge.apiKeys, store, config.bridge.salt);

  console.log(`Starting Agorai bridge server...`);
  console.log(`  Endpoint: http://${config.bridge.host}:${config.bridge.port}/mcp`);
  console.log(`  Health:   http://${config.bridge.host}:${config.bridge.port}/health`);
  console.log(`  Agents:   ${config.bridge.apiKeys.map((k) => k.agent).join(", ")}`);
  console.log(`  Database: ${dbPath}`);
  console.log(`  Salt:     ${config.bridge.salt ? "configured" : "NOT SET (unsalted hashes — add bridge.salt)"}`);
  console.log(`  Rate limit: ${config.bridge.rateLimit.maxRequests} req/${config.bridge.rateLimit.windowSeconds}s`);

  // Validate env vars for agents with apiKeyEnv
  for (const agentConfig of config.agents) {
    if (agentConfig.apiKeyEnv && !process.env[agentConfig.apiKeyEnv]) {
      console.log(`  ⚠ Warning: ${agentConfig.name}: env var ${agentConfig.apiKeyEnv} is not set`);
    }
  }

  const server = await startBridgeServer({ store, auth, config });

  // Spawn internal agents if --with-agent was specified
  const ac = new AbortController();
  const agentPromises: Promise<void>[] = [];

  if (withAgents.length > 0) {
    const { runInternalAgent } = await import("./agent/internal-agent.js");

    for (const agentName of withAgents) {
      const agentConfig = config.agents.find((a) => a.name === agentName);
      if (!agentConfig) {
        console.error(`Unknown agent: "${agentName}". Available: ${config.agents.map((a) => a.name).join(", ")}`);
        process.exit(1);
      }

      const adapter = createAdapter(agentConfig);
      console.log(`  Internal agent: ${agentName} (${agentConfig.type ?? "auto"})`);

      agentPromises.push(
        runInternalAgent({
          store,
          adapter,
          agentId: `internal:${agentName}`,
          agentName,
          mode: "passive",
          signal: ac.signal,
        }),
      );
    }
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    ac.abort();
    // Wait a bit for agents to stop gracefully
    await Promise.allSettled(agentPromises);
    await server.close();
    await store.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Agent subcommand group.
 * Routes to: add, list, update, remove, run
 * Backward compat: `agorai agent --adapter <name>` → redirects to run.
 */
async function cmdAgent(args: string[]) {
  const subcommand = args[0];

  // Backward compat: `agorai agent --adapter <name>` → run
  if (subcommand === "--adapter" || subcommand === "-a") {
    return cmdAgentRun(args);
  }

  switch (subcommand) {
    case "add":
      cmdAgentAdd(args.slice(1));
      break;
    case "list":
    case "ls":
      cmdAgentList();
      break;
    case "update":
      cmdAgentUpdate(args.slice(1));
      break;
    case "remove":
    case "rm":
      cmdAgentRemove(args.slice(1));
      break;
    case "run":
      await cmdAgentRun(args.slice(1));
      break;
    default:
      console.error("Usage: agorai agent <add|list|update|remove|run> [args]");
      console.error("\nSubcommands:");
      console.error("  add <name> --type <t> [--model <m>] [--endpoint <e>] [--api-key-env <VAR>] [--clearance <level>]");
      console.error("  list                     List all configured agents");
      console.error("  update <name>            Update agent config fields");
      console.error("  remove <name>            Remove an agent");
      console.error("  run --adapter <name>     Run an internal agent");
      process.exit(1);
  }
}

const VALID_AGENT_TYPES = ["claude-desktop", "claude-code", "openai-compat", "ollama", "custom"] as const;
const VALID_CLEARANCE_LEVELS = ["public", "team", "confidential", "restricted"] as const;

function cmdAgentAdd(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      type: { type: "string" },
      model: { type: "string" },
      endpoint: { type: "string" },
      "api-key-env": { type: "string" },
      clearance: { type: "string" },
    },
    allowPositionals: true,
  });

  const name = positionals[0];
  if (!name) {
    console.error("Usage: agorai agent add <name> --type <type> [--model <m>] [--endpoint <e>] [--api-key-env <VAR>] [--clearance <level>]");
    process.exit(1);
  }

  if (!values.type) {
    console.error("Error: --type is required");
    console.error(`Valid types: ${VALID_AGENT_TYPES.join(", ")}`);
    process.exit(1);
  }

  const agentType = values.type as AgentType;
  if (!VALID_AGENT_TYPES.includes(agentType as typeof VALID_AGENT_TYPES[number])) {
    console.error(`Error: invalid type "${values.type}"`);
    console.error(`Valid types: ${VALID_AGENT_TYPES.join(", ")}`);
    process.exit(1);
  }

  const clearance = values.clearance as ClearanceLevel | undefined;
  if (clearance && !VALID_CLEARANCE_LEVELS.includes(clearance as typeof VALID_CLEARANCE_LEVELS[number])) {
    console.error(`Error: invalid clearance "${values.clearance}"`);
    console.error(`Valid levels: ${VALID_CLEARANCE_LEVELS.join(", ")}`);
    process.exit(1);
  }

  try {
    const { passKey } = addAgent({
      name,
      type: agentType,
      model: values.model,
      endpoint: values.endpoint,
      apiKeyEnv: values["api-key-env"],
      clearance,
    });

    const apiKeyEnv = values["api-key-env"];
    const envStatus = apiKeyEnv
      ? process.env[apiKeyEnv]
        ? `$${apiKeyEnv} ✓`
        : `$${apiKeyEnv} ✗ (not set)`
      : "—";

    console.log(`✅ Agent "${name}" added`);
    console.log(`   Type:       ${agentType}`);
    if (values.model) console.log(`   Model:      ${values.model}`);
    if (values.endpoint) console.log(`   Endpoint:   ${values.endpoint}`);
    console.log(`   API key:    ${envStatus}`);
    console.log(`   Clearance:  ${clearance ?? "team"}`);
    console.log(`   Pass-key:   ${passKey} (save this — needed to connect externally)`);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

function cmdAgentList() {
  try {
    const agents = listAgents();

    if (agents.length === 0) {
      console.log("No agents configured. Use 'agorai agent add' to add one.");
      return;
    }

    // Column headers
    const nameW = Math.max(4, ...agents.map((a) => a.name.length)) + 2;
    const typeW = Math.max(4, ...agents.map((a) => a.type.length)) + 2;
    const modelW = Math.max(5, ...agents.map((a) => (a.model ?? "—").length)) + 2;
    const clearW = 14;
    const apiKeyW = 20;

    const pad = (s: string, w: number) => s.padEnd(w);

    console.log("");
    console.log(
      `  ${pad("Name", nameW)}${pad("Type", typeW)}${pad("Model", modelW)}${pad("Clearance", clearW)}API Key`
    );
    console.log(
      `  ${pad("────", nameW)}${pad("────", typeW)}${pad("─────", modelW)}${pad("─────────", clearW)}───────`
    );

    for (const a of agents) {
      const envStr = a.apiKeyEnv
        ? a.apiKeySet
          ? `$${a.apiKeyEnv} ✓`
          : `$${a.apiKeyEnv} ✗`
        : "—";
      console.log(
        `  ${pad(a.name, nameW)}${pad(a.type, typeW)}${pad(a.model ?? "—", modelW)}${pad(a.clearance, clearW)}${envStr}`
      );
    }

    console.log(`\n  ${agents.length} agent${agents.length !== 1 ? "s" : ""} configured`);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

function cmdAgentUpdate(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      model: { type: "string" },
      endpoint: { type: "string" },
      "api-key-env": { type: "string" },
      clearance: { type: "string" },
      enabled: { type: "string" },
    },
    allowPositionals: true,
  });

  const name = positionals[0];
  if (!name) {
    console.error("Usage: agorai agent update <name> [--model <m>] [--endpoint <e>] [--api-key-env <VAR>] [--clearance <level>] [--enabled true|false]");
    process.exit(1);
  }

  const clearance = values.clearance as ClearanceLevel | undefined;
  if (clearance && !VALID_CLEARANCE_LEVELS.includes(clearance as typeof VALID_CLEARANCE_LEVELS[number])) {
    console.error(`Error: invalid clearance "${values.clearance}"`);
    console.error(`Valid levels: ${VALID_CLEARANCE_LEVELS.join(", ")}`);
    process.exit(1);
  }

  let enabled: boolean | undefined;
  if (values.enabled !== undefined) {
    if (values.enabled !== "true" && values.enabled !== "false") {
      console.error('Error: --enabled must be "true" or "false"');
      process.exit(1);
    }
    enabled = values.enabled === "true";
  }

  try {
    const { changes } = updateAgent(name, {
      model: values.model,
      endpoint: values.endpoint,
      apiKeyEnv: values["api-key-env"],
      clearance,
      enabled,
    });

    console.log(`✅ Agent "${name}" updated`);
    for (const change of changes) {
      console.log(`   ${change}`);
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

function cmdAgentRemove(args: string[]) {
  const name = args[0];
  if (!name) {
    console.error("Usage: agorai agent remove <name>");
    process.exit(1);
  }

  try {
    removeAgent(name);
    console.log(`✅ Agent "${name}" removed`);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

async function cmdAgentRun(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      adapter: { type: "string" },
      mode: { type: "string" },
      poll: { type: "string" },
      system: { type: "string" },
    },
  });

  if (!values.adapter) {
    console.error("Error: --adapter is required\n");
    console.log("Usage: agorai agent run --adapter <name> [--mode passive|active] [--poll 3000] [--system \"prompt\"]");
    process.exit(1);
  }

  const mode = (values.mode as "passive" | "active") ?? "passive";
  if (mode !== "passive" && mode !== "active") {
    console.error(`Error: --mode must be "passive" or "active" (got "${values.mode}")`);
    process.exit(1);
  }

  const pollIntervalMs = values.poll ? parseInt(values.poll, 10) : 3000;
  if (isNaN(pollIntervalMs) || pollIntervalMs < 100) {
    console.error(`Error: --poll must be a number >= 100 (got "${values.poll}")`);
    process.exit(1);
  }

  const config = loadConfig();
  initFileLogging(getUserDataDir(config), config.logging);

  const agentConfig = config.agents.find((a) => a.name === values.adapter);
  if (!agentConfig) {
    console.error(`Unknown agent: "${values.adapter}". Available: ${config.agents.map((a) => a.name).join(", ")}`);
    process.exit(1);
  }

  const { SqliteStore } = await import("./store/sqlite.js");
  const { runInternalAgent } = await import("./agent/internal-agent.js");

  const dbPath = config.database.path;
  const store = new SqliteStore(dbPath);
  await store.initialize();

  const adapter = createAdapter(agentConfig);

  console.log(`Starting internal agent "${values.adapter}"...`);
  console.log(`  Mode: ${mode}`);
  console.log(`  Poll: ${pollIntervalMs}ms`);
  console.log(`  Database: ${dbPath}`);

  const ac = new AbortController();

  const shutdown = async () => {
    console.log("\nShutting down agent...");
    ac.abort();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await runInternalAgent({
    store,
    adapter,
    agentId: `internal:${values.adapter}`,
    agentName: values.adapter,
    mode,
    pollIntervalMs,
    systemPrompt: values.system,
    signal: ac.signal,
  });

  await store.close();
}

async function cmdConnect(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      key: { type: "string" },
    },
    allowPositionals: true,
  });

  let url = positionals[0];
  if (!url) {
    console.error("Usage: agorai connect <bridge-url> --key <api-key>");
    console.error("Example: agorai connect http://my-vps:3100 --key my-secret-key");
    process.exit(1);
  }

  // Auto-append /mcp if not present
  if (!url.endsWith("/mcp")) {
    url = url.replace(/\/$/, "") + "/mcp";
  }

  const apiKey = values.key;
  if (!apiKey) {
    console.error("Error: --key is required");
    process.exit(1);
  }

  let sessionId: string | undefined;
  const FETCH_TIMEOUT_MS = 30_000;

  // stdio→HTTP proxy: read JSON-RPC from stdin, POST to bridge, write responses to stdout
  const rl = createInterface({ input: process.stdin, terminal: false });

  const sendRequest = (body: string, sid?: string) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": `Bearer ${apiKey}`,
    };
    const s = sid !== undefined ? sid : sessionId;
    if (s) {
      headers["mcp-session-id"] = s;
    }
    return fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  };

  const extractRequestId = (line: string): string | number | undefined => {
    try { return JSON.parse(line).id ?? undefined; } catch { return undefined; }
  };

  const isInitializeRequest = (line: string): boolean => {
    try { return JSON.parse(line).method === "initialize"; } catch { return false; }
  };

  const writeJsonRpcError = (id: string | number | undefined, code: number, message: string) => {
    if (id === undefined) return;
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
  };

  /**
   * Perform a transparent MCP initialize handshake to establish a new session.
   */
  const reinitializeSession = async (): Promise<string | undefined> => {
    const initBody = JSON.stringify({
      jsonrpc: "2.0",
      id: "__proxy_reinit__",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "agorai-connect-proxy", version: "1.0.0" },
      },
    });

    const initResp = await sendRequest(initBody, "");  // empty string = no session header
    const newSid = initResp.headers.get("mcp-session-id") ?? undefined;
    await initResp.text(); // drain

    if (!initResp.ok || !newSid) {
      console.error(`[agorai connect] Re-initialize failed: HTTP ${initResp.status}`);
      return undefined;
    }

    // Complete handshake with notifications/initialized
    const notifBody = JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    const notifResp = await sendRequest(notifBody, newSid);
    await notifResp.text(); // drain

    console.error(`[agorai connect] Re-initialized with new session: ${newSid}`);
    return newSid;
  };

  for await (const line of rl) {
    if (!line.trim()) continue;

    const requestId = extractRequestId(line);
    const isInit = isInitializeRequest(line);

    try {
      let resp: Response;

      if (isInit) {
        // Initialize requests always go without sessionId — they create a new session.
        console.error("[agorai connect] Forwarding initialize request (no sessionId)");
        sessionId = undefined;
        resp = await sendRequest(line, ""); // no session header
      } else {
        resp = await sendRequest(line);
      }

      // Session recovery: bridge restarted → old sessionId is invalid (404).
      // The MCP SDK requires an "initialize" handshake before any other request,
      // so we transparently re-initialize to get a new session, then retry.
      if (resp.status === 404 && sessionId && !isInit) {
        await resp.text(); // drain body
        console.error("[agorai connect] Session expired (404) — re-initializing");

        const newSid = await reinitializeSession();
        if (newSid) {
          sessionId = newSid;
          resp = await sendRequest(line);
        } else {
          sessionId = undefined;
          writeJsonRpcError(requestId, -32000, "Bridge session expired and re-initialization failed");
          continue;
        }
      }

      // Capture session ID from response
      const sid = resp.headers.get("mcp-session-id");
      if (sid) sessionId = sid;

      // 202 = notification accepted, no response body
      if (resp.status === 202) continue;

      if (!resp.ok) {
        const body = await resp.text();
        console.error(`[agorai connect] HTTP ${resp.status}: ${body}`);
        writeJsonRpcError(requestId, -32000, `Bridge error: HTTP ${resp.status}`);
        continue;
      }

      const contentType = resp.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream")) {
        const text = await resp.text();
        for (const sseLine of text.split("\n")) {
          if (sseLine.startsWith("data: ")) {
            process.stdout.write(sseLine.slice(6) + "\n");
          }
        }
      } else {
        const text = await resp.text();
        if (text.trim()) {
          process.stdout.write(text + "\n");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[agorai connect] ${msg}`);
      writeJsonRpcError(requestId, -32000, `Proxy error: ${msg}`);
    }
  }

  // Stdin closed — clean up session
  if (sessionId) {
    try {
      await fetch(url, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "mcp-session-id": sessionId,
        },
      });
    } catch {
      // Best effort cleanup
    }
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
