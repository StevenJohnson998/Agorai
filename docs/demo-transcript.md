# Agorai Demo — Terminal Transcript

> Three AI agents (Claude, DeepSeek, Gemini) collaborating on an API architecture review through a single Agorai bridge. Copy-paste ready for asciinema or screen recording.

---

## Scenario

You're building a Node.js API for a task management app. You want three AI models to review it together: Claude (orchestrator), DeepSeek (backend specialist), Gemini (security reviewer). Each brings a different perspective; Agorai lets them talk to each other.

---

## Scene 1: Start the bridge

```
$ npx agorai serve

Starting Agorai bridge server...
  Endpoint: http://127.0.0.1:3100/mcp
  Health:   http://127.0.0.1:3100/health
  Agents:   claude-desktop, deepseek-chat, gemini-flash
  Database: ./data/agorai.db
  Salt:     configured
  Rate limit: 120 req/60s
```

## Scene 2: Connect the specialist agents

**Terminal 2 — DeepSeek (passive — only responds when @mentioned)**
```
$ DEEPSEEK_KEY=sk-... npx agorai-connect agent \
    --bridge http://127.0.0.1:3100 \
    --key my-deepseek \
    --model deepseek-chat \
    --endpoint https://api.deepseek.com \
    --api-key-env DEEPSEEK_KEY \
    --mode passive

[info]  Registered as deepseek-chat
[info]  Passive mode — waiting for @deepseek-chat mentions
[info]  Heartbeat: agent alive, 0 conversations tracked
```

**Terminal 3 — Gemini (passive)**
```
$ GEMINI_KEY=AIza... npx agorai-connect agent \
    --bridge http://127.0.0.1:3100 \
    --key my-gemini \
    --model gemini-2.0-flash \
    --endpoint https://generativelanguage.googleapis.com/v1beta/openai/chat/completions \
    --api-key-env GEMINI_KEY \
    --mode passive

[info]  Registered as gemini-flash
[info]  Passive mode — waiting for @gemini-flash mentions
```

## Scene 3: Connect Claude Desktop

```
$ npx agorai-connect setup

Bridge URL: http://127.0.0.1:3100
Agent name: claude-desktop
Pass-key: my-claude-desktop

✅ Connection tested successfully
✅ Config written — restart Claude Desktop to activate
```

After restarting Claude Desktop, the Agorai tools icon appears (16 tools).

## Scene 4: Set up the project

In Claude Desktop:

> "Create a project called 'taskflow-api' and a conversation called 'Architecture Review'"

```
Using tool: create_project (name: "taskflow-api", description: "Task management REST API")
→ Project created: id=f1a2b3c4...

Using tool: create_conversation (project_id: "f1a2b3c4...", title: "Architecture Review")
→ Conversation created: id=d5e6f7a8...
```

The specialist agents auto-discover and subscribe:
```
# Terminal 2 (DeepSeek)
[info]  Discovery: found 1 new conversation(s)
[info]  Subscribed to "Architecture Review"

# Terminal 3 (Gemini)
[info]  Discovery: found 1 new conversation(s)
[info]  Subscribed to "Architecture Review"
```

## Scene 5: Multi-agent review

**Claude Desktop kicks off the review:**

> "Post in Architecture Review: Team, here's our API stack — Express.js, Prisma ORM, PostgreSQL, JWT auth. We're at 12 endpoints and growing. @deepseek-chat review the data model and query patterns. @gemini-flash audit the auth flow and input validation."

```
Using tool: send_message (conversation_id: "d5e6f7a8...", type: "message")
→ Message sent
```

**DeepSeek responds automatically (Terminal 2):**
```
[info]  Mentioned in "Architecture Review" — generating response...
[info]  Model call: deepseek-chat (1,482 tokens, 5.3s)
[info]  Response sent to "Architecture Review"
```

In the conversation:

> **deepseek-chat**: Data model and query pattern review:
>
> 1. **N+1 queries on `/tasks?include=assignees`** — Prisma's nested includes generate separate queries per task. Use `findMany` with `relationLoadStrategy: "join"` or a raw query for list endpoints.
> 2. **No soft deletes** — `DELETE /tasks/:id` is permanent. Add a `deletedAt` timestamp column for audit trail and undo.
> 3. **Missing composite index** — `tasks(project_id, status, created_at)` would cover your two most common list queries.
> 4. **Unbounded pagination** — `/tasks` defaults to all records. Add `take: 50` default with cursor-based pagination.
>
> Overall the Prisma choice is solid. Address the N+1 before it becomes a perf bottleneck.

**Gemini responds (Terminal 3):**
```
[info]  Mentioned in "Architecture Review" — generating response...
[info]  Model call: gemini-2.0-flash (1,105 tokens, 2.1s)
[info]  Response sent to "Architecture Review"
```

> **gemini-flash**: Auth and input validation audit:
>
> 1. **JWT secret in env var** — good. But token expiry is 7 days — reduce to 15 minutes with a refresh token flow.
> 2. **No rate limiting on `/auth/login`** — brute force risk. Add 5 attempts per minute per IP.
> 3. **`req.body` used directly in 3 routes** — needs Zod or Joi schemas. `/tasks` POST accepts arbitrary JSON fields that get passed to Prisma.
> 4. **CORS allows `*`** — restrict to your frontend domain. Wildcard + credentials is a browser-rejected combo anyway.
> 5. **No CSRF protection** — if you add cookie-based auth later, you'll need it. Flag for future.
>
> Priority: #3 (input validation) is the most urgent — it's a potential injection vector through Prisma.

**Claude Desktop synthesizes:**

> "Read all messages in Architecture Review and create a prioritized action plan."

> **claude-desktop**: ## Architecture Review — Action Plan
>
> | # | Priority | Issue | Source |
> |---|----------|-------|--------|
> | 1 | P0 | Input validation — add Zod schemas to all endpoints | gemini-flash |
> | 2 | P0 | Login rate limiting — 5/min per IP | gemini-flash |
> | 3 | P1 | N+1 query fix — join strategy on list endpoints | deepseek-chat |
> | 4 | P1 | JWT expiry 7d → 15min + refresh tokens | gemini-flash |
> | 5 | P1 | Cursor-based pagination with default limit | deepseek-chat |
> | 6 | P2 | Soft deletes on tasks table | deepseek-chat |
> | 7 | P2 | CORS origin restriction | gemini-flash |
> | 8 | P2 | Composite index on tasks | deepseek-chat |
>
> @deepseek-chat @gemini-flash — does this priority ranking look right?

**Both agents confirm:**

> **deepseek-chat**: Agreed. Input validation before performance — correct order. The composite index is low risk, can ship anytime.

> **gemini-flash**: Confirmed. I'd make #4 (JWT expiry) P0 if this is public-facing. For internal tools, P1 is fine.

## Scene 6: Save the decisions to memory

**Claude Desktop saves to project memory:**

> "Save these as memory entries in taskflow-api: the action plan as a 'decision', and each agent's full review as 'context'"

```
Using tool: set_memory (type: "decision", title: "Architecture review action plan", priority: "high")
→ Saved

Using tool: set_memory (type: "context", title: "Data model review — deepseek", priority: "normal")
→ Saved

Using tool: set_memory (type: "context", title: "Security audit — gemini", priority: "normal")
→ Saved
```

Next week, in a new conversation:

> "Get all decisions for the taskflow-api project"

> **1 entry found:**
> **Architecture review action plan** (decision, high priority)
> *8-item prioritized action plan. P0: input validation, login rate limiting...*

The decision persists across conversations and is visible to every agent in the project.

## Scene 7: Visibility in action

**Claude Desktop sends a confidential message** (only `confidential`+ agents can see it):

> "Send a confidential message: Budget constraint — we only have 2 sprint days for the P0 items. If we can't finish both, prioritize input validation over rate limiting."

```
Using tool: send_message (visibility: "confidential")
→ Message sent (confidential)
```

**DeepSeek and Gemini (team clearance) read the conversation** — they see 7 messages. The budget message is invisible. They don't know it exists.

**Claude Desktop (confidential clearance)** — sees all 8 messages, including the budget constraint.

---

## What you just saw

| Feature | How it appeared |
|---------|----------------|
| **Multi-model collaboration** | 3 models with different strengths reviewing together |
| **@mentions** | Each agent only engages when called on |
| **Passive mode** | Cloud APIs idle until mentioned — no wasted tokens |
| **Specialist routing** | DeepSeek on data, Gemini on security — by prompt, not config |
| **Shared synthesis** | Claude reads everyone's input and builds the action plan |
| **Persistent memory** | Decisions survive across conversations |
| **Visibility levels** | Sensitive info hidden from lower-clearance agents |
| **Auto-discovery** | Agents join new conversations without manual setup |

All of this on a single machine, one SQLite file, zero cloud infrastructure.

---

*To set this up yourself, follow the [tutorial](tutorial.md) or the [install guide](../INSTALL.md).*
