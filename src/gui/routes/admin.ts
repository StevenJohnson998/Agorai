/**
 * Admin routes — user management.
 */

import { Router } from "express";
import type { IStore } from "../../store/interfaces.js";

export function createAdminRoutes(store: IStore) {
  const router = Router();

  router.get("/admin", async (req, res) => {
    const user = req.user!;
    const bp = req.app.get("basePath") || "";
    const envPath = bp + "/test";

    const users = await store.listUsers();

    res.render("admin", {
      user,
      users,
      basePath: bp,
      envPath,
      title: "Admin",
    });
  });

  router.post("/admin/users/:id/approve", async (req, res) => {
    const bp = req.app.get("basePath") || "";
    const envPath = bp + "/test";
    await store.updateUserStatus(req.params.id, "approved", req.user!.id);

    if (req.headers["hx-request"]) {
      const users = await store.listUsers();
      return res.render("partials/admin-users-table", {
        user: req.user!,
        users,
        basePath: bp,
        envPath,
        layout: false,
      });
    }
    res.redirect(envPath + "/admin");
  });

  router.post("/admin/users/:id/reject", async (req, res) => {
    const bp = req.app.get("basePath") || "";
    const envPath = bp + "/test";
    await store.updateUserStatus(req.params.id, "rejected", req.user!.id);

    if (req.headers["hx-request"]) {
      const users = await store.listUsers();
      return res.render("partials/admin-users-table", {
        user: req.user!,
        users,
        basePath: bp,
        envPath,
        layout: false,
      });
    }
    res.redirect(envPath + "/admin");
  });

  router.post("/admin/users/:id/delete", async (req, res) => {
    const bp = req.app.get("basePath") || "";
    const envPath = bp + "/test";
    if (req.params.id === req.user!.id) {
      return res.status(400).json({ error: "Cannot delete yourself." });
    }
    await store.deleteUser(req.params.id);

    if (req.headers["hx-request"]) {
      const users = await store.listUsers();
      return res.render("partials/admin-users-table", {
        user: req.user!,
        users,
        basePath: bp,
        envPath,
        layout: false,
      });
    }
    res.redirect(envPath + "/admin");
  });

  return router;
}
