/**
 * agorai-connect — public API for programmatic usage.
 */

export { runProxy, type ProxyOptions } from "./proxy.js";
export { runSetup, type SetupOptions, type SetupResult } from "./setup.js";
export { runUninstall, type UninstallOptions, type UninstallResult } from "./uninstall.js";
export { runAgent, type AgentOptions } from "./agent.js";
export { runDoctor, type DoctorOptions } from "./doctor.js";
export { McpClient, type McpClientOptions, type ToolCallResult, type SSENotification } from "./mcp-client.js";
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
  findClaudeCodeConfig,
  findAllClaudeConfigs,
  searchClaudeConfig,
  configCandidates,
  defaultConfigPath,
  claudeCodeConfigPath,
  resolveNodePath,
  saveInstallMeta,
  loadInstallMeta,
  removeInstallMeta,
  type Platform,
  type SetupTarget,
  type InstallMeta,
} from "./config-paths.js";
