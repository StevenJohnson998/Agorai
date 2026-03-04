/**
 * Attachment bridge tool integration tests — upload, send_message with
 * attachment_ids, get_messages includes metadata, get_attachment returns
 * content, delete respects ownership, size limit enforcement.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStore } from "../store/sqlite.js";
import { createBridgeMcpServer } from "../bridge/server.js";
import { LocalFileStore } from "../store/file-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../config.js";

let store: SqliteStore;
let fileStore: LocalFileStore;
let tmpDir: string;
let agentId: string;
let agentId2: string;
let conversationId: string;

/** Call an MCP tool and parse JSON response */
async function callTool(
  server: ReturnType<typeof createBridgeMcpServer>,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: { conversation_id?: string; [k: string]: unknown }, extra: unknown) => Promise<{ content: { text: string }[] }> }> })._registeredTools;
  const tool = tools[toolName];
  if (!tool) throw new Error(`Tool ${toolName} not found`);
  const result = await tool.handler(args as Record<string, unknown> & { conversation_id?: string }, {});
  return JSON.parse(result.content[0].text);
}

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-bridge-attach-test-"));
  store = new SqliteStore(join(tmpDir, "test.db"));
  await store.initialize();
  fileStore = new LocalFileStore(join(tmpDir, "attachments"));
  await fileStore.initialize();

  const agent1 = await store.registerAgent({
    name: "agent-a",
    type: "test",
    capabilities: [],
    clearanceLevel: "team",
    apiKeyHash: "hash-a",
  });
  agentId = agent1.id;

  const agent2 = await store.registerAgent({
    name: "agent-b",
    type: "test",
    capabilities: [],
    clearanceLevel: "team",
    apiKeyHash: "hash-b",
  });
  agentId2 = agent2.id;

  const project = await store.createProject({
    name: "test-project",
    createdBy: agentId,
  });
  await store.addMember(project.id, agentId2);

  const conv = await store.createConversation({
    projectId: project.id,
    title: "test-conv",
    createdBy: agentId,
  });
  conversationId = conv.id;

  await store.subscribe(conversationId, agentId);
  await store.subscribe(conversationId, agentId2);
});

afterEach(async () => {
  await store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function createServer(forAgentId: string) {
  const config = loadConfig();
  // Override fileStore config for tests
  config.fileStore = {
    type: "local" as const,
    basePath: join(tmpDir, "attachments"),
    maxFileSize: 1024, // 1KB for testing
    maxPerConversation: 10240,
    allowedTypes: [],
  };
  return createBridgeMcpServer(store, forAgentId, ["all"], fileStore, config);
}

describe("upload_attachment", () => {
  it("uploads a file and returns metadata", async () => {
    const server = createServer(agentId);
    const data = Buffer.from("hello world").toString("base64");
    const result = await callTool(server, "upload_attachment", {
      conversation_id: conversationId,
      filename: "test.txt",
      content_type: "text/plain",
      data,
    }) as Record<string, unknown>;

    expect(result.id).toBeTruthy();
    expect(result.filename).toBe("test.txt");
    expect(result.contentType).toBe("text/plain");
    expect(result.size).toBe(11); // "hello world" = 11 bytes
    expect(result.messageId).toBeNull();
    expect(result).not.toHaveProperty("storageRef");
  });

  it("rejects files exceeding maxFileSize", async () => {
    const server = createServer(agentId);
    // Create data > 1KB (our test limit)
    const data = Buffer.alloc(2048, "x").toString("base64");
    const result = await callTool(server, "upload_attachment", {
      conversation_id: conversationId,
      filename: "big.bin",
      content_type: "application/octet-stream",
      data,
    }) as Record<string, unknown>;

    expect(result.error).toContain("File too large");
  });

  it("rejects when not subscribed", async () => {
    const server = createServer(agentId);
    const result = await callTool(server, "upload_attachment", {
      conversation_id: "nonexistent-conv",
      filename: "test.txt",
      content_type: "text/plain",
      data: Buffer.from("x").toString("base64"),
    }) as Record<string, unknown>;

    expect(result.error).toContain("Not found");
  });
});

describe("get_attachment", () => {
  it("downloads attachment content as base64", async () => {
    const server = createServer(agentId);
    const originalData = "file content here";
    const upload = await callTool(server, "upload_attachment", {
      conversation_id: conversationId,
      filename: "doc.txt",
      content_type: "text/plain",
      data: Buffer.from(originalData).toString("base64"),
    }) as Record<string, unknown>;

    const download = await callTool(server, "get_attachment", {
      attachment_id: upload.id,
    }) as Record<string, unknown>;

    expect(download.filename).toBe("doc.txt");
    expect(download.content_type).toBe("text/plain");
    const decoded = Buffer.from(download.data as string, "base64").toString();
    expect(decoded).toBe(originalData);
  });

  it("allows another subscribed agent to download", async () => {
    // Agent A uploads
    const serverA = createServer(agentId);
    const upload = await callTool(serverA, "upload_attachment", {
      conversation_id: conversationId,
      filename: "shared.txt",
      content_type: "text/plain",
      data: Buffer.from("shared data").toString("base64"),
    }) as Record<string, unknown>;

    // Agent B downloads
    const serverB = createServer(agentId2);
    const download = await callTool(serverB, "get_attachment", {
      attachment_id: upload.id,
    }) as Record<string, unknown>;

    expect(download.filename).toBe("shared.txt");
  });
});

describe("send_message with attachment_ids", () => {
  it("links attachments to a sent message", async () => {
    const server = createServer(agentId);

    // Upload
    const upload = await callTool(server, "upload_attachment", {
      conversation_id: conversationId,
      filename: "report.pdf",
      content_type: "application/pdf",
      data: Buffer.from("pdf data").toString("base64"),
    }) as Record<string, unknown>;

    // Send with attachment
    const msg = await callTool(server, "send_message", {
      conversation_id: conversationId,
      content: "Here is the report",
      attachment_ids: [upload.id],
    }) as Record<string, unknown>;

    expect(msg.id).toBeTruthy();
    expect(msg).not.toHaveProperty("error");

    // Verify attachment is linked
    const attachments = await store.listAttachmentsByMessage(msg.id as string);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].filename).toBe("report.pdf");
  });

  it("rejects attachment from different conversation", async () => {
    const server = createServer(agentId);

    // Create a second conversation
    const project = await store.createProject({ name: "proj2", createdBy: agentId });
    const conv2 = await store.createConversation({
      projectId: project.id,
      title: "other-conv",
      createdBy: agentId,
    });
    await store.subscribe(conv2.id, agentId);

    // Upload to conversation 2
    const upload = await callTool(server, "upload_attachment", {
      conversation_id: conv2.id,
      filename: "wrong.txt",
      content_type: "text/plain",
      data: Buffer.from("x").toString("base64"),
    }) as Record<string, unknown>;

    // Try to link to conversation 1
    const result = await callTool(server, "send_message", {
      conversation_id: conversationId,
      content: "Cross-conversation attachment",
      attachment_ids: [upload.id],
    }) as Record<string, unknown>;

    expect(result.error).toContain("different conversation");
  });
});

describe("get_messages includes attachment metadata", () => {
  it("includes attachments array on messages that have them", async () => {
    const server = createServer(agentId);

    // Upload and send
    const upload = await callTool(server, "upload_attachment", {
      conversation_id: conversationId,
      filename: "image.png",
      content_type: "image/png",
      data: Buffer.from("png data").toString("base64"),
    }) as Record<string, unknown>;

    await callTool(server, "send_message", {
      conversation_id: conversationId,
      content: "Check this image",
      attachment_ids: [upload.id],
    });

    // Also send a message without attachments
    await callTool(server, "send_message", {
      conversation_id: conversationId,
      content: "No attachments here",
    });

    const messages = await callTool(server, "get_messages", {
      conversation_id: conversationId,
    }) as Record<string, unknown>[];

    // Find the message with attachment
    const withAtt = messages.find((m) => (m as Record<string, unknown>).content === "Check this image") as Record<string, unknown>;
    expect(withAtt.attachments).toHaveLength(1);
    expect((withAtt.attachments as Record<string, unknown>[])[0].filename).toBe("image.png");

    // Message without attachment should not have attachments key
    const noAtt = messages.find((m) => (m as Record<string, unknown>).content === "No attachments here") as Record<string, unknown>;
    expect(noAtt.attachments).toBeUndefined();
  });
});

describe("delete_attachment", () => {
  it("allows creator to delete their attachment", async () => {
    const server = createServer(agentId);
    const upload = await callTool(server, "upload_attachment", {
      conversation_id: conversationId,
      filename: "deleteme.txt",
      content_type: "text/plain",
      data: Buffer.from("bye").toString("base64"),
    }) as Record<string, unknown>;

    const result = await callTool(server, "delete_attachment", {
      attachment_id: upload.id,
    }) as Record<string, unknown>;

    expect(result.deleted).toBe(true);
  });

  it("prevents non-creator from deleting", async () => {
    // Agent A uploads
    const serverA = createServer(agentId);
    const upload = await callTool(serverA, "upload_attachment", {
      conversation_id: conversationId,
      filename: "protected.txt",
      content_type: "text/plain",
      data: Buffer.from("mine").toString("base64"),
    }) as Record<string, unknown>;

    // Agent B tries to delete
    const serverB = createServer(agentId2);
    const result = await callTool(serverB, "delete_attachment", {
      attachment_id: upload.id,
    }) as Record<string, unknown>;

    expect(result.error).toContain("Only the creator");
  });
});

describe("list_attachments", () => {
  it("lists attachments for a message", async () => {
    const server = createServer(agentId);

    const up1 = await callTool(server, "upload_attachment", {
      conversation_id: conversationId,
      filename: "a.txt",
      content_type: "text/plain",
      data: Buffer.from("a").toString("base64"),
    }) as Record<string, unknown>;

    const up2 = await callTool(server, "upload_attachment", {
      conversation_id: conversationId,
      filename: "b.txt",
      content_type: "text/plain",
      data: Buffer.from("b").toString("base64"),
    }) as Record<string, unknown>;

    const msg = await callTool(server, "send_message", {
      conversation_id: conversationId,
      content: "Two files",
      attachment_ids: [up1.id, up2.id],
    }) as Record<string, unknown>;

    const list = await callTool(server, "list_attachments", {
      message_id: msg.id,
    }) as Record<string, unknown>[];

    expect(list).toHaveLength(2);
    expect(list.map((a) => a.filename).sort()).toEqual(["a.txt", "b.txt"]);
  });
});
