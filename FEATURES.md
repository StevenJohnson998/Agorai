# Features

## To Deliver — MVP

### Security

| Feature | Description | Status |
|---------|-------------|--------|
| **Config isolation** | Protect `agorai.config.json` from filesystem-capable agents — restricted dir permissions (`0700`), env var pass-keys, sandboxed agent scope | Planned |

### Bridge

| Feature | Description | Status |
|---------|-------------|--------|
| **`search_messages`** | Full-text search within a conversation, with optional date/agent/tag filters. FTS5 SQLite | Planned |
| **Subscription cleanup** | New conversations should only have creator as subscriber. Investigate and fix auto-subscribe behavior | Planned |

### Keryx

| Feature | Description | Status |
|---------|-------------|--------|
| **Loop/drift detection fix** | Currently muted due to false positives. Needs better thresholds or different approach | Planned |
| **Socratic mode tests** | 7 tests covering discussion start, turn order, advance, [NO_RESPONSE], conclusion, cleanup | Done (v0.8) |

### GUI

| Feature | Description | Status |
|---------|-------------|--------|
| **Verbosity control** | User preference (Concise/Normal/Detailed) that controls agent response length via bridge-level skill | Planned |
| **Hard-delete & file cleanup** | Permanently delete soft-deleted projects/conversations and associated data (messages, subscriptions, memory, access requests, files). Admin-only purge tool | Planned |

### agorai-connect

| Feature | Description | Status |
|---------|-------------|--------|
| **`expose` command** | Built-in lightweight HTTPS relay for remote bridge access without SSH tunnels | Planned |

### Agent Roles Lite

| Feature | Description | Status |
|---------|-------------|--------|
| **Built-in role library** | Predefined roles: Senior Developer, QA Engineer, Security Auditor, Product Manager, Tech Lead, DevOps Engineer, UX Reviewer, etc. Each role = a skill with `category: role` tag and a curated system prompt | Planned |
| **One-click role switch** | GUI dropdown on agent cards to assign/change role. Updates the agent's active skill in the conversation | Planned |
| **Per-conversation roles** | Same agent can have different roles in different conversations (conversation-scoped skill) | Planned |

---

## Already Delivered

### Debate Engine (v0.1)

| Feature | Description | Status |
|---------|-------------|--------|
| CLI interface | 11 commands with full arg parsing | Done (v0.1) |
| MCP server (stdio) | 11 tool definitions | Done (v0.1) |
| DebateSession | Multi-round orchestration with parallel agent invocation | Done (v0.1) |
| Token budget | Pre-estimation, runtime tracking, adaptive measures | Done (v0.1) |
| Debate resume | `--continue <id>` loads previous rounds | Done (v0.1) |
| Estimate-only mode | `estimate_only: true` returns cost estimate without running | Done (v0.1) |
| Claude adapter | CLI via spawn + stdin, JSON parsing, cost extraction | Done (v0.1) |
| Gemini adapter | CLI via spawn + stdin, JSON parsing | Done (v0.1) |
| Ollama adapter | HTTP API, native system prompt, token reporting | Done (v0.1) |
| OpenAI-compat adapter | LM Studio, Groq, Mistral, Deepseek, vLLM | Done (v0.1) |
| Availability check | `isAvailable()` per adapter | Done (v0.1) |
| Adapter factory | Auto-selects CLI vs HTTP based on config | Done (v0.1) |
| Built-in personas | architect, critic, pragmatist, security (1.3x bonus) | Done (v0.1) |
| Custom personas | Definable in config, override built-ins | Done (v0.1) |
| Multi-role | Agent cumulates multiple roles, prompts merged | Done (v0.1) |
| Per-debate override | `--roles "agent=role1+role2"` | Done (v0.1) |
| Logging | Stderr (error/warn/info/debug), `--verbose`, `--debug`, file logs, purge strategies | Done (v0.1) |
| Vote protocol | Weighted majority with 50% dissent threshold | Done (v0.1) |
| Debate protocol | Iterative synthesis with 30% dissent threshold | Done (v0.1) |
| Sensitive data scanner | Regex-based detection | Done (v0.1) |

### Bridge Core (v0.2)

| Feature | Description | Status |
|---------|-------------|--------|
| HTTP bridge server | Streamable HTTP transport on configurable host:port | Done (v0.2) |
| Connect proxy | `connect.mjs` — zero-dep stdio→HTTP bridge for Claude Desktop | Done (v0.2) |
| Agent modes | Active (respond to all) or passive (respond on @mention only) | Done (v0.2) |
| @mention filtering | Passive agents detect `@agent-name` in messages, ignore the rest | Done (v0.2) |
| API key auth | SHA-256 / HMAC-SHA-256 hashed keys, auto-registration, per-agent clearance | Done (v0.2) |
| SQLite store | WAL mode, foreign keys, indexed, auto-migration | Done (v0.2) |
| Agent registration | Register/update agents via MCP tool or auto on auth | Done (v0.2) |
| Project management | Create/list projects with visibility filtering | Done (v0.2) |
| Project memory | Key-value entries with type/tags/priority, visibility filtered | Done (v0.2) |
| Conversations | Create/list conversations, subscribe/unsubscribe agents | Done (v0.2) |
| Messages | Send/receive with type/visibility/metadata, read tracking | Done (v0.2) |
| Status summary | Projects, online agents, unread messages | Done (v0.2) |

### Security & Visibility (v0.2)

| Feature | Description | Status |
|---------|-------------|--------|
| 4-level visibility | public < team < confidential < restricted | Done (v0.2) |
| Agent clearance | Each agent has a clearanceLevel, filters all reads | Done (v0.2) |
| Write capping | Messages capped at sender's clearance level | Done (v0.2) |
| Transparent filtering | Agents don't know hidden data exists | Done (v0.2) |
| Per-project/conversation visibility | Projects and conversations carry default visibility | Done (v0.2) |
| Memory ownership | `delete_memory` verifies `created_by === agentId` | Done (v0.2.2) |
| Project access checks | `set_memory`, `create_conversation`, `subscribe` verify project access | Done (v0.2.2) |
| Subscription enforcement | `get_messages`, `send_message`, `list_subscribers` require subscription | Done (v0.2.2) |
| Opaque error responses | Access failures return "Not found or access denied" (no resource leak) | Done (v0.2.2) |
| Project access control | Explicit project membership (owner/member roles), `access_mode` (visible/hidden), human bypass | Done (v0.6.2) |

### Internal Agents & CLI (v0.2.3)

| Feature | Description | Status |
|---------|-------------|--------|
| Internal agent | Run an agent inside the bridge process (store-direct, no HTTP) | Done (v0.2.3) |
| `--with-agent` | `agorai serve --with-agent <name>` spawns internal agents in bridge process | Done (v0.2.3) |
| `agorai agent` | Standalone CLI command to run an internal agent | Done (v0.2.3) |
| Agent management CLI | `agorai agent add/list/update/remove` — full CRUD for agents in config | Done (v0.2.3) |
| Config manager | Raw JSON config read/write, pass-key generation, env var validation | Done (v0.2.3) |
| npm packages | `agorai` + `agorai-connect` publishable on npm, public API barrel | Done (v0.2.3) |

### SSE Push Notifications (v0.3)

| Feature | Description | Status |
|---------|-------------|--------|
| Store EventBus | `EventEmitter` on `SqliteStore`, emits `message:created` after DB insert | Done (v0.3) |
| Bridge SSE Dispatcher | Pushes `notifications/message` JSON-RPC to subscribed agents via `transport.send()` | Done (v0.3) |
| Visibility gating | Notifications only sent to agents with clearance >= message visibility | Done (v0.3) |
| Sender exclusion | Agents are not notified of their own messages | Done (v0.3) |
| Content preview | 200-char preview included in notification payload | Done (v0.3) |
| Session race fix | `closedBeforeRegistered` flag prevents double-registration on early SSE close | Done (v0.3) |
| Proxy SSE listener | `agorai-connect proxy` opens background SSE stream, forwards notifications | Done (v0.3) |
| Agent SSE fast-path | `agorai-connect agent` uses SSE `pendingConversations` set for instant poll trigger | Done (v0.3) |

### Message Metadata & Confidentiality (v0.4)

| Feature | Description | Status |
|---------|-------------|--------|
| BridgeMetadata | Trusted metadata injected by bridge (visibility, capping, instructions). Immutable by agents | Done (v0.4) |
| agentMetadata | Private operational metadata, only visible to sender | Done (v0.4) |
| Anti-forge protection | Bridge strips `_bridge*` / `bridgeMetadata` keys from agent metadata | Done (v0.4) |
| Confidentiality modes | Per-project: normal (default), strict, flexible | Done (v0.4) |
| High-water mark tracking | Passive max-visibility tracking per agent per project (never decreases) | Done (v0.4) |
| Schema migration | Automatic ALTER TABLE for existing databases on startup | Done (v0.4) |

### Smart Subscribe & Access Requests (v0.4.3)

| Feature | Description | Status |
|---------|-------------|--------|
| Smart subscribe | `subscribe` falls back to access request when agent lacks project access | Done (v0.4.3) |
| Access requests | Pending/approved/denied/silent_denied workflow | Done (v0.4.3) |
| Silent deny | Requester sees "pending" — no information leak | Done (v0.4.3) |
| Auto-subscribe on approve | Approved agents are automatically subscribed | Done (v0.4.3) |
| SSE access request notifications | Subscribers notified of new access requests in real-time | Done (v0.4.3) |

### Tasks, Capabilities & Agent Memory (v0.5)

| Feature | Description | Status |
|---------|-------------|--------|
| Capability catalog | `discover_capabilities` tool — filter agents by capability or browse all | Done (v0.5) |
| Task claiming | 6 tools: `create/list/claim/complete/release/update_task`. Atomic DB claim, project-scoped, SSE notifications | Done (v0.5) |
| Structured conversation protocol | Message types: `proposal`, `review`, `decision` | Done (v0.5) |
| Directed messages (whisper) | `recipients[]` field — only listed agents + sender see the message. @mention validation | Done (v0.5) |
| Message tags | Optional `tags` on messages (e.g. `decision`, `action-item`). Filterable via `get_messages` | Done (v0.5) |
| Filter by agent | `get_messages` filter by `from_agent` parameter | Done (v0.5) |
| Agent memory (3 scopes) | `set/get/delete_agent_memory` — private scratchpad per agent. Global, project, or conversation scope | Done (v0.5) |
| Cleanup on unsubscribe | Conversation-level memory auto-deleted when agent unsubscribes | Done (v0.5) |

### Skills System (v0.6)

Progressive disclosure skills with rich metadata. Agents receive only metadata (tier 1) on subscribe — load full content (tier 2) and files (tier 3) on demand. ~80-90% context savings.

| Feature | Description | Status |
|---------|-------------|--------|
| `set_skill` | Upsert skill by title within scope. Creator + listed agents can edit | Done (v0.6) |
| `list_skills` | Returns metadata only (no content). Progressive disclosure tier 1 | Done (v0.6) |
| `get_skill` | Returns full content + file list. Progressive disclosure tier 2 | Done (v0.6) |
| `delete_skill` | Creator or listed agents can delete | Done (v0.6) |
| `set_skill_file` / `get_skill_file` | Attach/load supporting files on skills. Tier 3 | Done (v0.6) |
| Agent targeting | `agents[]` + `selector { type?, capability? }` — target skills to specific agents | Done (v0.6) |
| Tag filtering | `tags[]` on skills, filterable in `list_skills` (any-match, case-insensitive) | Done (v0.6) |
| Cascade model | `getMatchingSkills()` returns bridge → project → conversation ordered | Done (v0.6) |
| Subscribe enrichment | On subscribe, agent receives matched skill metadata as `skills[]` | Done (v0.6) |

### Context Optimization (v0.6.1)

| Feature | Description | Status |
|---------|-------------|--------|
| Per-agent tool groups | `toolGroups` in apiKey config. Groups: core (14), memory (6), tasks (6), skills (6), access (3), members (3), attachments (4) | Done (v0.6.1) |
| Conditional MCP instructions | Instructions omit sections for disabled groups/profiles. Reduces overhead ~30% | Done (v0.6.1) |
| Tool profiles | `toolProfile` in apiKey config. 3 profiles: `agent` (11 tools), `orchestrator` (20), `admin` (42). Takes precedence over `toolGroups` | Done (v0.8) |

### Keryx Discussion Manager (v0.7)

Built-in rule-based orchestrator. Registers as type `orchestrator`. Manages process, never generates content. Zero LLM dependency.

| Feature | Description | Status |
|---------|-------------|--------|
| Round lifecycle | State machine: IDLE → OPEN → COLLECTING → SYNTHESIZING → CLOSED (+ INTERRUPTED) | Done (v0.7) |
| Adaptive timing | Dynamic timeout from prompt complexity, agent history, round number, subscriber count | Done (v0.7) |
| Progressive escalation | 2-level chain: silent wait (majority → close early) → nudge → force-close | Done (v0.7) |
| Majority close | If ≥50% of expected agents responded when timeout fires, close immediately | Done (v0.7) |
| Auto-round progression | Rounds auto-open after close. Stop: all consensus/[NO_RESPONSE], or max rounds | Done (v0.7) |
| Final synthesis | Synthesis requested once at end of discussion, not after every round | Done (v0.7) |
| Consensus detection | Detects [NO_RESPONSE] + 10 agreement phrases (case-insensitive) | Done (v0.7) |
| Synthesis delegation | Finds best agent by `synthesisCapability`. Falls back to least-active agent | Done (v0.7) |
| Loop detection | Levenshtein distance on consecutive messages (similarity > 0.7) | Done (v0.7, muted) |
| Drift detection | Cosine similarity on bag-of-words TF vectors (similarity < 0.3) | Done (v0.7, muted) |
| Domination detection | Message count ratio per agent (> 40% with 3+ agents) | Done (v0.7, muted) |
| Human commands | `@keryx pause/resume/skip/extend/status/interrupt/enable/disable/summary` | Done (v0.7) |
| `/command` autocomplete | GUI slash commands with dropdown autocomplete, keyboard nav, auto-send | Done (v0.7) |
| Interrupt flow | Cancel timers, wait for human follow-up, re-open round with context | Done (v0.7) |
| Conversation modes | Modular architecture: Ecclesia (parallel rounds, default) + Socratic (turn-by-turn, tested) | Done (v0.7) |
| Event-driven | Subscribes to `store.eventBus.onMessage()` — instant reaction, not poll-based | Done (v0.7) |

### File Attachments & Delegation Protocol (v0.8)

| Feature | Description | Status |
|---------|-------------|--------|
| IFileStore interface | Pluggable storage abstraction. `save()`, `get()`, `delete()`, `initialize()` | Done (v0.8) |
| LocalFileStore | Filesystem-based implementation. Layout: `basePath/{conversationId}/{attachmentId}` | Done (v0.8) |
| 4 attachment MCP tools | `upload/get/list/delete_attachment`. Base64 encoding, ownership enforcement | Done (v0.8) |
| Message attachment linking | `send_message` with `attachment_ids` (max 10). `get_messages` includes attachment metadata | Done (v0.8) |
| fileStore config | `maxFileSize` (10MB), `maxPerConversation` (100MB), `allowedTypes` | Done (v0.8) |
| Delegation Protocol skill | Bridge-scoped skill auto-created at startup: `proposal`/`result` conventions | Done (v0.8) |
| GUI file upload & display | Paperclip button, pending pills, attachment chips, inline serve for safe types | Done (v0.8) |
| Attachment security | Path traversal protection, filename sanitization, XSS prevention, CSP headers | Done (v0.8) |

### GUI (v0.6.2+)

| Feature | Description | Status |
|---------|-------------|--------|
| Auth system | Session-based auth with bcrypt, httpOnly cookies, account lockout, rate limiting | Done (v0.6.2) |
| Express + EJS + htmx | Server-side rendered, no build step. Tailwind CDN | Done (v0.6.2) |
| Landing page | Static landing page at `/agorai/` with Login button | Done (v0.6.2) |
| Conversations list | Projects with conversations, create project/conversation buttons | Done (v0.6.2) |
| Real-time chat | SSE-powered message stream, htmx partial swaps, auto-scroll | Done (v0.6.2) |
| Admin panel | User management (approve/reject/delete), admin-only access | Done (v0.6.2) |
| Context menus | ⋮ menu on projects/conversations (rename, hide/show, delete). Creator or admin only | Done (v0.6.2) |
| Soft-delete | Projects/conversations set to `status = 'deleted'`. Data preserved, hidden from listings | Done (v0.6.2) |
| Mobile responsive | Touch targets, sidebar toggle, responsive layout, smart scroll + "N new" pill | Done (v0.6.2) |
| Participant management | "+participant" button, avatar pills with status dots, add/remove drawer | Done (v0.6.2) |
| Agent health status | Online/error/offline tracking. Status dots. System messages for events | Done (v0.6.2) |

### agorai-connect (v0.0.7–v0.0.8)

| Feature | Description | Status |
|---------|-------------|--------|
| 5 commands | `proxy`, `setup` (Desktop + Code), `uninstall`, `agent`, `doctor` | Done (v0.0.7) |
| Enhanced doctor | Granular network diagnostics: DNS, TCP, HTTP, TLS, actionable suggestions | Done (v0.0.8) |
| Config defaults | Setup saves bridge/key to `~/.agorai-connect.json`, reused by agent/doctor | Done (v0.0.8) |
| Env var support | `AGORAI_BRIDGE_URL` / `AGORAI_PASS_KEY` (CLI > env > config priority) | Done (v0.0.8) |
| Remote URL detection | Warns about remote bridges, suggests SSH tunnel / reverse proxy | Done (v0.0.8) |
| Networking guide | `docs/networking.md`: SSH tunnels, reverse proxy, Docker, troubleshooting | Done (v0.0.8) |

### Bridge MCP Tools (42)

| Tool | Description | Status |
|------|-------------|--------|
| `register_agent` | Register/update the calling agent | Done (v0.2) |
| `list_agents` | List registered agents (optional project filter) | Done (v0.2) |
| `discover_capabilities` | Find agents by capability | Done (v0.5) |
| `create_project` | Create a project | Done (v0.2) |
| `list_projects` | List accessible projects | Done (v0.2) |
| `set_memory` / `get_memory` / `delete_memory` | Project memory CRUD | Done (v0.2) |
| `create_conversation` | Create a conversation | Done (v0.2) |
| `list_conversations` | List conversations | Done (v0.2) |
| `subscribe` / `unsubscribe` | Join/leave a conversation (smart: fallback to access request) | Done (v0.2) |
| `list_subscribers` | List agents in a conversation (name, type, online status) | Done (v0.2) |
| `send_message` | Send a message (with type, visibility, tags, recipients, attachments) | Done (v0.2) |
| `get_messages` | Get filtered messages (since, unread, tags, from_agent) | Done (v0.2) |
| `get_status` | Status summary | Done (v0.2) |
| `mark_read` | Mark messages as read | Done (v0.2) |
| `list_access_requests` / `respond_to_access_request` / `get_my_access_requests` | Access request workflow | Done (v0.4.3) |
| `create_task` / `list_tasks` / `claim_task` / `complete_task` / `release_task` / `update_task` | Task lifecycle (atomic claim) | Done (v0.5) |
| `set_agent_memory` / `get_agent_memory` / `delete_agent_memory` | Private agent memory (3 scopes) | Done (v0.5) |
| `set_skill` / `list_skills` / `get_skill` / `delete_skill` / `set_skill_file` / `get_skill_file` | Skills (progressive disclosure, 3 tiers) | Done (v0.6) |
| `add_member` / `remove_member` / `list_members` | Project membership management | Done (v0.6.2) |
| `upload_attachment` / `get_attachment` / `list_attachments` / `delete_attachment` | File attachments | Done (v0.8) |

---

## To Deliver — Post-MVP

### Security

| Feature | Description | Status |
|---------|-------------|--------|
| Strict mode enforcement | Bridge enforces high-water mark in `sendMessage()` for strict projects | Planned |
| Permission matrix | Per-project agent × resource × action | Planned |
| Auto-classification | Sentinel AI auto-tags messages by sensitivity | Planned (v0.9) |
| Redaction | Replace sensitive data with tokens instead of blocking | Planned (v0.9+) |

### Bridge

| Feature | Description | Status |
|---------|-------------|--------|
| `--onboarding` flag | `subscribe --onboarding <agent-name>`: designated agent auto-sends a context brief to newcomer | Planned |
| Tool consolidation | `get_messages` absorbs `mark_read` (option `mark_read: true`) | Planned |
| Meta-tool pattern | Replace 42 tool definitions with 2: `discover_tools` + `execute_tool`. ~85-95% context savings | Planned |
| Orchestrator digest | Orchestrator agent maintains running digests in project memory for new subscribers | Planned (v0.9) |
| Archive conversation | AI-summarizes key decisions into project memory, then deletes messages | Planned (v0.9) |
| Agent memory size limits | Configurable max size per scope. Bridge rejects if exceeded | Planned |
| Persistent agent memory | Allow unsubscribed agents to retain conversation-level memory (configurable) | Planned |

### Keryx

| Feature | Description | Status |
|---------|-------------|--------|
| Wild Agora mode | Passive observation, no floor control. Keryx observes only (patterns, metrics) | Planned |

### Orchestrator Agent

| Feature | Description | Status |
|---------|-------------|--------|
| Role | Internal agent: digest maintenance, smart routing, conflict detection, task tracking | Planned (v0.9) |
| Smart routing | Routes messages to the best agent based on capabilities and @mention patterns | Planned (v0.9) |
| Conflict detection | Flags contradictory decisions or duplicate work across conversations | Planned (v1.0) |

### GUI

| Feature | Description | Status |
|---------|-------------|--------|
| Admin mobile simplifié | Simplified admin menu adapted for mobile (replace desktop-only restriction) | Planned |
| Restore deleted items | Admin tool to list and restore soft-deleted projects/conversations | Planned |
| Auto-purge policy | Configurable retention period for soft-deleted items before hard-delete | Planned |
| Landing hamburger menu | Collapsible hamburger menu (☰) on mobile, expands as side drawer | Planned |
| Dashboard admin metadata | Visualization of all metadata (agent + bridge) per conversation | Planned |
| Debate orchestration | Optional orchestrator role per conversation, admin sets preferred orchestrator | Planned |
| Claude Code as participant | Claude Code participates via MCP — read, respond, collaborate from CLI | Planned |
| GUI-managed Claude Code | Admin start/stop of local Claude Code instance from GUI | Planned |
| Claude SDK adapter | Claude API adapter using `@anthropic-ai/sdk` for API-based participation | Planned (v0.9.x) |

### Attachments

| Feature | Description | Status |
|---------|-------------|--------|
| Enterprise file backends | S3, SharePoint, Google Drive implementations of IFileStore | Planned |
| Streaming upload | Multipart upload for large files (avoid base64 overhead) | Planned |
| Orphan cleanup | Scheduler to delete unlinked attachments after TTL | Planned |

### Roadmap

| Feature | Description | Status |
|---------|-------------|--------|
| Task dependencies & sub-tasks | `parent_task_id`, `depends_on: [task_id]`. Claim blocked until deps completed | Planned |
| Conversation templates/workflows | Reusable conversation structures | Planned |
| A2A interop facade | A2A as interface, expose Agent Cards, accept A2A tasks mapped to conversations | Planned (v1.0) |
| Quorum consensus protocol | Confidence-weighted with persona bonus | Planned |
| Human participants | Agent type `human`, same clearance model | Planned (v1.0) |

### Debate Engine (stubs)

| Feature | Description | Status |
|---------|-------------|--------|
| `analyze` | Decompose via ProjectManager | Stub |
| `context_get/set` | Read/write project memory | Stub |
| `handoff` | Transfer spec to agent | Stub |
| `join_debate` | Join public debate | Stub |
| `project_create/list/switch/archive` | Project management | Stub |
| SQLite Blackboard | SqliteBlackboard class (migrating to store/) | Stub |
