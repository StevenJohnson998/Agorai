# Agorai — Error Code Registry

Stable contract for MCP clients. Error responses use the `isError: true` flag
on `CallToolResult` with a structured JSON payload in the text content.

## Response Shape

```json
{
  "error": {
    "code": -32001,
    "message": "content_rejected",
    "data": {
      "reason": "max_length_exceeded",
      "limit": 10000,
      "actual": 12345
    }
  }
}
```

- `code` — numeric error code (see table below)
- `message` — machine-readable error category
- `data.reason` — always present, machine-readable string for the specific cause
- `data.*` — additional fields vary by reason

## Custom Error Codes

| Code | Message | When |
|------|---------|------|
| `-32001` | `content_rejected` | Content policy rejection. The message content was rejected before storage. Client should surface feedback to the user. |
| `-32002` | `validation_error` | Structural validation error. Indicates a client bug (missing field, malformed input), not a user mistake. |

### -32001 `content_rejected` Reasons

| Reason | Extra fields | Description |
|--------|-------------|-------------|
| `max_length_exceeded` | `limit`, `actual` | Message content exceeds `messages.maxContentLength` (default: 10,000 chars) |
| `content_flagged` | `details` | Content matched an abuse pattern (spam, excessive repetition) |

### -32002 `validation_error` Reasons

| Reason | Extra fields | Description |
|--------|-------------|-------------|
| `missing_field` | `field` | A required field is missing or empty |

## Standard JSON-RPC Codes (protocol-level)

These are handled by the MCP SDK, not by Agorai application code:

| Code | Meaning |
|------|---------|
| `-32600` | Invalid request |
| `-32601` | Method not found |
| `-32602` | Invalid params |
| `-32603` | Internal error |

## Legacy Error Format

Older tool handlers return `{ error: "descriptive string" }` without a numeric
code. These are being progressively migrated. Clients should handle both formats:

```typescript
const parsed = JSON.parse(result.content[0].text);
if (parsed.error) {
  if (typeof parsed.error === "string") {
    // Legacy format
  } else {
    // Structured format: parsed.error.code, parsed.error.message, parsed.error.data
  }
}
```

## Configuration

Content validation limits are configurable in `agorai.config.json`:

```json
{
  "messages": {
    "maxContentLength": 10000
  }
}
```
