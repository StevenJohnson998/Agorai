/**
 * GUI Express server factory.
 *
 * Creates an Express app serving the Agorai web interface.
 * Shares the same SQLiteStore as the bridge (no HTTP round-trip).
 *
 * Route structure:
 *   /agorai/              — Landing page (public)
 *   /agorai/login         — Login with environment picker (public)
 *   /agorai/register      — Registration (public)
 *   /agorai/test/         — Dashboard (auth required)
 *   /agorai/test/c/:id    — Conversation (auth + subscribed/admin)
 *   /agorai/test/admin    — Admin panel (admin/superadmin)
 *   /agorai/test/api/*    — API endpoints (auth required)
 */

import express from "express";
import cookieParser from "cookie-parser";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { IStore } from "../store/interfaces.js";
import type { IFileStore } from "../store/file-store.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createDashboardRoutes } from "./routes/dashboard.js";
import { createConversationRoutes } from "./routes/conversations.js";
import { createSSERoutes } from "./routes/sse.js";
import { createAdminRoutes } from "./routes/admin.js";
import { createApiRoutes } from "./routes/api.js";
import type { Server } from "node:http";
import bcrypt from "bcrypt";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve paths to src/gui/ (EJS and CSS are not copied by tsc to dist/)
const guiSrcDir = __dirname.includes("/dist/")
  ? __dirname.replace("/dist/gui", "/src/gui")
  : __dirname;

export interface GuiConfig {
  port: number;
  host: string;
  basePath: string; // e.g. "/agorai" — Caddy strips this prefix before proxying
  defaultAdmin?: {
    email: string;
    name: string;
    password?: string;
  };
  fileStore?: IFileStore;
  fileStoreConfig?: { maxFileSize: number; allowedTypes: string[] };
}

export async function createGuiServer(store: IStore, config: GuiConfig): Promise<{ app: express.Express; server: Server }> {
  const app = express();
  const bp = config.basePath.replace(/\/$/, "");
  app.set("basePath", bp);

  // Trust proxy (behind Caddy)
  app.set("trust proxy", 1);

  // View engine
  app.set("view engine", "ejs");
  app.set("views", resolve(guiSrcDir, "views"));

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });

  // Static files
  app.use(bp + "/static", express.static(resolve(guiSrcDir, "public")));

  // Auth middleware
  const { loadSession, requireAuth, requireAdmin, requireConversationAccess, SESSION_COOKIE } = createAuthMiddleware(store);
  app.use(loadSession);

  // Ensure default admin exists on first start
  await ensureDefaultAdmin(store, config);

  // Clean expired sessions periodically
  setInterval(() => store.cleanExpiredSessions().catch(() => {}), 60 * 60 * 1000);

  // --- Public routes ---

  // Landing page
  app.get(bp + "/", (_req, res) => {
    res.render("landing", { basePath: bp });
  });

  // Auth routes (login, register, logout)
  app.use(bp, createAuthRoutes(store, SESSION_COOKIE));

  // --- Protected routes (under /test/) ---
  const envPrefix = bp + "/test";

  app.use(envPrefix, requireAuth, createDashboardRoutes(store));
  app.use(envPrefix, requireAuth, requireConversationAccess, createConversationRoutes(store, config.fileStore, config.fileStoreConfig));
  app.use(envPrefix, requireAuth, requireConversationAccess, createSSERoutes(store));
  app.use(envPrefix, requireAuth, requireAdmin, createAdminRoutes(store));
  app.use(envPrefix, requireAuth, createApiRoutes(store));

  // Error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[GUI] Error:", err.message);
    res.status(500).render("error", {
      user: null,
      title: "Error",
      message: "An unexpected error occurred.",
      basePath: bp,
    });
  });

  // Start server
  const server = app.listen(config.port, config.host, () => {
    console.log(`  GUI:      http://${config.host}:${config.port}${bp}/`);
  });

  return { app, server };
}

async function ensureDefaultAdmin(store: IStore, config: GuiConfig): Promise<void> {
  if (!config.defaultAdmin) return;

  const users = await store.listUsers();
  if (users.length > 0) return;

  const password = config.defaultAdmin.password || process.env.AGORAI_ADMIN_PASSWORD;
  if (!password) {
    console.log("  [GUI] No users in DB. Set AGORAI_ADMIN_PASSWORD or gui.defaultAdmin.password to auto-create admin.");
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await store.createUser({
    email: config.defaultAdmin.email,
    passwordHash,
    name: config.defaultAdmin.name,
    role: "superadmin",
    status: "approved",
  });

  console.log(`  [GUI] Default admin created: ${config.defaultAdmin.email}`);
}
