# Architecture

Agorai uses a 3-level orchestration model inspired by Mixture-of-Agents (MoA), Blackboard systems, and CP-WBFT consensus.

## Overview

```
┌──────────────────────────────────────────────────────────┐
│                    ProjectManager                         │
│  Auto-persisted projects (create / switch / archive)      │
│  Decomposes complex tasks into sub-questions              │
│  Routes: vote (factual) vs debate (design) vs quorum (sec)│
│  Respects thoroughness budget                             │
│  Cross-debate synthesis                                   │
└─────┬──────────────────┬──────────────────┬──────────────┘
      │                  │                  │
 ┌────▼────┐       ┌────▼────┐       ┌────▼────┐
 │ Debate  │       │ Debate  │       │ Debate  │
 │Session 1│       │Session 2│       │Session 3│
 └────┬────┘       └────┬────┘       └────┬────┘
      │                  │                  │
 ┌────▼──────────────────▼──────────────────▼────┐
 │             Blackboard (per project)           │
 │  ┌──────────┐  ┌────────────────────────┐     │
 │  │ Private  │  │ Public (opt-in,        │     │
 │  │ (default)│  │ user-validated,        │     │
 │  │          │  │ no sensitive data)     │     │
 │  └──────────┘  └────────────────────────┘     │
 │  ┌──────────┐  ┌────────────────────────┐     │
 │  │ Vector   │  │ SQLite (projects,      │     │
 │  │ Index    │  │ debates, context)      │     │
 │  └──────────┘  └────────────────────────┘     │
 └───────────────────────────────────────────────┘
```

## The three levels

### ProjectManager (top level)

The ProjectManager handles complex, multi-faceted tasks and manages project lifecycle. Projects are persistent — you can suspend one, work on something else, and come back later with full context.

**Auto-persist model:** every operation writes to the Blackboard immediately. There's no "save" or "suspend" step. You work on a project, switch to another one, come back a week later — everything is exactly where you left it. Like tabs in a browser.

Projects are sorted by `lastActiveAt`, so the most recently touched project is always at the top.

The only explicit lifecycle action is `archive`, which hides a project from default listings without deleting anything. You can unarchive it later.

All data (debates, context entries, decisions) is scoped to a project. This keeps workstreams isolated and makes it natural to switch between them.

**Task decomposition** — when you call `analyze`, the ProjectManager:

1. Decomposes the task into sub-questions
2. Classifies each sub-question (factual, design, security)
3. Routes each to the appropriate consensus protocol
4. Runs DebateSessions in parallel where possible
5. Synthesizes results across all sub-debates

The thoroughness parameter controls how aggressively it decomposes. Low thoroughness = fewer sub-questions, fewer rounds.

**Collaborative workflows (future):** because projects are persistent and self-contained, they're a natural unit for collaboration. Multiple agents or users can share a project, see its debate history, and build on previous decisions.

### DebateSession (mid level)

Each DebateSession handles one focused question. A session:

1. Selects the consensus protocol based on question type
2. Prepares prompts with persona instructions and prior context
3. Invokes agents in parallel for each round
4. Collects responses with confidence scores
5. Runs the consensus protocol to check for convergence
6. Stores results in the Blackboard

### Blackboard (bottom level)

The Blackboard is the shared memory layer. All debate data flows through it. Everything is partitioned by project — switching projects gives you a completely different context.

**Project-scoped storage:** each project has its own debates, context entries, and metadata. When you suspend a project and come back, everything is right where you left it.

**Private space** (default): debate records, context entries, intermediate results. Only the local user and their agents can access this.

**Public space** (opt-in): debates or entries that the user explicitly promotes. External agents can access public data via `join_debate`. Promotion requires:
1. Explicit user request
2. Automated scan for sensitive data (API keys, emails, IPs, passwords)
3. User confirmation after inspection

## Consensus protocols

The system picks a protocol based on the question type:

| Question type | Protocol | How it works |
|---------------|----------|--------------|
| Factual / technical | **Vote** | Weighted majority. Each agent votes, weighted by confidence score. |
| Architecture / design | **Debate** | Iterative rounds. Agents see prior responses and refine. Synthesis on convergence. |
| Security / critical | **Quorum** | Confidence-weighted vote with persona bonuses. Security specialist gets 1.3x weight on security topics. |

Each agent returns a confidence score (0-1) with its response. Consensus weight = confidence x persona bonus.

## Thoroughness

A single parameter (0.0 to 1.0) that controls the depth vs cost tradeoff:

| Range | Behavior |
|-------|----------|
| 0.0 - 0.3 | Quick: 1 round, 1-2 agents, minimal context |
| 0.4 - 0.6 | Balanced: 2 rounds, summaries injected between rounds |
| 0.7 - 1.0 | Thorough: 3-5 rounds, aggressive decomposition, all agents, rich context |

Set it globally in `agorai.config.json` or per-request via the `thoroughness` parameter.

## Token budget

The orchestrator tracks token usage per agent and per round. You can set a max budget per debate (`maxTokensPerDebate`) or per project (`maxTokensPerProject`) in the config. When no budget is set, usage is tracked but not limited.

**Pre-estimation:** before launching a debate, the orchestrator can estimate total token usage using the formula: `agents × rounds × estimatedTokensPerInvocation` (configurable, default 1500). In the CLI, if the estimate exceeds `warnAtPercent`, a confirmation prompt is shown (skippable with `--force`). Via MCP, clients can call `debate` with `estimate_only: true` to get the estimate without running.

When a budget is active, the orchestrator adapts as it approaches the limit:

| Budget used | Action |
|-------------|--------|
| < 80% | Normal operation |
| 80% | Context summarization — previous round responses are truncated to save tokens |
| 90% | Agent reduction — drops to a single agent |
| 95% | Final round — completes the current round, then stops |
| 100% | Hard stop — no more rounds |

These thresholds are relative to `warnAtPercent` (configurable, default 80%). The orchestrator logs every budget action taken so you can see exactly what happened.

Token counts come from the agents themselves: Claude reports `cost_usd`, Ollama reports `prompt_eval_count` and `eval_count`. The CLI displays a full cost breakdown after each debate (total tokens, per-agent, USD cost if available).

## Agent adapters

Agents are invoked via their local CLIs or HTTP APIs. No API keys are stored or managed by Agorai.

```
IAgentAdapter
├── ClaudeAdapter    → claude -p --output-format json (CLI)
├── GeminiAdapter    → gemini -p --output-format json (CLI)
├── OllamaAdapter    → HTTP POST /api/generate (any local model)
└── (future adapters)
```

Two adapter types:
- **CLI adapters** (Claude, Gemini): invoke a command-line tool as a subprocess
- **HTTP adapters** (Ollama): call a local API endpoint

The adapter factory (`createAdapter()`) picks the right type based on config: if `model` is set, it's Ollama; if `command` is set, it's CLI.

## System prompt handling

Each adapter handles persona system prompts differently based on what the underlying agent supports:

| Adapter | Method | System/User separation |
|---------|--------|----------------------|
| Claude | `--system-prompt` CLI flag | Yes — native separation |
| Gemini | Concatenated in user prompt (`[Your role]...[Question]...`) | No (untested adapter) |
| Ollama | `system` field in HTTP API body | Yes — native separation |

When the agent supports native system prompts, the persona instructions are passed separately from the user question. This gives the LLM proper context framing and avoids polluting the user message.

## Personas (Roles)

Personas shape how agents approach questions. They're configured at two levels:

**Default assignment** — in config, each agent has a `personas` array. These apply to every debate unless overridden.

**Per-debate override** — pass `roles` to the debate tool or `--roles` on CLI. This replaces the defaults for that specific debate.

**Multi-role** — an agent can cumulate multiple roles. When it does, the system prompts are merged into a combined instruction. This lets you create specialized perspectives: an agent with both "architect" and "security" will analyze design proposals with a security lens.

Built-in personas:

| Persona | Role | Consensus bonus |
|---------|------|-----------------|
| architect | Software Architect | 1.0x |
| critic | Devil's Advocate | 1.0x |
| pragmatist | Pragmatic Engineer | 1.0x |
| security | Security Specialist | 1.3x on security topics |

Custom personas can be defined in `agorai.config.json` under the `personas` key. They extend (or override) the built-ins.

## Logging

Minimal custom logger (zero dependencies). Two output channels: **stderr** for interactive use, **log files** for persistent history.

All stderr output uses `console.error()` — critical because the MCP server uses stdout for JSON-RPC and any stray output there would corrupt the protocol.

### Output channels

| Channel | Content | When |
|---------|---------|------|
| **stderr** | Truncated logs (max 800 chars/line) | Controlled by `--verbose`/`--debug`/`AGORAI_LOG_LEVEL` |
| **info.log** | Metrics: estimates, durations, tokens, costs | Always (when file logging is initialized) |
| **debates/\<id\>.log** | Full prompts, system prompts, complete responses | One file per debate, always |

### Levels and control

`error` > `warn` > `info` > `debug`. Default stderr level: `warn`.

| Method | Effect |
|--------|--------|
| `AGORAI_LOG_LEVEL=debug` (env var) | Set stderr level at startup |
| `--verbose` (CLI flag) | Set stderr level to `info` |
| `--debug` (CLI flag) | Set stderr level to `debug` |

CLI flags take precedence over the env var. `--debug` takes precedence over `--verbose`.

### User-scoped data directory

All data is scoped by user (configured via `user` field in `agorai.config.json`):

```
data/
└── <user>/
    └── logs/
        ├── info.log                          # Global metrics (append)
        └── debates/
            ├── 959c9023-78a2-4a43-....log    # Full debate transcript
            └── f08880ad-749c-42fe-....log
```

### Purge strategies (configurable)

**info.log** — single file, configurable via `logging.info`:

| Strategy | Config field | Default | Behavior |
|----------|-------------|---------|----------|
| `"date"` | `maxDays` | 30 | Remove lines older than N days |
| `"size"` | `maxBytes` | 50MB | Truncate oldest lines to stay within limit |

**Debate logs** — one file per debate, configurable via `logging.debates`:

| Strategy | Config field | Default | Behavior |
|----------|-------------|---------|----------|
| `"count"` | `maxFiles` | 50 | Keep N newest debate logs, delete the rest |
| `"date"` | `maxDays` | 14 | Delete debate logs older than N days |
| `"size"` | `maxBytes` | 100MB | Delete oldest debate logs until total size fits |

Purge runs once at startup.

### Namespaces

Each module creates a logger with its own tag: `[orchestrator]`, `[claude]`, `[gemini]`, `[ollama]`, `[adapters]`, `[server]`.

**stderr format:**
```
HH:MM:SS.mmm LVL [namespace] message...
```

**File format (info.log):**
```
2026-02-25T14:32:07.123Z INF [orchestrator] debate start: 2 agents, mode=full thoroughness=0.5
```

**Debate log format:**
```
2026-02-25T14:32:07.124Z DBG --- claude prompt ---
[system]
You are a senior software architect. Focus on system design...
[user]
Should we use Redis or Memcached for session storage?
2026-02-25T14:32:25.456Z DBG --- claude response (18332ms, confidence: 0.5) ---
**Redis. Without hesitation.** Here's why: [... full response ...]
```

### What gets logged where

| Namespace | info.log | debate log | stderr (debug) |
|-----------|----------|------------|----------------|
| orchestrator | estimate, debate start/end, round start | full prompts + responses, token tracking | summaries (truncated) |
| claude/gemini | invoke complete (duration, cost) | — | invoke start, isAvailable |
| ollama | invoke complete (duration, tokens) | — | invoke start, isAvailable, model |
| adapters | — | — | adapter type selected |
| server | server started, estimate_only | — | tool invocation args |

## Data flow

```
User (CLI or MCP)
  │
  ▼
ProjectManager.analyze()  ─or─  DebateSession.run()
  │                                    │
  ├─ decompose into sub-questions      │
  ├─ for each sub-question:            │
  │   └─ DebateSession.run()           │
  │       ├─ select protocol           ├─ select protocol
  │       ├─ for each round:           ├─ for each round:
  │       │   ├─ invoke agents         │   ├─ invoke agents
  │       │   ├─ collect responses     │   ├─ collect responses
  │       │   └─ check consensus       │   └─ check consensus
  │       └─ store in Blackboard       └─ store in Blackboard
  └─ cross-debate synthesis
  │
  ▼
Result returned to user
```

## File structure

```
src/
├── cli.ts                 # CLI entry point
├── server.ts              # MCP server (stdio)
├── project-manager.ts     # Top-level orchestrator
├── orchestrator.ts        # DebateSession
├── logger.ts              # Logger (stderr + file logging, per-debate logs)
├── tools.ts               # MCP tool schemas (Zod)
├── config.ts              # Config loading + validation
├── personas.ts            # Built-in personas
├── adapters/
│   ├── base.ts            # IAgentAdapter interface
│   ├── index.ts           # Adapter factory
│   ├── claude.ts          # Claude CLI adapter
│   ├── gemini.ts          # Gemini CLI adapter
│   └── ollama.ts          # Ollama HTTP adapter
├── memory/
│   ├── base.ts            # IMemoryBackend + IBlackboard interfaces
│   └── sqlite.ts          # SQLite implementation
└── consensus/
    ├── base.ts            # IConsensusProtocol interface
    ├── vote.ts            # Majority vote
    └── debate.ts          # Iterative debate
```
