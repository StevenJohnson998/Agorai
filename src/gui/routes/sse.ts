/**
 * SSE route — real-time message streaming via store.eventBus.
 */

import { Router } from "express";
import type { IStore } from "../../store/interfaces.js";
import type { MessageCreatedEvent } from "../../store/events.js";
import ejs from "ejs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve to src/ directory since tsc doesn't copy .ejs files to dist/
const guiSrcDir = __dirname.includes("/dist/")
  ? __dirname.replace("/dist/gui/routes", "/src/gui")
  : resolve(__dirname, "..");
const messageTemplatePath = resolve(guiSrcDir, "views/partials/message.ejs");

export function createSSERoutes(store: IStore) {
  const router = Router();

  router.get("/c/:id/stream", async (req, res) => {
    const user = req.user!;
    const conversationId = req.params.id;
    const bp = req.app.get("basePath") || "";

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx/caddy buffering
    res.flushHeaders();

    // Get agents for rendering
    const agents = await store.listAgents();
    const agentMap = new Map(agents.map((a) => [a.id, a]));

    const listener = async (event: MessageCreatedEvent) => {
      const message = event.message;
      // Only send messages for this conversation
      if (message.conversationId !== conversationId) return;

      // Skip messages sent by this user (already rendered client-side)
      if (message.fromAgent === user.agentId) return;

      try {
        // Refresh agent map for new agents
        if (!agentMap.has(message.fromAgent)) {
          const freshAgents = await store.listAgents();
          for (const a of freshAgents) agentMap.set(a.id, a);
        }

        // Fetch attachments for the message
        const attachments = await store.listAttachmentsByMessage(message.id);
        const messageWithAttachments = { ...message, attachments };

        const html = await ejs.renderFile(messageTemplatePath, {
          message: messageWithAttachments,
          agentMap,
          user,
          envPath: bp + "/test",
          basePath: bp,
        });

        // Send as SSE event — trim whitespace from EJS output
        const trimmed = html.trim();
        const data = trimmed.replace(/\n/g, "\ndata: ");
        res.write(`event: message\ndata: ${data}\n\n`);
        // Flush for proxy compatibility (Caddy, nginx)
        (res as any).flush?.();
      } catch (err) {
        // Log render errors for debugging
        console.error("[SSE] Render error:", (err as Error).message);
      }
    };

    // Subscribe to message events
    store.eventBus?.onMessage(listener);

    // Send keepalive every 15s (shorter interval for mobile/proxy compat)
    const keepalive = setInterval(() => {
      res.write(":keepalive\n\n");
      (res as any).flush?.();
    }, 15000);

    // Cleanup on disconnect
    req.on("close", () => {
      store.eventBus?.offMessage(listener);
      clearInterval(keepalive);
    });
  });

  return router;
}
