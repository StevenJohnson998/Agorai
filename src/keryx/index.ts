/**
 * Keryx — Discussion Manager module.
 *
 * Barrel export for all Keryx types and classes.
 */

export { KeryxModule } from "./module.js";
export type {
  RoundStatus,
  Round,
  ConversationState,
  ConversationMode,
  SocraticState,
  AgentProfile,
  KeryxConfig,
  InterventionType,
  WindowMessage,
} from "./types.js";
export type {
  ConversationModeHandler,
  ModeContext,
} from "./mode-interface.js";
export { EcclesiaMode } from "./modes/ecclesia.js";
export { SocraticMode } from "./modes/socratic.js";
