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
agorai-connect doctor --bridge http://my-vps:3100 --key my-pass-key
agorai-connect doctor --bridge http://my-vps:3100 --key pk --model deepseek-chat --endpoint https://api.deepseek.com --api-key-env DEEPSEEK_KEY
```

Checks Node.js version, bridge health, auth, and optionally model endpoint + inference.

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
