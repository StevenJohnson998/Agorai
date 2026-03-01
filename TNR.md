# TNR — Non-Regression Tests

Living document. Updated with every major release.
Each section = a functional domain. Each line = a scenario to validate.

**Legend**: `[A]` = automated (vitest), `[M]` = manual, `[S]` = semi-auto (script or command to run)

---

## 1. Build & Packaging

| # | Test | Type | Command / Procedure | Expected Result |
|---|------|------|---------------------|-----------------|
| 1.1 | TypeScript compile | [S] | `npx tsc --noEmit` | Zero errors |
| 1.2 | Unit tests pass | [S] | `npx vitest run` | All tests pass |
| 1.3 | npm pack (agorai) | [S] | `npm pack --dry-run` | Contains dist/, README.md, LICENSE. No node_modules, data/, .env |
| 1.4 | npm pack (agorai-connect) | [S] | `cd packages/agorai-connect && npm pack --dry-run` | Contains dist/, README.md. No src/, tests |
| 1.5 | package.json exports | [S] | `node -e "import('agorai').then(m => console.log(Object.keys(m)))"` | Exports SqliteStore, startBridgeServer, createAdapter, etc. |
| 1.6 | Version coherence | [M] | Check `package.json` version, `cli.ts` version string, CHANGELOG | All in sync |

---

## 2. Store SQLite

| # | Test | Type | Test file | Expected Result |
|---|------|------|-----------|-----------------|
| 2.1 | Agent CRUD | [A] | `store.test.ts` | register, re-register update, getByApiKey, list, remove, lastSeen |
| 2.2 | Project CRUD + visibility | [A] | `store.test.ts` | create, list filtered by clearance, getProject hidden if insufficient clearance |
| 2.3 | Memory CRUD + filters | [A] | `store.test.ts` | create, retrieve, filter by type/tags, visibility, limit after filter, delete |
| 2.4 | Conversations + messages | [A] | `store.test.ts` | create conv, subscribe/unsubscribe, send/get messages, visibility, read tracking |
| 2.5 | Visibility capping | [A] | `store.test.ts` | Message sent with visibility > clearance → capped to sender's clearance |
| 2.6 | Limit after filter | [A] | `store.test.ts` | limit applied after visibility filter (not before) |
| 2.7 | Message metadata JSON | [A] | `store.test.ts` | Metadata stored and retrieved correctly (nested objects) |
| 2.8 | Since timestamp filter | [A] | `store.test.ts` | getMessages with `since` returns only messages after the timestamp |

---

## 3. Auth & Security

| # | Test | Type | Test file | Expected Result |
|---|------|------|-----------|-----------------|
| 3.1 | Hash without salt | [A] | `auth.test.ts` | SHA-256 consistent, different hashes for different keys |
| 3.2 | Hash with salt (HMAC) | [A] | `auth.test.ts` | HMAC-SHA-256, same salt = same hash, different salt = different hash |
| 3.3 | Valid auth | [A] | `auth.test.ts` | Valid key → authenticated, agentId, agentName, clearanceLevel |
| 3.4 | Rejected auth | [A] | `auth.test.ts` | Invalid/empty key → authenticated: false, error message |
| 3.5 | Auto-registration | [A] | `auth.test.ts` | First auth creates the agent in the store |
| 3.6 | Clearance per key | [A] | `auth.test.ts` | Each key returns the correct clearanceLevel |
| 3.7 | LastSeen update | [A] | `auth.test.ts` | lastSeenAt updated on each auth |

---

## 4. Bridge — Data Isolation

| # | Test | Type | Test file | Expected Result |
|---|------|------|-----------|-----------------|
| 4.1 | Full round-trip | [A] | `bridge-integration.test.ts` | register → project → conversation → messages → read |
| 4.2 | Visibility cross-agent | [A] | `bridge-integration.test.ts` | External agent only sees public data |
| 4.3 | Memory visibility | [A] | `bridge-integration.test.ts` | Memory respects visibility across agents |
| 4.4 | Write capping | [A] | `bridge-integration.test.ts` | Visibility capped → no privilege escalation |
| 4.5 | delete_memory ownership | [A] | `bridge-integration.test.ts` | Agent cannot delete another agent's memory |
| 4.6 | set_memory project access | [A] | `bridge-integration.test.ts` | Agent cannot write to a project above their clearance |
| 4.7 | create_conversation access | [A] | `bridge-integration.test.ts` | Agent cannot create a conversation in an inaccessible project |
| 4.8 | subscribe access | [A] | `bridge-integration.test.ts` | Agent cannot subscribe to a conversation in an inaccessible project |
| 4.9 | get_messages subscription | [A] | `bridge-integration.test.ts` | Unsubscribed agent blocked by isSubscribed |
| 4.10 | send_message subscription | [A] | `bridge-integration.test.ts` | Unsubscribed agent cannot send a message |
| 4.11 | list_subscribers subscription | [A] | `bridge-integration.test.ts` | Unsubscribed agent cannot list subscribers |
| 4.12 | list_agents project filter | [A] | `bridge-integration.test.ts` | project_id filters to agents subscribed in that project |
| 4.13 | Opaque errors | [A] | `bridge-integration.test.ts` | All errors return "Not found or access denied" |

---

## 5. Bridge Tool Schemas

| # | Test | Type | Test file | Expected Result |
|---|------|------|-----------|-----------------|
| 5.1 | RegisterAgent validation | [A] | `bridge-tools.test.ts` | Accepts valid input, applies defaults, rejects missing name |
| 5.2 | CreateProject validation | [A] | `bridge-tools.test.ts` | Accepts valid input, rejects invalid visibility |
| 5.3 | SetMemory validation | [A] | `bridge-tools.test.ts` | Accepts full input, applies defaults |
| 5.4 | SendMessage validation | [A] | `bridge-tools.test.ts` | Accepts valid input, defaults, all types, rejects invalid type |
| 5.5 | GetMessages validation | [A] | `bridge-tools.test.ts` | Accepts filters, rejects limit out of range |
| 5.6 | Subscribe validation | [A] | `bridge-tools.test.ts` | Default history=full, accepts from_join |
| 5.7 | Size limits | [A] | `bridge-tools.test.ts` | Rejects: name >200, content >100KB, memory >50KB, tags >20, capabilities >20, tag >50 chars |
| 5.8 | Minimal schemas | [A] | `bridge-tools.test.ts` | ListAgents, ListProjects, GetStatus, DeleteMemory, etc. — required fields validated |

---

## 6. Internal Agent

| # | Test | Type | Test file | Expected Result |
|---|------|------|-----------|-----------------|
| 6.1 | Discovery + subscription | [A] | `internal-agent.test.ts` | Agent discovers conversations and subscribes |
| 6.2 | Active mode response | [A] | `internal-agent.test.ts` | Agent responds to unread messages |
| 6.3 | Passive mode — no mention | [A] | `internal-agent.test.ts` | Agent ignores messages without @mention |
| 6.4 | Passive mode — with mention | [A] | `internal-agent.test.ts` | Agent responds when @mentioned |
| 6.5 | Self-filtering | [A] | `internal-agent.test.ts` | Agent does not respond to its own messages (no loop) |
| 6.6 | Mark read after success | [A] | `internal-agent.test.ts` | Messages marked read only after successful send |
| 6.7 | No mark read on failure | [A] | `internal-agent.test.ts` | Messages remain unread if adapter fails (retry on next poll) |
| 6.8 | Graceful shutdown | [A] | `internal-agent.test.ts` | AbortSignal stops the loop cleanly in <2s |

---

## 7. Debate Engine

| # | Test | Type | Test file | Expected Result |
|---|------|------|-----------|-----------------|
| 7.1 | Debate with mocks | [A] | `integration.test.ts` | Full debate with mock adapters |
| 7.2 | Protocol selection — vote | [A] | `integration.test.ts` | Comparison questions → VoteConsensus |
| 7.3 | Protocol selection — quorum | [A] | `integration.test.ts` | Security questions → QuorumConsensus |
| 7.4 | Persona bonuses | [A] | `integration.test.ts` | Persona bonus applied to consensus |
| 7.5 | Dissent detection | [A] | `integration.test.ts` | Dissent included in result when applicable |
| 7.6 | All agents fail | [A] | `integration.test.ts` | Clean abort when all agents fail |
| 7.7 | Multi-round debate | [A] | `integration.test.ts` | Multiple rounds executed correctly |
| 7.8 | computeMaxRounds | [A] | `orchestrator.test.ts` | Explicit value, quick mode, low/medium/high thoroughness |
| 7.9 | Budget estimation | [A] | `orchestrator.test.ts` | Correct estimation, over-budget flag |

---

## 8. Consensus

| # | Test | Type | Test file | Expected Result |
|---|------|------|-----------|-----------------|
| 8.1 | VoteConsensus — highest confidence | [A] | `consensus.test.ts` | Selects the response with the highest confidence |
| 8.2 | VoteConsensus — persona bonus | [A] | `consensus.test.ts` | Persona bonus weights the score |
| 8.3 | VoteConsensus — threshold | [A] | `consensus.test.ts` | Filters below confidence threshold |
| 8.4 | VoteConsensus — dissent | [A] | `consensus.test.ts` | Dissent when weights are close |
| 8.5 | DebateConsensus | [A] | `consensus.test.ts` | Highest-weighted, lower dissent threshold (30%) |

---

## 9. Personas, Config, Adapters, Logging

| # | Test | Type | Test file | Expected Result |
|---|------|------|-----------|-----------------|
| 9.1 | Persona resolution | [A] | `personas.test.ts` | Built-in, custom, override, multi-resolve, system prompt building |
| 9.2 | Config parsing | [A] | `config.test.ts` | Defaults, full config, validation errors, data dir resolution |
| 9.3 | Adapter factory | [A] | `adapters.test.ts` | Ollama, Claude, Gemini, OpenAI-compat, auto-detect, explicit type, errors |
| 9.4 | Confidence extraction | [A] | `confidence.test.ts` | Parse [confidence: X.XX], case insensitive, default 0.5 |
| 9.5 | Timeout calculation | [A] | `confidence.test.ts` | CLI vs HTTP base, correct caps |
| 9.6 | Logger | [A] | `logger.test.ts` | Log levels, truncation |
| 9.7 | Sensitive data scan | [A] | `memory.test.ts` | Detects emails, API keys, IPs. Clean text → empty |

---

## 10. CLI

| # | Test | Type | Command | Expected Result |
|---|------|------|---------|-----------------|
| 10.1 | Help | [S] | `node dist/cli.js --help` | Shows usage with all commands including `agent` and `serve` |
| 10.2 | Version | [S] | `node dist/cli.js --version` | Shows version consistent with package.json |
| 10.3 | Init | [S] | `node dist/cli.js init` (in a tmp dir) | Creates agorai.config.json with defaults |
| 10.4 | Agent — no adapter | [S] | `node dist/cli.js agent` | Error: --adapter is required |
| 10.5 | Agent — unknown adapter | [S] | `node dist/cli.js agent --adapter nonexistent` | Error: Unknown agent |
| 10.6 | Serve — no bridge config | [S] | `node dist/cli.js serve` (without bridge in config) | Error: bridge not configured |
| 10.7 | Serve — with-agent unknown | [S] | `node dist/cli.js serve --with-agent nonexistent` | Error: Unknown agent |

---

## 11. Manual Integration Tests (pre-release)

| # | Test | Type | Procedure | Expected Result |
|---|------|------|-----------|-----------------|
| 11.1 | Bridge startup | [M] | `agorai serve` with valid config | Bridge starts, shows endpoint/health/agents/db |
| 11.2 | Health endpoint | [M] | `curl http://127.0.0.1:3100/health` | JSON with status, uptime, version |
| 11.3 | Agent connect (agorai-connect) | [M] | Launch an agorai-connect agent with Ollama | Agent connects, discovers, subscribes |
| 11.4 | Internal agent (--with-agent) | [M] | `agorai serve --with-agent ollama` | Bridge starts + internal agent polls, heartbeat visible |
| 11.5 | Internal agent standalone | [M] | `agorai agent --adapter ollama --mode active` | Agent starts, polls, heartbeat |
| 11.6 | Multi-agent conversation | [M] | 2+ agents connected, send a message from one | The other agent responds, messages in correct order |
| 11.7 | Passive mode @mention | [M] | Agent in passive, send message without/with @mention | Ignores without @mention, responds with @mention |
| 11.8 | Session recovery | [M] | Restart bridge while an agent is running | Agent reconnects with backoff |
| 11.9 | Graceful shutdown | [M] | Ctrl+C on `agorai serve --with-agent` | Bridge + agents stop cleanly |
| 11.10 | Debate CLI | [M] | `agorai debate "test" --agents ollama` | Full debate with result and consensus |

---

## 12. Security (pre-release)

| # | Test | Type | Procedure | Expected Result |
|---|------|------|-----------|-----------------|
| 12.1 | Auth without key | [M] | `curl -X POST http://127.0.0.1:3100/mcp` (no Authorization) | 401 Unauthorized |
| 12.2 | Auth wrong key | [M] | `curl -H "Authorization: Bearer wrong"` | 401 Invalid API key |
| 12.3 | Rate limit | [M] | 121+ requests in <60s | 429 Too Many Requests + Retry-After header |
| 12.4 | Body size limit | [M] | Send a body >512KB | 413 Payload Too Large |
| 12.5 | Cross-agent isolation | [M] | Agent A creates a confidential project, Agent B (team) tries to access it | Not found or access denied |

---

## 13. Message Metadata & Confidentiality (v0.4)

| # | Test | Type | Test file | Expected Result |
|---|------|------|-----------|-----------------|
| 13.1 | bridgeMetadata on normal send | [A] | `store.test.ts` | `bridgeMetadata` contains visibility, senderClearance, visibilityCapped=false, timestamp, instructions |
| 13.2 | bridgeMetadata on capped send | [A] | `store.test.ts` | `visibilityCapped=true`, `originalVisibility` present when visibility > clearance |
| 13.3 | agentMetadata round-trip | [A] | `store.test.ts` | agentMetadata sent by sender retrieved as-is by getMessages |
| 13.4 | Anti-forge: strip _bridge keys | [A] | `store.test.ts` | Keys starting with `_bridge` stripped from agent metadata before storage |
| 13.5 | Null metadata graceful | [A] | `store.test.ts` | `null` metadata → `agentMetadata: null`, `bridgeMetadata` generated normally |
| 13.6 | Strip all _bridge → null agentMetadata | [A] | `store.test.ts` | If all keys are `_bridge*`, resulting `agentMetadata` = null |
| 13.7 | Project confidentiality default | [A] | `store.test.ts` | Project created without mode → `confidentialityMode: "normal"` |
| 13.8 | Project confidentiality explicit | [A] | `store.test.ts` | Project created with `strict` or `flexible` → mode stored correctly |
| 13.9 | Project confidentiality in retrieve | [A] | `store.test.ts` | `getProject()` returns `confidentialityMode` |
| 13.10 | Bridge instructions — normal mode | [A] | `store.test.ts` | `bridgeMetadata.instructions.mode === "normal"`, instruction mentions output visibility |
| 13.11 | Bridge instructions — flexible mode | [A] | `store.test.ts` | `bridgeMetadata.instructions.mode === "flexible"`, instruction allows any level |
| 13.12 | High-water mark tracking | [A] | `store.test.ts` | `getMessages()` creates/updates the agent's high-water mark for the project |
| 13.13 | High-water mark never decreases | [A] | `store.test.ts` | Reading `public` messages after `confidential` → mark stays `confidential` |
| 13.14 | High-water mark null for unknown | [A] | `store.test.ts` | `getHighWaterMark()` returns null for unknown agent/project |
| 13.15 | High-water mark per-project | [A] | `store.test.ts` | Tracks separately for each project |
| 13.16 | agentMetadata + bridgeMetadata in messages | [A] | `store.test.ts` | `handles message metadata (agentMetadata + bridgeMetadata)` — migrated legacy test |
| 13.17 | Schema migration (existing DB) | [M] | — | Existing v0.3 database → columns `agent_metadata`, `bridge_metadata`, `confidentiality_mode` added automatically, existing `metadata` data migrated to `agent_metadata` |
| 13.18 | Bridge: agentMetadata filtered per sender | [M] | — | Via MCP: `get_messages` returns `agentMetadata` only for the reader's own messages (not other agents') |
| 13.19 | Bridge: deprecated metadata excluded | [M] | — | Via MCP: `get_messages` response does not contain the legacy `metadata` field |

---

## 14. SSE Push Notifications (v0.3)

| # | Test | Type | Test file | Expected Result |
|---|------|------|-----------|-----------------|
| 14.1 | Notify subscribed (exclude sender) | [A] | `bridge-sse.test.ts` | Subscriber receives notification, sender does not |
| 14.2 | No notify unsubscribed | [A] | `bridge-sse.test.ts` | Unsubscribed agent does not receive notification |
| 14.3 | Visibility gating — team receives team | [A] | `bridge-sse.test.ts` | `team` agent receives `team` notification |
| 14.4 | Visibility gating — team blocks confidential | [A] | `bridge-sse.test.ts` | `team` agent does NOT receive `confidential` notification |
| 14.5 | Visibility gating — confidential receives confidential | [A] | `bridge-sse.test.ts` | `confidential` agent receives `confidential` notification |
| 14.6 | Content preview — truncated at 200 | [A] | `bridge-sse.test.ts` | Preview truncated at 200 chars + `…` |
| 14.7 | Content preview — short not truncated | [A] | `bridge-sse.test.ts` | Short message not truncated |
| 14.8 | Notification payload fields | [A] | `bridge-sse.test.ts` | Contains conversationId, messageId, fromAgent, type, visibility, preview |
| 14.9 | Multi-subscriber scenario | [A] | `bridge-sse.test.ts` | Multiple subscribers notified with correct visibility filtering |
| 14.10 | SSE E2E — curl stream | [M] | — | `curl -N -H "Authorization: Bearer <key>" http://127.0.0.1:3100/mcp` receives real-time notifications when another agent sends a message |

---

## 15. Agent Management CLI & Config Manager

| # | Test | Type | Test file | Expected Result |
|---|------|------|-----------|-----------------|
| 15.1 | loadRawConfig preserves fields | [A] | `config-manager.test.ts` | Loads and preserves all raw JSON fields |
| 15.2 | Config round-trip lossless | [A] | `config-manager.test.ts` | save → load → identical |
| 15.3 | generatePassKey format | [A] | `config-manager.test.ts` | Base64url of expected length |
| 15.4 | generatePassKey unique | [A] | `config-manager.test.ts` | Two calls → different keys |
| 15.5 | addAgent — openai-compat | [A] | `config-manager.test.ts` | Added to `bridge.apiKeys` AND `agents[]` |
| 15.6 | addAgent — MCP type | [A] | `config-manager.test.ts` | Added to `bridge.apiKeys` ONLY (not `agents[]`) |
| 15.7 | addAgent — ollama | [A] | `config-manager.test.ts` | Added to both arrays |
| 15.8 | addAgent — duplicate rejected | [A] | `config-manager.test.ts` | Throws if name already exists |
| 15.9 | addAgent — default clearance team | [A] | `config-manager.test.ts` | Default clearance = `team` |
| 15.10 | addAgent — creates bridge section if missing | [A] | `config-manager.test.ts` | Empty config → `bridge` section created automatically |
| 15.11 | listAgents — merge bridge + agents | [A] | `config-manager.test.ts` | Merges `bridge.apiKeys` and `agents[]` by name |
| 15.12 | listAgents — empty config | [A] | `config-manager.test.ts` | Returns empty array |
| 15.13 | listAgents — orphan agents | [A] | `config-manager.test.ts` | Agents in `agents[]` but not in `bridge.apiKeys` included |
| 15.14 | updateAgent — model | [A] | `config-manager.test.ts` | Updates the model in `agents[]` |
| 15.15 | updateAgent — clearance | [A] | `config-manager.test.ts` | Updates clearance in `bridge.apiKeys` |
| 15.16 | updateAgent — multiple fields | [A] | `config-manager.test.ts` | Multiple fields updated at once |
| 15.17 | updateAgent — unknown rejected | [A] | `config-manager.test.ts` | Throws if agent unknown |
| 15.18 | updateAgent — no changes rejected | [A] | `config-manager.test.ts` | Throws if no changes specified |
| 15.19 | removeAgent — both arrays | [A] | `config-manager.test.ts` | Removed from `bridge.apiKeys` AND `agents[]` |
| 15.20 | removeAgent — MCP only | [A] | `config-manager.test.ts` | Removed from `bridge.apiKeys` only |
| 15.21 | removeAgent — unknown rejected | [A] | `config-manager.test.ts` | Throws if agent unknown |
| 15.22 | removeAgent — preserve others | [A] | `config-manager.test.ts` | Other agents remain intact |

---

## 16. agorai-connect

| # | Test | Type | Test file | Expected Result |
|---|------|------|-----------|-----------------|
| 16.1 | callModel — URL construction | [A] | `model-caller.test.ts` | Builds the correct URL from endpoint |
| 16.2 | callModel — Authorization header | [A] | `model-caller.test.ts` | Sends `Authorization: Bearer` when apiKey provided |
| 16.3 | callModel — empty choices error | [A] | `model-caller.test.ts` | Throws on response with empty choices |
| 16.4 | callModel — /chat/completions detection | [A] | `model-caller.test.ts` | Does not append `/chat/completions` if already present |
| 16.5 | callModel — HTTP error | [A] | `model-caller.test.ts` | Throws on HTTP error |
| 16.6 | McpClient — initialize | [A] | `mcp-client.test.ts` | Sends initialize, captures session ID |
| 16.7 | McpClient — tool calls | [A] | `mcp-client.test.ts` | Correct JSON-RPC structure |
| 16.8 | McpClient — SSE responses | [A] | `mcp-client.test.ts` | Parses SSE responses |
| 16.9 | McpClient — JSON-RPC error | [A] | `mcp-client.test.ts` | Throws on JSON-RPC error |
| 16.10 | McpClient — SessionExpiredError | [A] | `mcp-client.test.ts` | 404 + "Session not found" → SessionExpiredError |
| 16.11 | McpClient — BridgeUnreachableError | [A] | `mcp-client.test.ts` | Connection refused → BridgeUnreachableError |
| 16.12 | McpClient — resetSession | [A] | `mcp-client.test.ts` | Clears session state |
| 16.13 | Backoff — exponential delays | [A] | `backoff.test.ts` | Correct exponential delays |
| 16.14 | Backoff — max cap | [A] | `backoff.test.ts` | Capped at maxMs |
| 16.15 | Backoff — jitter | [A] | `backoff.test.ts` | Jitter within expected range |
| 16.16 | Backoff — reset on succeed | [A] | `backoff.test.ts` | `succeed()` resets the counter to zero |
| 16.17 | Backoff — wait increments | [A] | `backoff.test.ts` | `wait()` increments the failure count |
| 16.18 | SSE stream — push notifications | [A] | `sse-stream.test.ts` | Receives push notifications via SSE |
| 16.19 | Config paths — platform detection | [A] | `config-paths.test.ts` | Returns a valid platform |
| 16.20 | Config paths — Windows candidates | [A] | `config-paths.test.ts` | Includes Windows Store path, ≥3 candidates, APPDATA first |
| 16.21 | Config paths — macOS/Linux | [A] | `config-paths.test.ts` | Application Support (macOS), .config (Linux) |
| 16.22 | Config paths — defaultConfigPath | [A] | `config-paths.test.ts` | Returns a string for each platform |
| 16.23 | Config paths — resolveNodePath | [A] | `config-paths.test.ts` | `node` on non-windows, full path on Windows |
| 16.24 | Config paths — searchClaudeConfig | [A] | `config-paths.test.ts` | Empty if no config, finds nested files |
| 16.25 | URL utils — normalizeBridgeUrl | [A] | `utils.test.ts` | Adds `/mcp`, strips trailing slash, https, multi-slash |
| 16.26 | URL utils — baseUrl | [A] | `utils.test.ts` | Strips `/mcp`, `/mcp/`, trailing slashes |

---

## Execution History

| Date | Version | Auto tests | Manual tests | Result | Notes |
|------|---------|-----------|--------------|--------|-------|
| 2026-02-28 | v0.2.3 | 170/170 ✅ | — | PASS | First TNR run. Manual tests 11.x/12.x to do pre-release |
| 2026-03-01 | v0.4.0 | 222/222 ✅ + 62/62 ✅ | SSE E2E ✅ | PASS | Added sections 13-16. agorai 222 tests, agorai-connect 62 tests. SSE tested E2E (curl instant, Claude Desktop polling ~8s) |

---

## Notes

- `[A]` tests are run automatically by `npx vitest run`
- `[M]` tests require an active bridge with valid config + at least one available model (Ollama recommended)
- `[S]` tests are shell commands to run manually but verifiable by script
- Update this file with every feature addition, new version, or bug fix
- agorai-connect has its own 62 tests in `packages/agorai-connect/` — detailed in section 16
- Manual tests `[M]` in section 13 (13.17-13.19) require an active bridge and two connected agents
- Identified gaps (schema migration, bridge-level agentMetadata filtering, deprecated metadata exclusion) are covered by manual tests 13.17-13.19
