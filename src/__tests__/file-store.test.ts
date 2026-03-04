/**
 * LocalFileStore tests — CRUD operations on filesystem-based file storage.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LocalFileStore } from "../store/file-store.js";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let fileStore: LocalFileStore;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "agorai-filestore-test-"));
  fileStore = new LocalFileStore(join(tmpDir, "attachments"));
  await fileStore.initialize();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("LocalFileStore", () => {
  it("creates base directory on initialize", () => {
    expect(existsSync(join(tmpDir, "attachments"))).toBe(true);
  });

  it("saves and retrieves a file", async () => {
    const data = Buffer.from("hello world");
    const ref = await fileStore.save("conv-1", "att-1", data);
    expect(ref).toBe("local://conv-1/att-1");

    const retrieved = await fileStore.get(ref);
    expect(retrieved.toString()).toBe("hello world");
  });

  it("saves binary data correctly", async () => {
    const data = Buffer.from([0x00, 0xff, 0x42, 0x89, 0xab]);
    const ref = await fileStore.save("conv-1", "att-bin", data);
    const retrieved = await fileStore.get(ref);
    expect(Buffer.compare(retrieved, data)).toBe(0);
  });

  it("creates conversation subdirectory", async () => {
    await fileStore.save("conv-new", "att-1", Buffer.from("test"));
    expect(existsSync(join(tmpDir, "attachments", "conv-new"))).toBe(true);
  });

  it("deletes a file and returns true", async () => {
    const ref = await fileStore.save("conv-1", "att-del", Buffer.from("delete me"));
    const deleted = await fileStore.delete(ref);
    expect(deleted).toBe(true);

    // Verify file is gone
    await expect(fileStore.get(ref)).rejects.toThrow();
  });

  it("returns false when deleting non-existent file", async () => {
    const deleted = await fileStore.delete("local://conv-1/nonexistent");
    expect(deleted).toBe(false);
  });

  it("throws when getting non-existent file", async () => {
    await expect(fileStore.get("local://conv-1/missing")).rejects.toThrow();
  });

  it("handles multiple files in same conversation", async () => {
    const ref1 = await fileStore.save("conv-1", "file-a", Buffer.from("aaa"));
    const ref2 = await fileStore.save("conv-1", "file-b", Buffer.from("bbb"));

    expect((await fileStore.get(ref1)).toString()).toBe("aaa");
    expect((await fileStore.get(ref2)).toString()).toBe("bbb");
  });

  it("handles files across different conversations", async () => {
    const ref1 = await fileStore.save("conv-a", "file-1", Buffer.from("alpha"));
    const ref2 = await fileStore.save("conv-b", "file-1", Buffer.from("beta"));

    expect((await fileStore.get(ref1)).toString()).toBe("alpha");
    expect((await fileStore.get(ref2)).toString()).toBe("beta");
  });

  it("can initialize multiple times without error", async () => {
    await fileStore.initialize();
    await fileStore.initialize();
  });

  describe("path traversal protection", () => {
    it("rejects traversal in save() conversationId", async () => {
      await expect(fileStore.save("../../etc", "att-1", Buffer.from("pwned"))).rejects.toThrow("Path traversal detected");
    });

    it("rejects traversal in save() attachmentId", async () => {
      await expect(fileStore.save("conv-1", "../../etc/passwd", Buffer.from("pwned"))).rejects.toThrow("Path traversal detected");
    });

    it("rejects traversal in get() storageRef", async () => {
      await expect(fileStore.get("local://../../etc/passwd")).rejects.toThrow("Path traversal detected");
    });

    it("rejects traversal in delete() storageRef", async () => {
      await expect(fileStore.delete("local://../../etc/passwd")).rejects.toThrow("Path traversal detected");
    });

    it("rejects absolute path injection in get()", async () => {
      await expect(fileStore.get("local:///etc/passwd")).rejects.toThrow("Path traversal detected");
    });
  });
});
