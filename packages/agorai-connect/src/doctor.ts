/**
 * Enhanced doctor command — granular network diagnostics for bridge connectivity.
 *
 * Checks (in order):
 * 1. Node.js version (>= 18)
 * 2. URL validation + remote/scheme warnings
 * 3. DNS resolution (node:dns)
 * 4. TCP port reachability (node:net)
 * 5. HTTP health endpoint
 * 6. Auth (MCP session)
 * 7. Model endpoint (optional)
 * 8. Actionable summary
 *
 * Zero new dependencies — uses node:dns, node:net, node:url built-ins.
 */

import { lookup } from "node:dns/promises";
import { connect as tcpConnect, type Socket } from "node:net";

export interface DoctorOptions {
  bridgeUrl: string;
  passKey: string;
  model?: string;
  endpoint?: string;
  apiKey?: string;
}

interface CheckState {
  ok: boolean;
  failedAt?: string;
  suggestions: string[];
  isRemote: boolean;
  isPlainHttp: boolean;
}

const pass = (msg: string) => console.log(`  [PASS] ${msg}`);
const fail = (msg: string) => console.log(`  [FAIL] ${msg}`);
const warn = (msg: string) => console.log(`  [WARN] ${msg}`);
const info = (msg: string) => console.log(`  [INFO] ${msg}`);

function isLocalhostUrl(url: URL): boolean {
  const h = url.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
}

/** Strip userinfo (user:pass@) from a URL before displaying it. */
function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
    }
    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * Check TCP port reachability with a timeout.
 * Resolves true if connection established, false on error/timeout.
 */
function checkTcpPort(host: string, port: number, timeoutMs: number): Promise<{ ok: boolean; code?: string }> {
  return new Promise((resolve) => {
    let socket: Socket | undefined;
    const timer = setTimeout(() => {
      socket?.destroy();
      resolve({ ok: false, code: "ETIMEDOUT" });
    }, timeoutMs);

    socket = tcpConnect(port, host, () => {
      clearTimeout(timer);
      socket!.destroy();
      resolve({ ok: true });
    });

    socket.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      socket!.destroy();
      resolve({ ok: false, code: err.code });
    });
  });
}

export async function runDoctor(options: DoctorOptions): Promise<void> {
  const state: CheckState = {
    ok: true,
    suggestions: [],
    isRemote: false,
    isPlainHttp: false,
  };

  const markFail = (step: string) => {
    state.ok = false;
    if (!state.failedAt) state.failedAt = step;
  };

  console.log("\nagorai-connect doctor\n");

  // 1. Node.js version
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split(".")[0], 10);
  if (major >= 18) {
    pass(`Node.js ${nodeVersion} (>= 18 required)`);
  } else {
    fail(`Node.js ${nodeVersion} — version 18+ required`);
    markFail("node");
    state.suggestions.push("Upgrade Node.js to v18 or later: https://nodejs.org/");
  }

  // 2. URL validation
  let parsed: URL;
  try {
    parsed = new URL(options.bridgeUrl);
  } catch {
    fail(`Invalid URL: ${options.bridgeUrl}`);
    markFail("url");
    state.suggestions.push("Use a valid URL, e.g. http://127.0.0.1:3100 or https://bridge.example.com");
    printSummary(state);
    return;
  }

  const isLocal = isLocalhostUrl(parsed);
  state.isRemote = !isLocal;
  state.isPlainHttp = parsed.protocol === "http:";

  if (parsed.username || parsed.password) {
    warn("URL contains credentials — they have been stripped from output for safety.");
    parsed.username = "";
    parsed.password = "";
  }

  pass(`URL valid: ${sanitizeUrl(parsed.href)}`);

  if (state.isRemote && state.isPlainHttp) {
    warn("Unencrypted HTTP to a remote bridge. Use HTTPS (reverse proxy) or an SSH tunnel.");
    state.suggestions.push("Switch to HTTPS via a reverse proxy, or use an SSH tunnel: ssh -L 3100:127.0.0.1:3100 user@server");
  }

  if (state.isRemote) {
    info("Remote bridge detected. Checking network path...");
  }

  // 3. DNS resolution (skip for IP addresses and localhost)
  const hostname = parsed.hostname;
  const isIP = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
  let resolvedIP = hostname;

  if (!isIP && hostname !== "localhost") {
    try {
      const result = await lookup(hostname);
      resolvedIP = result.address;
      pass(`DNS resolves ${hostname} → ${resolvedIP}`);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      fail(`DNS lookup failed for ${hostname} (${code ?? "unknown"})`);
      markFail("dns");
      if (code === "ENOTFOUND") {
        state.suggestions.push(`Domain "${hostname}" does not exist. Check for typos.`);
      } else {
        state.suggestions.push(`DNS resolution failed. Check your network connection and DNS settings.`);
      }
      printSummary(state);
      return;
    }
  }

  // 4. TCP port check
  const port = parseInt(parsed.port, 10) || (parsed.protocol === "https:" ? 443 : 80);
  const tcp = await checkTcpPort(resolvedIP === "localhost" ? "127.0.0.1" : resolvedIP, port, 5000);

  if (tcp.ok) {
    pass(`TCP port ${port} reachable on ${hostname}`);
  } else {
    if (tcp.code === "ECONNREFUSED") {
      fail(`TCP port ${port} refused on ${hostname} — bridge not running or wrong port`);
      state.suggestions.push("Is the bridge running? Start it with: npx agorai serve");
      state.suggestions.push(`Check that the bridge is configured to listen on port ${port}`);
    } else if (tcp.code === "ETIMEDOUT") {
      fail(`TCP port ${port} timed out on ${hostname} — firewall or network issue`);
      state.suggestions.push("A firewall may be silently dropping packets.");
      if (state.isRemote) {
        state.suggestions.push("If the bridge is on a remote server, use an SSH tunnel instead of connecting directly:");
        state.suggestions.push("  ssh -L 3100:127.0.0.1:3100 user@server");
        state.suggestions.push("Then use http://127.0.0.1:3100 as the bridge URL.");
      }
    } else {
      fail(`TCP port ${port} unreachable on ${hostname} (${tcp.code ?? "unknown error"})`);
      state.suggestions.push("Check that the bridge is running and the host/port are correct.");
    }
    markFail("tcp");
    printSummary(state);
    return;
  }

  // 5. HTTP health check — strip credentials from URL before making requests
  const safeBaseUrl = new URL(options.bridgeUrl);
  safeBaseUrl.username = "";
  safeBaseUrl.password = "";
  const healthUrl = new URL("/health", safeBaseUrl.href).href;
  let bridgeVersion: string | undefined;
  try {
    const resp = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const data = await resp.json() as { version?: string };
      bridgeVersion = data.version;
      pass(`Bridge health OK at ${sanitizeUrl(healthUrl)} (v${bridgeVersion ?? "?"})`);
    } else if (resp.status === 502 || resp.status === 503) {
      fail(`Bridge health returned HTTP ${resp.status} — proxy is up but bridge may be down`);
      markFail("health");
      state.suggestions.push("Your reverse proxy is reachable but the bridge behind it isn't responding.");
      state.suggestions.push("Check that the bridge process is running on the server.");
    } else {
      fail(`Bridge health returned HTTP ${resp.status}`);
      markFail("health");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("certificate") || msg.includes("SSL") || msg.includes("TLS")) {
      fail(`TLS error connecting to ${sanitizeUrl(healthUrl)} — ${msg}`);
      state.suggestions.push("The server's TLS certificate may be invalid or self-signed.");
      state.suggestions.push("If using a reverse proxy, check its certificate configuration.");
    } else if (msg.includes("redirect")) {
      fail(`Unexpected redirect from ${sanitizeUrl(healthUrl)} — ${msg}`);
      state.suggestions.push("The bridge URL may be behind a proxy that redirects. Check the URL.");
    } else {
      fail(`Bridge unreachable at ${sanitizeUrl(healthUrl)} — ${msg}`);
    }
    markFail("health");
    printSummary(state);
    return;
  }

  // 6. Auth check — MCP session
  try {
    const { McpClient } = await import("./mcp-client.js");
    const client = new McpClient({ bridgeUrl: safeBaseUrl.href, passKey: options.passKey });
    const initResult = await client.initialize();
    const srvName = (initResult.serverInfo as Record<string, unknown>).name ?? "?";
    const srvVersion = (initResult.serverInfo as Record<string, unknown>).version ?? "?";
    pass(`Auth OK — session established (server: ${srvName} v${srvVersion})`);

    // 6b. Bridge status
    try {
      const result = await client.callTool("get_status", {});
      const text = result.content?.[0]?.text;
      if (text) {
        const status = JSON.parse(text);
        pass(`Status: ${status.projects} project(s), ${status.agents?.online ?? "?"} agent(s) online, ${status.unread_messages} unread`);
      }
    } catch {
      info("Could not fetch bridge status (non-critical)");
    }

    await client.close();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`Auth failed — ${msg}`);
    markFail("auth");
    if (msg.includes("401") || msg.includes("Unauthorized") || msg.includes("invalid")) {
      state.suggestions.push("Check that the pass-key matches one defined in the bridge's agorai.config.json.");
    } else {
      state.suggestions.push("The bridge is reachable but authentication failed. Verify your pass-key.");
    }
  }

  // 7. Model endpoint (optional)
  if (options.model && options.endpoint) {
    await checkModelEndpoint(options, state, markFail);
  } else if (options.model || options.endpoint) {
    info("Both --model and --endpoint needed for model check (skipping)");
  }

  printSummary(state);
}

async function checkModelEndpoint(
  options: DoctorOptions,
  state: CheckState,
  markFail: (step: string) => void,
): Promise<void> {
  const endpoint = options.endpoint!;
  const model = options.model!;

  const modelsUrl = new URL(
    endpoint.includes("/v1") ? "/v1/models" : "/api/tags",
    endpoint,
  ).href;

  try {
    const headers: Record<string, string> = {};
    if (options.apiKey) headers["Authorization"] = `Bearer ${options.apiKey}`;
    const resp = await fetch(modelsUrl, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      pass(`Model endpoint reachable at ${endpoint}`);
    } else {
      fail(`Model endpoint returned HTTP ${resp.status} at ${modelsUrl}`);
      markFail("model");
      return;
    }
  } catch (err) {
    fail(`Model endpoint unreachable at ${endpoint} — ${err instanceof Error ? err.message : err}`);
    markFail("model");
    return;
  }

  // Quick model call test
  if (state.ok && options.apiKey !== undefined) {
    try {
      const { callModel } = await import("./model-caller.js");
      const response = await callModel(
        [{ role: "user", content: "Say 'hello' in one word." }],
        { model, endpoint, apiKey: options.apiKey, timeoutMs: 30_000 },
      );
      if (response && response.content.length > 0) {
        pass(`Model ${model} responds ("${response.content.slice(0, 50).trim()}")`);
      } else {
        fail(`Model ${model} returned empty response`);
        markFail("model-call");
      }
    } catch (err) {
      fail(`Model ${model} call failed — ${err instanceof Error ? err.message : err}`);
      markFail("model-call");
    }
  }
}

function printSummary(state: CheckState): void {
  console.log("");

  if (state.ok && state.suggestions.length === 0) {
    console.log("All checks passed.");
    return;
  }

  if (state.ok && state.suggestions.length > 0) {
    // Passed but with warnings
    console.log("All checks passed, but review the warnings above.");
    console.log("");
    for (const s of state.suggestions) {
      console.log(`  → ${s}`);
    }
    return;
  }

  // Failed
  console.log("Some checks failed. Suggestions:");
  console.log("");
  for (const s of state.suggestions) {
    console.log(`  → ${s}`);
  }

  if (state.isRemote && state.failedAt && ["tcp", "dns", "health"].includes(state.failedAt)) {
    console.log("");
    console.log("Tip: For remote bridges, the recommended approach is an SSH tunnel:");
    console.log("  ssh -L 3100:127.0.0.1:3100 user@your-server");
    console.log("  Then use http://127.0.0.1:3100 as the bridge URL.");
    console.log("");
    console.log("See: https://github.com/StevenJohnson998/Agorai/blob/main/docs/networking.md");
  }

  process.exit(1);
}
