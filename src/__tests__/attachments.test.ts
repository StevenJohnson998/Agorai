/**
 * Attachment store method tests — createAttachment, linkAttachmentsToMessage,
 * batch list, delete, visibility/ownership rules.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStore } from "../store/sqlite.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let store: SqliteStore;
let tmpDir: string;
let agentId: string;
let agentId2: string;
let conversationId: string;
let projectId: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-attach-test-"));
  store = new SqliteStore(join(tmpDir, "test.db"));
  await store.initialize();

  const agent = await store.registerAgent({
    name: "agent-a",
    type: "test",
    capabilities: [],
    clearanceLevel: "team",
    apiKeyHash: "hash-a",
  });
  agentId = agent.id;

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
  projectId = project.id;

  const conv = await store.createConversation({
    projectId,
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

describe("createAttachment", () => {
  it("creates an attachment with null messageId", async () => {
    const att = await store.createAttachment({
      conversationId,
      filename: "test.txt",
      contentType: "text/plain",
      size: 100,
      storageRef: "local://conv/att-1",
      createdBy: agentId,
    });

    expect(att.id).toBeTruthy();
    expect(att.messageId).toBeNull();
    expect(att.filename).toBe("test.txt");
    expect(att.contentType).toBe("text/plain");
    expect(att.size).toBe(100);
    expect(att.createdBy).toBe(agentId);
    expect(att.createdAt).toBeTruthy();
  });
});

describe("getAttachment", () => {
  it("retrieves an existing attachment", async () => {
    const att = await store.createAttachment({
      conversationId,
      filename: "photo.png",
      contentType: "image/png",
      size: 5000,
      storageRef: "local://conv/att-2",
      createdBy: agentId,
    });

    const retrieved = await store.getAttachment(att.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(att.id);
    expect(retrieved!.storageRef).toBe("local://conv/att-2");
  });

  it("returns null for non-existent attachment", async () => {
    const result = await store.getAttachment("nonexistent");
    expect(result).toBeNull();
  });
});

describe("linkAttachmentsToMessage", () => {
  it("links attachments to a message", async () => {
    const att1 = await store.createAttachment({
      conversationId,
      filename: "file1.txt",
      contentType: "text/plain",
      size: 10,
      storageRef: "local://conv/f1",
      createdBy: agentId,
    });

    const att2 = await store.createAttachment({
      conversationId,
      filename: "file2.txt",
      contentType: "text/plain",
      size: 20,
      storageRef: "local://conv/f2",
      createdBy: agentId,
    });

    const msg = await store.sendMessage({
      conversationId,
      fromAgent: agentId,
      content: "Message with attachments",
    });

    const linked = await store.linkAttachmentsToMessage([att1.id, att2.id], msg.id, agentId);
    expect(linked).toBe(2);

    // Verify attachments are linked
    const attachments = await store.listAttachmentsByMessage(msg.id);
    expect(attachments).toHaveLength(2);
    expect(attachments.map((a) => a.filename).sort()).toEqual(["file1.txt", "file2.txt"]);
  });

  it("only links attachments owned by the agent", async () => {
    const att = await store.createAttachment({
      conversationId,
      filename: "owned.txt",
      contentType: "text/plain",
      size: 10,
      storageRef: "local://conv/owned",
      createdBy: agentId2, // different agent
    });

    const msg = await store.sendMessage({
      conversationId,
      fromAgent: agentId,
      content: "Trying to link someone else's attachment",
    });

    const linked = await store.linkAttachmentsToMessage([att.id], msg.id, agentId);
    expect(linked).toBe(0);
  });

  it("does not re-link already linked attachments", async () => {
    const att = await store.createAttachment({
      conversationId,
      filename: "once.txt",
      contentType: "text/plain",
      size: 10,
      storageRef: "local://conv/once",
      createdBy: agentId,
    });

    const msg1 = await store.sendMessage({
      conversationId,
      fromAgent: agentId,
      content: "First message",
    });

    await store.linkAttachmentsToMessage([att.id], msg1.id, agentId);

    const msg2 = await store.sendMessage({
      conversationId,
      fromAgent: agentId,
      content: "Second message",
    });

    // Should not re-link since message_id is no longer NULL
    const linked = await store.linkAttachmentsToMessage([att.id], msg2.id, agentId);
    expect(linked).toBe(0);
  });
});

describe("listAttachmentsByMessages (batch)", () => {
  it("returns attachments grouped by message ID", async () => {
    const msg1 = await store.sendMessage({
      conversationId,
      fromAgent: agentId,
      content: "Message 1",
    });
    const msg2 = await store.sendMessage({
      conversationId,
      fromAgent: agentId,
      content: "Message 2",
    });

    const att1 = await store.createAttachment({
      conversationId,
      filename: "a.txt",
      contentType: "text/plain",
      size: 1,
      storageRef: "local://conv/a",
      createdBy: agentId,
    });
    const att2 = await store.createAttachment({
      conversationId,
      filename: "b.txt",
      contentType: "text/plain",
      size: 2,
      storageRef: "local://conv/b",
      createdBy: agentId,
    });

    await store.linkAttachmentsToMessage([att1.id], msg1.id, agentId);
    await store.linkAttachmentsToMessage([att2.id], msg2.id, agentId);

    const result = await store.listAttachmentsByMessages([msg1.id, msg2.id]);
    expect(result.size).toBe(2);
    expect(result.get(msg1.id)).toHaveLength(1);
    expect(result.get(msg1.id)![0].filename).toBe("a.txt");
    expect(result.get(msg2.id)).toHaveLength(1);
    expect(result.get(msg2.id)![0].filename).toBe("b.txt");
  });

  it("returns empty map for empty input", async () => {
    const result = await store.listAttachmentsByMessages([]);
    expect(result.size).toBe(0);
  });

  it("omits messages with no attachments", async () => {
    const msg = await store.sendMessage({
      conversationId,
      fromAgent: agentId,
      content: "No attachments",
    });
    const result = await store.listAttachmentsByMessages([msg.id]);
    expect(result.size).toBe(0);
  });

  it("metadata does not include storageRef", async () => {
    const att = await store.createAttachment({
      conversationId,
      filename: "secret.txt",
      contentType: "text/plain",
      size: 42,
      storageRef: "local://conv/secret",
      createdBy: agentId,
    });
    const msg = await store.sendMessage({
      conversationId,
      fromAgent: agentId,
      content: "test",
    });
    await store.linkAttachmentsToMessage([att.id], msg.id, agentId);

    const result = await store.listAttachmentsByMessages([msg.id]);
    const meta = result.get(msg.id)![0];
    expect(meta).not.toHaveProperty("storageRef");
    expect(meta.filename).toBe("secret.txt");
    expect(meta.size).toBe(42);
  });
});

describe("deleteAttachment", () => {
  it("deletes an existing attachment", async () => {
    const att = await store.createAttachment({
      conversationId,
      filename: "del.txt",
      contentType: "text/plain",
      size: 10,
      storageRef: "local://conv/del",
      createdBy: agentId,
    });

    const deleted = await store.deleteAttachment(att.id);
    expect(deleted).toBe(true);

    const retrieved = await store.getAttachment(att.id);
    expect(retrieved).toBeNull();
  });

  it("returns false for non-existent attachment", async () => {
    const deleted = await store.deleteAttachment("nonexistent");
    expect(deleted).toBe(false);
  });
});
