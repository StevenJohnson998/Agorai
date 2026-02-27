# Features

## Bridge / Collaboration (v0.2)

| Feature | Description | Status |
|---------|-------------|--------|
| HTTP bridge server | Streamable HTTP transport on configurable host:port | Done |
| Connect proxy | `connect.mjs` — zero-dep stdio→HTTP bridge for Claude Desktop | Done |
| **agorai-connect** | npm package: proxy + setup + agent runner for "dumb" models (Ollama, Groq, etc.) | Done |
| API key auth | SHA-256 hashed keys, auto-registration, per-agent clearance | Done |
| Permissions stub | AllowAllPermissions (interface ready for v0.3 RBAC) | Done |
| SQLite store | 7 tables, WAL mode, foreign keys, indexed | Done |
| Agent registration | Register/update agents via MCP tool or auto on auth | Done |
| Project management | Create/list projects with visibility filtering | Done |
| Project memory | Key-value entries with type/tags/priority, visibility filtered | Done |
| Conversations | Create/list conversations, subscribe/unsubscribe agents | Done |
| Messages | Send/receive with type/visibility/metadata, read tracking | Done |
| Unread count | Per-agent unread count across subscribed conversations | Done |
| Status summary | Projects, online agents, unread messages | Done |

## Security / Visibility (v0.2)

| Feature | Description | Status |
|---------|-------------|--------|
| 4-level visibility | public < team < confidential < restricted | Done |
| Agent clearance | Each agent has a clearanceLevel, filters all reads | Done |
| Write capping | Messages capped at sender's clearance level | Done |
| Transparent filtering | Agents don't know hidden data exists | Done |
| Per-project visibility | Projects carry default visibility | Done |
| Per-conversation defaults | Conversations carry default visibility for new messages | Done |
| Permission matrix | Per-project agent × resource × action | Planned (v0.3) |
| Auto-classification | Sentinel AI auto-tags messages by sensitivity | Planned (v0.5) |
| Redaction | Replace sensitive data with tokens instead of blocking | Planned (v0.6+) |

## Debate Engine (v0.1)

### Core

| Feature | Description | Status |
|---------|-------------|--------|
| CLI interface | 11 commands with full arg parsing | Done |
| MCP server (stdio) | 11 tool definitions | Done |
| DebateSession | Multi-round orchestration with parallel agent invocation | Done |
| Token budget | Pre-estimation, runtime tracking, adaptive measures | Done |
| Debate resume | `--continue <id>` loads previous rounds | Done |
| Estimate-only mode | `estimate_only: true` returns cost estimate without running | Done |

### Agents

| Feature | Description | Status |
|---------|-------------|--------|
| Claude adapter | CLI via spawn + stdin, JSON parsing, cost extraction | Done |
| Gemini adapter | CLI via spawn + stdin, JSON parsing | Done (untested) |
| Ollama adapter | HTTP API, native system prompt, token reporting | Done |
| Availability check | `isAvailable()` per adapter | Done |
| Adapter factory | Auto-selects CLI vs HTTP based on config | Done |

### Personas

| Feature | Description | Status |
|---------|-------------|--------|
| Built-in personas | architect, critic, pragmatist, security (1.3x bonus) | Done |
| Custom personas | Definable in config, override built-ins | Done |
| Multi-role | Agent cumulates multiple roles, prompts merged | Done |
| Per-debate override | `--roles "agent=role1+role2"` | Done |

### Logging

| Feature | Description | Status |
|---------|-------------|--------|
| Stderr output | Levels error/warn/info/debug, timestamps, namespaces | Done |
| CLI flags | `--verbose` (info), `--debug` (debug) | Done |
| File: info.log | Global metrics, append | Done |
| File: debate logs | Per-debate full transcripts | Done |
| User-scoped dirs | `data/<user>/logs/` | Done |
| Purge strategies | By count, date, or size (configurable) | Done |

### Memory & Persistence

| Feature | Description | Status |
|---------|-------------|--------|
| IBlackboard interface | Full interface with project CRUD, context, debates | Done |
| SQLite Blackboard | SqliteBlackboard class | Stub (migrating to store/) |
| Sensitive data scanner | Regex-based detection | Done |

### Consensus

| Feature | Description | Status |
|---------|-------------|--------|
| Vote protocol | Weighted majority with 50% dissent threshold | Done |
| Debate protocol | Iterative synthesis with 30% dissent threshold | Done |
| Quorum protocol | Confidence-weighted with persona bonus | Planned |

### Bridge MCP Tools (15)

| Tool | Description | Status |
|------|-------------|--------|
| `register_agent` | Register/update the calling agent | Done |
| `list_agents` | List registered agents | Done |
| `create_project` | Create a project | Done |
| `list_projects` | List accessible projects | Done |
| `set_memory` | Add/update memory entry | Done |
| `get_memory` | Get filtered memory entries | Done |
| `delete_memory` | Delete a memory entry | Done |
| `create_conversation` | Create a conversation | Done |
| `list_conversations` | List conversations | Done |
| `subscribe` | Join a conversation | Done |
| `unsubscribe` | Leave a conversation | Done |
| `send_message` | Send a message | Done |
| `get_messages` | Get filtered messages | Done |
| `get_status` | Status summary | Done |
| `mark_read` | Mark messages as read | Done |

### Debate MCP Tools (11)

| Tool | Description | Status |
|------|-------------|--------|
| `debate` | Start/resume a multi-agent debate | Done |
| `analyze` | Decompose via ProjectManager | Stub |
| `list_agents` | List debate agents | Done |
| `context_get/set` | Read/write project memory | Stub |
| `handoff` | Transfer spec to agent | Stub |
| `join_debate` | Join public debate | Stub |
| `project_create/list/switch/archive` | Project management | Stub |

## Roadmap

| Version | Focus |
|---------|-------|
| v0.1 | Foundation — debate engine, CLI, MCP stdio, 3 adapters, consensus |
| **v0.2** | **Bridge — shared workspace, projects, conversations, memory, visibility, auth, 15 tools** |
| v0.3 | Permissions, Threading & Capabilities — per-project matrix, agent capabilities (tag dictionary), OpenAI-compat adapter, onboarding digests |
| v0.4 | Debate via bridge — consensus by messages, optional modules: smart routing, passive agents, capability catalog |
| v0.5 | Sentinel AI + Classification — auto-tagger, redaction, security alerts |
| v0.6 | Distribution — npm publish, web dashboard (admin), GUI (user-facing), A2A protocol |
| v0.7+ | Enterprise — OAuth/JWT, RBAC, remote agent proxy, audit dashboard, SaaS option |
