/**
 * Conversation routes — view messages, send messages.
 */

import { Router } from "express";
import type { IStore } from "../../store/interfaces.js";

export function createConversationRoutes(store: IStore) {
  const router = Router();

  // Conversations list — /test/c/
  router.get("/c/", async (req, res) => {
    const user = req.user!;
    const bp = req.app.get("basePath") || "";
    const envPath = bp + "/test";

    const agents = await store.listAgents();
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const onlineAgents = agents.filter((a) => a.lastSeenAt > fiveMinAgo);

    const projects = await store.listProjects(user.agentId!);
    const projectsWithConvs = [];
    const allConversations = [];
    for (const project of projects) {
      const convs = await store.listConversations(project.id, user.agentId!);
      projectsWithConvs.push({ ...project, conversations: convs });
      for (const conv of convs) {
        allConversations.push({ ...conv, projectName: project.name });
      }
    }

    const unreadCount = await store.getUnreadCount(user.agentId!);

    // htmx partial — return just the list panel
    if (req.headers["hx-request"]) {
      return res.render("conversations-list", {
        user,
        projects: projectsWithConvs,
        envPath,
        basePath: bp,
        layout: false,
      });
    }

    res.render("dashboard", {
      user,
      agents,
      onlineAgents,
      projects,
      conversations: allConversations,
      unreadCount,
      basePath: bp,
      envPath,
      title: "Conversations",
      activeConversation: null,
      activeView: "conversations-list",
      projectsWithConvs,
    });
  });

  // Create project
  router.post("/c/create-project", async (req, res) => {
    const user = req.user!;
    const bp = req.app.get("basePath") || "";
    const envPath = bp + "/test";
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Project name is required." });
    }

    await store.createProject({
      name: name.trim(),
      description: description?.trim() || undefined,
      createdBy: user.agentId!,
    });

    res.redirect(envPath + "/c/?toast=Project+created");
  });

  // Delete project
  router.post("/c/delete-project/:projectId", async (req, res) => {
    const user = req.user!;
    const bp = req.app.get("basePath") || "";
    const envPath = bp + "/test";
    const { projectId } = req.params;

    const project = await store.getProject(projectId, user.agentId!);
    if (!project) {
      return res.status(404).json({ error: "Project not found." });
    }

    const isAdmin = user.role === "admin" || user.role === "superadmin";
    if (!isAdmin && project.createdBy !== user.agentId) {
      return res.status(403).json({ error: "Not authorized." });
    }

    await store.deleteProject(projectId);
    res.redirect(envPath + "/c/?toast=Project+deleted");
  });

  // Rename project
  router.post("/c/rename-project/:projectId", async (req, res) => {
    const user = req.user!;
    const bp = req.app.get("basePath") || "";
    const envPath = bp + "/test";
    const { projectId } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Name is required." });
    }

    const project = await store.getProject(projectId, user.agentId!);
    if (!project) {
      return res.status(404).json({ error: "Project not found." });
    }

    const isAdmin = user.role === "admin" || user.role === "superadmin";
    if (!isAdmin && project.createdBy !== user.agentId) {
      return res.status(403).json({ error: "Not authorized." });
    }

    await store.renameProject(projectId, name.trim());
    res.redirect(envPath + "/c/?toast=Project+renamed");
  });

  // Create conversation
  router.post("/c/create-conversation", async (req, res) => {
    const user = req.user!;
    const bp = req.app.get("basePath") || "";
    const envPath = bp + "/test";
    const { projectId, title } = req.body;

    if (!projectId || !title || !title.trim()) {
      return res.status(400).json({ error: "Project and title are required." });
    }

    const conv = await store.createConversation({
      projectId,
      title: title.trim(),
      createdBy: user.agentId!,
    });

    // Auto-subscribe the creator
    await store.subscribe(conv.id, user.agentId!);

    res.redirect(envPath + "/c/" + conv.id);
  });

  // Delete conversation (soft-delete)
  router.post("/c/:id/delete", async (req, res) => {
    const user = req.user!;
    const bp = req.app.get("basePath") || "";
    const envPath = bp + "/test";
    const conversationId = req.params.id;

    const conversation = await store.getConversation(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found." });
    }

    // Only admin/superadmin or creator can delete
    const isAdmin = user.role === "admin" || user.role === "superadmin";
    if (!isAdmin && conversation.createdBy !== user.agentId) {
      return res.status(403).json({ error: "Not authorized." });
    }

    await store.deleteConversation(conversationId);
    res.redirect(envPath + "/c/?toast=Conversation+deleted");
  });

  // Rename conversation
  router.post("/c/:id/rename", async (req, res) => {
    const user = req.user!;
    const bp = req.app.get("basePath") || "";
    const envPath = bp + "/test";
    const conversationId = req.params.id;
    const { title } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required." });
    }

    const conversation = await store.getConversation(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found." });
    }

    // Only admin/superadmin or creator can rename
    const isAdmin = user.role === "admin" || user.role === "superadmin";
    if (!isAdmin && conversation.createdBy !== user.agentId) {
      return res.status(403).json({ error: "Not authorized." });
    }

    await store.renameConversation(conversationId, title.trim());

    // Return updated sidebar partial for htmx
    if (req.headers["hx-request"]) {
      return res.redirect(303, envPath + "/c/?toast=Conversation+renamed");
    }
    res.redirect(envPath + "/c/" + conversationId + "?toast=Conversation+renamed");
  });

  // View a conversation
  router.get("/c/:id", async (req, res) => {
    const user = req.user!;
    const bp = req.app.get("basePath") || "";
    const envPath = bp + "/test";
    const conversationId = req.params.id;

    const conversation = await store.getConversation(conversationId);
    if (!conversation) {
      return res.status(404).render("error", {
        user,
        title: "Not Found",
        message: "Conversation not found.",
        basePath: bp,
      });
    }

    // Get messages
    const messages = await store.getMessages(conversationId, user.agentId!);

    // Get agents for display names
    const agents = await store.listAgents();
    const agentMap = new Map(agents.map((a) => [a.id, a]));

    // Mark messages as read
    const unreadIds = messages.map((m) => m.id);
    if (unreadIds.length > 0) {
      await store.markRead(unreadIds, user.agentId!);
    }

    // Get project info
    const project = await store.getProject(conversation.projectId, user.agentId!);

    // Sidebar data
    const projects = await store.listProjects(user.agentId!);
    const allConversations = [];
    for (const p of projects) {
      const convs = await store.listConversations(p.id, user.agentId!);
      for (const conv of convs) {
        allConversations.push({ ...conv, projectName: p.name });
      }
    }

    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const onlineAgents = agents.filter((a) => a.lastSeenAt > fiveMinAgo);
    const rawSubscribers = await store.getSubscribers(conversationId);
    // Enrich subscribers with agent info
    const subscribers = rawSubscribers.map((s) => {
      const agent = agentMap.get(s.agentId);
      return {
        ...s,
        name: agent?.name || s.agentId,
        type: agent?.type || "unknown",
        online: agent ? agent.lastSeenAt > fiveMinAgo : false,
        agentStatus: agent?.status || "offline",
      };
    });
    const unreadCount = await store.getUnreadCount(user.agentId!);

    // htmx partial request — return just the conversation panel
    if (req.headers["hx-request"]) {
      return res.render("conversation", {
        user,
        conversation,
        project,
        messages,
        agentMap,
        subscribers,
        agents,
        onlineAgents,
        envPath,
        basePath: bp,
        title: conversation.title,
        layout: false,
      });
    }

    res.render("dashboard", {
      user,
      agents,
      onlineAgents,
      projects,
      conversations: allConversations,
      unreadCount,
      basePath: bp,
      envPath,
      title: conversation.title,
      activeConversation: {
        conversation,
        project,
        messages,
        agentMap,
        subscribers,
      },
    });
  });

  // Add participant to conversation
  router.post("/c/:id/add-participant", async (req, res) => {
    const user = req.user!;
    const bp = req.app.get("basePath") || "";
    const envPath = bp + "/test";
    const conversationId = req.params.id;
    const { agentId } = req.body;

    if (!agentId) {
      return res.status(400).json({ error: "Agent ID is required." });
    }

    await store.subscribe(conversationId, agentId);

    // Return updated participants partial
    const agents = await store.listAgents();
    const agentMap = new Map(agents.map((a) => [a.id, a]));
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const rawSubscribers = await store.getSubscribers(conversationId);
    const subscribers = rawSubscribers.map((s) => {
      const agent = agentMap.get(s.agentId);
      return {
        ...s,
        name: agent?.name || s.agentId,
        type: agent?.type || "unknown",
        online: agent ? agent.lastSeenAt > fiveMinAgo : false,
        agentStatus: agent?.status || "offline",
      };
    });

    res.render("partials/participants", {
      user,
      conversation: { id: conversationId },
      subscribers,
      agents: agents.filter((a) => !rawSubscribers.some((s) => s.agentId === a.id)),
      envPath,
      basePath: bp,
      layout: false,
    });
  });

  // Remove participant from conversation
  router.post("/c/:id/remove-participant", async (req, res) => {
    const user = req.user!;
    const bp = req.app.get("basePath") || "";
    const envPath = bp + "/test";
    const conversationId = req.params.id;
    const { agentId } = req.body;

    if (!agentId) {
      return res.status(400).json({ error: "Agent ID is required." });
    }

    await store.unsubscribe(conversationId, agentId);

    // Return updated participants partial
    const agents = await store.listAgents();
    const agentMap = new Map(agents.map((a) => [a.id, a]));
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const rawSubscribers = await store.getSubscribers(conversationId);
    const subscribers = rawSubscribers.map((s) => {
      const agent = agentMap.get(s.agentId);
      return {
        ...s,
        name: agent?.name || s.agentId,
        type: agent?.type || "unknown",
        online: agent ? agent.lastSeenAt > fiveMinAgo : false,
        agentStatus: agent?.status || "offline",
      };
    });

    res.render("partials/participants", {
      user,
      conversation: { id: conversationId },
      subscribers,
      agents: agents.filter((a) => !rawSubscribers.some((s) => s.agentId === a.id)),
      envPath,
      basePath: bp,
      layout: false,
    });
  });

  // Send a message
  router.post("/c/:id/send", async (req, res) => {
    const user = req.user!;
    const bp = req.app.get("basePath") || "";
    const envPath = bp + "/test";
    const conversationId = req.params.id;
    const { content, type, visibility } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Message content is required." });
    }

    const message = await store.sendMessage({
      conversationId,
      fromAgent: user.agentId!,
      content: content.trim(),
      type: type || "message",
      visibility: visibility || undefined,
    });

    // Return the message fragment for htmx
    const agents = await store.listAgents();
    const agentMap = new Map(agents.map((a) => [a.id, a]));

    res.render("partials/message", {
      message,
      agentMap,
      user,
      envPath,
      basePath: bp,
      layout: false,
    });
  });

  return router;
}
