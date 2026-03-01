/**
 * Store event bus — typed EventEmitter for store mutations.
 *
 * Emits events when the store is mutated, enabling reactive patterns
 * like SSE push notifications without polling.
 *
 * MVP: single event type `message:created`.
 */

import { EventEmitter } from "node:events";
import type { Message } from "./types.js";

export interface MessageCreatedEvent {
  message: Message;
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
}
