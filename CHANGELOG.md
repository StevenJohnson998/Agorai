# Changelog

## 2026-03-01 — v0.4.0 (Message Format / Metadata Overhaul)

### Added
- **`BridgeMetadata`**: trusted metadata injected by the bridge on every message — `visibility`, `senderClearance`, `visibilityCapped`, `originalVisibility?`, `timestamp`, `instructions`. Immutable by agents, always present.
- **`agentMetadata`**: private operational metadata (cost, model, tokens, etc.) only visible to the sender. Other agents cannot see it. Replaces the free-form `metadata` field.
- **Anti-forge protection**: bridge strips `_bridge*`, `bridgeMetadata`, `bridge_metadata` keys from agent-provided metadata before storing.
- **Confidentiality modes** on projects: `normal` (agent-responsible, default), `strict` (bridge-enforced, future), `flexible` (agent chooses freely).
- **`BridgeInstructions`** in bridge metadata: pre-computed human-readable confidentiality instruction + mode, so agents know how to handle visibility.
- **High-water mark tracking** (`agent_high_water_marks` table): passive tracking of max visibility level seen per agent per project. Populated on every `getMessages()` call. Never decreases. Enforcement deferred to strict mode (future sprint).
- **`getHighWaterMark(agentId, projectId)`**: new store method to query an agent's current high-water mark.
- **Schema migration**: automatic `ALTER TABLE` on startup for existing databases — adds `agent_metadata`, `bridge_metadata` columns to `messages`, `confidentiality_mode` to `projects`. Migrates existing `metadata` → `agentMetadata`.
- **MCP instructions expanded**: metadata model and confidentiality mode documentation in bridge handshake.

### Changed
- **`Message` type**: now has `agentMetadata` + `bridgeMetadata` fields. `metadata` is deprecated (kept for backward compat, will be removed in v0.5).
- **`Project` type**: new `confidentialityMode` field (default: `"normal"`).
- **`CreateProject` type**: new optional `confidentialityMode` field.
- **`CreateProjectSchema`**: new `confidentiality_mode` enum field.
- **`SendMessageSchema`**: metadata description updated to "Private metadata (only visible to you)".
- **`send_message` response**: excludes deprecated `metadata` field, includes `agentMetadata` + `bridgeMetadata`.
- **`get_messages` response**: excludes deprecated `metadata`, strips `agentMetadata` for non-sender messages.
- **Bridge version**: `0.3.0` → `0.4.0`.

### Tests
- 15 new tests: bridgeMetadata generation (normal + capped), agentMetadata round-trip, anti-forge stripping, null metadata, confidentiality modes (default, strict, flexible, instructions), high-water marks (create, increase-only, per-project, unknown returns null)
- Total: 222 server tests passing (was 207)

### Not changed
- `agorai-connect` stays at `0.0.6` (not impacted — does not touch metadata)
- All existing tests pass without modification (backward compat)

---

## 2026-03-01 — v0.3.0 (SSE Push Notifications) + agorai-connect v0.0.6

### Added (agorai — v0.3.0)
- **SSE Push Notifications — 3-layer architecture**:
  1. **Store EventBus** (`src/store/events.ts`): `EventEmitter` on `SqliteStore`, emits `message:created` after DB insert. `setMaxListeners(0)` for pub/sub pattern
  2. **Bridge SSE Dispatcher** (`src/bridge/server.ts`): listens to EventBus, pushes `notifications/message` JSON-RPC notifications to subscribed agents via `transport.send()`. Applies visibility gating (agent clearance >= message visibility) and sender exclusion (agents don't notify themselves)
  3. **Client listeners** (see agorai-connect v0.0.6 below + internal agent)
- **`initialize` server instructions**: `initialize` response now includes workflow instructions (call `mark_read` after `get_messages`, respect visibility when sending)
- **Enhanced tool descriptions**: `get_messages`, `mark_read`, `send_message` have richer descriptions with workflow hints
- **Content preview in notifications**: 200-char preview of message content in push notification payload
- **Internal agent cleanup**: eventBusCleanup closure unsubscribes from EventBus on shutdown
- **Session registration race fix**: `closedBeforeRegistered` flag prevents double-registration when SSE stream closes before MCP handshake completes

### Fixed (agorai — v0.3.0)
- **N+1 agent lookup**: bridge dispatcher now uses `listAgents()` for a single batch lookup instead of per-subscriber `getAgent()` calls

### Added (agorai-connect — v0.0.6)
- **`McpClient.openSSEStream()`**: opens GET `/mcp` SSE stream, parses incoming `notifications/message` JSON-RPC events, auto-reconnects on disconnect
- **`SSENotification` type**: exported from `index.ts` for library consumers
- **Proxy SSE listener**: `proxy` command opens a background GET `/mcp` SSE stream and forwards `data:` lines to stdout — Claude Desktop receives push notifications via stdio without polling
- **Agent SSE fast-path**: `agent` command opens SSE stream, routes `notifications/message` events to a `pendingConversations` set for instant poll trigger (poll loop retained as fallback)

### Tests
- **Store EventBus**: 6 new tests (`store-events.test.ts`) — emits on createMessage, not on other ops, multiple listeners, setMaxListeners, cleanup
- **Bridge SSE Dispatcher**: 9 new tests (`bridge-sse.test.ts`) — push on send, visibility gating, sender exclusion, N+1 batch lookup, session race fix
- **agorai-connect SSE stream**: 7 new tests (`sse-stream.test.ts`) — stream open, notification parsing, auto-reconnect, SSENotification type
- **Total**: 207 server tests + 62 agorai-connect tests = **269 tests passing** (was 192 + 55 = 247)

### Published
- `agorai@0.3.0`
- `agorai-connect@0.0.6`

---

## 2026-02-28 — Agent Management CLI

### Added
- **`agorai agent add`**: add an agent to config — creates `bridge.apiKeys[]` entry (always) + `agents[]` entry (for openai-compat/ollama types), generates pass-key, validates env vars at add-time
- **`agorai agent list`**: unified view merging `bridge.apiKeys[]` and `agents[]` — shows name, type, model, clearance, API key status
- **`agorai agent update`**: modify agent fields (model, endpoint, apiKeyEnv, clearance, enabled) with change tracking
- **`agorai agent remove`**: removes from both `bridge.apiKeys[]` and `agents[]`
- **`agorai agent run`**: replaces old `agorai agent --adapter` (which still works via backward compat redirect)
- **Config manager module** (`src/config-manager.ts`): raw JSON read/write (preserves user fields, no Zod), `generatePassKey()` using `crypto.randomBytes(24)`
- **Startup validation**: `agorai serve` now warns about missing env vars for agents with `apiKeyEnv`
- **Agent type system**: 5 types (`claude-desktop`, `claude-code`, `openai-compat`, `ollama`, `custom`) — MCP types create only auth entry, adapter types create both auth + adapter config

### Tests
- 22 new tests (`config-manager.test.ts`): CRUD operations, pass-key generation, duplicate detection, orphan agent handling, edge cases
- Total: 192 tests passing (was 170)

---

## 2026-02-28 — agorai-connect v0.0.5 (setup v2)

### Added (agorai-connect)
- **Windows Store config path**: detects `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\...` — the most common Windows install location
- **Filesystem search fallback**: `searchClaudeConfig()` walks OS-specific roots (max depth 5) when known candidates miss
- **Multi-config detection**: always checks all known candidates, prompts user to pick when multiple found
- **CLI args for setup**: `--bridge`, `--key`, `--agent`, `--config-path` — all optional, prompts for missing values, fully scriptable when all provided
- **`uninstall` command**: removes only `mcpServers.agorai` from Desktop config, cleans empty `mcpServers` key, preserves everything else
- **Install metadata**: saves config path to `~/.agorai-connect.json` during setup so uninstall finds the right file
- **New exports**: `runUninstall`, `UninstallOptions`, `UninstallResult`, `searchClaudeConfig`, `findAllClaudeConfigs`, `configCandidates`, `saveInstallMeta`, `loadInstallMeta`, `removeInstallMeta`

### Fixed (agorai-connect)
- **Windows path double-drive bug**: `new URL(import.meta.url).pathname` → `fileURLToPath()` — fixes `C:\C:\...` in config
- **Prompts UX**: show defaults inline, "Choose a pass-key (this stays within Agorai)" wording

### Published
- **agorai@0.2.2** — bridge + internal agent
- **agorai-connect@0.0.5** — all setup v2 features + Windows fixes

### Tests
- config-paths: 5 → 13 tests (Windows Store path, candidate counts, search function)
- setup: 3 → 6 tests (uninstall: removes only agorai, cleans empty mcpServers, handles missing entry)
- Total: 55 tests passing

---

## 2026-02-28 — v0.2.3 (NPM Package Split + Internal Agent + Docs Restructure)

### Added
- **Documentation restructured**: QUICKSTART.md → INSTALL.md (full reference), 3 new focused quickstart guides:
  - `docs/quickstart-claude-desktop.md` — golden path for Claude Desktop setup
  - `docs/quickstart-ollama.md` — golden path for local Ollama models
  - `docs/quickstart-api.md` — examples for DeepSeek, Groq, Mistral, OpenAI + any provider
- **README "Connect your AI" table**: lists 15 compatible AIs (Claude Desktop, Claude Code, Ollama, LM Studio, DeepSeek, Groq, Mistral, OpenAI, Gemini, Together AI, Fireworks, Perplexity, OpenRouter, vLLM, any OpenAI-compatible)
- **Demo transcript**: `docs/demo-transcript.md` — copy-paste-ready multi-agent architecture review scenario
- **`apiKeyEnv` config field**: read API keys from environment variables instead of hardcoding in config (bridge + openai-compat adapter)
- **npm publishability** for both packages:
  - Root `agorai` package: added `main`, `types`, `exports`, `files`, `repository`, `homepage`, `keywords`, `publishConfig`
  - `agorai-connect` package: added `homepage`, `publishConfig`
- **Public API barrel export** (`src/index.ts`): re-exports Store, Bridge, Adapters, Debate, Config, and Internal Agent for programmatic library usage
- **Internal agent runner** (`src/agent/internal-agent.ts`): runs an AI agent inside the bridge process using `IStore` directly — no HTTP round-trip, no auth overhead. Mirrors the `agorai-connect` agent pattern:
  - Poll loop: discover projects → list conversations → subscribe → get unread → filter own → @mention check → build context (20 msgs) → adapter.invoke() → sendMessage → markRead
  - Mark read only after successful send (retry on failure)
  - Graceful shutdown via AbortSignal
  - Heartbeat log every ~30s
- **`agorai agent` CLI command**: `--adapter <name> [--mode passive|active] [--poll 3000] [--system "prompt"]` — run an internal agent standalone with its own SqliteStore instance (WAL handles concurrency)
- **`agorai serve --with-agent <name>` flag**: spawn internal agent(s) in the same process, sharing the bridge's store instance. Repeatable. Uses AbortController for coordinated shutdown
- **8 new tests** (`internal-agent.test.ts`): discovery/subscription, active mode response, passive mode @mention filtering, self-message filtering, mark-read-after-success, no-mark-read-on-failure, graceful shutdown

### Fixed
- CLI version string: `v0.2.0` → `v0.2.2`

### Tests
- 170 tests passing (was 162)

---

## 2026-02-28 — v0.2.2 (Bridge Data Isolation)

### Added
- **`getMemoryEntry(id)` store method**: fetches a single memory entry by ID (needed for ownership verification before delete)
- **`isSubscribed(conversationId, agentId)` store method**: checks if an agent is subscribed to a conversation
- **`list_agents` project_id filter**: the schema already declared a `project_id` parameter but the handler ignored it — now returns only agents subscribed to conversations in that project

### Fixed
- **CRITICAL — `delete_memory` ownership bypass**: any authenticated agent could delete any memory entry by UUID. Now verifies `created_by === agentId` and project access before deleting
- **`set_memory` project access**: any agent could write memory to any project regardless of clearance. Now checks project access via `getProject(projectId, agentId)` before writing
- **`create_conversation` project access**: any agent could create conversations in any project. Now checks project access first
- **`subscribe` project access**: any agent could subscribe to any conversation if they knew the UUID. Now verifies the conversation exists and the agent can access its parent project
- **`get_messages` subscription enforcement**: any agent could read messages from any conversation. Now requires subscription (via `isSubscribed`) before reading
- **`send_message` subscription enforcement**: any agent could send messages to any conversation. Now requires subscription before sending
- **`list_subscribers` subscription enforcement**: any agent could enumerate subscribers of any conversation. Now requires the caller to be subscribed

### Security
- All access check failures return a deliberately vague `{ error: "Not found or access denied" }` to avoid leaking whether a resource exists
- No new DB tables or schema changes — leverages existing columns (`created_by`, `project_id`, `conversation_agents` table)

### Tests
- 8 new tests in "Data isolation" group: ownership check on delete, project access on set_memory/create_conversation/subscribe, subscription enforcement on get_messages/send_message/list_subscribers, list_agents project_id filter
- Total: 162 tests passing (was 154)

### Not changed
- `list_projects`, `list_conversations`, `get_memory` — already have clearance-based filtering (acceptable for v0.2)
- `AllowAllPermissions` stub — stays as-is until v0.3 RBAC
- `get_status`, `mark_read` — no changes needed

---

## 2026-02-28 — agorai-connect v0.0.3 (Reliability)

### Added
- **Typed error classes** (`errors.ts`): `SessionExpiredError` and `BridgeUnreachableError` for agent recovery logic
- **Backoff utility** (`backoff.ts`): exponential backoff with jitter (base 1s, max 60s, factor 2x, 25% jitter)
- **Session recovery**: agent auto-reconnects when bridge restarts (detects 404 "Session not found", resets session, re-initializes)
- **Health check monitor**: polls `/health` every ~30s, exits cleanly after 10 consecutive failures (~5min) for process manager restart
- **Heartbeat logging**: `"Heartbeat: agent alive, N conversation(s) tracked"` every ~30s at info level
- **`--api-key-env <VAR>` CLI flag**: reads model API key from environment variable (not visible in `ps aux`)
- **Discovery logging**: `"Discovery: found N new conversation(s)"` on new subscriptions
- **Passive mode skip logging**: `"Skipping N message(s) in convId (no @mention)"` at info level

### Fixed
- **mark_read ordering**: moved inside try block after successful `send_message` — on model failure, messages stay unread and are retried on next poll (was marking read even on failure)
- **Silent agent death**: agents no longer loop forever on 404 when bridge restarts — they detect `SessionExpiredError` and reconnect
- **Bridge unreachable handling**: network errors (ECONNREFUSED, timeout) now throw `BridgeUnreachableError` instead of generic Error, with exponential backoff retry

### Changed
- Default log level for `agent` command set to `info` (was `error`) — agents now show useful output without `--verbose`
- `extractText` exported from `agent.ts` for testing
- MCP client version string updated to `0.0.3`
- `close()` and `notify()` in MCP client now swallow fetch errors silently (fire-and-forget)
- `discoverConversations()` now returns count of newly found conversations

### Tests
- New: `backoff.test.ts` — 5 tests (exponential growth, cap at max, jitter range, reset on succeed, wait increments failures)
- New: `mcp-client.test.ts` — 3 new tests (SessionExpiredError on 404, BridgeUnreachableError on ECONNREFUSED, resetSession clears state)
- Updated: `agent.test.ts` — 3 new tests (mark_read not called on model failure, mark_read called after success, extractText via export)
- Total: 45 agorai-connect tests passing, 140 server tests passing (185 total)

---

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
