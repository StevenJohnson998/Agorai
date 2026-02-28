/**
 * Authentication layer for the bridge HTTP server.
 *
 * v0.2: API key authentication via config.
 * v0.2.1: Salted HMAC-SHA-256 (optional salt in config).
 * Future: OAuth/JWT, external identity providers.
 */

import { createHash, createHmac } from "node:crypto";
import { createLogger } from "../logger.js";
import type { VisibilityLevel } from "../config.js";
import type { IStore } from "../store/interfaces.js";
import type { ApiKeyConfig } from "../config.js";

const log = createLogger("auth");

export interface AuthResult {
  authenticated: boolean;
  agentId?: string;
  agentName?: string;
  clearanceLevel?: VisibilityLevel;
  error?: string;
}

export interface IAuthProvider {
  authenticate(token: string): Promise<AuthResult>;
}

/**
 * Hash an API key. Uses HMAC-SHA-256 when salt is provided,
 * falls back to bare SHA-256 for backward compatibility.
 */
export function hashApiKey(key: string, salt?: string): string {
  if (salt) {
    return createHmac("sha256", salt).update(key).digest("hex");
  }
  return createHash("sha256").update(key).digest("hex");
}

/**
 * API key auth provider.
 *
 * Keys are defined in agorai.config.json under bridge.apiKeys.
 * On first auth, the agent is auto-registered in the store if absent.
 * When bridge.salt is set, uses HMAC-SHA-256 (resistant to rainbow tables).
 * Without salt, falls back to bare SHA-256 with a startup warning.
 */
export class ApiKeyAuthProvider implements IAuthProvider {
  private keyMap: Map<string, ApiKeyConfig>;
  private store: IStore;
  private salt?: string;

  constructor(apiKeys: ApiKeyConfig[], store: IStore, salt?: string) {
    this.store = store;
    this.salt = salt;
    this.keyMap = new Map();

    if (!salt) {
      log.warn("No bridge.salt configured — API key hashes are unsalted. Set bridge.salt in agorai.config.json for better security.");
    }

    for (const entry of apiKeys) {
      const hash = hashApiKey(entry.key, salt);
      this.keyMap.set(hash, entry);
    }
  }

  async authenticate(token: string): Promise<AuthResult> {
    if (!token) {
      return { authenticated: false, error: "Missing API key" };
    }

    const hash = hashApiKey(token, this.salt);
    const keyConfig = this.keyMap.get(hash);

    if (!keyConfig) {
      return { authenticated: false, error: "Invalid API key" };
    }

    // Auto-register or update agent in store
    const agent = await this.store.registerAgent({
      name: keyConfig.agent,
      type: keyConfig.type,
      capabilities: keyConfig.capabilities,
      clearanceLevel: keyConfig.clearanceLevel,
      apiKeyHash: hash,
    });

    await this.store.updateAgentLastSeen(agent.id);

    return {
      authenticated: true,
      agentId: agent.id,
      agentName: agent.name,
      clearanceLevel: agent.clearanceLevel,
    };
  }
}
