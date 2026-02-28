/**
 * agorai-connect — public API for programmatic usage.
 */

export { runProxy, type ProxyOptions } from "./proxy.js";
export { runSetup, type SetupOptions, type SetupResult } from "./setup.js";
export { runUninstall, type UninstallOptions, type UninstallResult } from "./uninstall.js";
export { runAgent, type AgentOptions } from "./agent.js";
export { McpClient, type McpClientOptions, type ToolCallResult } from "./mcp-client.js";
export { callModel, type ChatMessage, type ModelCallerOptions, type ModelResponse } from "./model-caller.js";
export { SessionExpiredError, BridgeUnreachableError } from "./errors.js";
export { Backoff } from "./backoff.js";
export {
  normalizeBridgeUrl,
  baseUrl,
  checkHealth,
  type HealthResult,
  setLogLevel,
  type LogLevel,
} from "./utils.js";
export {
  detectPlatform,
  findClaudeConfig,
  findAllClaudeConfigs,
  searchClaudeConfig,
  configCandidates,
  defaultConfigPath,
  resolveNodePath,
  type Platform,
} from "./config-paths.js";
