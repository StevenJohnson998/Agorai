/**
 * Structured MCP error responses with JSON-RPC error codes.
 *
 * Custom codes:
 *   -32001  content_rejected  — content policy rejection (user-facing)
 *   -32002  validation_error  — structural validation error (client bug)
 *
 * See docs/ERROR-CODES.md for the full registry.
 */

export const ErrorCode = {
  CONTENT_REJECTED: -32001,
  VALIDATION_ERROR: -32002,
} as const;

export type ContentRejectedReason = "max_length_exceeded" | "content_flagged";
export type ValidationErrorReason = "missing_field";

/**
 * Build an MCP CallToolResult that signals an error to the client.
 *
 * Shape: { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message, data } }) }] }
 *
 * - `code`    — JSON-RPC-style numeric code (see ErrorCode)
 * - `message` — machine-readable error category ("content_rejected", "validation_error")
 * - `data`    — structured payload with at least a `reason` field
 */
export function mcpError(code: number, message: string, data: Record<string, unknown>) {
  return {
    isError: true as const,
    content: [{
      type: "text" as const,
      text: JSON.stringify({ error: { code, message, data } }),
    }],
  };
}
