/**
 * File storage abstraction for message attachments.
 *
 * IFileStore is the pluggable interface; LocalFileStore is the filesystem-based
 * MVP implementation (zero external deps). Enterprise backends (S3, etc.) can
 * implement IFileStore without touching the rest of the codebase.
 */

import { mkdir, writeFile, readFile, unlink, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface IFileStore {
  /** Persist file data and return an opaque storage reference. */
  save(conversationId: string, attachmentId: string, data: Buffer): Promise<string>;

  /** Retrieve file data by storage reference. Throws if not found. */
  get(storageRef: string): Promise<Buffer>;

  /** Delete a file by storage reference. Returns true if deleted, false if not found. */
  delete(storageRef: string): Promise<boolean>;

  /** Create required directories / connections. Called once at startup. */
  initialize(): Promise<void>;
}

/**
 * Filesystem-based file store. Layout: basePath/{conversationId}/{attachmentId}
 */
export class LocalFileStore implements IFileStore {
  private resolvedBase: string;

  constructor(private basePath: string) {
    this.resolvedBase = resolve(basePath);
  }

  /** Resolve a path and verify it stays within basePath. Throws on traversal attempt. */
  private safePath(...segments: string[]): string {
    const target = resolve(this.resolvedBase, ...segments);
    if (!target.startsWith(this.resolvedBase + "/") && target !== this.resolvedBase) {
      throw new Error("Path traversal detected");
    }
    return target;
  }

  async initialize(): Promise<void> {
    await mkdir(this.resolvedBase, { recursive: true });
  }

  async save(conversationId: string, attachmentId: string, data: Buffer): Promise<string> {
    const dir = this.safePath(conversationId);
    const filePath = this.safePath(conversationId, attachmentId);
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, data);
    return `local://${conversationId}/${attachmentId}`;
  }

  async get(storageRef: string): Promise<Buffer> {
    const relativePath = storageRef.replace("local://", "");
    const filePath = this.safePath(relativePath);
    return readFile(filePath);
  }

  async delete(storageRef: string): Promise<boolean> {
    const relativePath = storageRef.replace("local://", "");
    const filePath = this.safePath(relativePath);
    try {
      await unlink(filePath);
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }
}
