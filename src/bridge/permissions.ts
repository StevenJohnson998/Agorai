/**
 * Permission layer (stub for v0.2).
 *
 * v0.2: AllowAllPermissions — always returns true.
 * v0.3: RBAC per project — matrix of agent × resource × action.
 */

export interface IPermissionProvider {
  canAccess(agentId: string, resource: string, action: string): Promise<boolean>;
}

export class AllowAllPermissions implements IPermissionProvider {
  async canAccess(_agentId: string, _resource: string, _action: string): Promise<boolean> {
    return true;
  }
}
