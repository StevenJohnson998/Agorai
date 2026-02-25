# Agorai

Multi-agent AI debate server. MCP + CLI.

Instead of asking one AI and hoping for the best, Agorai orchestrates structured debates between multiple AI agents. They argue, challenge each other, and converge on a consensus — or surface where they disagree.

## What it does

- **Structured debates** — Agents discuss a topic in rounds with defined protocols (majority vote, iterative debate, or confidence-weighted quorum)
- **3-level orchestration** — ProjectManager decomposes complex tasks into sub-questions, DebateSessions handle individual debates, and a Blackboard provides shared memory
- **Thoroughness control** — A single parameter (0.0 to 1.0) balances depth vs cost across the entire pipeline
- **Token budget** — Set a max token budget per debate or per project. The orchestrator tracks usage and adapts automatically: summarizes context, reduces agents, cuts rounds
- **Private by default** — All data stays local. Nothing is shared unless you explicitly promote it
- **Two interfaces** — Use it as an MCP server (for Claude, etc.) or directly from the CLI

## Status

**v0.1.0 — Foundation.** Architecture in place, CLI debate works (Claude + Ollama), configurable roles with multi-role per agent, token tracking with budget enforcement. Consensus protocols and SQLite memory land in v0.2.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it all fits together.

## Quick start

```bash
git clone https://github.com/StevenJohnson998/Agorai.git
cd Agorai
npm install
npm run build

# CLI
npx agorai --help
npx agorai agents
npx agorai debate "Redis vs Memcached for session storage?"

# MCP server (stdio)
npx agorai start
```

### Configuration

```bash
npx agorai init  # creates agorai.config.json
```

See [agorai.config.json.example](agorai.config.json.example) for all options.

### As an MCP server

Add to your MCP client config:

```json
{
  "mcpServers": {
    "agorai": {
      "command": "node",
      "args": ["/path/to/agorai/dist/server.js"]
    }
  }
}
```

## How agents are invoked

No API keys needed in Agorai itself. Agents are called through their local CLIs or HTTP APIs:

- **Claude** — `claude -p --output-format json` (Claude Code CLI)
- **Gemini** — `gemini -p --output-format json` (Gemini CLI)
- **Ollama** — HTTP API at `localhost:11434` (any local model: qwen3, llama3, mistral, etc.)

You configure which agents are available in `agorai.config.json`. CLI agents must be installed and authenticated on your system. Ollama agents need a running Ollama instance.

## Roles / Personas

Each agent can be assigned one or more roles that shape how they approach the question. Roles are configured at two levels:

**Config defaults** — in `agorai.config.json`, each agent has a `personas` array:
```json
{ "name": "claude", "personas": ["architect", "security"], ... }
```

**Per-debate override** — override roles for a specific debate:
```bash
agorai debate "question" --roles "claude=architect+security,ollama=critic+pragmatist"
```

An agent can cumulate multiple roles. When it does, the system prompts are merged so the agent integrates all perspectives into a single response.

Built-in personas: `architect`, `critic`, `pragmatist`, `security`. You can define custom ones in the config.

## MCP Tools

| Tool | Description |
|------|-------------|
| `debate` | Start a multi-agent debate |
| `analyze` | Decompose a complex task (ProjectManager) |
| `list_agents` | List available agents |
| `project_create` | Create a project (auto-persisted) |
| `project_list` | List projects (most recent first) |
| `project_switch` | Switch to a different project |
| `project_archive` | Archive a project (hidden, not deleted) |
| `context_get` | Read from project memory |
| `context_set` | Write to project memory |
| `handoff` | Transfer a spec to an agent |
| `join_debate` | Join a public debate (external agents) |

## Roadmap

| Version | What |
|---------|------|
| v0.1 | Foundation — CLI debate, configurable roles, Claude + Ollama adapters |
| v0.2 | SQLite memory, consensus protocols, debate resume, full Blackboard |
| v0.3 | ProjectManager, task decomposition, Streamable HTTP, vector memory |
| v0.4 | External agent support, public space with privacy validation |
| v0.5 | More local runtimes (LM Studio, vLLM, llama.cpp), webhooks, npm global install |

## License

AGPLv3. See [LICENSE](LICENSE).

If you want to build commercial tools on top of Agorai, reach out — we're open to dual licensing for serious projects.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). We use a CLA for contributions.
