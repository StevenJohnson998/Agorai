/**
 * Bridge tool schema validation tests.
 */

import { describe, it, expect } from "vitest";
import {
  RegisterAgentSchema,
  ListBridgeAgentsSchema,
  CreateProjectSchema,
  ListProjectsSchema,
  SetMemorySchema,
  GetMemorySchema,
  DeleteMemorySchema,
  CreateConversationSchema,
  ListConversationsSchema,
  SubscribeSchema,
  UnsubscribeSchema,
  SendMessageSchema,
  GetMessagesSchema,
  GetStatusSchema,
  MarkReadSchema,
} from "../bridge/tools.js";

describe("Bridge tool schemas", () => {
  describe("RegisterAgentSchema", () => {
    it("accepts valid input", () => {
      const result = RegisterAgentSchema.safeParse({
        name: "test-agent",
        type: "claude-code",
        capabilities: ["code-execution"],
      });
      expect(result.success).toBe(true);
    });

    it("applies defaults", () => {
      const result = RegisterAgentSchema.parse({ name: "minimal" });
      expect(result.type).toBe("custom");
      expect(result.capabilities).toEqual([]);
    });

    it("rejects missing name", () => {
      const result = RegisterAgentSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("CreateProjectSchema", () => {
    it("accepts valid input", () => {
      const result = CreateProjectSchema.parse({
        name: "My Project",
        description: "A test project",
        visibility: "confidential",
      });
      expect(result.name).toBe("My Project");
      expect(result.visibility).toBe("confidential");
    });

    it("rejects invalid visibility", () => {
      const result = CreateProjectSchema.safeParse({
        name: "Bad",
        visibility: "ultra-secret",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("SetMemorySchema", () => {
    it("accepts full input", () => {
      const result = SetMemorySchema.parse({
        project_id: "proj-1",
        type: "decision",
        title: "Use Redis",
        tags: ["cache", "infra"],
        content: "We chose Redis for caching",
        priority: "high",
        visibility: "team",
      });
      expect(result.priority).toBe("high");
      expect(result.tags).toEqual(["cache", "infra"]);
    });

    it("applies defaults", () => {
      const result = SetMemorySchema.parse({
        project_id: "p1",
        title: "Note",
        content: "...",
      });
      expect(result.type).toBe("note");
      expect(result.priority).toBe("normal");
      expect(result.tags).toEqual([]);
    });
  });

  describe("SendMessageSchema", () => {
    it("accepts valid input", () => {
      const result = SendMessageSchema.parse({
        conversation_id: "conv-1",
        content: "Hello",
        type: "message",
        visibility: "public",
      });
      expect(result.type).toBe("message");
      expect(result.visibility).toBe("public");
    });

    it("applies defaults", () => {
      const result = SendMessageSchema.parse({
        conversation_id: "conv-1",
        content: "Hello",
      });
      expect(result.type).toBe("message");
    });

    it("accepts all message types", () => {
      for (const type of ["message", "spec", "result", "review", "status", "question"]) {
        const result = SendMessageSchema.safeParse({
          conversation_id: "c1",
          content: "test",
          type,
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid message type", () => {
      const result = SendMessageSchema.safeParse({
        conversation_id: "c1",
        content: "test",
        type: "invalid",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("GetMessagesSchema", () => {
    it("accepts valid input with filters", () => {
      const result = GetMessagesSchema.parse({
        conversation_id: "conv-1",
        since: "2026-01-01T00:00:00Z",
        unread_only: true,
        limit: 50,
      });
      expect(result.unread_only).toBe(true);
      expect(result.limit).toBe(50);
    });

    it("rejects limit out of range", () => {
      const result = GetMessagesSchema.safeParse({
        conversation_id: "c1",
        limit: 500,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("SubscribeSchema", () => {
    it("defaults to full history", () => {
      const result = SubscribeSchema.parse({ conversation_id: "c1" });
      expect(result.history_access).toBe("full");
    });

    it("accepts from_join", () => {
      const result = SubscribeSchema.parse({
        conversation_id: "c1",
        history_access: "from_join",
      });
      expect(result.history_access).toBe("from_join");
    });
  });

  describe("Minimal schemas", () => {
    it("ListBridgeAgentsSchema accepts empty or project_id", () => {
      expect(ListBridgeAgentsSchema.safeParse({}).success).toBe(true);
      expect(ListBridgeAgentsSchema.safeParse({ project_id: "p1" }).success).toBe(true);
    });

    it("ListProjectsSchema accepts empty", () => {
      expect(ListProjectsSchema.safeParse({}).success).toBe(true);
    });

    it("GetStatusSchema accepts empty", () => {
      expect(GetStatusSchema.safeParse({}).success).toBe(true);
    });

    it("DeleteMemorySchema requires id", () => {
      expect(DeleteMemorySchema.safeParse({}).success).toBe(false);
      expect(DeleteMemorySchema.safeParse({ id: "m1" }).success).toBe(true);
    });

    it("UnsubscribeSchema requires conversation_id", () => {
      expect(UnsubscribeSchema.safeParse({}).success).toBe(false);
      expect(UnsubscribeSchema.safeParse({ conversation_id: "c1" }).success).toBe(true);
    });

    it("MarkReadSchema requires conversation_id", () => {
      expect(MarkReadSchema.safeParse({}).success).toBe(false);
      expect(MarkReadSchema.safeParse({ conversation_id: "c1" }).success).toBe(true);
    });

    it("GetMemorySchema requires project_id", () => {
      expect(GetMemorySchema.safeParse({}).success).toBe(false);
      expect(GetMemorySchema.safeParse({ project_id: "p1" }).success).toBe(true);
    });

    it("CreateConversationSchema requires project_id and title", () => {
      expect(CreateConversationSchema.safeParse({}).success).toBe(false);
      expect(CreateConversationSchema.safeParse({ project_id: "p1", title: "Chat" }).success).toBe(true);
    });

    it("ListConversationsSchema requires project_id", () => {
      expect(ListConversationsSchema.safeParse({}).success).toBe(false);
      expect(ListConversationsSchema.safeParse({ project_id: "p1" }).success).toBe(true);
    });
  });
});
