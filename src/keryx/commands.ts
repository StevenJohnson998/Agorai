/**
 * Keryx — Command parser.
 *
 * Parses @keryx commands from message content.
 * Only non-internal, non-keryx agents can issue commands.
 */

export type KeryxCommand =
  | "pause"
  | "resume"
  | "skip"
  | "extend"
  | "status"
  | "interrupt"
  | "enable"
  | "disable"
  | "summary";

export interface ParsedCommand {
  command: KeryxCommand;
  args?: string;
}

const COMMAND_REGEX = /@keryx\s+(pause|resume|skip|extend|status|interrupt|enable|disable|summary)(?:\s+(.+))?/i;

/**
 * Parse a @keryx command from message content.
 * Returns null if no command found.
 */
export function parseCommand(content: string): ParsedCommand | null {
  const match = content.match(COMMAND_REGEX);
  if (!match) return null;

  return {
    command: match[1].toLowerCase() as KeryxCommand,
    args: match[2]?.trim(),
  };
}

/**
 * Parse a duration string to milliseconds.
 * Supports: "30s", "2m", "1h", "90" (seconds by default).
 * Returns null if invalid.
 */
export function parseDuration(input: string): number | null {
  const match = input.trim().match(/^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr)?$/i);
  if (!match) return null;

  const value = parseFloat(match[1]);
  if (isNaN(value) || value <= 0) return null;

  const unit = (match[2] ?? "s").toLowerCase();

  switch (unit) {
    case "s":
    case "sec":
      return Math.round(value * 1000);
    case "m":
    case "min":
      return Math.round(value * 60_000);
    case "h":
    case "hr":
      return Math.round(value * 3_600_000);
    default:
      return null;
  }
}
