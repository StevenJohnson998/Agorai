/**
 * Keryx — Pattern detection.
 *
 * Three independent detectors on rolling message window.
 * All pure TS, no external dependencies.
 */

import type { WindowMessage } from "./types.js";

// --- Loop Detection (Levenshtein) ---

export interface LoopResult {
  agentId: string;
  similarity: number;
}

/**
 * Levenshtein distance between two strings.
 * Optimized with single-row DP for memory efficiency.
 */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Truncate long strings for performance
  const maxLen = 500;
  const sa = a.length > maxLen ? a.slice(0, maxLen) : a;
  const sb = b.length > maxLen ? b.slice(0, maxLen) : b;

  let prev = Array.from({ length: sb.length + 1 }, (_, i) => i);
  let curr = new Array(sb.length + 1);

  for (let i = 1; i <= sa.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= sb.length; j++) {
      const cost = sa[i - 1] === sb[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[sb.length];
}

/**
 * Detect loops: consecutive messages from the same agent with high similarity.
 * Returns the first agent detected looping, or null.
 * Similarity threshold: > 0.7.
 */
export function detectLoop(messages: WindowMessage[]): LoopResult | null {
  if (messages.length < 2) return null;

  // Group consecutive messages by agent
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];

    if (prev.fromAgent !== curr.fromAgent) continue;

    // Skip [NO_RESPONSE] messages
    if (curr.content.trim() === "[NO_RESPONSE]") continue;
    if (prev.content.trim() === "[NO_RESPONSE]") continue;

    const maxLen = Math.max(prev.content.length, curr.content.length);
    if (maxLen === 0) continue;

    const distance = levenshteinDistance(prev.content, curr.content);
    const similarity = 1 - distance / maxLen;

    if (similarity > 0.7) {
      return { agentId: curr.fromAgent, similarity };
    }
  }

  return null;
}

// --- Drift Detection (Cosine Similarity on Bag-of-Words) ---

export interface DriftResult {
  similarity: number;
}

/** Tokenize text into lowercase words, filtering stop words. */
function tokenize(text: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
    "into", "through", "during", "before", "after", "above", "below",
    "between", "and", "but", "or", "nor", "not", "so", "yet", "both",
    "either", "neither", "each", "every", "all", "any", "few", "more",
    "most", "other", "some", "such", "no", "only", "own", "same", "than",
    "too", "very", "just", "because", "if", "when", "while", "this",
    "that", "these", "those", "i", "you", "he", "she", "it", "we", "they",
    "me", "him", "her", "us", "them", "my", "your", "his", "its", "our",
    "their", "what", "which", "who", "whom", "how", "where", "why",
  ]);

  return text
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 1 && !stopWords.has(w));
}

/** Build term frequency vector from tokens. */
function buildTfVector(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  return tf;
}

/** Cosine similarity between two TF vectors. */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, freqA] of a) {
    normA += freqA * freqA;
    const freqB = b.get(term) ?? 0;
    dotProduct += freqA * freqB;
  }

  for (const [, freqB] of b) {
    normB += freqB * freqB;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Detect topic drift: cosine similarity between original topic and recent messages.
 * Returns drift result if similarity < 0.3, null otherwise.
 */
export function detectDrift(topic: string, recentMessages: WindowMessage[]): DriftResult | null {
  if (recentMessages.length === 0) return null;

  const topicTokens = tokenize(topic);
  if (topicTokens.length === 0) return null;

  const topicTf = buildTfVector(topicTokens);

  // Combine recent messages into one bag
  const recentText = recentMessages.map(m => m.content).join(" ");
  const recentTokens = tokenize(recentText);
  if (recentTokens.length === 0) return null;

  const recentTf = buildTfVector(recentTokens);

  const similarity = cosineSimilarity(topicTf, recentTf);

  if (similarity < 0.3) {
    return { similarity };
  }

  return null;
}

// --- Domination Detection ---

export interface DominationResult {
  agentId: string;
  messagePercent: number;
}

/**
 * Detect domination: any agent with > 40% of messages when 3+ agents present.
 * Returns the dominant agent, or null.
 */
export function detectDomination(
  messages: WindowMessage[],
  subscriberCount: number,
): DominationResult | null {
  if (subscriberCount < 3) return null;
  if (messages.length < 5) return null; // Need enough data

  // Count messages per agent
  const counts = new Map<string, number>();
  for (const msg of messages) {
    // Skip [NO_RESPONSE]
    if (msg.content.trim() === "[NO_RESPONSE]") continue;
    counts.set(msg.fromAgent, (counts.get(msg.fromAgent) ?? 0) + 1);
  }

  const totalMessages = [...counts.values()].reduce((sum, c) => sum + c, 0);
  if (totalMessages === 0) return null;

  for (const [agentId, count] of counts) {
    const percent = Math.round((count / totalMessages) * 100);
    if (percent > 40) {
      return { agentId, messagePercent: percent };
    }
  }

  return null;
}
