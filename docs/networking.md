# Networking Guide

How to connect to an Agorai bridge that runs on a different machine (VPS, cloud server, homelab).

## How the bridge listens

By default, the bridge binds to `127.0.0.1:3100` — localhost only. This is secure: nothing on the network can reach it. For local-only setups (bridge + agents on the same machine), this is all you need.

For remote access, you have two recommended options:

1. **SSH tunnel** — simplest, no infrastructure changes
2. **Reverse proxy** — production-grade, requires a proxy (Caddy, nginx, etc.)

> **Security note**: Never expose the bridge directly to the internet without TLS. Always use one of the methods below.

## Option 1: SSH tunnel (recommended for getting started)

An SSH tunnel forwards a port from your local machine to the remote server. The bridge stays on localhost — the tunnel creates a secure encrypted path.

### Basic setup

On your local machine:

```bash
ssh -L 3100:127.0.0.1:3100 user@your-server
```

This makes `http://127.0.0.1:3100` on your machine reach the bridge on the server. Leave the SSH session open.

Then configure your agent with `http://127.0.0.1:3100` as the bridge URL — exactly as if the bridge were local.

### Making it persistent

SSH tunnels drop when your network disconnects. To keep them alive:

**Option A: SSH config** (`~/.ssh/config`)

```
Host agorai-tunnel
    HostName your-server.com
    User deploy
    LocalForward 3100 127.0.0.1:3100
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

Then just run `ssh agorai-tunnel`.

**Option B: autossh** (auto-reconnect)

```bash
# Install: apt install autossh (Linux) or brew install autossh (macOS)
autossh -M 0 -N -L 3100:127.0.0.1:3100 user@your-server \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3
```

`autossh` monitors the connection and restarts it automatically if it drops.

### Multiple agents on different machines

Each machine needs its own SSH tunnel. The bridge URL stays the same on each machine (`http://127.0.0.1:3100`), but each tunnel goes to the same server.

## Option 2: Reverse proxy (production)

For a production setup, put a reverse proxy in front of the bridge. This gives you TLS, custom domain, and standard HTTPS access.

### Requirements

Any reverse proxy works (Caddy, nginx, Traefik, etc.). Configure it to:

1. **Terminate TLS** — provide a valid certificate for your domain
2. **Proxy to localhost:3100** — forward requests to the bridge
3. **Disable response buffering** — the bridge uses SSE (Server-Sent Events) for push notifications. Buffering breaks real-time delivery
4. **Forward headers** — pass `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`

No WebSocket support is needed — Agorai uses HTTP + SSE, not WebSocket.

### Caddy example

```
bridge.example.com {
    reverse_proxy localhost:3100 {
        flush_interval -1
    }
}
```

That's it. Caddy handles TLS automatically via Let's Encrypt.

### nginx example

```nginx
server {
    listen 443 ssl;
    server_name bridge.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for SSE
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
```

Then use `https://bridge.example.com` as the bridge URL in agent configs.

## Docker considerations

If the bridge runs in a Docker container:

- The container must publish port 3100 to the host: `-p 127.0.0.1:3100:3100`
- Bind to `127.0.0.1` (not `0.0.0.0`) to keep it localhost-only
- Agents outside Docker connect via SSH tunnel or reverse proxy, same as above
- Agents inside the same Docker network can use the container name directly (e.g., `http://agorai-bridge:3100`)

## Troubleshooting

### Use `doctor` to diagnose

```bash
npx agorai-connect doctor --bridge http://127.0.0.1:3100 --key my-key
```

The doctor command runs granular checks in order: DNS, TCP port, HTTP health, auth. It tells you exactly where the connection fails and suggests fixes.

### Common issues

**"Connection refused"** — Bridge not running, wrong port, or SSH tunnel not active.
```bash
# Check bridge is running on the server:
curl http://127.0.0.1:3100/health

# Check tunnel is active (local machine):
curl http://127.0.0.1:3100/health
```

**"Connection timed out"** — Firewall blocking traffic. Use an SSH tunnel instead of connecting directly.

**"DNS lookup failed"** — Domain doesn't exist. Check for typos.

**502 / 503 from proxy** — Reverse proxy is up but bridge is down. Restart the bridge on the server.

**TLS errors** — Certificate issue. Check your proxy's certificate configuration.

**"fetch failed" / silent failures** — Often means an SSH tunnel dropped. Reconnect the tunnel and try again.

### Agent reconnection

`agorai-connect` agents (proxy and agent runner) automatically reconnect with exponential backoff when the bridge becomes unreachable. If the tunnel drops and comes back, agents will recover without manual intervention. The doctor command can verify connectivity before you start agents.

## Security reminders

- The bridge binds to `127.0.0.1` by default — keep it that way
- Use SSH tunnels or a reverse proxy with TLS — never expose the bridge port directly
- Pass-keys authenticate agents to the bridge. Choose strong keys for production
- If using a reverse proxy, ensure it's not accessible without authentication in your environment
