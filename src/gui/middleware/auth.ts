/**
 * Authentication middleware for the GUI.
 * Session-based auth with httpOnly cookies.
 */

import type { Request, Response, NextFunction } from "express";
import type { IStore } from "../../store/interfaces.js";
import type { User } from "../../store/types.js";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      sessionId?: string;
    }
  }
}

const SESSION_COOKIE = "agorai_sid";

export function createAuthMiddleware(store: IStore) {
  /**
   * Loads user from session cookie if present.
   * Does NOT reject — just populates req.user or leaves it undefined.
   */
  async function loadSession(req: Request, _res: Response, next: NextFunction) {
    const sid = req.cookies?.[SESSION_COOKIE];
    if (!sid) return next();

    const session = await store.getSession(sid);
    if (!session) return next();

    if (session.user.status !== "approved") return next();

    req.user = session.user;
    req.sessionId = sid;

    // Update activity (non-blocking)
    store.updateSessionActivity(sid).catch(() => {});

    next();
  }

  /**
   * Requires authenticated + approved user. Redirects to login otherwise.
   */
  function requireAuth(req: Request, res: Response, next: NextFunction) {
    if (!req.user) {
      const bp = req.app.get("basePath") || "";
      return res.redirect(bp + "/login");
    }
    next();
  }

  /**
   * Requires admin or superadmin role.
   */
  function requireAdmin(req: Request, res: Response, next: NextFunction) {
    if (!req.user) {
      const bp = req.app.get("basePath") || "";
      return res.redirect(bp + "/login");
    }
    if (req.user.role !== "admin" && req.user.role !== "superadmin") {
      const bp = req.app.get("basePath") || "";
      return res.status(403).render("error", {
        user: req.user,
        title: "Forbidden",
        message: "Admin access required.",
        basePath: bp,
      });
    }
    next();
  }

  /**
   * For conversation routes (/c/:id) — requires user to be subscribed or admin.
   * Only applies to routes that have :id param matching a conversation.
   */
  async function requireConversationAccess(req: Request, res: Response, next: NextFunction) {
    // Only check routes with /c/:id pattern (skip /c/, /c/create-*)
    const match = req.path.match(/^\/c\/([^/]+)/);
    if (!match) return next();

    const conversationId = match[1];

    // Skip non-conversation routes under /c/
    if (conversationId.startsWith("create-")) return next();

    const user = req.user!;

    // Admins can access everything
    if (user.role === "admin" || user.role === "superadmin") return next();

    // Check subscription
    const subscribed = await store.isSubscribed(conversationId, user.agentId!);
    if (subscribed) return next();

    const bp = req.app.get("basePath") || "";
    return res.status(403).render("error", {
      user,
      title: "Access Denied",
      message: "You are not subscribed to this conversation.",
      basePath: bp,
    });
  }

  return { loadSession, requireAuth, requireAdmin, requireConversationAccess, SESSION_COOKIE };
}
