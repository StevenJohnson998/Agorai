#!/usr/bin/env node

/**
 * Agorai MCP Server — stdio transport.
 *
 * Exposes 11 tools: 7 core (debate, analyze, agents, context, handoff, join)
 * + 4 project management (create, list, switch, archive).
 * Streamable HTTP transport planned for v0.2+.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, getUserDataDir, type PersonaConfig } from "./config.js";
import { createAdapter } from "./adapters/index.js";
import { DebateSession } from "./orchestrator.js";
import type { DebateMode } from "./orchestrator.js";
import { resolvePersonas } from "./personas.js";
import { createLogger, initFileLogging } from "./logger.js";

const log = createLogger("server");

import {
  DebateInputSchema,
  AnalyzeInputSchema,
  ListAgentsInputSchema,
  ContextGetInputSchema,
  ContextSetInputSchema,
  HandoffInputSchema,
  JoinDebateInputSchema,
  ProjectCreateInputSchema,
  ProjectListInputSchema,
  ProjectSwitchInputSchema,
  ProjectArchiveInputSchema,
} from "./tools.js";

const config = loadConfig();
initFileLogging(getUserDataDir(config), config.logging);

const server = new McpServer({
  name: "agorai",
  version: "0.1.0",
});

// --- Tool handlers ---

server.tool(
  "debate",
  "Start a multi-agent debate on a topic",
  DebateInputSchema.shape,
  async (args) => {
    log.debug("debate tool invoked:", JSON.stringify(args));
    // Resolve agents
    const agentNames = args.agents
      ?? config.agents.filter((a) => a.enabled).map((a) => a.name);

    const agentConfigs = agentNames.map((name) => {
      const found = config.agents.find((a) => a.name === name);
      if (!found) throw new Error(`Unknown agent: "${name}"`);
      return found;
    });

    const adapters = agentConfigs.map(createAdapter);
    const mode = (args.mode ?? "full") as DebateMode;
    const thoroughness = args.thoroughness ?? config.thoroughness;

    // Estimate-only mode: return estimation without running the debate
    if (args.estimate_only) {
      log.debug("debate tool: estimate_only mode");
      const session = new DebateSession(undefined, config.budget);
      const estimate = session.estimate({
        agents: adapters,
        mode,
        thoroughness,
        maxRounds: args.max_rounds,
        maxTokens: args.max_tokens,
      });
      log.info("estimate_only result:", JSON.stringify(estimate));
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(estimate, null, 2),
        }],
      };
    }

    // Resolve personas from roles arg (Record<string, string[]>) → Map<string, PersonaConfig[]>
    const agentPersonas = new Map<string, PersonaConfig[]>();
    if (args.roles) {
      for (const [agentName, personaNames] of Object.entries(args.roles)) {
        agentPersonas.set(agentName, resolvePersonas(personaNames, config));
      }
    } else {
      for (const ac of agentConfigs) {
        if (ac.personas.length > 0) {
          agentPersonas.set(ac.name, resolvePersonas(ac.personas, config));
        }
      }
    }

    // Run full debate
    const session = new DebateSession(undefined, config.budget);
    const result = await session.run({
      projectId: "mcp-session",
      debateId: args.debate_id,
      prompt: args.prompt,
      agents: adapters,
      agentPersonas,
      mode,
      thoroughness,
      maxRounds: args.max_rounds,
      maxTokens: args.max_tokens,
    });

    // Format result
    const costSummary = result.cost.totalCostUsd > 0
      ? `\nCost: $${result.cost.totalCostUsd.toFixed(4)} | Tokens: ${result.cost.totalTokens.inputTokens + result.cost.totalTokens.outputTokens}`
      : `\nTokens: ${result.cost.totalTokens.inputTokens + result.cost.totalTokens.outputTokens}`;

    const output = [
      `**Consensus** (protocol: ${result.protocol}, confidence: ${result.confidenceScore.toFixed(2)})`,
      "",
      result.consensus,
      result.dissent ? `\n**Dissent:**\n${result.dissent}` : "",
      `\n---\nDebate ${result.debateId} | ${result.rounds.length} rounds | ${(result.durationMs / 1000).toFixed(1)}s${costSummary}`,
    ].filter(Boolean).join("\n");

    return {
      content: [{ type: "text" as const, text: output }],
    };
  }
);

server.tool(
  "analyze",
  "Decompose a complex task via ProjectManager",
  AnalyzeInputSchema.shape,
  async (_args) => {
    // TODO v0.3: wire up ProjectManager
    return {
      content: [{ type: "text" as const, text: "analyze tool: not implemented yet (v0.3)" }],
    };
  }
);

server.tool(
  "list_agents",
  "List available agents and their status",
  ListAgentsInputSchema.shape,
  async () => {
    const agents = config.agents.map((a) => ({
      name: a.name,
      command: a.command,
      enabled: a.enabled,
    }));
    return {
      content: [{ type: "text" as const, text: JSON.stringify(agents, null, 2) }],
    };
  }
);

server.tool(
  "context_get",
  "Read from private memory",
  ContextGetInputSchema.shape,
  async (_args) => {
    // TODO v0.2: wire up Blackboard
    return {
      content: [{ type: "text" as const, text: "context_get: not implemented yet (v0.2)" }],
    };
  }
);

server.tool(
  "context_set",
  "Write to private memory",
  ContextSetInputSchema.shape,
  async (_args) => {
    // TODO v0.2: wire up Blackboard
    return {
      content: [{ type: "text" as const, text: "context_set: not implemented yet (v0.2)" }],
    };
  }
);

server.tool(
  "handoff",
  "Transfer a spec to an agent",
  HandoffInputSchema.shape,
  async (_args) => {
    // TODO v0.2: implement handoff
    return {
      content: [{ type: "text" as const, text: "handoff: not implemented yet (v0.2)" }],
    };
  }
);

server.tool(
  "join_debate",
  "Join an ongoing public debate",
  JoinDebateInputSchema.shape,
  async (_args) => {
    // TODO v0.4: implement join_debate with public space access
    return {
      content: [{ type: "text" as const, text: "join_debate: not implemented yet (v0.4)" }],
    };
  }
);

// --- Project management tools ---

server.tool(
  "project_create",
  "Create a new project (persistent workspace for debates and context)",
  ProjectCreateInputSchema.shape,
  async (_args) => {
    // TODO v0.2: wire up ProjectManager.createProject
    return {
      content: [{ type: "text" as const, text: "project_create: not implemented yet (v0.2)" }],
    };
  }
);

server.tool(
  "project_list",
  "List projects",
  ProjectListInputSchema.shape,
  async (_args) => {
    // TODO v0.2: wire up ProjectManager.listProjects
    return {
      content: [{ type: "text" as const, text: "project_list: not implemented yet (v0.2)" }],
    };
  }
);

server.tool(
  "project_switch",
  "Switch to a project (previous project state already saved)",
  ProjectSwitchInputSchema.shape,
  async (_args) => {
    // TODO v0.2: wire up ProjectManager.switchProject
    return {
      content: [{ type: "text" as const, text: "project_switch: not implemented yet (v0.2)" }],
    };
  }
);

server.tool(
  "project_archive",
  "Archive a project (hidden from listings, data preserved)",
  ProjectArchiveInputSchema.shape,
  async (_args) => {
    // TODO v0.2: wire up ProjectManager.archiveProject
    return {
      content: [{ type: "text" as const, text: "project_archive: not implemented yet (v0.2)" }],
    };
  }
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("MCP server started (stdio)");
}

main().catch((err) => {
  console.error("Agorai MCP server failed to start:", err);
  process.exit(1);
});
