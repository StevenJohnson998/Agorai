# Roadmap Ideas

Ideas and design notes for future versions. Not commitments — just thinking ahead.

---

## v0.3 — Permissions & Threading

### Per-project permissions
Matrix of permissions per project. Example: "external agents can only see `public` data on this project". Lets you invite an agent to a project without giving it access to everything.

### Conversation threading
Reply-to chains within conversations. Agents can branch off a sub-discussion without polluting the main thread.

### Project onboarding digests
When a new agent joins a project, it gets an auto-generated summary (digest) of what happened so far — key decisions, current state, open questions. No need to read hundreds of messages.

### Conversation/memory compaction
Long conversations and memory entries get summarized into shorter digests. Keeps context manageable without losing information. Could be triggered manually ("compact this conversation") or automatically (after N messages).

### Blackboard migration
The old debate engine Blackboard (`memory/base.ts`, `memory/sqlite.ts`) gets migrated to use the new store as its backend. One storage layer instead of two.

---

## v0.4 — Debate via Bridge & Smart Routing

### Debate as conversations
Instead of a separate debate engine, debates happen as structured conversations in the bridge. Agents argue in rounds via messages, consensus is computed from the conversation. This unifies the two systems.

### Capabilities-based routing
Each agent declares capabilities (`code-execution`, `web-search`, `security-review`, `analysis`, etc.). When a task needs a specific capability, the bridge routes it to the right agent automatically.

Example: "I need a security review" → the bridge finds agents with `security-review` capability and dispatches to them.

### Passive agents
**The problem**: some AI models are expensive or rate-limited (Perplexity, GPT-4, etc.) but have unique capabilities (web search, specific knowledge). You don't want them participating in every message — that burns tokens for nothing.

**The solution**: agents can be `active` or `passive`.

- **Active**: participates in all conversations it's subscribed to. Gets notified of every message.
- **Passive**: idle by default. Only activated when:
  1. A user mentions it: "@perplexity what do you think about this?"
  2. Another agent requests its capability: "I need a web search for X"
  3. The bridge routes a task to it based on capabilities

**How it works**:
- New field on agent registration: `mode: "active" | "passive"` (default: active)
- Passive agents are subscribed to conversations but don't receive messages in real-time
- When invoked (by mention or capability request), the bridge sends them the relevant context (recent messages, project memory) along with the specific question
- The passive agent responds, its response is posted as a message in the conversation
- Cost control: the invoker (or admin) can set a token/cost budget per invocation

**Use cases**:
- Perplexity for web search (expensive, limited tokens, but uniquely capable)
- A specialized code review agent that only runs when asked
- A translation agent invoked only when multi-language content is detected
- Agents can call other passive agents: Claude says "I'm not sure about the latest React API, let me ask Perplexity" → automatic dispatch

**Design note**: this ties directly into capabilities routing. The capability system decides *who* to call, the passive/active mode decides *when* they participate.

### Specialist dispatch
Combination of capabilities + passive mode. The bridge becomes a smart router:
1. Agent A says "I need help with X"
2. Bridge looks at registered capabilities
3. Finds the best match (possibly a passive agent)
4. Sends context + question
5. Returns the response to the conversation

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

## v0.6 — Distribution & Dashboard

### npm publish
Package on npm so anyone can `npx agorai serve` without cloning the repo.

### Web dashboard
Phase 1: Activity viewer — see projects, conversations, messages, agent status in a browser. Read-only.
Phase 2: Chat interface — participate in conversations from the browser. Send messages, create projects.

### A2A protocol
Support Google's Agent-to-Agent protocol alongside MCP. Lets Agorai interop with agents that don't speak MCP.

### More AI model integrations
Beyond Claude, Ollama, Gemini — support:
- LM Studio (local models with OpenAI-compatible API)
- vLLM (high-throughput local inference)
- llama.cpp (lightweight local inference)
- Any OpenAI-compatible API (broad compatibility)
- Perplexity (web search capability)

The adapter system is designed to make adding new models straightforward.

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
