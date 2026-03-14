# Changelog

## 2026-03-05 — Keryx Auto-Round Progression & GUI Slash Commands

### Added
- **Auto-round progression**: Rounds auto-open after close when discussion continues. Stop conditions: all agents consensus/[NO_RESPONSE], or max rounds reached (default 3). Final synthesis covers the full discussion (all rounds), not just the last round.
- **Consensus detection**: `isConsensusResponse()` in `patterns.ts` — detects `[NO_RESPONSE]` + 10 agreement phrases (case-insensitive). Used by `closeRound` to determine stop condition.
- **`responseContents`**: New field on `Round` interface — maps agentId → response content for consensus checking.
- **Majority close**: If ≥50% of expected agents responded when first timeout fires, close round immediately instead of waiting for stragglers.
- **`/command` autocomplete**: GUI slash commands with dropdown autocomplete (same UX as @mention). Keyboard nav (arrows, Enter/Tab, Escape). Commands: `/pause`, `/resume`, `/skip`, `/status`, `/extend`, `/interrupt`, `/enable`, `/disable`, `/summary`.
- **`/summary` command**: Force-request a synthesis of the discussion. Closes active round if needed, or synthesizes from history.
- **`roundContinue` template**: Different wording for Round 2+ ("Build on previous responses or challenge ideas").
- **`discussionConcluded` template**: Two variants — consensus ("All participants have nothing new to add") and max rounds ("Round limit reached").
- **Continuation round context**: Internal agents in Round 2+ get full conversation context (not cut off at round-open) so they can build on previous rounds.
- **10 new tests** (Phase 6: consensus detection, Phase 7: auto-progression). Total: 496.

### Changed
- **Escalation chain simplified**: 4 levels over 4 min → 2 levels over ~67s. Silent wait → nudge → force-close.
- **Default timeouts lowered**: `baseTimeoutMs` 60s → 45s, `nudgeAfterMs` 90s → 60s.
- **`maxRoundsPerTopic` default**: 5 → 3.
- **`synthesisRequest` template**: Now references "full discussion (rounds 1–N)" instead of just last round.
- **Humans excluded from rounds**: `openRound` now filters out `type === "human"` agents from expected participants.

### Muted (log-only, pending proper fixes)
- **Loop detection**: False positives — flags humans, flags normal cross-round similarity.
- **Drift detection**: False positives — cosine similarity on bag-of-words too noisy with short texts.
- **Domination detection**: False positives — with 2 agents, >50% is normal.
- **Human escalation**: Removed — replaced by force-close in simplified escalation chain.

## 2026-03-04 — Hide/Show Toggle & Attachment-Only Messages

### Added
- **Hide/Show toggle**: Context menu button (between Rename and Delete) to toggle `access_mode` (visible ↔ hidden) on projects and conversations. Available to admins and creators only.
  - `setProjectAccessMode()` and `setConversationAccessMode()` store methods.
  - `POST /c/toggle-access-project/:id` and `POST /c/:id/toggle-access` routes.
  - Button label dynamically shows "Hide" or "Show" based on current state.

### Fixed
- **Attachment-only messages**: Sending a file without text no longer silently fails. Messages with only attachments (no text) are now allowed with a 📎 placeholder.

## 2026-03-04 — GUI Attachment Support & Security Hardening

### Added
- **GUI file attachments**: Human users can upload, view, and download file attachments in conversations.
  - Paperclip button in conversation input area triggers file upload.
  - Base64 JSON upload route (`POST /c/:id/upload`) with size and content-type validation.
  - Pending attachment pills with remove buttons before sending.
  - Attachment chips on messages showing filename, size, open (new tab) and download buttons.
  - Serve route (`GET /c/:id/attachment/:aid`) with safe-inline allowlist (images, PDF, text, audio, video).
  - Force-download route (`GET /c/:id/attachment/:aid/download`).
  - Attachments displayed in all render paths: page load, htmx send, SSE real-time, catch-up.
  - `fileStore` and `fileStoreConfig` threaded from CLI to GUI server to conversation routes.

### Security
- **LocalFileStore path traversal protection**: `safePath()` method validates all resolved paths stay within `basePath`. Applied to `save()`, `get()`, `delete()`. Throws on `../../` or absolute path injection.
- **Filename sanitization**: Strip path separators, null bytes, control characters from user-supplied filenames.
- **Content-Type validation**: Strict MIME pattern validation (`type/subtype`), rejects malformed or injection attempts.
- **XSS prevention on inline serve**: Only known-safe content types served inline; HTML/SVG/JS forced to `application/octet-stream` download. CSP header `default-src 'none'` on all served files.
- **Content-Disposition hardening**: RFC 5987 encoding with `filename*=UTF-8''...` for unicode safety.
- **Download route**: Always serves as `application/octet-stream` with `X-Content-Type-Options: nosniff`.
- **5 new path traversal tests** in `file-store.test.ts`.

## 2026-03-04 — v0.8.0 (File Attachments & Delegation Protocol)

### Added
- **File attachments**: Agents can share files (images, code, documents) via message attachments.
  - `IFileStore` pluggable interface with `LocalFileStore` filesystem implementation (zero deps).
  - Two-step workflow: `upload_attachment` → `send_message` with `attachment_ids`.
  - `get_messages` includes `attachments` metadata array on messages that have them.
  - `get_attachment` returns file content as base64. `delete_attachment` enforces ownership.
  - `message_attachments` table with nullable `message_id` (upload-first pattern).
  - Batch `listAttachmentsByMessages` prevents N+1 on `get_messages`.
- **`attachments` tool group** (4 new MCP tools): `upload_attachment`, `get_attachment`, `list_attachments`, `delete_attachment`.
- **`fileStore` config section**: `maxFileSize` (10MB default), `maxPerConversation` (100MB), `allowedTypes` (empty = all).
- **Delegation protocol**: Conventions for `@agent do X` workflows using existing task system + message types.
  - Bridge-scoped "Delegation Protocol" skill auto-created at startup.
  - `delegationRules` in bridge instructions (conditional on `tasks` group).
  - Convention: `proposal`+`action-request` → `status`+`action-accepted` → `result`+`action-result`.
- **Bridge instructions** updated with `attachmentRules` (conditional on `attachments` group) and `delegationRules` (conditional on `tasks` group).
- **~40 new tests** for file store, store attachment methods, and bridge tool integration.
- `IFileStore`, `LocalFileStore`, `Attachment`, `AttachmentMetadata`, `CreateAttachment` exported from public API.

### Changed
- `send_message` accepts optional `attachment_ids` array (max 10) to link pre-uploaded attachments.
- Tool count: 38 → **42** (7 groups: core, memory, tasks, skills, access, members, attachments).
- `BridgeServerOptions` now accepts optional `fileStore: IFileStore`.
- `createBridgeMcpServer` accepts optional `fileStore` and `config` parameters.

## 2026-03-04 — Project Membership & Access Control

### Added
- **Project membership model**: `project_members` table with owner/member roles. Project creators auto-added as owner. Agents need membership to subscribe to conversations or create new ones.
- **`access_mode`** field on projects and conversations: `visible` (default, appears in listings) or `hidden` (invisible to non-members).
- **`members` tool group** (3 new MCP tools): `add_member`, `remove_member`, `list_members`. Owners can manage project membership.
- **Human bypass**: Agents with `type=human` (GUI users) skip all access checks — can see and join everything. Granular human restrictions deferred to paid tier.
- **Subscribe flow change**: Members subscribe directly. Non-members of visible projects get access request. Non-members of hidden projects get ACCESS_DENIED (no info leak).
- **Migration**: Existing project creators backfilled as owners, existing conversation subscribers as members. Default `access_mode: visible` for backward compat.
- **22 new tests** for membership CRUD, access filtering, human bypass.
- **Bridge instructions** updated with membership rules (conditional on `members` tool group).

### Changed
- `list_projects` now filters hidden projects for non-members (agents only).
- `list_conversations` now filters hidden conversations for non-subscribers (agents only).
- `create_conversation` requires project membership for agents.
- `respond_to_access_request` auto-adds approved agent as project member.
- Tool count: 35 → **38** (6 groups: core, memory, tasks, skills, access, members).

## 2026-03-04 — v0.7.0 (Keryx Discussion Manager)

### Added
- **Keryx — built-in discussion manager**: Rule-based moderator embedded in the bridge that manages multi-agent conversations. Registers as agent type `moderator` — manages process, never generates content.
  - **Round lifecycle**: State machine (IDLE → OPEN → COLLECTING → SYNTHESIZING → CLOSED). Rounds triggered by human messages only. Agents respond once per round; `[NO_RESPONSE]` if nothing to add.
  - **Adaptive timing**: Timeout dynamically calculated from prompt complexity (word count, code blocks, questions), agent response history (rolling average), round number, and subscriber count. No fixed floor/ceiling.
  - **Progressive escalation**: 4-level chain — silent wait → nudge slow agents → CC backup agent → escalate to human. Each level at baseTimeout × 1.0, 1.5, 2.5, 4.0. Agent response cancels pending escalation.
  - **Synthesis delegation**: On round close, finds best agent via `synthesisCapability` (configurable). Falls back to least-active agent in round.
  - **Pattern detection** (pure TS, zero external deps):
    - Loop detection: Levenshtein distance on consecutive messages from same agent (threshold > 0.7)
    - Drift detection: Cosine similarity on bag-of-words term frequency vectors (threshold < 0.3)
    - Domination detection: Message count ratio per agent (> 40% with 3+ agents)
  - **Human commands**: `@keryx pause`, `@keryx resume`, `@keryx skip`, `@keryx extend [duration]`, `@keryx status`, `@keryx interrupt`, `@keryx enable`, `@keryx disable`. Duration parsing: `30s`, `2m`, `1h`.
  - **Interrupt flow**: Marks round interrupted, cancels timers, waits for human follow-up, re-opens round with additional context.
  - **Behavioral skill**: Auto-creates bridge-level skill on start with Keryx protocol instructions for agents.
  - **Bridge rules injection**: `keryxRules` added to agent context (MCP instructions + LLM system prompt) when Keryx is active.
  - **Onboarding**: Detects new agent subscriptions, sends onboarding template.
  - **Event-driven**: Subscribes to `store.eventBus.onMessage()` for instant reaction. Not poll-based.
  - **Conversation discovery**: Periodic discovery loop (10s) finds all conversations and auto-subscribes Keryx.

- **`--no-keryx` CLI flag**: Disable Keryx on `agorai serve` (Keryx is enabled by default).
- **`keryx` config section**: `enabled`, `baseTimeoutMs` (30s), `nudgeAfterMs` (45s), `maxRoundsPerTopic` (5), `synthesisCapability`, `healthWindowSize` (10). All with sensible defaults — works without any config.
- **`moderator` agent type**: Keryx registers as type `moderator` (not `keryx`) so agents see it in `list_subscribers` as a process manager, not a peer.

### New files (8)
- `src/keryx/types.ts` — Type definitions (RoundStatus, Round, ConversationState, KeryxConfig, etc.)
- `src/keryx/index.ts` — Barrel export
- `src/keryx/module.ts` — Core state machine (~910 lines)
- `src/keryx/templates.ts` — 12 parameterized message templates
- `src/keryx/timing.ts` — Adaptive timeout calculator + complexity estimator
- `src/keryx/commands.ts` — Command parser + duration parser
- `src/keryx/patterns.ts` — Loop/drift/domination detectors

### Modified files
- `src/config.ts` — Added `keryx` section to ConfigSchema with Zod defaults
- `src/config-manager.ts` — Added `"keryx"` and `"moderator"` to AgentType union
- `src/cli.ts` — `--no-keryx` flag, KeryxModule spawn on `agorai serve`, shutdown handler
- `src/agent/context.ts` — `keryxRules` in BridgeRules, conditional rendering in MCP instructions and LLM prompts
- `src/index.ts` — KeryxModule and type exports

### Not modified
- `src/store/sqlite.ts` — No schema changes. Keryx state is in-memory (ephemeral).
- `src/bridge/server.ts` — No MCP tool changes. Keryx uses existing tools.
- `src/agent/internal-agent.ts` — Status messages already filtered (line 248). No changes needed.

### Tests
- 39 new tests in `keryx.test.ts`: config parsing (4), core state machine (6), adaptive timing (5), pattern detection (11), command parsing (13)
- Total: 420 tests passing (was 381)

### Design decisions
- **Zero external dependencies**: Levenshtein + cosine similarity are pure TypeScript implementations
- **No LLM dependency**: All interventions are parameterized templates, not generated text
- **Status messages filtered**: Keryx sends `type: "status"` messages which are already excluded by internal agent anti-loop guards — no modification needed
- **Backward compatible**: Existing conversations without Keryx context work normally (Keryx starts managing from next new message only)

---

## 2026-03-03 — agorai-connect v0.0.8 (Remote Connectivity MVP)

### Added
- **Enhanced doctor command**: Extracted from `cli.ts` into `src/doctor.ts` with granular network diagnostics:
  - DNS resolution check (isolates bad domain from port issues)
  - TCP port reachability check (distinguishes ECONNREFUSED from ETIMEDOUT)
  - HTTP health with better error messages (TLS errors, 502/503 proxy detection)
  - Actionable suggestions based on failure pattern
  - Remote URL detection and plain HTTP security warnings
  - Link to networking guide in failure output
- **Config file defaults**: `setup` now saves bridge URL and pass-key to `~/.agorai-connect.json`. `agent` and `doctor` commands fall back to saved config when `--bridge`/`--key` are omitted
- **Environment variable support**: `AGORAI_BRIDGE_URL` and `AGORAI_PASS_KEY` env vars (priority: CLI args > env vars > config file)
- **Setup wizard improvements**:
  - Remote URL detection with SSH tunnel / reverse proxy guidance
  - URL scheme auto-prepend (bare `domain:port` → `https://domain:port`)
  - Plain HTTP security warning with confirmation prompt for remote bridges
  - Actionable failure messages when bridge health check fails (ECONNREFUSED, ENOTFOUND, timeout)
  - "Run `agorai-connect doctor`" suggestion on failure
- **Networking guide**: New `docs/networking.md` covering SSH tunnels (basic + persistent), reverse proxy (Caddy, nginx), Docker, and troubleshooting
- **Documentation updates**: Updated quickstart guides, INSTALL.md, tutorial, and README files with remote connectivity guidance

### Changed
- Doctor is now a separate module (`src/doctor.ts`) exported from `agorai-connect` API
- `saveInstallMeta()` / `loadInstallMeta()` now include bridge URL and pass-key fields

### Roadmap
- `agorai-connect expose` command — built-in lightweight HTTPS relay for remote bridge access without SSH tunnels or external proxies (future)

## 2026-03-02 — v0.6.0 (post-release fixes)

### Fixed
- `subscribe` now returns skills metadata when already subscribed (was returning error)
- `create_conversation` now includes matching skills metadata in response

### Added
- `keyEnv` support for bridge API keys — pass-keys can reference environment variables instead of cleartext in config
- Startup validation warns when `keyEnv` env vars are missing
- Bridge-level security skill: confidentiality policy delivered to all agents on subscribe

## 2026-03-02 — v0.6.0 (Skills System — Progressive Disclosure)

### Breaking Changes
- **Removed**: `set_instructions`, `list_instructions`, `delete_instructions` MCP tools
- **Removed**: `Instruction`, `CreateInstruction`, `InstructionScope`, `InstructionSelector` types from public API
- **Removed**: `setInstruction()`, `listInstructions()`, `getMatchingInstructions()`, `deleteInstruction()` store methods
- **Replaced by**: Skills system with 6 new tools and progressive disclosure

### Added
- **Skills system**: Progressive disclosure skills replace the instruction matrix. 3-tier loading:
  - Tier 1 (metadata): title, summary, instructions hint, tags, agents, files list — sent on subscribe
  - Tier 2 (content): full skill body — loaded on demand via `get_skill`
  - Tier 3 (files): supporting files — loaded on demand via `get_skill_file`
- **6 new MCP tools** (32 → 35 total):
  - `set_skill` — create/update a skill with title, content, summary, instructions, selector, agents, tags
  - `list_skills` — returns metadata only (no content). Filterable by tags
  - `get_skill` — returns full content + file list
  - `delete_skill` — creator or listed agents can delete
  - `set_skill_file` — attach/update a supporting file to a skill
  - `get_skill_file` — load a supporting file by name
- **Agent targeting**: `agents[]` field on skills — target to specific agent names. AND with selector
- **Tag filtering**: `tags[]` on skills, filterable in `list_skills` (any-match, case-insensitive)
- **Skill files**: Supporting files per skill with upsert, listing (names only), and full content retrieval
- **Auto-migration**: v0.5 `instructions` table rows migrated to `skills` with auto-generated titles. Original IDs preserved
- **`skills` table**: `(scope, scope_id, title)` unique constraint, selector_json, agents_json, tags_json, summary, instructions columns
- **`skill_files` table**: `(skill_id, filename)` unique constraint, CASCADE delete with parent skill

### Changed
- Tool count: 32 → 35 (removed 3 instruction tools, added 6 skill tools)
- `subscribe` response: `instructions[]` replaced by `skills[]` containing metadata only (progressive disclosure)
- MCP `initialize` instructions: added skills system section explaining 3-tier progressive disclosure
- Public API: exports `Skill`, `CreateSkill`, `SkillScope`, `SkillSelector`, `SkillMetadata`, `SkillFile`, `SkillFilters`

### Tests
- 35 new tests in `skills.test.ts`: CRUD (8), progressive disclosure (3), agent targeting (4), selector matching (5), tags (3), instructions field (2), scope isolation (2), skill files (6), migration (3)
- Deleted `instructions.test.ts` (13 tests)
- Total: 337 tests passing (was 315)

---

## 2026-03-02 — v0.5 Phase 2 (Agent Memory, Instructions, Structured Protocol)

### Added
- **Agent memory**: Private per-agent scratchpad with 3 scopes (global, project, conversation). One text blob per scope, full overwrite on set. Conversation-scoped memory auto-deleted on unsubscribe.
  - 3 new MCP tools: `set_agent_memory`, `get_agent_memory`, `delete_agent_memory`
  - `agent_memory` table with composite primary key `(agent_id, scope, scope_id)`
- **Instruction matrix**: Scope × selector instructions system. Creators set instructions at project or conversation level, optionally targeting specific agent types or capabilities.
  - 3 new MCP tools: `set_instructions`, `list_instructions`, `delete_instructions`
  - `instructions` table with unique constraint on `(scope, scope_id, selector_json)`
  - Runtime matching: `getMatchingInstructions()` cascades bridge → project → conversation, filtered by agent type/capabilities (case-insensitive)
  - Subscribe response now includes matching instructions for the subscribing agent
- **Structured conversation protocol**: Extended message type enum with `proposal` and `decision` types

### Changed
- Tool count: 26 → 32 (6 new tools: 3 agent memory + 3 instructions)
- `subscribe` response now includes `instructions` array with matching instruction content

### Tests
- 16 new tests in `agent-memory.test.ts`: global set/get, overwrite, null for non-existent, delete, delete non-existent, project-scoped, separate from global, conversation-scoped, privacy, cleanup on unsubscribe, scope isolation + 2 structured conversation protocol tests
- 13 new tests in `instructions.test.ts`: CRUD, upsert, different selectors, delete by creator, delete fails for non-creator, type matching, capability matching, cascading scopes, unknown conversation, case-insensitive matching, scope isolation, bridge-level
- Total: 315 server tests passing (was 288)

---

## 2026-03-02 — v0.5 Phase 1D (Directed Messages / Whisper)

### Added
- **Directed messages (whisper)**: `recipients` field on `send_message` — only listed agent IDs + sender can see the message. Omit for broadcast.
  - `send_message` accepts optional `recipients` parameter (up to 20 agent IDs)
  - Store-level enforcement: `getMessages()` filters out whispers where the reader is not sender or recipient
  - SSE whisper gate: `dispatchMessageNotification()` skips non-recipients for whisper messages
  - `BridgeMetadata` includes `whisper: true` and `recipients: [...]` on directed messages
  - `Message.recipients`: `string[] | null` — null for broadcasts, array of agent IDs for whispers
- **@mention validation**: `send_message` rejects whispers where @mentioned agents are not in the recipients list (they wouldn't see the message)
- **Schema migration**: `ALTER TABLE messages ADD COLUMN recipients TEXT` — auto-applied on startup for existing databases

### Changed
- `Message` type: added `recipients: string[] | null`
- `CreateMessage` type: added optional `recipients?: string[]`
- `BridgeMetadata` type: added optional `whisper?: boolean` and `recipients?: string[]`
- `SendMessageSchema`: added `recipients` field (optional, max 20 IDs)

### Tests
- 12 new tests in `whispers.test.ts`: whisper storage + bridgeMetadata, broadcast (no recipients), empty recipients = broadcast, recipient sees whisper, sender always sees own whisper, non-recipient blocked, mixed broadcast + whisper, multiple recipients, visibility + whisper (both apply), DB persistence, migration compat, event bus emission
- Total: 288 server tests passing (was 276)

---

## 2026-03-02 — v0.5 Phase 1C (Message Tags + Filter by Agent)

### Added
- **Message tags**: `tags` field on messages — array of strings for categorization (e.g. `["urgent", "review"]`). Default `[]`.
  - `send_message` now accepts a `tags` parameter (up to 20 tags, 50 chars each)
  - `get_messages` filters by `tags` parameter (any-match: message included if it has at least one matching tag)
- **Filter by agent**: `get_messages` now accepts a `from_agent` parameter to filter messages by sender agent ID
- **Schema migration**: `ALTER TABLE messages ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'` — auto-applied on startup for existing databases
- Combined filters work together: `tags` + `from_agent` + `since` + `unread_only` + `limit`

### Changed
- `CreateMessage` type: added optional `tags?: string[]`
- `GetMessagesOptions` type: added optional `tags?: string[]` and `fromAgent?: string`
- `SendMessageSchema`: added `tags` field (default `[]`)
- `GetMessagesSchema`: added `tags` and `from_agent` fields

### Tests
- 11 new tests in `message-tags.test.ts`: tag storage, default empty array, tag filtering (single, multiple, non-matching, empty), fromAgent filtering, combined filters, migration compat
- Total: 276 server tests passing (was 265)

---

## 2026-03-02 — v0.5 Phase 1B (Task Claiming)

### Added
- **Task claiming system** — 6 new MCP tools (20 → 26 total), enabling agents to create, discover, claim, complete, and release work items:
  - `create_task` — create a task in a project, optionally linked to a conversation, with required capabilities
  - `list_tasks` — list tasks with filters by status, claimed agent, or required capability
  - `claim_task` — atomically claim an open task (DB-level `WHERE status='open'` + `changes > 0`)
  - `complete_task` — mark a claimed task as completed with an optional result
  - `release_task` — release a claim back to open (allowed by claimer or task creator)
  - `update_task` — update title/description/status (only by creator)
- **`tasks` table**: 14 columns with `(project_id, status)` index, foreign keys to projects and agents
- **`Task`, `CreateTask`, `TaskFilters`, `TaskStatus` types** in `store/types.ts`
- **7 store methods**: `createTask`, `getTask`, `listTasks`, `claimTask`, `completeTask`, `releaseTask`, `updateTask`
- **Auto-release of stale claims**: `releaseStaleTaskClaims()` checks agent `last_seen_at` — claims from agents inactive >5 minutes are released lazily on `listTasks`/`claimTask`
- **Task events**: `TaskCreatedEvent`, `TaskUpdatedEvent` (actions: claimed, completed, released, cancelled, updated) on `StoreEventBus`
- **SSE push for tasks**: `dispatchTaskNotification()` pushes `notifications/task` to all agents with active sessions
- **Public API exports**: `Task`, `CreateTask`, `TaskFilters`, `TaskStatus`, `TaskCreatedEvent`, `TaskUpdatedEvent` from `src/index.ts`

### Tests
- 23 new tests in `tasks.test.ts`: CRUD, atomic claims, race condition protection, auto-release, permissions (creator-only update, claimer-only complete), event bus emissions, project access check
- Total: 265 server tests passing (was 242)

### E2E Verified
- 9 integration tests via live MCP against Docker container: create → list → filter → claim → double-claim (blocked) → complete → release → update/cancel → capability filter

---

## 2026-03-02 — v0.5 Phase 1A (Capability Catalog)

### Added
- **`discover_capabilities` MCP tool** (tool #20): Find agents by capability. Pass a `capability` string for filtered results (case-insensitive), or omit to browse all agents and their capabilities.
- **`findAgentsByCapability(capability)` store method**: JS filter on `listAgents()` with case-insensitive matching. Added to `IStore` interface and `SqliteStore`.
- **`DiscoverCapabilitiesSchema`**: Zod schema with optional `capability` parameter (max 50 chars).

### Tests
- 5 new tests in `capability-catalog.test.ts`: filter match, case-insensitive, unknown capability, multiple matches, browse mode.
- Total: 242 server tests passing (was 237).

### E2E Verified
- All 4 scenarios tested against live bridge: filter by capability, case-insensitive match, unknown capability (empty result), browse mode (all agents).

---

## 2026-03-02 — v0.4.3 (Smart Subscribe + Access Requests) + agorai-connect v0.0.7

### Added (agorai — v0.4.3)
- **Smart Subscribe**: `subscribe` tool now falls back to an access request when the agent lacks project access. Returns `{ status: "access_requested", requestId }` instead of a silent access-denied.
- **Access Requests system**: 3 new MCP tools (16 → 19 total):
  - `list_access_requests` — subscribers see pending requests for their conversations
  - `respond_to_access_request` — approve / deny / silent_deny with optional clearance level on approve
  - `get_my_access_requests` — agent checks own request statuses (silent_denied masked as "pending")
- **`access_requests` table**: new SQLite table with indexes on `(conversation_id, status)` and `(agent_id, status)`. No migration needed (CREATE TABLE IF NOT EXISTS).
- **`AccessRequest` type**: `id`, `conversationId`, `agentId`, `agentName`, `message`, `status`, `respondedBy`, `createdAt`, `respondedAt`.
- **`access-request:created` event**: new StoreEventBus event with `emitAccessRequest` / `onAccessRequest` / `offAccessRequest`.
- **SSE notifications for access requests**: subscribers receive `notifications/access_request` push notifications when someone requests access.
- **MCP instructions updated**: access request workflow documented in bridge handshake.

### Changed (agorai — v0.4.3)
- **`subscribe` handler**: now checks if already subscribed (returns error instead of silent re-subscribe). Falls back to access request when no project access.
- **`IStore` interface**: 6 new methods for access request CRUD.
- **Bridge version**: `0.4.2` → `0.4.3`.

### Added (agorai-connect — v0.0.7)
- **Claude Code setup**: `agorai-connect setup --target claude-code` writes MCP config to `~/.claude.json`.
- **Interactive target selection**: without `--target`, setup prompts for Claude Desktop or Claude Code.
- **`claudeCodeConfigPath()`** / **`findClaudeCodeConfig()`**: new config-paths functions.
- **`SetupTarget` type**: `"claude-desktop" | "claude-code"`.
- **Install metadata target**: `saveInstallMeta` now stores the target for smarter uninstall messages.
- **Uninstall**: now also checks `~/.claude.json` as fallback when auto-detecting config.
- **Version display fixed**: `--version` now shows `v0.0.7` (was hardcoded to `v0.0.5`).

### Tests
- 15 new access request tests (store CRUD, event bus, masking)
- Total: 237 server tests + 62 connect tests = 299 tests passing

---

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
