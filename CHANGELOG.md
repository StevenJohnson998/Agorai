# Changelog

## 2026-02-27 — agorai-connect v0.0.1

### Added
- **`agorai-connect` npm package** (`packages/agorai-connect/`): lightweight client to connect AI agents to an Agorai bridge. Zero runtime dependencies — Node.js built-ins only.
- **3 CLI commands**:
  - `agorai-connect proxy <url> <pass-key>` — stdio→HTTP proxy for MCP clients (Claude Desktop)
  - `agorai-connect setup` — interactive Claude Desktop config injection (detects OS, finds config, tests health, merges mcpServers)
  - `agorai-connect agent --bridge <url> --key <key> --model <model> --endpoint <endpoint>` — connects an OpenAI-compatible model (Ollama, Groq, Mistral, etc.) to the bridge as a participant
- **Agent runner**: MCP session init, auto-discovery of projects/conversations, subscribe, poll loop (3s), passive mode (@mention) or active mode, context building (20 last messages), model call via `/v1/chat/completions`, graceful shutdown
- **Lightweight MCP client** (`mcp-client.ts`): JSON-RPC over HTTP, ~150 lines, no SDK dependency — handles initialize, tools/call, tools/list, notifications, SSE responses, session management
- **Model caller** (`model-caller.ts`): OpenAI-compatible chat completions with `node:http/https` for controllable timeouts
- **Config paths** (`config-paths.ts`): OS detection (Windows/macOS/Linux), Claude Desktop config file discovery (4 known paths), node.exe path resolution for Windows
- **Programmatic API**: all modules exported from `index.ts` for library usage
- **Tests**: 34 tests (7 test files) — utils, config-paths, proxy, model-caller, mcp-client (with mock HTTP servers), setup (config merging), agent (helpers + mention detection)
- **Monorepo**: root `package.json` now has `"workspaces": ["packages/*"]`

### Tested
- Proxy: initialize handshake against live bridge — OK
- Agent: Ollama mistral:7b connected via agorai-connect, discovered conversations, responded to a message from Claude Code through the bridge — full round-trip confirmed

---

## 2026-02-27 — v0.2.1 (OpenAI-compat adapter)

### Added
- **OpenAI-compatible adapter** (`src/adapters/openai-compat.ts`): single adapter for all OpenAI-compatible APIs — Groq, Mistral, Deepseek, LM Studio, vLLM, llama.cpp, LocalAI, Together AI, OpenAI itself
- **`type` field on agent config**: explicit adapter selection (`cli`, `ollama`, `openai-compat`). Backward compatible — auto-detects from `model`/`command` if omitted
- **`apiKey` field on agent config**: for authenticated API endpoints (Groq, Mistral, Deepseek, etc.)
- **HTTPS support**: adapter handles both HTTP and HTTPS endpoints natively
- **Config examples**: Groq, Mistral, Deepseek, LM Studio examples in `agorai.config.json.example`
- **Tests**: 4 new adapter factory tests (140 total, all passing)
- **Competitive analysis**: Agorai vs OpenClaw vs LM Studio — saved in bridge project memory
- **Roadmap updates**: Agent Capabilities with tag dictionary (v0.3), optional modules for passive agents/routing (v0.4), GUI as separate item (v0.6)

### Changed
- Adapter factory now checks explicit `type` first, then auto-detects (backward compat)
- Error message for misconfigured agents updated to mention all three adapter types

---

## 2026-02-27 — v0.2.0 (Bridge)

### Added
- **Bridge HTTP server** (`agorai serve`): Streamable HTTP transport on configurable host:port, per-session MCP server instances, health endpoint, graceful shutdown
- **SQLite store** (`src/store/`): 7 tables (agents, projects, project_memory, conversations, conversation_agents, messages, message_reads), WAL mode, indexed, visibility filtering on every read
- **4-level visibility model**: `public < team < confidential < restricted` on every entity. Agents have `clearanceLevel`, store filters automatically. Write capping prevents privilege escalation
- **API key auth** (`src/bridge/auth.ts`): SHA-256 hashed keys, auto-registration in store on first auth, per-agent clearance level
- **Permissions stub** (`src/bridge/permissions.ts`): `AllowAllPermissions` with `IPermissionProvider` interface ready for v0.3 RBAC
- **15 bridge MCP tools** in 5 groups:
  - Agents: `register_agent`, `list_agents`
  - Projects: `create_project`, `list_projects`
  - Memory: `set_memory`, `get_memory`, `delete_memory`
  - Conversations: `create_conversation`, `list_conversations`, `subscribe`, `unsubscribe`
  - Messages: `send_message`, `get_messages`, `get_status`, `mark_read`
- **Config**: `BridgeConfigSchema` with port, host, apiKeys (each with agent name, type, capabilities, clearanceLevel). `VisibilityLevelSchema` exported
- **CLI**: `agorai serve` command (validates bridge config, initializes store, starts HTTP server), `agorai connect` command (stdio→HTTP proxy for MCP clients)
- **`connect.mjs`**: standalone zero-dependency script for Claude Desktop — no npm install needed, just Node.js 18+
- **Tests**: 64 new tests (store CRUD + visibility filtering + limit-after-filter, auth validation + auto-registration, bridge tool schemas, integration round-trips). Total: 136 tests passing
- **Documentation**: complete rewrite reflecting the "collaboration platform" positioning — README, ARCHITECTURE, FEATURES, llms.txt, CONTRIBUTING, QUICKSTART

### Changed
- `better-sqlite3` moved from devDependencies to dependencies (now used by the store)
- `package.json` description updated to "Multi-agent AI collaboration platform"
- Version bumped to 0.2.0
- ARCHITECTURE.md now has bridge layer diagram above the debate engine
- FEATURES.md reorganized into Bridge/Collaboration, Security/Visibility, and Debate Engine sections
- Roadmap revised: v0.3 (permissions + review), v0.4 (debate via bridge), v0.5 (sentinel AI), v0.6 (distribution), v0.7+ (enterprise)

### Unchanged
- All 72 existing tests pass without modification
- stdio MCP server (`agorai start`) works exactly as before
- CLI debate commands work exactly as before
- Debate engine, adapters, consensus, personas, logging — all untouched
- `memory/base.ts` and `memory/sqlite.ts` (old Blackboard) remain intact (progressive migration in v0.3)

---

## 2026-02-25 — v0.1.0 (Foundation)

### Added
- **CLI** with 10 commands: `debate`, `analyze`, `agents`, `project create/list/switch/archive`, `context get/set`, `init`, `start`
- **MCP server** (stdio transport) with 11 tools: `debate`, `analyze`, `list_agents`, `context_get`, `context_set`, `handoff`, `join_debate`, `project_create`, `project_list`, `project_switch`, `project_archive`
- **DebateSession orchestrator**: multi-round debates with parallel agent invocation, token budget tracking with adaptive measures (summarize, reduce agents, cut rounds), pre-estimation with `--force` bypass
- **Agent adapters**: Claude CLI (spawn + stdin), Gemini CLI (spawn + stdin, untested), Ollama HTTP API
- **Persona system**: 4 built-in personas (architect, critic, pragmatist, security with 1.3x bonus), custom persona support, multi-role per agent with merged system prompts, per-debate role override via `--roles`
- **Consensus protocols**: VoteConsensus (weighted majority, 50% dissent threshold), DebateConsensus (iterative synthesis, 30% dissent threshold), protocol auto-selection via keyword heuristic
- **Confidence extraction**: `[confidence: X.XX]` parsed from LLM output, 0.5 fallback
- **Dynamic timeouts**: `calculateTimeout()` — CLI 30s base + 20ms/token (max 5min), HTTP 15s + 15ms/token (max 10min)
- **MCP `debate` tool**: fully wired with start/resume support
- **Logging system**: stderr output (controlled by `--verbose`/`--debug`/`AGORAI_LOG_LEVEL`), persistent file logging with global `info.log` and per-debate transcript logs (`debates/<id>.log`), user-scoped data directories (`data/<user>/`), configurable purge strategies (count/date/size)
- **Privacy**: regex-based sensitive data scanner (emails, API keys, IPs, passwords)
- **Config**: Zod-validated `agorai.config.json` with agents, personas, budget, logging, privacy, user scoping
- **Data directory**: absolute path resolution via config dir or XDG_DATA_HOME fallback
- **Tests**: 72 tests passing (vitest)

### Security & validation hardening
- **Path traversal fix**: debateId validated (alphanumeric/hyphens, max 128 chars) before use in log file paths
- **0 agents guard**: early throw if no agents provided, guard before consensus on empty rounds
- **Resume honesty**: `--continue` warns that resume requires SQLite blackboard (v0.2) instead of silently starting fresh
- **CLI input validation**: `--thoroughness`, `--max-rounds`, `--max-tokens`, `--mode` validated with clear error messages
- **Budget comment fix**: "cheapest agent" → "first agent" (no cost-per-agent tracking yet)
- **computeMaxRounds**: smooth 1-5 formula `ceil(t*5)` — no more gap (was jumping from 2 to 4 rounds)
- **Gemini disabled by default**: untested adapter no longer enabled in default config
- **better-sqlite3**: moved to devDependencies (unused native addon, all SQLite code is stub)
- **Blackboard error logging**: swallowed catch replaced with `log.warn()`

### Not yet implemented (stubs)
- SQLite Blackboard (v0.2)
- QuorumConsensus — separate from VoteConsensus (v0.2)
- MCP tools: `analyze`, `context_get/set`, `handoff`, `join_debate`, `project_*` (v0.2-v0.4)
- ProjectManager decomposition + synthesis (v0.3)
- Streamable HTTP transport (v0.2+)
- Public space + join_debate (v0.4)
