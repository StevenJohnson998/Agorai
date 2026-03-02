/**
 * Store event bus — typed EventEmitter for store mutations.
 *
 * Emits events when the store is mutated, enabling reactive patterns
 * like SSE push notifications without polling.
 *
 * MVP: single event type `message:created`.
 */

import { EventEmitter } from "node:events";
import type { Message, AccessRequest, Task } from "./types.js";

export interface MessageCreatedEvent {
  message: Message;
}

export interface AccessRequestCreatedEvent {
  accessRequest: AccessRequest;
}

export interface TaskCreatedEvent {
  task: Task;
}

export interface TaskUpdatedEvent {
  task: Task;
  action: "claimed" | "completed" | "released" | "cancelled" | "updated";
}

export class StoreEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0); // intentional pub/sub — many subscribers expected
  }

  /** Emit after a message is inserted into the store. */
  emitMessage(message: Message): void {
    this.emit("message:created", { message } satisfies MessageCreatedEvent);
  }

  /** Subscribe to new message events. */
  onMessage(listener: (event: MessageCreatedEvent) => void): this {
    return this.on("message:created", listener);
  }

  /** Unsubscribe from new message events. */
  offMessage(listener: (event: MessageCreatedEvent) => void): this {
    return this.off("message:created", listener);
  }

  /** Emit after an access request is created. */
  emitAccessRequest(accessRequest: AccessRequest): void {
    this.emit("access-request:created", { accessRequest } satisfies AccessRequestCreatedEvent);
  }

  /** Subscribe to access request events. */
  onAccessRequest(listener: (event: AccessRequestCreatedEvent) => void): this {
    return this.on("access-request:created", listener);
  }

  /** Unsubscribe from access request events. */
  offAccessRequest(listener: (event: AccessRequestCreatedEvent) => void): this {
    return this.off("access-request:created", listener);
  }

  /** Emit after a task is created. */
  emitTaskCreated(task: Task): void {
    this.emit("task:created", { task } satisfies TaskCreatedEvent);
  }

  /** Emit after a task is updated (claimed, completed, released, cancelled, updated). */
  emitTaskUpdated(task: Task, action: TaskUpdatedEvent["action"]): void {
    this.emit("task:updated", { task, action } satisfies TaskUpdatedEvent);
  }

  /** Subscribe to task created events. */
  onTaskCreated(listener: (event: TaskCreatedEvent) => void): this {
    return this.on("task:created", listener);
  }

  /** Unsubscribe from task created events. */
  offTaskCreated(listener: (event: TaskCreatedEvent) => void): this {
    return this.off("task:created", listener);
  }

  /** Subscribe to task updated events. */
  onTaskUpdated(listener: (event: TaskUpdatedEvent) => void): this {
    return this.on("task:updated", listener);
  }

  /** Unsubscribe from task updated events. */
  offTaskUpdated(listener: (event: TaskUpdatedEvent) => void): this {
    return this.off("task:updated", listener);
  }
}
