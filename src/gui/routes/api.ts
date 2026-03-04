/**
 * API routes — JSON endpoints for htmx.
 */

import { Router } from "express";
import type { IStore } from "../../store/interfaces.js";

export function createApiRoutes(store: IStore) {
  const router = Router();

  router.get("/api/agents", async (_req, res) => {
    const agents = await store.listAgents();
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const result = agents.map((a) => ({
      ...a,
      online: a.lastSeenAt > fiveMinAgo,
    }));
    res.json(result);
  });

  router.get("/api/status", async (req, res) => {
    const user = req.user!;
    const agents = await store.listAgents();
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const onlineAgents = agents.filter((a) => a.lastSeenAt > fiveMinAgo);
    const projects = await store.listProjects(user.agentId!);
    const unreadCount = await store.getUnreadCount(user.agentId!);

    res.json({
      agents: { total: agents.length, online: onlineAgents.length },
      projects: projects.length,
      unreadCount,
    });
  });

  router.get("/api/projects", async (req, res) => {
    const user = req.user!;
    const bp = req.app.get("basePath") || "";
    const envPath = bp + "/test";
    const projects = await store.listProjects(user.agentId!);

    const result = [];
    for (const project of projects) {
      const convs = await store.listConversations(project.id, user.agentId!);
      result.push({ ...project, conversations: convs });
    }

    res.render("partials/sidebar-projects", {
      projects: result,
      user,
      basePath: bp,
      envPath,
      layout: false,
    });
  });

  router.get("/api/projects/:id/conversations", async (req, res) => {
    const user = req.user!;
    const bp = req.app.get("basePath") || "";
    const envPath = bp + "/test";
    const convs = await store.listConversations(req.params.id, user.agentId!);

    res.render("partials/sidebar-conversations", {
      conversations: convs,
      user,
      basePath: bp,
      envPath,
      layout: false,
    });
  });

  router.patch("/api/settings/verbosity", async (req, res) => {
    const user = req.user!;
    const { verbosity } = req.body;

    if (!["concise", "normal", "detailed"].includes(verbosity)) {
      return res.status(400).json({ error: "Invalid verbosity level." });
    }

    await store.updateUserVerbosity(user.id, verbosity);

    const verbosityContent: Record<string, string> = {
      concise: "Respond concisely. Keep answers under 3 sentences unless the user asks for more detail. No preamble.",
      normal: "Respond with complete but concise answers. Use clear structure. Include relevant details without excess.",
      detailed: "Respond with exhaustive detail. Include examples, justifications, full code snippets. Explain reasoning step by step.",
    };

    try {
      await store.setSkill({
        scope: "bridge",
        title: "response-verbosity",
        summary: `Response verbosity: ${verbosity}`,
        instructions: "Always follow this verbosity guideline for all responses.",
        content: verbosityContent[verbosity],
        createdBy: user.agentId!,
      });
    } catch {
      // Non-critical
    }

    res.json({ ok: true, verbosity });
  });

  return router;
}
