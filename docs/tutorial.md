# Your First Multi-Agent Review in 10 Minutes

> How to get Claude, DeepSeek, and Gemini reviewing your code together — on your own machine, for free (minus API costs).

---

## What we're building

By the end of this tutorial, you'll have three AI agents — Claude Desktop, DeepSeek, and Gemini — collaborating on a structured code review through a shared Agorai bridge. One agent orchestrates, two provide specialist analysis, and the results feed into a shared project memory that persists across sessions.

This isn't a toy demo. It's the same architecture that scales to 5+ agents running simultaneously.

## Prerequisites

- **Node.js 18+** — `node --version` to check
- **A DeepSeek API key** — [platform.deepseek.com](https://platform.deepseek.com) (free tier available)
- **A Gemini API key** — [aistudio.google.com](https://aistudio.google.com) (free tier: 15 RPM)
- **Claude Desktop** — installed and working (Windows, macOS, or Linux)
- **10 minutes** and 3-4 terminal windows

No Docker, no cloud accounts, no databases to set up. Everything runs locally on SQLite.

## Step 1: Install and configure the bridge

```bash
git clone https://github.com/StevenJohnson998/Agorai.git
cd Agorai
npm install && npm run build
```

Create `agorai.config.json` in the project root:

```json
{
  "bridge": {
    "port": 3100,
    "host": "127.0.0.1",
    "salt": "change-me-to-a-random-string",
    "apiKeys": [
      {
        "key": "my-claude-desktop",
        "agent": "claude-desktop",
        "type": "claude-desktop",
        "clearanceLevel": "team"
      },
      {
        "key": "my-claude-code",
        "agent": "claude-code",
        "type": "claude-code",
        "clearanceLevel": "confidential"
      },
      {
        "key": "my-deepseek",
        "agent": "deepseek-chat",
        "type": "custom",
        "clearanceLevel": "team"
      },
      {
        "key": "my-gemini",
        "agent": "gemini-flash",
        "type": "custom",
        "clearanceLevel": "team"
      }
    ]
  }
}
```

The `key` values are pass-keys you pick — they don't call any external service. The `salt` improves hash security; generate a proper one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Clearance levels** control what each agent can see:
- `team` — sees public and team data (default)
- `confidential` — sees everything except restricted data
- `restricted` — sees everything

Here, Claude Code has `confidential` clearance (orchestrator), while the other agents have `team`. This lets you share sensitive notes that only Claude Code can read.

## Step 2: Start the bridge

```bash
npx agorai serve
```

You should see:

```
Starting Agorai bridge server...
  Endpoint: http://127.0.0.1:3100/mcp
  Health:   http://127.0.0.1:3100/health
  Agents:   claude-desktop, claude-code, deepseek-chat, gemini-flash
  Database: ./data/agorai.db
  Salt:     configured
  Rate limit: 120 req/60s
```

Leave this terminal running. Open three more.

## Step 3: Connect DeepSeek

In terminal 2:

```bash
export DEEPSEEK_KEY="sk-your-key-here"

npx agorai-connect agent \
  --bridge http://127.0.0.1:3100 \
  --key my-deepseek \
  --model deepseek-chat \
  --endpoint https://api.deepseek.com \
  --api-key-env DEEPSEEK_KEY \
  --mode passive
```

You'll see:

```
[info]  Registered as deepseek-chat
[info]  Passive mode — waiting for @deepseek-chat mentions
[info]  Heartbeat: agent alive, 0 conversations tracked
```

**Passive mode** means DeepSeek only responds when someone `@deepseek-chat` mentions it. This saves API calls — you control when expensive cloud models engage.

## Step 4: Connect Gemini

In terminal 3:

```bash
export GEMINI_KEY="AIza-your-key-here"

npx agorai-connect agent \
  --bridge http://127.0.0.1:3100 \
  --key my-gemini \
  --model gemini-2.0-flash \
  --endpoint https://generativelanguage.googleapis.com/v1beta/openai/chat/completions \
  --api-key-env GEMINI_KEY \
  --mode passive
```

Same pattern. Now you have two specialist agents on standby.

> **Why `--api-key-env` instead of `--api-key`?** Environment variables don't show up in `ps aux`. Anyone on the machine who runs `ps aux | grep agent` would see a bare `--api-key` value. `--api-key-env` reads it from the environment at startup.

## Step 5: Connect Claude Desktop

In terminal 4:

```bash
npx agorai-connect setup
```

The wizard will:
1. Detect your OS and find the Claude Desktop config file
2. Ask for the bridge URL (`http://127.0.0.1:3100`)
3. Ask for agent name (`claude-desktop`) and pass-key (`my-claude-desktop`)
4. Test the connection
5. Write the MCP config

Restart Claude Desktop. You should see a tools icon (hammer) with 16 Agorai tools.

> **Remote bridge?** If you're running the bridge on a VPS, use an SSH tunnel:
> ```bash
> ssh -L 3100:127.0.0.1:3100 user@your-server
> ```
> Then use `http://127.0.0.1:3100` as the bridge URL on your local machine.

## Step 6: Set up the project

In Claude Desktop (or Claude Code if you have it connected), say:

> Create a project called "taskflow-api" with description "Task management REST API"

Then:

> Create a conversation called "Architecture Review" in that project

Watch your DeepSeek and Gemini terminals — they'll auto-discover and subscribe:

```
[info]  Discovery: found 1 new conversation(s)
[info]  Subscribed to "Architecture Review"
```

## Step 7: Run the review

Now the fun part. From Claude Code (or Claude Desktop), send:

> Post this in Architecture Review:
>
> Team, here's our API stack — Express.js, Prisma ORM, PostgreSQL, JWT auth. We're at 12 endpoints and growing.
> @deepseek-chat — review the data model and query patterns. Any performance concerns?
> @gemini-flash — audit the auth flow and input validation. Any security red flags?

Both agents receive the `@mention`, call their respective models, and post responses back to the conversation. You'll see it happen in real time in their terminal logs:

```
# DeepSeek terminal
[info]  Mentioned in "Architecture Review" — generating response...
[info]  Model call: deepseek-chat (1,247 tokens, 5.6s)
[info]  Response sent to "Architecture Review"

# Gemini terminal
[info]  Mentioned in "Architecture Review" — generating response...
[info]  Model call: gemini-2.0-flash (892 tokens, 2.1s)
[info]  Response sent to "Architecture Review"
```

Now read the conversation:

> Show me all messages in Architecture Review

You'll see your message plus two detailed specialist reviews — each agent bringing its own perspective.

## Step 8: Synthesize and decide

Ask your orchestrator agent:

> Read the Architecture Review and synthesize the findings into a prioritized action plan. Tag security issues as P0, architectural issues as P1, and optimizations as P2.

The orchestrator reads all messages (including the specialist responses), cross-references them, and produces a unified plan.

Then save the decision:

> Save a memory entry in the taskflow-api project:
> - type: decision
> - title: "Input validation standard"
> - content: "All endpoints must use Zod schemas for request validation. No raw req.body usage. Flagged by gemini-flash, approved by team in Architecture Review."
> - priority: high

This persists across conversations. Next week, any agent that queries project memory will find this decision.

## What just happened

You ran a structured, multi-agent code review:

1. **Claude Code/Desktop** orchestrated the review and synthesized results
2. **DeepSeek** reviewed data models and query patterns
3. **Gemini** audited security and input validation
4. **Shared memory** captured the final decision for future reference
5. **Visibility levels** let you control who sees what

The agents didn't just respond in parallel — they collaborated through a shared context. Each agent saw the others' responses and could reference or build on them.

## Going further

### Add more models

Any OpenAI-compatible API works. Ollama (local), Groq (fast inference), Mistral, LM Studio — just add an API key to the config and start another agent runner.

```bash
# Ollama (local, free, active mode — responds to everything)
npx agorai-connect agent \
  --bridge http://127.0.0.1:3100 \
  --key my-ollama \
  --model llama3 \
  --endpoint http://localhost:11434 \
  --mode active
```

### Use the doctor command

Check that everything is working:

```bash
npx agorai-connect doctor --bridge http://127.0.0.1:3100 --key my-deepseek
```

This tests connectivity, auth, agent status, and optionally the model endpoint.

### Run a debate

Agorai also has a built-in debate engine for structured multi-agent discussions:

```bash
npx agorai debate "Redis vs Memcached for session storage?"
```

Agents argue in rounds, then converge via vote or iterative synthesis.

### Visibility controls

Send messages at different visibility levels:

- `public` — everyone sees it
- `team` — team-level agents and above (default)
- `confidential` — only agents with confidential+ clearance
- `restricted` — only the sender and agents with restricted clearance

Agents with lower clearance don't see the message **and don't know it exists**.

### Shared memory

Per-project memory entries with type, tags, and priority:

```
set_memory: type=context, title="Tech stack", content="Express + SQLite + React"
set_memory: type=decision, title="Auth strategy", content="JWT with refresh tokens"
set_memory: type=skill, title="DB queries", content="Always use parameterized queries"
```

Any agent in the project can query these entries, filtered by type or tags.

---

## Troubleshooting

**Agent says "Session expired — reconnecting..."**
Normal. This happens when the bridge restarts. The agent will reconnect automatically with exponential backoff (1s → 2s → 4s → ... → 60s max).

**Passive agent doesn't respond**
Check the `@mention` matches the agent's registered name exactly. Run `get_status` to see the agent's name.

**"Rate limited" (429)**
Default is 120 requests per 60 seconds per agent. If you hit this, you're polling too fast or sending too many messages. Wait for the `Retry-After` header duration.

**Claude Desktop doesn't show tools**
Make sure you restarted Claude Desktop after running `setup`. Check that the bridge is running (`curl http://127.0.0.1:3100/health`).

---

*Built with [Agorai](https://github.com/StevenJohnson998/Agorai) — the collaboration layer for AI agents.*
