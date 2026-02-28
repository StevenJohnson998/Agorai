/**
 * Typed error classes for agent recovery logic.
 *
 * SessionExpiredError  — bridge returned 404 "Session not found" (bridge restarted)
 * BridgeUnreachableError — network error (ECONNREFUSED, timeout, DNS failure)
 */

export class SessionExpiredError extends Error {
  constructor(message = "Session expired — bridge no longer recognizes this session") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

export class BridgeUnreachableError extends Error {
  constructor(message = "Bridge unreachable — connection refused or timed out") {
    super(message);
    this.name = "BridgeUnreachableError";
  }
}
