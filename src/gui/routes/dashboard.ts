/**
 * Dashboard route — main page after login.
 */

import { Router } from "express";
import type { IStore } from "../../store/interfaces.js";

export function createDashboardRoutes(_store: IStore) {
  const router = Router();

  // Redirect /test/ to /test/c/ (conversations list is the default view)
  router.get("/", (req, res) => {
    const bp = req.app.get("basePath") || "";
    res.redirect(bp + "/test/c/");
  });

  return router;
}
