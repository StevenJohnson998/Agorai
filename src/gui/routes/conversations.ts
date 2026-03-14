/**
 * Conversation routes — view messages, send messages.
 */

import { Router } from "express";
import express from "express";
import ejs from "ejs";
import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { IStore } from "../../store/interfaces.js";
import type { IFileStore } from "../../store/file-store.js";
import type { Message, AttachmentMetadata } from "../../store/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const guiSrcDir = __dirname.includes("/dist/")
  ? __dirname.replace("/dist/gui/routes", "/src/gui")
  : resolve(__dirname, "..");
const messageTemplatePath = resolve(guiSrcDir, "views/partials/message.ejs");

type MessageWithAttachments = Message & { attachments?: AttachmentMetadata[] };

// Content types safe to serve inline (won't execute scripts in the browser)
const SAFE_INLINE_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
  "image/bmp", "image/tiff", "image/avif",
  "application/pdf",
  "text/plain", "text/csv",
  "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm",
  "video/mp4", "video/webm", "video/ogg",
]);

/** Strip path separators, null bytes, and control characters from a filename. */
function sanitizeFilename(raw: string): string {
  // Take only the basename (last segment after any / or \)
  let name = raw.replace(/^.*[/\\]/, "");
  // Remove null bytes and control characters
  name = name.replace(/[\x00-\x1f\x7f]/g, "");
  // Collapse to reasonable length
  name = name.slice(0, 255);
  return name || "attachment";
}

/** Validate a MIME content type: must match type/subtype pattern, no newlines or special chars. */
function sanitizeContentType(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (/^[a-z0-9][a-z0-9!#$&\-.^_+]*\/[a-z0-9][a-z0-9!#$&\-.^_+]*$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/** RFC 5987 encode a filename for Content-Disposition (handles unicode safely). */
function contentDisposition(mode: "inline" | "attachment", filename: string): string {
  // ASCII-safe subset for filename= parameter
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, '\\"');
  // UTF-8 encoded for filename*= parameter
  const utf8 = encodeURIComponent(filename).replace(/['()]/g, (c) => "%" + c.charCodeAt(0).toString(16));
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

async function enrichMessagesWithAttachments(store: IStore, messages: Message[]): Promise<MessageWithAttachments[]> {
  if (messages.length === 0) return [];
  const messageIds = messages.map((m) => m.id);
  const attachmentMap = await store.listAttachmentsByMessages(messageIds);
  return messages.map((m) => ({
    ...m,
    attachments: attachmentMap.get(m.id) || [],
  }));
}

export function createConversationRoutes(store: IStore, fileStore?: IFileStore, fileStoreConfig?: { maxFileSize: number; allowedTypes: string[] }) {
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

  // Toggle project access mode (visible ↔ hidden)
  router.post("/c/toggle-access-project/:projectId", async (req, res) => {
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

    const newMode = project.accessMode === "hidden" ? "visible" : "hidden";
    await store.setProjectAccessMode(projectId, newMode);
    const toast = newMode === "hidden" ? "Project+hidden" : "Project+visible";
    res.redirect(envPath + "/c/?toast=" + toast);
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
    // Creator auto-subscribed by store.createConversation()

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

  // Toggle conversation access mode (visible ↔ hidden)
  router.post("/c/:id/toggle-access", async (req, res) => {
    const user = req.user!;
    const bp = req.app.get("basePath") || "";
    const envPath = bp + "/test";
    const conversationId = req.params.id;

    const conversation = await store.getConversation(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found." });
    }

    const isAdmin = user.role === "admin" || user.role === "superadmin";
    if (!isAdmin && conversation.createdBy !== user.agentId) {
      return res.status(403).json({ error: "Not authorized." });
    }

    const newMode = conversation.accessMode === "hidden" ? "visible" : "hidden";
    await store.setConversationAccessMode(conversationId, newMode);
    const toast = newMode === "hidden" ? "Conversation+hidden" : "Conversation+visible";

    if (req.headers["hx-request"]) {
      return res.redirect(303, envPath + "/c/?toast=" + toast);
    }
    res.redirect(envPath + "/c/" + conversationId + "?toast=" + toast);
  });

  // Catch-up endpoint — fetch messages since a timestamp (for SSE reconnection)
  router.get("/c/:id/messages-since", async (req, res) => {
    const user = req.user!;
    const bp = req.app.get("basePath") || "";
    const conversationId = req.params.id;
    const since = req.query.since as string;

    if (!since) {
      return res.status(400).json({ error: "since parameter is required." });
    }

    const rawMessages = await store.getMessages(conversationId, user.agentId!, { since });

    // Filter out user's own messages (already rendered client-side)
    const otherMessages = rawMessages.filter((m) => m.fromAgent !== user.agentId);

    // Enrich with attachments
    const messagesWithAttachments = await enrichMessagesWithAttachments(store, otherMessages);

    // Get agents for rendering
    const agents = await store.listAgents();
    const agentMap = new Map(agents.map((a) => [a.id, a]));

    // Render each message to HTML
    const rendered = [];
    for (const message of messagesWithAttachments) {
      const html = await ejs.renderFile(messageTemplatePath, {
        message,
        agentMap,
        user,
        envPath: bp + "/test",
        basePath: bp,
      });
      rendered.push({ html: html.trim(), createdAt: message.createdAt });
    }

    res.json({ messages: rendered });
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

    // Get messages and enrich with attachments
    const rawMessages = await store.getMessages(conversationId, user.agentId!);
    const messages = await enrichMessagesWithAttachments(store, rawMessages);

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
      agents: agents.filter((a) => !rawSubscribers.some((s) => s.agentId === a.id) && (a.type === "human" || a.type === "claude-code" || a.type === "claude-desktop" || a.type === "internal" || a.type === "moderator" || a.capabilities.includes("chat"))),
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
      agents: agents.filter((a) => !rawSubscribers.some((s) => s.agentId === a.id) && (a.type === "human" || a.type === "claude-code" || a.type === "claude-desktop" || a.type === "internal" || a.type === "moderator" || a.capabilities.includes("chat"))),
      envPath,
      basePath: bp,
      layout: false,
    });
  });

  // Upload attachment (base64 JSON body)
  router.post("/c/:id/upload", express.json({ limit: "14mb" }), async (req, res) => {
    const user = req.user!;
    const conversationId = req.params.id;

    if (!fileStore) {
      return res.status(501).json({ error: "File attachments are not enabled." });
    }

    const { filename: rawFilename, content_type: rawContentType, data } = req.body;
    if (!rawFilename || !rawContentType || !data) {
      return res.status(400).json({ error: "filename, content_type, and data are required." });
    }

    // Sanitize filename — strip path traversal, control chars
    const filename = sanitizeFilename(String(rawFilename));

    // Validate and sanitize content type
    const contentType = sanitizeContentType(String(rawContentType));
    if (!contentType) {
      return res.status(400).json({ error: "Invalid content type format." });
    }

    // Decode base64
    let buffer: Buffer;
    try {
      buffer = Buffer.from(data, "base64");
    } catch {
      return res.status(400).json({ error: "Invalid base64 data." });
    }

    // Validate size
    const maxSize = fileStoreConfig?.maxFileSize ?? 10 * 1024 * 1024;
    if (buffer.length > maxSize) {
      return res.status(413).json({ error: `File too large. Maximum size: ${(maxSize / (1024 * 1024)).toFixed(0)} MB.` });
    }

    // Validate content type against allowlist
    const allowedTypes = fileStoreConfig?.allowedTypes ?? [];
    if (allowedTypes.length > 0 && !allowedTypes.includes(contentType)) {
      return res.status(400).json({ error: `Content type '${contentType}' is not allowed.` });
    }

    try {
      const id = randomUUID();
      const storageRef = await fileStore.save(conversationId, id, buffer);
      const attachment = await store.createAttachment({
        conversationId,
        filename,
        contentType,
        size: buffer.length,
        storageRef,
        createdBy: user.agentId!,
      });
      res.json({ id: attachment.id, filename: attachment.filename, contentType: attachment.contentType, size: attachment.size });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      res.status(500).json({ error: msg });
    }
  });

  // Serve attachment (inline for safe types, forced download for dangerous types like HTML)
  router.get("/c/:id/attachment/:aid", async (req, res) => {
    const conversationId = req.params.id;
    const attachmentId = req.params.aid;

    if (!fileStore) {
      return res.status(501).json({ error: "File attachments are not enabled." });
    }

    const attachment = await store.getAttachment(attachmentId);
    if (!attachment || attachment.conversationId !== conversationId) {
      return res.status(404).json({ error: "Attachment not found." });
    }

    try {
      const data = await fileStore.get(attachment.storageRef);
      // Only serve inline for known-safe content types; force download for anything else (prevents XSS via HTML/SVG)
      const isSafe = SAFE_INLINE_TYPES.has(attachment.contentType);
      const mode = isSafe ? "inline" : "attachment";
      const servedType = isSafe ? attachment.contentType : "application/octet-stream";
      res.setHeader("Content-Type", servedType);
      res.setHeader("Content-Disposition", contentDisposition(mode, attachment.filename));
      res.setHeader("Content-Length", data.length.toString());
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(data);
    } catch {
      res.status(404).json({ error: "Attachment file not found." });
    }
  });

  // Download attachment (force download)
  router.get("/c/:id/attachment/:aid/download", async (req, res) => {
    const conversationId = req.params.id;
    const attachmentId = req.params.aid;

    if (!fileStore) {
      return res.status(501).json({ error: "File attachments are not enabled." });
    }

    const attachment = await store.getAttachment(attachmentId);
    if (!attachment || attachment.conversationId !== conversationId) {
      return res.status(404).json({ error: "Attachment not found." });
    }

    try {
      const data = await fileStore.get(attachment.storageRef);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", contentDisposition("attachment", attachment.filename));
      res.setHeader("Content-Length", data.length.toString());
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(data);
    } catch {
      res.status(404).json({ error: "Attachment file not found." });
    }
  });

  // Send a message
  router.post("/c/:id/send", async (req, res) => {
    const user = req.user!;
    const bp = req.app.get("basePath") || "";
    const envPath = bp + "/test";
    const conversationId = req.params.id;
    const { content, type, visibility, attachment_ids } = req.body;

    const hasContent = content && content.trim();
    const hasAttachments = attachment_ids && typeof attachment_ids === "string" && attachment_ids.trim();
    if (!hasContent && !hasAttachments) {
      return res.status(400).json({ error: "Message content or attachments required." });
    }

    const message = await store.sendMessage({
      conversationId,
      fromAgent: user.agentId!,
      content: hasContent ? content.trim() : "📎",
      type: type || "message",
      visibility: visibility || undefined,
    });

    // Link pending attachments to this message
    if (attachment_ids && typeof attachment_ids === "string" && attachment_ids.trim()) {
      const ids = attachment_ids.split(",").map((id: string) => id.trim()).filter(Boolean);
      if (ids.length > 0) {
        await store.linkAttachmentsToMessage(ids, message.id, user.agentId!);
      }
    }

    // Fetch attachments for the message
    const attachments = await store.listAttachmentsByMessage(message.id);
    const messageWithAttachments: MessageWithAttachments = { ...message, attachments };

    // Return the message fragment for htmx
    const agents = await store.listAgents();
    const agentMap = new Map(agents.map((a) => [a.id, a]));

    res.render("partials/message", {
      message: messageWithAttachments,
      agentMap,
      user,
      envPath,
      basePath: bp,
      layout: false,
    });
  });

  return router;
}
