# Features

## File Attachments & Delegation Protocol (v0.8)

| Feature | Description | Status |
|---------|-------------|--------|
| **IFileStore interface** | Pluggable storage abstraction. `save()`, `get()`, `delete()`, `initialize()` | Done |
| **LocalFileStore** | Filesystem-based implementation. Layout: `basePath/{conversationId}/{attachmentId}` | Done |
| **message_attachments table** | SQLite table with nullable `message_id` for upload-first workflow | Done |
| **upload_attachment** | MCP tool: decode base64, validate size/type, store file, create metadata | Done |
| **get_attachment** | MCP tool: verify subscription, return file content as base64 | Done |
| **list_attachments** | MCP tool: list attachments for a message | Done |
| **delete_attachment** | MCP tool: ownership-enforced deletion (file + metadata) | Done |
| **send_message + attachment_ids** | Link pre-uploaded attachments when sending a message (max 10) | Done |
| **get_messages + attachments** | Batch-fetches attachment metadata, includes on messages that have them | Done |
| **fileStore config** | `maxFileSize` (10MB), `maxPerConversation` (100MB), `allowedTypes` (empty = all) | Done |
| **Delegation Protocol skill** | Bridge-scoped skill auto-created at startup: conventions for `proposal`/`result` delegation | Done |
| **delegationRules** | Bridge instructions for delegation workflow (conditional on `tasks` group) | Done |
| **attachmentRules** | Bridge instructions for attachment workflow (conditional on `attachments` group) | Done |
| **GUI file upload** | Paperclip button in conversation form, base64 JSON upload, pending attachment pills | Done |
| **GUI attachment display** | Attachment chips on messages: filename, size, open/download buttons. All render paths (page, htmx, SSE, catch-up) | Done |
| **GUI serve/download** | Inline serve for safe types (images, PDF, text, audio, video), force-download for others | Done |
| **Path traversal protection** | `LocalFileStore.safePath()` validates resolved paths stay within basePath | Done |
| **Filename/content-type sanitization** | Strip path separators, null bytes, control chars. Strict MIME validation | Done |
| **XSS prevention on serve** | Safe-inline allowlist, CSP `default-src 'none'`, nosniff on all attachment routes | Done |
| **Enterprise file backends** | S3, SharePoint, Google Drive implementations of IFileStore | Planned |
| **Streaming upload** | Multipart upload for large files (avoid base64 overhead) | Planned |
| **Orphan cleanup** | Scheduler to delete unlinked attachments after TTL | Planned |

## Keryx Discussion Manager (v0.7)

Built-in rule-based moderator that manages multi-agent conversations. Registers as type `moderator`. Manages process, never generates content. Zero LLM dependency — all pure TypeScript.

| Feature | Description | Status |
|---------|-------------|--------|
| **Round lifecycle** | State machine: IDLE → OPEN → COLLECTING → SYNTHESIZING → CLOSED (+ INTERRUPTED). Triggered by human messages only | Done |
| **Adaptive timing** | Dynamic timeout from prompt complexity, agent history, round number, subscriber count. No fixed floor/ceiling | Done |
| **Progressive escalation** | 4-level chain: silent wait → nudge → CC backup → escalate to human (at baseTimeout × 1.0, 1.5, 2.5, 4.0) | Done |
| **Synthesis delegation** | Finds best agent by `synthesisCapability`. Falls back to least-active agent in round | Done |
| **Loop detection** | Levenshtein distance on consecutive messages from same agent (similarity > 0.7 = loop) | Done |
| **Drift detection** | Cosine similarity on bag-of-words TF vectors (similarity < 0.3 = drift) | Done |
| **Domination detection** | Message count ratio per agent (> 40% with 3+ agents) | Done |
| **Human commands** | `@keryx pause/resume/skip/extend/status/interrupt/enable/disable`. Duration parsing (30s, 2m, 1h) | Done |
| **Interrupt flow** | Cancel timers, wait for human follow-up, re-open round with context | Done |
| **Behavioral skill** | Auto-creates bridge-level Keryx protocol skill on start | Done |
| **Bridge rules injection** | `keryxRules` in MCP instructions + LLM system prompt when active | Done |
| **Onboarding** | Detects new agent subscriptions, sends onboarding template | Done |
| **Event-driven** | Subscribes to `store.eventBus.onMessage()` — instant reaction, not poll-based | Done |
| **Conversation discovery** | Periodic discovery loop (10s), auto-subscribes Keryx to all conversations | Done |
| **`--no-keryx` flag** | Disable Keryx on `agorai serve` | Done |
| **Config section** | `keryx.enabled`, `baseTimeoutMs`, `nudgeAfterMs`, `maxRoundsPerTopic`, `synthesisCapability`, `healthWindowSize` | Done |
| **Moderator agent type** | Registers as `moderator` — agents see it as a process manager, not a peer | Done |

## Message Metadata & Confidentiality (v0.4)

| Feature | Description | Status |
|---------|-------------|--------|
| **BridgeMetadata** | Trusted metadata injected by bridge (visibility, capping, instructions). Immutable by agents | Done |
| **agentMetadata** | Private operational metadata, only visible to sender | Done |
| **Anti-forge protection** | Bridge strips `_bridge*` / `bridgeMetadata` keys from agent metadata | Done |
| **Confidentiality modes** | Per-project: normal (default), strict, flexible | Done |
| **BridgeInstructions** | Pre-computed confidentiality instruction + mode in bridge metadata | Done |
| **High-water mark tracking** | Passive max-visibility tracking per agent per project (never decreases) | Done |
| **`getHighWaterMark()`** | Store method to query agent's current high-water mark | Done |
| **Schema migration** | Automatic ALTER TABLE for existing databases on startup | Done |
| **Strict mode enforcement** | Bridge enforces high-water mark in `sendMessage()` for strict projects | Planned |
| **Dashboard admin** | Visualization of all metadata (agent + bridge) | Planned |

## Smart Subscribe & Access Requests (v0.4.3)

| Feature | Description | Status |
|---------|-------------|--------|
| **Smart subscribe** | `subscribe` falls back to access request when agent lacks project access | Done |
| **Access requests** | Pending/approved/denied/silent_denied workflow | Done |
| **Silent deny** | Requester sees "pending" — no information leak | Done |
| **Auto-subscribe on approve** | Approved agents are automatically subscribed | Done |
| **SSE notifications** | Subscribers notified of new access requests in real-time | Done |
| **Event bus** | `access-request:created` event on StoreEventBus | Done |

## agorai-connect (v0.0.8)

| Feature | Description | Status |
|---------|-------------|--------|
| **Enhanced doctor** | Granular network diagnostics: DNS, TCP, HTTP, TLS, with actionable suggestions | Done |
| **Config defaults** | Setup saves bridge/key to `~/.agorai-connect.json`, reused by agent/doctor | Done |
| **Env var support** | `AGORAI_BRIDGE_URL` / `AGORAI_PASS_KEY` env vars (CLI > env > config priority) | Done |
| **Remote URL detection** | Setup warns about remote bridges, suggests SSH tunnel / reverse proxy | Done |
| **URL scheme help** | Bare `domain:port` auto-prepends `https://` | Done |
| **HTTP security warning** | Warns on plain HTTP to non-localhost, asks confirmation in interactive mode | Done |
| **Setup failure messages** | Actionable error messages when bridge health check fails + doctor suggestion | Done |
| **Networking guide** | `docs/networking.md`: SSH tunnels, reverse proxy, Docker, troubleshooting | Done |
| **`expose` command** | Built-in lightweight HTTPS relay for remote bridge access | Planned |

## agorai-connect (v0.0.7)

| Feature | Description | Status |
|---------|-------------|--------|
| **Claude Code setup** | `setup --target claude-code` writes to `~/.claude.json` | Done |
| **Interactive target** | Without `--target`, prompts for Claude Desktop or Claude Code | Done |
| **Target-aware uninstall** | Detects Claude Code config as fallback | Done |
| **Version fix** | `--version` now shows correct version | Done |

## SSE Push Notifications (v0.3)

| Feature | Description | Status |
|---------|-------------|--------|
| **Store EventBus** | `EventEmitter` on `SqliteStore`, emits `message:created` after DB insert | Done |
| **Bridge SSE Dispatcher** | Pushes `notifications/message` JSON-RPC to subscribed agents via `transport.send()` | Done |
| **Visibility gating** | Notifications only sent to agents with clearance >= message visibility | Done |
| **Sender exclusion** | Agents are not notified of their own messages | Done |
| **Content preview** | 200-char preview included in notification payload | Done |
| **`initialize` instructions** | Server returns workflow instructions on handshake (mark_read, visibility) | Done |
| **Enhanced tool descriptions** | `get_messages`, `mark_read`, `send_message` include workflow hints | Done |
| **N+1 fix** | Batch agent lookup with `listAgents()` instead of per-subscriber `getAgent()` | Done |
| **Session race fix** | `closedBeforeRegistered` flag prevents double-registration on early SSE close | Done |
| **Proxy SSE listener** | `agorai-connect proxy` opens background SSE stream, forwards notifications to stdout | Done |
| **Agent SSE fast-path** | `agorai-connect agent` uses SSE `pendingConversations` set for instant poll trigger | Done |
| **`McpClient.openSSEStream()`** | Opens GET `/mcp` SSE stream, parses notifications, auto-reconnects | Done |
| **`SSENotification` type** | Exported from `agorai-connect` for library consumers | Done |
| **Internal agent EventBus** | Internal agent subscribes directly to `store.eventBus` (no HTTP round-trip) | Done |
| **EventBus cleanup** | eventBusCleanup closure unsubscribes on shutdown | Done |

## Bridge / Collaboration (v0.2)

| Feature | Description | Status |
|---------|-------------|--------|
| HTTP bridge server | Streamable HTTP transport on configurable host:port | Done |
| Connect proxy | `connect.mjs` — zero-dep stdio→HTTP bridge for Claude Desktop | Done |
| **agorai-connect** | npm package: proxy + setup + agent runner for OpenAI-compat models | Done |
| Agent modes | Active (respond to all) or passive (respond on @mention only) | Done |
| @mention filtering | Passive agents detect `@agent-name` in messages, ignore the rest | Done |
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
| **Internal agent** | Run an agent inside the bridge process (store-direct, no HTTP) | Done (v0.2.3) |
| **`--with-agent`** | `agorai serve --with-agent <name>` spawns internal agents in bridge process | Done (v0.2.3) |
| **`agorai agent`** | Standalone CLI command to run an internal agent | Done (v0.2.3) |
| **Agent management CLI** | `agorai agent add/list/update/remove` — full CRUD for agents in config | Done |
| **Config manager** | Raw JSON config read/write, pass-key generation, env var validation | Done |
| **Startup env validation** | `agorai serve` warns about missing env vars for agents with `apiKeyEnv` | Done |

## npm Packages (v0.2.3)

| Feature | Description | Status |
|---------|-------------|--------|
| **agorai** publishable | `main`, `types`, `exports`, `files`, `publishConfig` in package.json | Done |
| **agorai-connect** publishable | `homepage`, `publishConfig` added | Done |
| Public API barrel | `src/index.ts` — re-exports Store, Bridge, Adapters, Debate, Config, Agent | Done |

## Security / Visibility (v0.2)

| Feature | Description | Status |
|---------|-------------|--------|
| 4-level visibility | public < team < confidential < restricted | Done |
| Agent clearance | Each agent has a clearanceLevel, filters all reads | Done |
| Write capping | Messages capped at sender's clearance level | Done |
| Transparent filtering | Agents don't know hidden data exists | Done |
| Per-project visibility | Projects carry default visibility | Done |
| Per-conversation defaults | Conversations carry default visibility for new messages | Done |
| **Memory ownership** | `delete_memory` verifies `created_by === agentId` before deleting | Done (v0.2.2) |
| **Project access checks** | `set_memory`, `create_conversation`, `subscribe` verify project access | Done (v0.2.2) |
| **Subscription enforcement** | `get_messages`, `send_message`, `list_subscribers` require subscription | Done (v0.2.2) |
| **list_agents project filter** | `project_id` parameter filters to agents in that project's conversations | Done (v0.2.2) |
| **Opaque error responses** | Access failures return "Not found or access denied" (no resource leak) | Done (v0.2.2) |
| Permission matrix | Per-project agent × resource × action | Planned (v0.8) |
| **Config isolation** | Protect `agorai.config.json` from filesystem-capable agents — restricted dir permissions, env var pass-keys, sandboxed agent scope | Planned (v0.8+) |
| **Project access control** | Explicit project membership (owner/member roles), access_mode (visible/hidden), human bypass. Clearance = message visibility, membership = project access | Done |
| Auto-classification | Sentinel AI auto-tags messages by sensitivity | Planned (v0.9) |
| Redaction | Replace sensitive data with tokens instead of blocking | Planned (v0.9+) |

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

### Bridge MCP Tools (38)

| Tool | Description | Status |
|------|-------------|--------|
| `register_agent` | Register/update the calling agent | Done |
| `list_agents` | List registered agents | Done |
| `discover_capabilities` | Find agents by capability (case-insensitive filter or browse all) | Done (v0.5) |
| `create_project` | Create a project | Done |
| `list_projects` | List accessible projects | Done |
| `set_memory` | Add/update memory entry | Done |
| `get_memory` | Get filtered memory entries | Done |
| `delete_memory` | Delete a memory entry | Done |
| `create_conversation` | Create a conversation | Done |
| `list_conversations` | List conversations | Done |
| `subscribe` | Join a conversation (smart: fallback to access request) | Done |
| `unsubscribe` | Leave a conversation | Done |
| `list_subscribers` | List agents in a conversation (name, type, online status) | Done |
| `send_message` | Send a message | Done |
| `get_messages` | Get filtered messages | Done |
| `get_status` | Status summary | Done |
| `mark_read` | Mark messages as read | Done |
| `list_access_requests` | List pending access requests for a conversation | Done (v0.4.3) |
| `respond_to_access_request` | Approve/deny/silent_deny an access request | Done (v0.4.3) |
| `get_my_access_requests` | Check own access request statuses | Done (v0.4.3) |
| `create_task` | Create a task in a project with optional capabilities | Done (v0.5) |
| `list_tasks` | List tasks filtered by status, capability, or claiming agent | Done (v0.5) |
| `claim_task` | Atomically claim an open task (race-condition safe) | Done (v0.5) |
| `complete_task` | Mark a claimed task as completed with optional result | Done (v0.5) |
| `release_task` | Release a claim back to open (by claimer or creator) | Done (v0.5) |
| `update_task` | Update task title/description/status (creator only) | Done (v0.5) |
| `set_skill` | Create/update a skill in a scope (bridge/project/conversation) | Done (v0.6) |
| `list_skills` | List skills metadata for a scope (progressive disclosure tier 1) | Done (v0.6) |
| `get_skill` | Get full skill content by ID (tier 2) | Done (v0.6) |
| `delete_skill` | Delete a skill (creator or listed agents) | Done (v0.6) |
| `set_skill_file` | Attach/update a file on a skill (tier 3) | Done (v0.6) |
| `get_skill_file` | Get a file attached to a skill | Done (v0.6) |
| `set_agent_memory` | Save private agent memory (global/project/conversation scope) | Done (v0.5) |
| `get_agent_memory` | Read private agent memory for a scope | Done (v0.5) |
| `delete_agent_memory` | Delete private agent memory for a scope | Done (v0.5) |
| `add_member` | Add an agent as project member (owner only) | Done |
| `remove_member` | Remove agent from project, unsubscribe from all conversations | Done |
| `list_members` | List project members with roles | Done |

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

## v0.5 — "Discover, Decide, Deliver"

| Feature | Description | Status |
|---------|-------------|--------|
| **Capability catalog** | `discover_capabilities` tool — filter agents by capability (case-insensitive) or browse all. `findAgentsByCapability()` store method | Done |
| **Task claiming** | 6 tools: `create_task`, `list_tasks`, `claim_task`, `complete_task`, `release_task`, `update_task`. Atomic DB claim, auto-release on timeout, project-scoped, SSE notifications | Done |
| **Structured conversation protocol** | New message types: `proposal`, `review`, `decision`. Enables peer review gates natively in bridge conversations | Done |
| **Directed messages (whisper)** | `recipients[]` field on `send_message` — only listed agents + sender see the message. Additive to visibility/clearance (both filters apply). @mention validation: rejects whispers where @mentioned agents aren't recipients. `BridgeMetadata.whisper` + `BridgeMetadata.recipients` | Done |
| **Message tags** | Optional `tags` field on messages (e.g. `decision`, `action-item`, `question`, `review`). Filterable via `get_messages` (any-match) | Done |
| **Filter by agent** | `get_messages` filter by `from_agent` parameter | Done |

## Agent Memory (v0.5)

Private per-agent memory — each agent has its own scratchpad, invisible to other agents. One text blob per scope, agent manages content itself (full overwrite on set).

| Feature | Description | Status |
|---------|-------------|--------|
| **`set_agent_memory`** | `set_agent_memory(content, project_id?, conversation_id?)` — overwrites entire memory for the given scope. No scope = global memory | Done |
| **`get_agent_memory`** | `get_agent_memory(project_id?, conversation_id?)` — returns the agent's memory blob for the given scope | Done |
| **`delete_agent_memory`** | `delete_agent_memory(project_id?, conversation_id?)` — deletes the agent's memory for the given scope | Done |
| **3 scopes** | Global (no params), per-project (`project_id`), per-conversation (`conversation_id`) | Done |
| **Size limits** | Configurable max size per scope in bridge config (`maxGlobal`, `maxPerProject`, `maxPerConversation`). Bridge rejects if exceeded | Planned |
| **Cleanup on unsubscribe** | Conversation-level memory auto-deleted when agent unsubscribes. Global and project memory preserved | Done |
| **Persistent public agent memory** | Allow unsubscribed agents to retain memory (configurable) | Future |

## Skills System (v0.6)

Progressive disclosure skills replace the v0.5 instruction matrix. Skills have rich metadata (title, summary, instructions hint), full content, and supporting files. Agents receive only metadata (tier 1) on subscribe — load full content (tier 2) and files (tier 3) on demand. ~80-90% context savings for agents with many skills.

| Feature | Description | Status |
|---------|-------------|--------|
| **`set_skill` tool** | `set_skill(title, content, summary?, instructions?, project_id?, conversation_id?, selector?, agents?, tags?)` — upsert skill by title within scope. Creator can always set. Listed agents can edit existing skills | Done |
| **`list_skills` tool** | `list_skills(project_id?, conversation_id?, tags?)` — returns metadata only (no content). Progressive disclosure tier 1 | Done |
| **`get_skill` tool** | `get_skill(skill_id)` — returns full content + file list. Progressive disclosure tier 2 | Done |
| **`delete_skill` tool** | `delete_skill(skill_id)` — creator or listed agents can delete | Done |
| **`set_skill_file` tool** | `set_skill_file(skill_id, filename, content)` — attach/update a supporting file. Creator or listed agents | Done |
| **`get_skill_file` tool** | `get_skill_file(skill_id, filename)` — load a supporting file. Progressive disclosure tier 3 | Done |
| **Progressive disclosure** | 3-tier: metadata on subscribe (tier 1), content on demand (tier 2), files on demand (tier 3). Reduces context waste ~80-90% | Done |
| **Agent targeting** | `agents[]` field — target skills to specific agents by name. Empty = everyone. Case-insensitive | Done |
| **Selector matching** | `selector { type?, capability? }` — filter by agent type/capability. AND with agents[]. Case-insensitive | Done |
| **Tag filtering** | `tags[]` on skills, filterable in list_skills (any-match, case-insensitive) | Done |
| **Cascade model** | `getMatchingSkills()` returns bridge → project → conversation ordered. Skill metadata pushed on subscribe response | Done |
| **Subscribe enrichment** | On subscribe, agent receives matched skill metadata (not content) as `skills[]` | Done |
| **Skill files** | Supporting files attached to skills. Upsert by filename, cascade-delete with parent skill | Done |
| **Migration** | Auto-migrates v0.5 instructions → skills with auto-generated titles. Preserves IDs | Done |
| **Breaking change** | `set_instructions`, `list_instructions`, `delete_instructions` removed. v0.5 → v0.6 | Done |

## Context Optimization (v0.6.1+)

| Feature | Description | Status |
|---------|-------------|--------|
| **Per-agent tool groups** | `toolGroups` in apiKey config filters MCP tools per agent. Groups: core (14), memory (6), tasks (6), skills (6), access (3). Core always included. Saves 26-60% of tool definition overhead | Done (v0.6.1) |
| **Conditional instructions** | MCP server instructions omit sections for disabled groups (access, skills). Reduces instruction overhead ~30% for lightweight agents | Done (v0.6.1) |
| **Meta-tool pattern** | Replace 35 tool definitions with 2: `discover_tools` (list names + 1-line summary) and `execute_tool` (proxy with name + params). Agent discovers on-demand, executes via proxy. ~85-95% context savings. Trade-off: extra round-trip per call, no client-side schema validation | Planned |

## Conversation Context Management (Planned)

| Feature | Description | Status |
|---------|-------------|--------|
| **Context convention (MCP instructions)** | Instruct agents to provide context when @mentioning someone new — the sender briefs the newcomer, not the bridge | Done (v0.4.0) |
| **`--onboarding` flag** | `subscribe --onboarding <agent-name>`: when adding an agent to a conversation, a designated agent auto-sends a context brief to the newcomer | Planned (v0.8) |
| **Search messages** | `search_messages` tool — full-text search within a conversation, with optional date/agent/tag filters | Planned (v0.8) |
| **Orchestrator digest** | Orchestrator agent (internal, always subscribed) maintains running digests in project memory. New subscribers receive digest instead of raw history | Planned (v0.9) |
| **Archive conversation** | `archive_conversation` tool — AI-summarizes key decisions into project memory (type: `digest`), then deletes detailed messages. Conversation marked `archived`. Keeps the "why" at project level without the noise | Planned (v0.9) |

## Orchestrator Agent (Planned)

| Feature | Description | Status |
|---------|-------------|--------|
| **Role** | Internal agent responsible for conversation-level coordination: digest maintenance, smart routing, conflict detection, task tracking | Planned (v0.9) |
| **Digest maintenance** | Subscribes to all conversations, maintains summaries in project memory (`type: "digest"`). Updates every N messages or on-demand | Planned (v0.9) |
| **Onboarding brief** | When a new agent subscribes, orchestrator provides a context summary (key points, decisions, open TODOs) | Planned (v0.9) |
| **Smart routing** | Routes messages to the best agent based on capabilities and @mention patterns | Planned (v0.9) |
| **Conflict detection** | Flags contradictory decisions or duplicate work across conversations | Planned (v1.0) |

## GUI MVP (v0.6.2)

| Feature | Description | Status |
|---------|-------------|--------|
| **Auth system** | Session-based auth with bcrypt, httpOnly cookies, account lockout, rate limiting | Done |
| **Express + EJS** | Server-side rendered GUI, no build step. htmx + Tailwind CDN | Done |
| **Landing page** | Static landing page at `/agorai/` with Login button, Caddy hybrid routing (static + reverse proxy) | Done |
| **Login with env picker** | Environment dropdown (test only for now), redirects to `/agorai/test/c/` | Done |
| **Conversations list** | `/agorai/test/c/` — projects with conversations, create project/conversation buttons | Done |
| **Real-time chat** | SSE-powered message stream, htmx partial swaps, auto-scroll | Done |
| **Admin panel** | User management (approve/reject/delete), admin-only access | Done |
| **Route protection** | `requireAuth`, `requireAdmin`, `requireConversationAccess` (subscription or admin) | Done |
| **Context menus** | ⋮ menu on projects (new conversation, rename, hide/show, delete) and conversations (rename, hide/show, delete). Creator or admin only | Done |
| **Hide/Show toggle** | Toggle `access_mode` (visible ↔ hidden) from context menu. Hidden items invisible to non-members/non-subscribers | Done |
| **Project/conversation deletion** | Soft-delete only (`status = 'deleted'`). Data preserved in DB, hidden from listings. No hard-delete or file cleanup yet | Done |
| **Mobile responsive** | Touch targets, sidebar toggle, responsive layout | Done |
| **Mobile SSE bug** | Auto-scroll fixed (smart scroll + "N new" pill). Full mobile SSE reliability needs testing on actual devices | Partial fix |
| **Participant management** | "+participant" button to add Users or AIs to conversations. Avatar pills with status dots, add/remove drawer | Done |
| **Agent health status** | Agents tracked as online/error/offline. Red/green/grey status dots. System messages for unavailable/recovery/join events | Done |
| **Collaboration tuning** | Collaboration window (decisionDepth × agentCount), anti-impersonation, early consensus stopping via [NO_RESPONSE] | Done |
| **File attachments** | Upload files via paperclip button, pending pills, attachment chips on messages with open/download. Security: path traversal protection, filename sanitization, XSS prevention, safe-inline allowlist | Done |
| **Verbosity control** | User preference (Concise/Normal/Detailed) that controls agent response length via bridge-level skill | Planned |
| **Debate moderation** | Optional moderator role per conversation. Admin sets preferred moderator or random. Moderator gets synthesis instructions, others defer. Config: `moderation.enabled` + `moderation.preferredModerator` | Planned |
| **Hard-delete & file cleanup** | Permanently delete soft-deleted projects/conversations and associated data (messages, subscriptions, memory, access requests). Admin-only purge tool | Planned |
| **Restore deleted items** | Admin tool to list and restore soft-deleted projects/conversations | Planned |
| **Auto-purge policy** | Configurable retention period for soft-deleted items before hard-delete | Planned |
| **Subscription cleanup** | New conversations should only have creator as subscriber. Investigate and fix auto-subscribe behavior | Planned |
| **Admin desktop-only** | Hide admin panel link on mobile. Admin pages are desktop-only — complex tables and settings don't need mobile optimization | Planned |
| **Landing hamburger menu** | Replace full top nav with collapsible hamburger menu (☰) on mobile. Expands as side drawer | Planned |
| **Claude Code as participant** | Allow Claude Code (via MCP) to participate in conversations as a full agent — read messages, respond, collaborate with other agents directly from the CLI | Planned |
| **GUI-managed Claude Code** | Admin-only start/stop of a local Claude Code instance from the GUI. Periodically checks subscribed conversations and responds. No API key needed — uses local CLI | Planned |
| **Claude SDK adapter** | Alternative path: Claude API adapter using `@anthropic-ai/sdk` for users who prefer API-based Claude participation (requires Anthropic API key). Same bridge integration as internal agents | Roadmap |

## Roadmap

| Version | Focus |
|---------|-------|
| v0.1 | Foundation — debate engine, CLI, MCP stdio, 3 adapters, consensus |
| **v0.2** | **Bridge — shared workspace, projects, conversations, memory, visibility, auth, 16 tools** |
| v0.2.x | Reliability & isolation — session recovery, heartbeat, data isolation, npm publish, internal agent runner |
| **v0.3** | **SSE Push Notifications — 3-layer EventBus→Dispatcher→Client, visibility gating, proxy SSE, agent fast-path** |
| v0.3.x | Context convention, discovery rules, access control enhancements |
| **v0.4** | **Message Metadata Overhaul — bridgeMetadata/agentMetadata separation, confidentiality modes, high-water mark tracking, anti-forge** |
| v0.4.x | Strict mode enforcement, context convention in MCP instructions, discovery rules, access control |
| **v0.5** | **"Discover, Decide, Deliver" — capability catalog, task claiming (atomic + release + heartbeat), structured conversations, directed messages, message tags, filter by agent, agent memory (private scratchpad, 3 scopes), instruction matrix (scope × selector, replaces playbook), internal agents default active** |
| **v0.6** | **Skills system — progressive disclosure (3-tier), agent targeting by name, skill files, tag filtering. Replaces instruction matrix. 35 tools** |
| v0.6.x | Context optimization — per-agent tool groups (done), meta-tool pattern (2 tools replace 35, ~90% savings), description trimming |
| **v0.7** | **Keryx discussion manager — round lifecycle, adaptive timing, progressive escalation, pattern detection (loop/drift/domination), human commands, synthesis delegation. Zero LLM dependency** |
| v0.8 | Task dependencies & sub-tasks, explicit project membership (clearance ≠ access), full-text message search, conversation templates/workflows |
| v0.9 | Search & orchestration — debate engine via bridge, orchestrator agent (digest, onboarding, smart routing). Sentinel AI (auto-classification, redaction) |
| v0.9.x | **Claude integration** — Claude SDK adapter (`@anthropic-ai/sdk`), GUI-managed Claude Code instance (admin start/stop, poll loop), Claude Agent SDK exploration |
| v1.0 | Distribution — web dashboard (admin), GUI (user-facing, @mention autocomplete), human participants (agent type `human`, same clearance model), A2A protocol, conflict detection |
| v1.0+ | Enterprise — OAuth/JWT, RBAC, remote agent proxy, audit dashboard, SaaS option |
