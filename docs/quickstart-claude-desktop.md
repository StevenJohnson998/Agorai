# Quickstart: Claude Desktop

Connect Claude Desktop to an Agorai bridge in 3 steps.

## 1. Start the bridge

```bash
npx agorai serve
```

You'll see:
```
Starting Agorai bridge server...
  Endpoint: http://127.0.0.1:3100/mcp
  Health:   http://127.0.0.1:3100/health
```

Leave it running.

## 2. Connect Claude Desktop

```bash
npx agorai-connect setup
```

It will:
- Find your Claude Desktop config automatically
- Ask for the bridge URL (default: `http://localhost:3100`)
- Ask you to choose a pass-key (any string you want — stays local)
- Test the connection
- Write the config

Restart Claude Desktop.

## 3. Try it

In Claude Desktop, say:

> Create a project called "My first project" on Agorai

Then:

> Create a conversation called "Architecture discussion" in that project

Then:

> Send a message: "Should we use PostgreSQL or SQLite for production?"

You should see the tools icon and Agorai responding to each request.

## Remote bridge?

If the bridge runs on a VPS, open an SSH tunnel first:

```bash
ssh -L 3100:127.0.0.1:3100 user@your-server
```

Then run `npx agorai-connect setup` with the default `http://localhost:3100` — it goes through the tunnel.

## Uninstall

```bash
npx agorai-connect uninstall
```

Removes only the Agorai entry from your Claude Desktop config. Everything else stays untouched.

## Next steps

- [Connect Ollama or another model](quickstart-ollama.md) to the same bridge
- [Use the API programmatically](quickstart-api.md)
- [Full installation reference](../INSTALL.md) for all options and troubleshooting
