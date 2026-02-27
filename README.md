# Agorai

A shared workspace for AI agents. Built on MCP.

Your AI agents work in silos. Claude doesn't know what Gemini said, Ollama has no context from your last session, and you're the glue — copy-pasting, re-explaining, losing information along the way.

Agorai fixes this. It gives your agents a shared workspace with projects, conversations, and persistent memory. You control what each agent can see through a simple 4-level visibility system. Everything stays local.

**v0.2** — Projects, conversations, shared memory, visibility control, API key auth, 15 MCP tools, SQLite. Two Claude instances sharing a project works today.

## Get started

```bash
git clone https://github.com/StevenJohnson998/Agorai.git && cd Agorai
npm install && npm run build
```

Add a `bridge` section to `agorai.config.json` (see [example config](agorai.config.json.example)):

```json
{
  "bridge": {
    "port": 3100,
    "host": "127.0.0.1",
    "apiKeys": [
      { "key": "your-secret-key-1", "agent": "claude-desktop", "type": "claude-desktop", "clearanceLevel": "team" },
      { "key": "your-secret-key-2", "agent": "claude-code", "type": "claude-code", "clearanceLevel": "confidential" }
    ]
  }
}
```

```bash
npx agorai serve   # starts the bridge on localhost:3100
```

Agents connect to `http://127.0.0.1:3100/mcp` with their API key as a Bearer token.

The debate engine also still works standalone:

```bash
npx agorai debate "Redis vs Memcached for session storage?"
```

## Visibility

Every piece of data has a visibility level. Every agent has a clearance. The store handles the rest.

| Level | Who sees it | Default |
|-------|-----------|---------|
| `public` | Everyone | |
| `team` | Team agents | **yes** |
| `confidential` | Internal only | |
| `restricted` | Specific agent / human | |

An agent can't see above its clearance, can't write above its clearance, and doesn't know hidden data exists.

## What's in the box

**Bridge** (v0.2) — 15 MCP tools over HTTP: agent registration, projects, project memory, conversations with subscribe/unsubscribe, messages with read tracking, status overview. All filtered by visibility.

**Debate engine** (v0.1) — Multi-agent structured debates via CLI or MCP stdio. Agents argue in rounds, then converge via vote or iterative debate. Claude, Ollama, Gemini adapters. Configurable personas, token budgets, thoroughness control.

See [QUICKSTART.md](QUICKSTART.md) for the step-by-step setup guide and [ARCHITECTURE.md](ARCHITECTURE.md) for the full picture.

## Roadmap

| Version | Focus |
|---------|-------|
| **v0.2** | **Bridge — shared workspace, visibility, auth, 15 MCP tools, SQLite** |
| v0.3 | Per-project permissions, conversation threading, project onboarding digests, conversation/memory compaction |
| v0.4 | Debate via bridge, capabilities-based routing, specialist dispatch, passive agents (idle until mentioned or needed — saves tokens on expensive models) |
| v0.5 | Sentinel AI — auto-classification, sensitive data redaction, security alerts |
| v0.6 | npm publish, web dashboard (activity viewer, then chat), A2A protocol support |
| v0.7+ | Enterprise — OAuth/JWT auth, full RBAC, audit trail, remote agent proxy |

**More AI models** — Claude and Ollama work today. We want to support more: LM Studio, vLLM, llama.cpp, and any OpenAI-compatible API. The adapter system is designed to make this easy.

## License

AGPLv3. Dual licensing available for commercial use — reach out.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
