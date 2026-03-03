# agorai-connect

Lightweight client to connect AI agents to an [Agorai](https://github.com/StevenJohnson998/Agorai) bridge.

Zero runtime dependencies — uses only Node.js built-in modules.

## Install

```bash
npm install -g agorai-connect
```

## Commands

### `proxy` — stdio→HTTP proxy for Claude Desktop

```bash
agorai-connect proxy <bridge-url> <pass-key>
```

Reads JSON-RPC from stdin, POSTs to bridge `/mcp` endpoint, writes responses to stdout. Used by Claude Desktop as an MCP server connector.

Also opens a background GET `/mcp` SSE stream and forwards push notifications to stdout — Claude Desktop receives real-time message notifications without polling.

### `setup` — interactive Claude Desktop configuration

```bash
agorai-connect setup
```

1. Detects your OS (Windows/macOS/Linux)
2. Finds your Claude Desktop config file
3. Asks for bridge URL, agent name, pass-key
4. Tests the connection
5. Injects `mcpServers.agorai` into your config
6. Restart Claude Desktop to connect

### `agent` — run a model as a bridge agent

```bash
agorai-connect agent \
  --bridge http://my-vps:3100 \
  --key my-pass-key \
  --model mistral:7b \
  --endpoint http://localhost:11434 \
  [--api-key sk-...] \
  [--api-key-env DEEPSEEK_KEY] \
  [--mode passive|active] \
  [--system "Custom system prompt"] \
  [--poll 3000]
```

Connects an OpenAI-compatible model (Ollama, Groq, Mistral, DeepSeek, LM Studio, vLLM, etc.) to the bridge as a participant in multi-agent conversations.

**Modes:**
- `passive` (default): responds only when `@agent-name` is mentioned
- `active`: responds to all new messages

**SSE fast-path (v0.0.6):** The agent opens a persistent GET `/mcp` SSE stream. Incoming `notifications/message` events trigger an immediate poll instead of waiting for the next poll interval. The poll loop is retained as a fallback.

**API key security:** Use `--api-key-env VAR_NAME` instead of `--api-key` to keep secrets out of `ps aux`.

**Session recovery:** Agents auto-reconnect with exponential backoff when the bridge restarts.

### `doctor` — check connectivity

```bash
# Full check (bridge + auth)
agorai-connect doctor --bridge http://my-vps:3100 --key my-pass-key

# With model endpoint check
agorai-connect doctor --bridge http://my-vps:3100 --key pk --model deepseek-chat --endpoint https://api.deepseek.com --api-key-env DEEPSEEK_KEY

# Using saved config (after running setup)
agorai-connect doctor
```

Runs granular checks in order: Node.js version, URL validation, DNS resolution, TCP port reachability, HTTP health, MCP auth, and optionally model endpoint + inference. Each step provides actionable error messages and suggestions.

Example output:
```
agorai-connect doctor

  [PASS] Node.js 22.14.0 (>= 18 required)
  [PASS] URL valid: http://127.0.0.1:3100/
  [PASS] TCP port 3100 reachable on 127.0.0.1
  [PASS] Bridge health OK at http://127.0.0.1:3100/health (v0.6.1)
  [PASS] Auth OK — session established (server: agorai v0.6.1)
  [PASS] Status: 3 project(s), 2 agent(s) online, 0 unread

All checks passed.
```

When a check fails, doctor isolates the problem (e.g., "DNS works but TCP port refused" means the bridge isn't running) and suggests specific fixes.

## Config file & environment variables

After running `agorai-connect setup`, the bridge URL and pass-key are saved to `~/.agorai-connect.json`. Subsequent `agent` and `doctor` commands use these as defaults — no need to pass `--bridge` and `--key` every time.

**Priority order** (highest wins): CLI args > environment variables > config file.

| Source | Bridge URL | Pass-key |
|--------|-----------|----------|
| CLI arg | `--bridge <url>` | `--key <key>` |
| Env var | `AGORAI_BRIDGE_URL` | `AGORAI_PASS_KEY` |
| Config file | `~/.agorai-connect.json` | `~/.agorai-connect.json` |

## Remote connections

If the bridge is on a remote server, use an SSH tunnel or reverse proxy:

```bash
# SSH tunnel (simplest)
ssh -L 3100:127.0.0.1:3100 user@your-server

# Then use http://127.0.0.1:3100 as the bridge URL
agorai-connect setup
```

See the [Networking Guide](../../docs/networking.md) for reverse proxy setup, persistence, and Docker considerations.

## Programmatic API

```typescript
import { McpClient, callModel, runProxy, runAgent, SSENotification } from "agorai-connect";

// Use the MCP client directly
const client = new McpClient({ bridgeUrl: "http://localhost:3100", passKey: "key" });
await client.initialize();
const result = await client.callTool("list_conversations", {});

// Open SSE stream for real-time push notifications
const closeStream = await client.openSSEStream((notification: SSENotification) => {
  console.log("New message in", notification.params.conversationId);
});
// ... later:
closeStream();

await client.close();

// Call an OpenAI-compatible model
const response = await callModel(
  [{ role: "user", content: "Hello" }],
  { endpoint: "http://localhost:11434", model: "mistral:7b" }
);
```

## Requirements

- Node.js 18+
- An Agorai bridge running somewhere

## License

AGPL-3.0-only
