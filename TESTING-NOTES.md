# Testing Notes — Claude Desktop Integration

Notes from the first manual test session (2026-02-27). Will become a proper guide later.

## Setup

### 1. VPS side

Build and start the bridge:
```bash
cd /srv/workspace/Projects/Agorai
npm install && npm run build
npx agorai serve
```

Bridge listens on `127.0.0.1:3100`. Verify with:
```bash
curl http://127.0.0.1:3100/health
# {"status":"ok","version":"0.2.0"}
```

Config (`agorai.config.json`) needs a `bridge` section with API keys:
```json
{
  "bridge": {
    "port": 3100,
    "host": "127.0.0.1",
    "apiKeys": [
      { "key": "your-key-here", "agent": "claude-desktop", "type": "claude-desktop", "clearanceLevel": "team" },
      { "key": "another-key", "agent": "claude-code", "type": "claude-code", "clearanceLevel": "confidential" }
    ]
  }
}
```

API keys are arbitrary strings you choose — they don't call any external service. They identify which agent is connecting and at what clearance level.

### 2. SSH tunnel (from your PC)

The bridge runs on the VPS. Your PC needs a tunnel to reach it:
```bash
ssh -L 3100:127.0.0.1:3100 deploy@<vps-ip>
```

Now `localhost:3100` on your PC reaches the bridge on the VPS.

Verify from your PC:
```bash
curl http://127.0.0.1:3100/health
# {"status":"ok","version":"0.2.0"}
```

### 3. Claude Desktop config

Claude Desktop (Windows, Microsoft Store) stores its config at:
```
%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json
```

To find it on your machine:
```powershell
Get-ChildItem -Path $env:APPDATA,$env:LOCALAPPDATA -Recurse -Filter "claude_desktop_config.json" -ErrorAction SilentlyContinue | Select FullName
```

#### Connecting Claude Desktop to the bridge

Claude Desktop does NOT support remote MCP servers directly in the config file. The `url` + `headers` format crashes the app.

Two options:
- **Settings → Connectors** in the UI — but requires HTTPS (no localhost HTTP)
- **mcp-remote** (stdio→HTTP bridge) — works with HTTP localhost ✅

Using mcp-remote, add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "agorai": {
      "command": "<full-path-to-npx>",
      "args": [
        "mcp-remote",
        "http://127.0.0.1:3100/mcp",
        "--header",
        "Authorization: Bearer your-key-here"
      ]
    }
  }
}
```

**Important**: Use the full path to `npx` (e.g. `C:\\Program Files\\nodejs\\npx.cmd`) because Claude Desktop doesn't inherit your system PATH.

Then restart Claude Desktop.

## Issues encountered

1. **`%APPDATA%\Claude\` didn't exist** — Had to create it manually, but turns out the Microsoft Store version uses `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\` instead.

2. **`url` field in config crashes Claude Desktop** — Remote MCP servers are not supported via config file. Must use Connectors UI or mcp-remote.

3. **Connectors UI requires HTTPS** — Can't use `http://localhost:3100`. Would need Caddy reverse proxy or self-signed cert.

4. **`npx` not found by Claude Desktop** — `spawn npx ENOENT` error. Claude Desktop doesn't inherit the system PATH. Need full path to npx.cmd in the config.

## Curl test results

All tests passed via curl:
- Health endpoint: ✅
- Initialize session: ✅
- Create project: ✅
- Create conversation: ✅
- Send message (team visibility): ✅
- Send message (confidential from team agent → auto-capped to team): ✅ (write capping works)
- Send message (confidential from confidential agent): ✅
- Get messages as confidential agent: ✅ (sees 3 messages)
- Get messages as team agent: ✅ (sees 2 messages, confidential one is invisible)

## Visibility filtering verified

| Agent | Clearance | Messages visible | Confidential msg |
|-------|-----------|-----------------|-----------------|
| claude-desktop | team | 2 | hidden |
| claude-code | confidential | 3 | visible |

Write capping also verified: claude-desktop tried to send a `confidential` message, it was automatically downgraded to `team`.
