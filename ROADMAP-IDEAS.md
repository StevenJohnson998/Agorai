# Roadmap Ideas

Ideas and design notes for future versions. Not commitments — just thinking ahead.

---

## v0.2.x — Connection Reliability & Agent Security

Lessons from running 5 agents simultaneously (Claude Code, Claude Desktop, DeepSeek, Gemini, Ollama). These are patch-level priorities before v0.3.

### Session recovery
Agents lose their MCP session when the bridge restarts. Currently they loop on "Session not found" errors forever. Fix: detect stale session errors and automatically re-initialize (drop session ID, call `initialize` again, re-subscribe).

### Heartbeat / keepalive
No mechanism to detect a dead bridge or a dead agent. Options:
- Bridge-side: track `lastSeenAt` via poll activity (already exists), expose a health status per agent
- Agent-side: ping the bridge periodically, reconnect on failure
- Consider WebSocket upgrade for push-based messaging (eliminates polling entirely)

### Agent logging
The poll loop is silent — no output unless something goes wrong. Add:
- Periodic "alive" log (every N polls, e.g. every 30s)
- Log when messages are found but filtered (passive mode, no @mention)
- Log when mark_read is called
- Configurable log level via `--verbose` / `--debug` flags

### API key security for model endpoints
Model API keys (DeepSeek, Gemini, etc.) are currently passed as CLI args — visible in `ps aux` output, shell history, and process listings. This is a real security issue. Options:
1. **Environment variables**: `--api-key-env DEEPSEEK_API_KEY` reads from env instead of CLI arg
2. **Config file**: read keys from `agorai.config.json` (already has examples), never expose on command line
3. **Bridge-side key vault**: store model API keys in the bridge, agents reference them by name — keys never leave the server. The agent runner would request the key via an authenticated MCP tool
4. **Pass-key ≠ model key**: clarify the distinction — pass-keys authenticate to the bridge (local, low-risk), model API keys authenticate to external services (high-risk, billable). Different security posture for each

### Bridge pass-key storage
Bridge pass-keys in `agorai.config.json` are plaintext. Currently hashed (SHA-256) at runtime before DB comparison, which is good — but the config file itself is the weak point. Options:
- Document clearly that `agorai.config.json` should be `chmod 600`
- Support environment variable references in config: `"key": "$AGORAI_KEY_DESKTOP"`
- Consider a separate secrets file with restricted permissions

---

## v0.3 — Permissions, Threading & Capabilities

### Per-project permissions
Matrix of permissions per project. Example: "external agents can only see `public` data on this project". Lets you invite an agent to a project without giving it access to everything.

### Conversation threading
Reply-to chains within conversations. Agents can branch off a sub-discussion without polluting the main thread.

### Agent Capabilities (Milestone A — core)
Agents declare capabilities using **standardized tags** from a built-in dictionary. The dictionary ships with Agorai and is evolvable (users can extend it, community can propose additions).

**Tag dictionary** (initial set, organized by category):
- **Code**: `code-execution`, `code-review`, `testing`, `debugging`, `refactoring`
- **Analysis**: `analysis`, `research`, `fact-checking`, `data-analysis`
- **Content**: `writing`, `translation`, `summarization`, `copywriting`
- **Security**: `security-audit`, `vulnerability-scan`, `compliance`
- **Search**: `web-search`, `document-search`, `knowledge-retrieval`
- **Creative**: `brainstorming`, `design`, `ideation`
- **Ops**: `deployment`, `monitoring`, `infrastructure`

Tags follow a flat namespace (no hierarchy) with kebab-case convention. Custom tags are allowed but flagged as non-standard.

**New MCP tools:**
- `find_agents`: "who has capability X?" → returns matching agents with their tags
- `request_help`: send a request to a capable agent, routed by tag match

The `capabilities` field already exists in API key config. This milestone just exploits it with a standardized vocabulary and lookup tools.

### OpenAI-compatible adapter
Single adapter covering all OpenAI-compatible API endpoints: LM Studio, Ollama (`/v1/`), vLLM, llama.cpp, LocalAI, Groq, Mistral, Deepseek, Together AI, and OpenAI itself. Config example:
```json
{ "name": "local-mistral", "type": "openai-compat", "endpoint": "http://localhost:1234/v1", "model": "mistral-7b" }
```
One adapter, ten+ backends. Replaces the need for dedicated per-provider adapters.

### Project onboarding digests
When a new agent joins a project, it gets an auto-generated summary (digest) of what happened so far — key decisions, current state, open questions. No need to read hundreds of messages.

### Conversation/memory compaction
Long conversations and memory entries get summarized into shorter digests. Keeps context manageable without losing information. Could be triggered manually ("compact this conversation") or automatically (after N messages).

### Blackboard migration
The old debate engine Blackboard (`memory/base.ts`, `memory/sqlite.ts`) gets migrated to use the new store as its backend. One storage layer instead of two.

---

## v0.4 — Debate via Bridge & Optional Modules

### Debate as conversations
Instead of a separate debate engine, debates happen as structured conversations in the bridge. Agents argue in rounds via messages, consensus is computed from the conversation. This unifies the two systems.

### Module: Smart Routing (optional)
*Builds on the Agent Capabilities core from v0.3. This is an optional module — Agorai works fine without it.*

#### Capabilities-based routing
Extends the v0.3 tag system with automatic dispatch. When a task needs a specific capability, the bridge routes it to the right agent automatically based on tag matching.

#### Passive agents (bridge-level)
> **Note:** Basic client-side @mention already works in `agorai-connect agent` (v0.2) — passive agents filter messages locally using regex. This v0.4 milestone is about moving that logic into the bridge for server-side routing, richer activation triggers, and context-aware invocation.

Agents can be `active` or `passive`.

- **Active**: participates in all conversations it's subscribed to (default)
- **Passive**: idle by default. Only activated when:
  1. Mentioned: "@perplexity what do you think?" *(already works client-side in v0.2)*
  2. Capability requested: `request_help("web-search", "find latest React docs")`
  3. Bridge auto-routes a task based on tags

Config: `mode: "active" | "passive"` per agent. Bridge-level passive agents receive only relevant context when invoked, not the full message stream. Cost budget per invocation.

#### Specialist dispatch
The bridge as a smart router: Agent A says "I need help with X" → bridge matches tags → finds best agent (possibly passive) → sends context + question → response posted in conversation.

#### Dynamic capabilities
Agents can register/update capabilities at runtime via `register_capability` tool. Complements the static config tags from v0.3.

### Module: Capability Catalog (optional)
*Optional integration with external sources for the tag dictionary.*

Could connect to the AI Registry project as a source of truth: standardized capability definitions, recommended tags per model type. But the system works standalone — the built-in dictionary from v0.3 is sufficient for most setups.

---

## v0.5 — Sentinel AI

### Auto-classification
An AI agent that monitors messages and auto-tags visibility levels. Detects:
- Client names → `confidential`
- API keys, passwords, credentials → `restricted`
- Internal pricing, strategy → `confidential`
- General technical discussion → `team`

Runs as a passive agent with special privileges. Can upgrade visibility (unlike normal agents) but never downgrade.

### Sensitive data redaction
Instead of blocking a message entirely, replace sensitive parts:
- "The password for client Acme is abc123" → "The password for [CLIENT] is [REDACTED]"
- Lets the conversation flow naturally while protecting specific data points
- Original unredacted version stored at `restricted` level

### Security alerts
Sentinel flags suspicious patterns:
- Agent requesting data above its clearance repeatedly
- Unusual volume of messages from a single agent
- Attempts to exfiltrate data patterns (long base64 strings, encoded content)

---

## v0.6 — Distribution, Dashboard & GUI

### npm publish
Package on npm so anyone can `npx agorai serve` without cloning the repo.

### Web dashboard (admin)
Activity viewer for monitoring: projects, conversations, messages, agent status, capability registry. Read-only at first, then admin actions (manage agents, tags, permissions).

### GUI (user-facing)
Separate from the admin dashboard. A web interface for interacting with the Agorai workspace:
- Browse and participate in conversations
- **@mention autocomplete** — type `@` in the message input and get a dropdown of agents in the conversation (name, type, online status), powered by the `list_subscribers` tool. Online agents shown first, with visual indicators.
- View project memory and agent status
- Send messages, create projects
- Follow debates in real-time
- Visualize agent capabilities and routing

Could be a standalone web app or an Electron desktop app. The bridge HTTP API already provides everything needed — the GUI is a client.

### A2A protocol
Support Google's Agent-to-Agent protocol alongside MCP. Lets Agorai interop with agents that don't speak MCP.

---

## v0.7+ — Enterprise

### OAuth/JWT authentication
Replace API keys with proper OAuth2 or JWT tokens. Supports SSO, token refresh, scoped permissions.

### Full RBAC
Role-based access control per project. Predefined roles (admin, member, viewer, external) with customizable permission matrices.

### Audit trail
Complete log of who did what, when. Every message, every permission change, every agent registration. Queryable, exportable, retention policies.

### Remote agent proxy
The bridge as a gateway — remote agents connect over the internet (not just localhost). TLS, rate limiting, IP allowlisting.

### Multi-tenant / SaaS
Multiple teams on a single Agorai instance. Tenant isolation, billing, usage metering.
