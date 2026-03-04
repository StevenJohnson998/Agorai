/**
 * Unified Agent Context System — single source of truth for agent instructions.
 *
 * Architecture:
 *   Store → buildAgentContext() → AgentContext → renderer → transport
 *
 * Each transport has its own renderer:
 *   - renderForPrompt()          → system prompt text (API/Ollama internal agents)
 *   - renderForMcpInstructions() → MCP instructions string (Claude Desktop, MCP clients)
 *
 * SOURCE OF TRUTH for bridge rules.
 * If you change these rules, also update .claude/skills/agorai-bridge-rules/
 */

import type { IStore } from "../store/interfaces.js";
import type {
  VisibilityLevel,
  SkillMetadata,
  MemoryEntry,
  Message,
  Agent,
  Conversation,
  Project,
  Subscription,
} from "../store/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentContext {
  identity: {
    agentId: string;
    agentName: string;
    agentType: string;
    clearanceLevel: VisibilityLevel;
  };

  bridgeRules: BridgeRules;

  conversation?: {
    conversationId: string;
    projectId: string;
    projectName: string;
    confidentialityMode: string;
    defaultVisibility: VisibilityLevel;
    subscribers: { name: string; type: string; online: boolean }[];
  };

  skills: SkillMetadata[];
  projectMemory: MemoryEntry[];
  agentMemory: {
    global?: string;
    project?: string;
    conversation?: string;
  };

  recentMessages?: {
    messages: Message[];
    agentNameMap: Map<string, string>;
  };

  activeToolGroups?: string[];
  decisionDepth?: number;
}

export interface BridgeRules {
  messageTracking: string;
  visibilityRules: string;
  metadataModel: string;
  workflow: string;
  mentionRules: string;
  accessRequestRules?: string;
  membershipRules?: string;
  skillsRules?: string;
  attachmentRules?: string;
  delegationRules?: string;
  keryxRules?: string;
}

export interface BuildContextOptions {
  store: IStore;
  agentId: string;
  conversationId?: string;
  includeMessages?: boolean;
  messageLimit?: number;
  activeToolGroups?: string[];
  decisionDepth?: number;
  keryxActive?: boolean;
}

// ---------------------------------------------------------------------------
// Bridge Rules — single source of truth
// ---------------------------------------------------------------------------

/**
 * Build structured bridge rules. Active tool groups determine which
 * conditional sections are included.
 */
export function buildBridgeRules(activeToolGroups?: string[], keryxActive?: boolean): BridgeRules {
  const groups = new Set(activeToolGroups);
  const allActive = !activeToolGroups || activeToolGroups.length === 0 || groups.has("all");

  const rules: BridgeRules = {
    messageTracking: [
      "IMPORTANT — Message read tracking:",
      "After you read messages with get_messages, you MUST call mark_read with the same conversation_id.",
      "This prevents you from seeing the same messages again on the next poll.",
      'Example: get_messages({conversation_id: "abc"}) → process messages → mark_read({conversation_id: "abc"})',
    ].join("\n"),

    visibilityRules: [
      "IMPORTANT — Visibility / confidentiality levels:",
      "Messages have a visibility level: public < team < confidential < restricted.",
      "When you send a message, set its visibility to the HIGHEST level among the messages you used as input.",
      "For example, if you read messages at 'team' and 'confidential' level, your reply MUST be 'confidential'.",
      "If unsure, default to the conversation's default visibility. Never downgrade confidentiality.",
    ].join("\n"),

    metadataModel: [
      "IMPORTANT — Message metadata model:",
      "Messages have two metadata fields:",
      "- bridgeMetadata: trusted data injected by the bridge (visibility, capping info, confidentiality instructions). Always present. Read the 'instructions' field for guidance on how to handle confidentiality for this project.",
      "- agentMetadata: your private operational data (cost, model, tokens, etc.). Only visible to you — other agents cannot see it.",
      "When sending a message, pass any operational metadata in the 'metadata' field. Do NOT include keys starting with '_bridge'.",
    ].join("\n"),

    workflow: [
      "Typical workflow:",
      "1. get_status — check for unread messages",
      "2. list_projects → list_conversations → subscribe to conversations you want to follow",
      "3. get_messages({conversation_id, unread_only: true}) — fetch new messages",
      "4. Process/respond with send_message (set visibility to max of input messages' visibility)",
      "5. mark_read({conversation_id}) — ALWAYS do this after reading, even if you don't reply",
    ].join("\n"),

    mentionRules: [
      "IMPORTANT — @mentions and context:",
      "All subscribed agents see your messages by default — address the group, not individuals.",
      "Use @agent-name only to request input from a specific agent who hasn't been active, or to delegate a task.",
      "When you do, provide context — they may not have read the conversation history.",
    ].join("\n"),
  };

  if (allActive || groups.has("access")) {
    rules.accessRequestRules = [
      "IMPORTANT — Access requests:",
      "If you try to subscribe to a conversation you don't have access to, an access request is created automatically.",
      "Subscribers of that conversation can approve or deny your request via list_access_requests + respond_to_access_request.",
      "Check your request status with get_my_access_requests.",
    ].join("\n");
  }

  if (allActive || groups.has("members")) {
    rules.membershipRules = [
      "IMPORTANT — Project membership:",
      "Projects have an access_mode: 'visible' (appears in listings, subscribe requires membership or access request) or 'hidden' (invisible to non-members).",
      "You must be a project member to create conversations or subscribe directly. Non-members of visible projects can request access.",
      "Project owners can add/remove members via add_member/remove_member. Use list_members to see who's in a project.",
      "Human users bypass membership checks — they can see and join all projects freely.",
    ].join("\n");
  }

  if (allActive || groups.has("skills")) {
    rules.skillsRules = [
      "IMPORTANT — Skills system (progressive disclosure):",
      "Skills provide behavioral instructions and context. They use 3-tier progressive disclosure to save context:",
      "- Tier 1 (metadata): When you subscribe, you receive skill metadata (title, summary, instructions, tags) — NOT the full content.",
      "- Tier 2 (content): Call get_skill(skill_id) to load the full content of a skill you need.",
      "- Tier 3 (files): Call get_skill_file(skill_id, filename) to load supporting files attached to a skill.",
      "Only load tier 2/3 when you actually need the detail. The summary and instructions fields give you enough to decide.",
    ].join("\n");
  }

  if (allActive || groups.has("attachments")) {
    rules.attachmentRules = [
      "IMPORTANT — File attachments:",
      "Agents can share files (images, code, documents) via message attachments.",
      "Two-step workflow: (1) upload_attachment → get attachment ID, (2) send_message with attachment_ids to link them.",
      "To download: get_messages returns attachment metadata, then get_attachment to fetch content as base64.",
      "Attachments belong to a conversation. Only the creator can delete their attachments.",
    ].join("\n");
  }

  if (allActive || groups.has("tasks")) {
    rules.delegationRules = [
      "IMPORTANT — Delegation protocol:",
      "To delegate work to another agent, use the task system (create_task with required_capabilities).",
      "For informal delegation in conversation, use message type 'proposal' with tag 'action-request'.",
      "When accepting delegated work, respond with type 'status' and tag 'action-accepted'.",
      "When reporting results, use type 'result' with tag 'action-result'.",
      "To decline, explain why in a regular message.",
    ].join("\n");
  }

  if (keryxActive) {
    rules.keryxRules = [
      "IMPORTANT — Keryx discussion manager:",
      "This bridge uses Keryx, a discussion manager that organizes conversations into rounds.",
      "Respond once per round. Use [NO_RESPONSE] if you have nothing new to add.",
      "Do not respond more than once per round. Follow Keryx process instructions.",
      "When Keryx requests a synthesis, summarize key points, agreements, disagreements, and open questions.",
    ].join("\n");
  }

  return rules;
}

// ---------------------------------------------------------------------------
// MCP Renderer
// ---------------------------------------------------------------------------

/**
 * Render bridge rules as MCP instructions string.
 * Output matches the original hardcoded format in server.ts exactly.
 */
export function renderForMcpInstructions(rules: BridgeRules): string {
  const parts: string[] = [
    "You are connected to Agorai, a multi-agent collaboration bridge.",
    "",
    rules.messageTracking,
    "",
    rules.visibilityRules,
    "",
    rules.metadataModel,
    "",
    rules.workflow,
    "",
    rules.mentionRules,
  ];

  if (rules.accessRequestRules) {
    parts.push("", rules.accessRequestRules);
  }

  if (rules.membershipRules) {
    parts.push("", rules.membershipRules);
  }

  if (rules.skillsRules) {
    parts.push("", rules.skillsRules);
  }

  if (rules.attachmentRules) {
    parts.push("", rules.attachmentRules);
  }

  if (rules.delegationRules) {
    parts.push("", rules.delegationRules);
  }

  if (rules.keryxRules) {
    parts.push("", rules.keryxRules);
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Context Builder
// ---------------------------------------------------------------------------

/**
 * Build a complete AgentContext by querying the store.
 * All queries are SQLite (microsecond-level). Uses Promise.all where possible.
 */
export async function buildAgentContext(opts: BuildContextOptions): Promise<AgentContext> {
  const {
    store,
    agentId,
    conversationId,
    includeMessages = false,
    messageLimit = 20,
    activeToolGroups,
    decisionDepth,
    keryxActive,
  } = opts;

  // Phase 1: agent identity (needed for skills query)
  const agent = await store.getAgent(agentId);
  if (!agent) {
    throw new Error(`Agent ${agentId} not found`);
  }

  const identity: AgentContext["identity"] = {
    agentId: agent.id,
    agentName: agent.name,
    agentType: agent.type,
    clearanceLevel: agent.clearanceLevel,
  };

  const bridgeRules = buildBridgeRules(activeToolGroups, keryxActive);

  // Phase 2: parallel queries (all independent)
  const promises: {
    conversation?: Promise<Conversation | null>;
    project?: Promise<Project | null>;
    subscribers?: Promise<Subscription[]>;
    skills: Promise<SkillMetadata[]>;
    projectMemory?: Promise<MemoryEntry[]>;
    agentMemoryGlobal: Promise<{ content: string } | null>;
    agentMemoryProject?: Promise<{ content: string } | null>;
    agentMemoryConversation?: Promise<{ content: string } | null>;
    messages?: Promise<Message[]>;
    agents?: Promise<Agent[]>;
  } = {
    skills: conversationId
      ? store.getMatchingSkills(
          { name: agent.name, type: agent.type, capabilities: agent.capabilities },
          conversationId,
        )
      : Promise.resolve([]),
    agentMemoryGlobal: store.getAgentMemory(agentId, "global"),
  };

  if (conversationId) {
    promises.conversation = store.getConversation(conversationId);
    promises.subscribers = store.getSubscribers(conversationId);
    promises.agentMemoryConversation = store.getAgentMemory(agentId, "conversation", conversationId);

    if (includeMessages) {
      promises.messages = store.getMessages(conversationId, agentId, { limit: messageLimit });
    }
  }

  // Await conversation first to get projectId for project-scoped queries
  const conversation = conversationId ? await promises.conversation : undefined;
  const projectId = conversation?.projectId;

  if (projectId) {
    promises.project = store.getProject(projectId, agentId);
    promises.projectMemory = store.getMemory(projectId, agentId, { limit: 10 });
    promises.agentMemoryProject = store.getAgentMemory(agentId, "project", projectId);
  }

  // Await all remaining parallel queries
  const [
    skills,
    subscribers,
    agentMemGlobal,
    agentMemProject,
    agentMemConversation,
    messages,
    project,
    projectMemory,
  ] = await Promise.all([
    promises.skills,
    promises.subscribers ?? Promise.resolve([]),
    promises.agentMemoryGlobal,
    promises.agentMemoryProject ?? Promise.resolve(null),
    promises.agentMemoryConversation ?? Promise.resolve(null),
    promises.messages ?? Promise.resolve([]),
    promises.project ?? Promise.resolve(null),
    promises.projectMemory ?? Promise.resolve([]),
  ]);

  // Build conversation context with subscriber details
  let conversationContext: AgentContext["conversation"] | undefined;
  if (conversation && project) {
    // Get last-seen info for online status (5 min threshold)
    const allAgents = await store.listAgents();
    const agentMap = new Map(allAgents.map(a => [a.id, a]));
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    conversationContext = {
      conversationId: conversation.id,
      projectId: project.id,
      projectName: project.name,
      confidentialityMode: project.confidentialityMode,
      defaultVisibility: conversation.defaultVisibility,
      subscribers: subscribers.map(sub => {
        const a = agentMap.get(sub.agentId);
        return {
          name: a?.name ?? sub.agentId,
          type: a?.type ?? "unknown",
          online: a ? a.lastSeenAt >= fiveMinAgo : false,
        };
      }),
    };
  }

  // Build agent name map for messages
  let recentMessages: AgentContext["recentMessages"] | undefined;
  if (includeMessages && messages.length > 0) {
    const agentNameMap = new Map<string, string>();
    agentNameMap.set(agentId, agent.name);

    for (const msg of messages) {
      if (!agentNameMap.has(msg.fromAgent)) {
        const sender = await store.getAgent(msg.fromAgent);
        agentNameMap.set(msg.fromAgent, sender?.name ?? msg.fromAgent);
      }
    }

    recentMessages = { messages, agentNameMap };
  }

  return {
    identity,
    bridgeRules,
    conversation: conversationContext,
    skills,
    projectMemory,
    agentMemory: {
      global: agentMemGlobal?.content,
      project: agentMemProject?.content,
      conversation: agentMemConversation?.content,
    },
    recentMessages,
    activeToolGroups,
    decisionDepth,
  };
}

// ---------------------------------------------------------------------------
// Prompt Renderer (for API/Ollama internal agents)
// ---------------------------------------------------------------------------

/**
 * Render AgentContext into system + conversation prompts for LLM adapters.
 */
export function renderForPrompt(
  context: AgentContext,
  mode: "passive" | "active",
): { systemPrompt: string; conversationPrompt: string } {
  const { identity, bridgeRules, conversation, skills, projectMemory, agentMemory } = context;

  // --- System prompt ---
  const systemParts: string[] = [];

  // Identity
  systemParts.push(
    `You are ${identity.agentName}, an AI agent in a multi-agent conversation on Agorai.`,
  );
  if (mode === "active") {
    systemParts.push([
      "You are in a multi-agent collaboration. Read and engage with other agents' messages — agree, disagree, build on their ideas, or challenge them.",
      "Respond to BOTH human messages and other agents' messages. Do NOT just answer the human — react to what other agents said too.",
      "If you disagree or have a genuinely new perspective, explain it. If you mostly agree, keep it very brief.",
      "IMPORTANT: Do NOT respond just to show agreement or summarize what others said. 'I agree with X' adds no value. If the group has reached consensus and you have nothing NEW to add, reply with exactly [NO_RESPONSE].",
      "Signs you should use [NO_RESPONSE]: the discussion is converging, key points are covered, you'd mostly be restating others' ideas, or someone already summarized the conclusion.",
      "IMPORTANT — @mentions: When a message uses @agent-name, it tags that specific agent for that part of the message. If a part of the message is clearly directed at another agent (e.g. '@mistral-medium what do you think?'), do NOT answer that part — let the tagged agent handle it. Only respond to parts addressed to you by name or to the group generally. A message can mix group content with @targeted questions; respond to what concerns you, skip what is explicitly for someone else. If the ENTIRE message is directed at a specific agent and not you, reply with [NO_RESPONSE].",
      "CRITICAL: Only speak as yourself. NEVER simulate, impersonate, or write on behalf of other agents. Do NOT prefix your message with other agents' names or create fake dialogue. You are ONLY " + identity.agentName + ".",
    ].join(" "));
    if (context.decisionDepth && context.decisionDepth > 0) {
      systemParts.push(
        `Aim to reach a conclusion quickly. You have a maximum of ${context.decisionDepth} exchanges per topic, but stop EARLIER if consensus is reached. Quality over quantity — one strong contribution beats five repetitive ones.`,
      );
    }
  }

  if (mode === "passive") {
    systemParts.push(
      `You are in passive mode — only respond when someone @mentions you by name (@${identity.agentName}). Otherwise, reply with exactly [NO_RESPONSE].`,
    );
  }

  // Bridge rules (compact for prompt)
  systemParts.push("");
  systemParts.push("## Bridge Rules");
  systemParts.push(bridgeRules.visibilityRules);
  systemParts.push(bridgeRules.mentionRules);
  if (bridgeRules.keryxRules) {
    systemParts.push(bridgeRules.keryxRules);
  }

  // Conversation context
  if (conversation) {
    systemParts.push("");
    systemParts.push("## Current Conversation");
    systemParts.push(`Project: ${conversation.projectName} (${conversation.confidentialityMode} mode)`);
    systemParts.push(`Default visibility: ${conversation.defaultVisibility}`);
    const subscriberList = conversation.subscribers
      .map(s => `${s.name} (${s.type}${s.online ? ", online" : ""})`)
      .join(", ");
    if (subscriberList) {
      systemParts.push(`Subscribers: ${subscriberList}`);
    }
  }

  // Skills instructions (tier 1 — instructions field only)
  const skillsWithInstructions = skills.filter(s => s.instructions);
  if (skillsWithInstructions.length > 0) {
    systemParts.push("");
    systemParts.push("## Skills");
    for (const skill of skillsWithInstructions) {
      systemParts.push(`[${skill.title}]: ${skill.instructions}`);
    }
  }

  // Project memory (top entries, truncated)
  if (projectMemory.length > 0) {
    systemParts.push("");
    systemParts.push("## Project Memory");
    for (const entry of projectMemory) {
      const truncated = entry.content.length > 200
        ? entry.content.slice(0, 200) + "…"
        : entry.content;
      systemParts.push(`[${entry.title}]: ${truncated}`);
    }
  }

  // Agent memory (all scopes)
  const memoryParts: string[] = [];
  if (agentMemory.global) memoryParts.push(`Global: ${agentMemory.global}`);
  if (agentMemory.project) memoryParts.push(`Project: ${agentMemory.project}`);
  if (agentMemory.conversation) memoryParts.push(`Conversation: ${agentMemory.conversation}`);
  if (memoryParts.length > 0) {
    systemParts.push("");
    systemParts.push("## Your Memory");
    systemParts.push(...memoryParts);
  }

  const systemPrompt = systemParts.join("\n");

  // --- Conversation prompt (recent messages) ---
  let conversationPrompt = "";
  if (context.recentMessages && context.recentMessages.messages.length > 0) {
    const { messages, agentNameMap } = context.recentMessages;
    const promptParts: string[] = [];

    for (const msg of messages) {
      const senderName = agentNameMap.get(msg.fromAgent) ?? msg.fromAgent;
      const role = msg.fromAgent === identity.agentId ? "you" : senderName;
      const vis = msg.visibility !== "team" ? ` [${msg.visibility}]` : "";
      promptParts.push(`[${role}]${vis}: ${msg.content}`);
    }

    conversationPrompt = promptParts.join("\n\n");
  }

  return { systemPrompt, conversationPrompt };
}
