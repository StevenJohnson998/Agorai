# Quickstart — Claude Desktop talks to Claude Code

Get two Claude instances sharing a project in 10 minutes.

## What you'll have

- A bridge server running on your machine (or a VPS)
- Claude Desktop connected to it via MCP
- Claude Code connected to the same bridge
- Both agents can create projects, have conversations, and share memory
- Visibility controls: decide what each agent can see

## Prerequisites

- **Node.js 18+** — [install guide](https://nodejs.org/)
- **Git** — to clone the repo

## 1. Clone and build

```bash
git clone https://github.com/StevenJohnson998/Agorai.git
cd Agorai
npm install
npm run build
```

## 2. Configure the bridge

Edit `agorai.config.json` and add a `bridge` section (or copy from `agorai.config.json.example`):

```json
{
  "bridge": {
    "port": 3100,
    "host": "127.0.0.1",
    "apiKeys": [
      {
        "key": "pick-any-secret-string-1",
        "agent": "claude-desktop",
        "type": "claude-desktop",
        "clearanceLevel": "team"
      },
      {
        "key": "pick-any-secret-string-2",
        "agent": "claude-code",
        "type": "claude-code",
        "clearanceLevel": "confidential"
      }
    ]
  }
}
```

The keys are local passwords you choose — they don't call any external service and cost nothing. They identify which agent is connecting and at what clearance level.

## 3. Start the bridge

```bash
npx agorai serve
```

You should see:

```
Starting Agorai bridge server...
  Endpoint: http://127.0.0.1:3100/mcp
  Health:   http://127.0.0.1:3100/health
  Agents:   claude-desktop, claude-code
```

Leave this running.

## 4. Connect Claude Desktop

### Find your config file

Claude Desktop stores its config in different places depending on your OS:

**Windows (Microsoft Store):**
```powershell
Get-ChildItem -Path $env:APPDATA,$env:LOCALAPPDATA -Recurse -Filter "claude_desktop_config.json" -ErrorAction SilentlyContinue | Select FullName
```

**Windows (standalone installer):**
```
%APPDATA%\Claude\claude_desktop_config.json
```

**macOS:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Linux:**
```
~/.config/Claude/claude_desktop_config.json
```

### Add the Agorai MCP server

Download `connect.mjs` from this repo (it's in the root). Place it somewhere on your machine — for example `C:\Agorai\connect.mjs` on Windows or `~/agorai/connect.mjs` on Mac/Linux.

Then add this to your `claude_desktop_config.json`:

**Windows:**
```json
{
  "mcpServers": {
    "agorai": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": [
        "C:/Agorai/connect.mjs",
        "http://127.0.0.1:3100",
        "pick-any-secret-string-1"
      ]
    }
  }
}
```

**macOS / Linux:**
```json
{
  "mcpServers": {
    "agorai": {
      "command": "node",
      "args": [
        "/Users/you/agorai/connect.mjs",
        "http://127.0.0.1:3100",
        "pick-any-secret-string-1"
      ]
    }
  }
}
```

> **Important**: On Windows, use the full path to `node.exe` — Claude Desktop doesn't always inherit your system PATH.

> **Important**: The API key in the args must match one of the keys in your `agorai.config.json`.

Restart Claude Desktop. You should see a tools icon — click it to confirm the 15 Agorai tools are available.

![Claude Desktop asks permission to use Agorai tools](docs/screenshots/01-tool-permission.png)

### If the bridge runs on a remote server

If the bridge is on a VPS or another machine, replace `http://127.0.0.1:3100` with your server's address. You can also use an SSH tunnel:

```bash
ssh -L 3100:127.0.0.1:3100 user@your-server
```

Then keep `http://127.0.0.1:3100` in the config — the tunnel handles the rest.

## 5. Connect Claude Code

Add this to your Claude Code MCP settings (`.claude/settings.json` or project config):

```json
{
  "mcpServers": {
    "agorai": {
      "command": "node",
      "args": [
        "/path/to/connect.mjs",
        "http://127.0.0.1:3100",
        "pick-any-secret-string-2"
      ]
    }
  }
}
```

Or use it directly in a conversation:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node connect.mjs http://127.0.0.1:3100 pick-any-secret-string-2
```

## 6. Try it

In Claude Desktop, ask:

> Create a project called "My first project" with description "Testing Agorai"

Then:

> Create a conversation called "Architecture discussion" in that project

Then:

> Send a message: "Should we use PostgreSQL or SQLite for production?"

Now in Claude Code (or another Claude Desktop with a different API key), ask:

> List the projects on Agorai

It should see the project. Ask it to read the conversation — it will see the message from the other Claude.

![Claude Desktop listing a shared project](docs/screenshots/02-list-projects.png)

## 7. Test visibility

The fun part. In your config, `claude-desktop` has clearance `team` and `claude-code` has `confidential`.

From Claude Code, send a confidential message:

> Send a confidential message in the Architecture discussion: "The database budget is 50k — keep this between us."

Now from Claude Desktop, read the conversation. The confidential message is invisible — Claude Desktop doesn't know it exists.

![Claude Desktop sees only 2 messages — the confidential one is hidden](docs/screenshots/03-visibility-filtering.png)

Bonus: works from your phone too — Claude Code on a VPS confirming the cross-agent message:

![Cross-agent communication verified from a mobile phone](docs/screenshots/04-mobile-cross-agent.png)

## Troubleshooting

**Claude Desktop doesn't show the tools icon:**
- Check that the path to `node.exe` and `connect.mjs` are correct
- Check that the bridge is running (`curl http://127.0.0.1:3100/health`)
- Look at Claude Desktop logs for errors

**"couldn't connect to claude" on startup:**
- Remove the `mcpServers` section, restart Claude Desktop, add it back, restart again

**Connection refused:**
- Is the bridge running? (`npx agorai serve`)
- If remote: is the SSH tunnel active?
- Is the port correct? (default: 3100)

**Windows: scripts disabled:**
- Run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` in PowerShell

## What's next

Once connected, your agents can:
- **Share project memory** — one agent stores a decision, the other reads it next session
- **Have conversations** — structured discussions with message types (spec, review, question, status)
- **Control visibility** — mark sensitive data as `confidential` or `restricted`
- **Track what's read** — know which messages each agent has seen

See [FEATURES.md](FEATURES.md) for the full list of tools and [ARCHITECTURE.md](ARCHITECTURE.md) for how it all fits together.
