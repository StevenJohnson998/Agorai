/**
 * Keryx — Message templates.
 *
 * All parameterized, no LLM involved.
 * Keryx manages PROCESS, never creates CONTENT.
 */

export interface RoundOpenParams {
  roundNumber: number;
  topic: string;
  expectedAgents: string[];
  timeoutSeconds: number;
}

export function roundOpen(p: RoundOpenParams): string {
  const agentList = p.expectedAgents.map(a => `@${a}`).join(", ");
  return [
    `📋 **Round ${p.roundNumber}** — Topic: ${p.topic}`,
    `Participants: ${agentList}`,
    `Please share your perspective. Timeout: ${p.timeoutSeconds}s.`,
    `Use [NO_RESPONSE] if you have nothing new to add.`,
  ].join("\n");
}

export interface RoundCloseParams {
  roundNumber: number;
  respondedCount: number;
  totalCount: number;
  noResponseCount: number;
}

export function roundClose(p: RoundCloseParams): string {
  const parts = [`✅ **Round ${p.roundNumber} closed** — ${p.respondedCount}/${p.totalCount} responded`];
  if (p.noResponseCount > 0) {
    parts.push(`(${p.noResponseCount} opted out with [NO_RESPONSE])`);
  }
  return parts.join(" ");
}

export interface SynthesisRequestParams {
  roundNumber: number;
  agentName: string;
  topic: string;
}

export function synthesisRequest(p: SynthesisRequestParams): string {
  return [
    `🔄 @${p.agentName} — Please synthesize the discussion from round ${p.roundNumber}.`,
    `Topic: ${p.topic}`,
    `Summarize key points, areas of agreement/disagreement, and any open questions.`,
  ].join("\n");
}

export interface NudgeParams {
  agentNames: string[];
  roundNumber: number;
  elapsedSeconds: number;
}

export function nudge(p: NudgeParams): string {
  const mentions = p.agentNames.map(a => `@${a}`).join(", ");
  return `⏰ ${mentions} — Round ${p.roundNumber} has been open for ${p.elapsedSeconds}s. Please respond or use [NO_RESPONSE].`;
}

export interface EscalateToHumanParams {
  roundNumber: number;
  nonResponders: string[];
  elapsedSeconds: number;
}

export function escalateToHuman(p: EscalateToHumanParams): string {
  const list = p.nonResponders.map(a => `@${a}`).join(", ");
  return [
    `⚠️ **Round ${p.roundNumber} stalled** — ${p.elapsedSeconds}s elapsed.`,
    `Non-responding: ${list}`,
    `Human intervention may be needed. Use \`@keryx skip\` to close this round or \`@keryx extend 2m\` for more time.`,
  ].join("\n");
}

export interface InterruptParams {
  roundNumber: number;
  interruptedBy: string;
}

export function interrupt(p: InterruptParams): string {
  return `🛑 **Round ${p.roundNumber} interrupted** by @${p.interruptedBy}. Awaiting their input to continue.`;
}

export interface OnboardingRequestParams {
  newAgentName: string;
  brieferName: string;
  conversationTitle: string;
}

export function onboardingRequest(p: OnboardingRequestParams): string {
  return [
    `👋 New participant: @${p.newAgentName} joined "${p.conversationTitle}".`,
    `@${p.brieferName} — please briefly summarize the discussion context for them.`,
    `@${p.newAgentName} — please declare your capabilities (e.g. analysis, code review, synthesis).`,
  ].join("\n");
}

export interface LoopDetectedParams {
  agentName: string;
  roundNumber: number;
}

export function loopDetected(p: LoopDetectedParams): string {
  return `🔁 @${p.agentName} — Your responses in round ${p.roundNumber} appear repetitive. Please provide a fresh perspective or use [NO_RESPONSE].`;
}

export interface DriftDetectedParams {
  originalTopic: string;
  roundNumber: number;
}

export function driftDetected(p: DriftDetectedParams): string {
  return `📌 **Topic drift detected** in round ${p.roundNumber}. Original topic: "${p.originalTopic}". Please refocus or suggest a topic change with \`@keryx interrupt\`.`;
}

export interface DominationWarningParams {
  agentName: string;
  messagePercent: number;
}

export function dominationWarning(p: DominationWarningParams): string {
  return `⚖️ @${p.agentName} — You account for ${p.messagePercent}% of recent messages. Please allow space for other participants.`;
}

export function paused(): string {
  return `⏸️ **Keryx paused** — Round management suspended. Use \`@keryx resume\` to continue.`;
}

export function resumed(): string {
  return `▶️ **Keryx resumed** — Round management active.`;
}
