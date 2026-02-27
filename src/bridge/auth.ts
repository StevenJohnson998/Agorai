/**
 * Authentication layer for the bridge HTTP server.
 *
 * v0.2: API key authentication via config.
 * Future: OAuth/JWT, external identity providers.
 */

import { createHash } from "node:crypto";
import type { VisibilityLevel } from "../config.js";
import type { IStore } from "../store/interfaces.js";
import type { ApiKeyConfig } from "../config.js";

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

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * API key auth provider.
 *
 * Keys are defined in agorai.config.json under bridge.apiKeys.
 * On first auth, the agent is auto-registered in the store if absent.
 * Comparison uses SHA-256 hashes — keys are never stored in cleartext.
 */
export class ApiKeyAuthProvider implements IAuthProvider {
  private keyMap: Map<string, ApiKeyConfig>;
  private store: IStore;

  constructor(apiKeys: ApiKeyConfig[], store: IStore) {
    this.store = store;
    this.keyMap = new Map();
    for (const entry of apiKeys) {
      const hash = hashApiKey(entry.key);
      this.keyMap.set(hash, entry);
    }
  }

  async authenticate(token: string): Promise<AuthResult> {
    if (!token) {
      return { authenticated: false, error: "Missing API key" };
    }

    const hash = hashApiKey(token);
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
