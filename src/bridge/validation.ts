/**
 * Pluggable message content validation pipeline.
 *
 * Validators run in order; the first failure short-circuits and returns
 * a structured error suitable for mcpError(). Add new validators by
 * appending to the `validators` array — no other code changes needed.
 */

import { ErrorCode } from "./errors.js";
import type { Config } from "../config.js";

export type MessagesConfig = NonNullable<Config["messages"]>;

export interface ValidationError {
  code: number;
  message: string;
  data: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  error?: ValidationError;
}

type MessageValidator = (content: string, config: MessagesConfig) => ValidationResult;

const VALID: ValidationResult = { valid: true };

// ---------------------------------------------------------------------------
// Built-in validators
// ---------------------------------------------------------------------------

/** Reject messages exceeding the configured max content length. */
function validateLength(content: string, config: MessagesConfig): ValidationResult {
  const limit = config.maxContentLength;
  if (content.length > limit) {
    return {
      valid: false,
      error: {
        code: ErrorCode.CONTENT_REJECTED,
        message: "content_rejected",
        data: { reason: "max_length_exceeded", limit, actual: content.length },
      },
    };
  }
  return VALID;
}

/** Reject obvious spam/abuse patterns. */
function validateAbuse(content: string, _config: MessagesConfig): ValidationResult {
  // Same character repeated 50+ times (e.g. "aaaa..." or "!!!!")
  if (/(.)\1{49,}/.test(content)) {
    return {
      valid: false,
      error: {
        code: ErrorCode.CONTENT_REJECTED,
        message: "content_rejected",
        data: { reason: "content_flagged", details: "excessive character repetition" },
      },
    };
  }

  // Same word repeated 20+ times (case-insensitive, word boundaries)
  const words = content.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length >= 20) {
    const freq = new Map<string, number>();
    for (const w of words) {
      const count = (freq.get(w) ?? 0) + 1;
      freq.set(w, count);
      if (count >= 20) {
        return {
          valid: false,
          error: {
            code: ErrorCode.CONTENT_REJECTED,
            message: "content_rejected",
            data: { reason: "content_flagged", details: "excessive word repetition" },
          },
        };
      }
    }
  }

  return VALID;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/** Ordered list of validators. Extend by pushing new validators here. */
const validators: MessageValidator[] = [
  validateLength,
  validateAbuse,
];

/**
 * Run the full validation pipeline on message content.
 * Returns { valid: true } or { valid: false, error: ... } on first failure.
 */
export function validateMessage(content: string, config: MessagesConfig): ValidationResult {
  for (const validator of validators) {
    const result = validator(content, config);
    if (!result.valid) return result;
  }
  return VALID;
}
