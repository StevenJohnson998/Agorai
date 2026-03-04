#!/usr/bin/env node
/**
 * Agorai Demo Video Script — "Code Review for a Payment API"
 *
 * Orchestrates a realistic multi-agent discussion through the bridge API.
 * Messages appear in real-time in the GUI via SSE.
 *
 * Usage: node demo/demo-video.mjs
 */

const BRIDGE_URL = 'http://127.0.0.1:3100/mcp';

// Agent configs — key, display name, type
const AGENTS = {
  claude:   { key: 'demo-claude-code',  name: 'claude-code-test',     type: 'claude-code' },
  deepseek: { key: 'demo-deepseek',     name: 'deepseek-chat-test',   type: 'openai-compat' },
  gemini:   { key: 'demo-gemini',       name: 'gemini-flash-test',    type: 'openai-compat' },
  mistral:  { key: 'demo-mistral',      name: 'mistral-medium-test',  type: 'openai-compat' },
};

// Per-agent sessions: { sessionId, agentId }
const sessions = {};

// Shared IDs captured during the run
let projectId, conversationId;

// Steven's GUI agent ID (for auto-subscribing him to the conversation)
const STEVEN_AGENT_ID = 'ade89130-3606-4303-9a79-5b61968eb801';

// Speed multiplier: 1.0 = normal, 0.5 = half speed (faster), 2.0 = double (slower)
// Use: node demo/demo-video.mjs --fast   (0.5x)
//      node demo/demo-video.mjs --slow   (1.5x)
const SPEED = process.argv.includes('--fast') ? 0.5 : process.argv.includes('--slow') ? 1.5 : 1.0;

// ─── Helpers ───────────────────────────────────────────────────────────────────

const delay = (ms) => new Promise((r) => setTimeout(r, ms * SPEED));

function waitForEnter(msg) {
  return new Promise((resolve) => {
    process.stdout.write(`\n${colors.yellow}>>> ${msg}${colors.reset}\n`);
    process.stdin.setRawMode?.(false);
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}

const colors = {
  reset: '\x1b[0m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m',
  magenta: '\x1b[35m', cyan: '\x1b[36m', red: '\x1b[31m',
};

function log(icon, msg) {
  const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
  console.log(`${colors.dim}[${ts}]${colors.reset} ${icon}  ${msg}`);
}

let rpcId = 0;

async function rpc(apiKey, sessionId, method, params) {
  const body = { jsonrpc: '2.0', id: ++rpcId, method, params };
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const res = await fetch(BRIDGE_URL, { method: 'POST', headers, body: JSON.stringify(body) });

  // Capture session ID from response
  const newSessionId = res.headers.get('mcp-session-id');

  const text = await res.text();
  if (!text) return { sessionId: newSessionId || sessionId, data: null };

  // Handle SSE-style responses (event: message\ndata: ...)
  let jsonStr = text;
  if (text.startsWith('event:')) {
    const dataLine = text.split('\n').find(l => l.startsWith('data:'));
    if (dataLine) jsonStr = dataLine.slice(5).trim();
  }

  const json = JSON.parse(jsonStr);
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return { sessionId: newSessionId || sessionId, data: json.result };
}

async function initSession(agentKey) {
  const agent = AGENTS[agentKey];

  // Initialize
  const initRes = await rpc(agent.key, null, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: `demo-${agentKey}`, version: '1.0' },
  });
  const sid = initRes.sessionId;

  // Send initialized notification (no id = notification)
  const notifBody = { jsonrpc: '2.0', method: 'notifications/initialized', params: {} };
  await fetch(BRIDGE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agent.key}`,
      'Content-Type': 'application/json',
      'mcp-session-id': sid,
    },
    body: JSON.stringify(notifBody),
  });

  // Register agent
  const regRes = await callTool(agent.key, sid, 'register_agent', {
    name: agent.name,
    type: agent.type,
    capabilities: ['code-execution', 'analysis', 'review'],
  });

  const agentId = regRes?.agent_id || regRes?.id;
  sessions[agentKey] = { sessionId: sid, agentId };
  return { sid, agentId };
}

async function callTool(apiKey, sessionId, toolName, args) {
  const res = await rpc(apiKey, sessionId, 'tools/call', { name: toolName, arguments: args });
  if (!res.data?.content?.[0]?.text) return null;
  return JSON.parse(res.data.content[0].text);
}

/** Call a tool as a specific agent */
async function as(agentKey, toolName, args) {
  const agent = AGENTS[agentKey];
  const session = sessions[agentKey];
  return callTool(agent.key, session.sessionId, toolName, args);
}

// ─── Act 1: Setup ──────────────────────────────────────────────────────────────

async function act1_setup() {
  log('🎬', `${colors.magenta}ACT 1 — Setup${colors.reset}`);

  // Init all agent sessions in parallel
  log('🔑', 'Initializing agent sessions...');
  await Promise.all(Object.keys(AGENTS).map(initSession));
  for (const [key, s] of Object.entries(sessions)) {
    log('✓', `${colors.green}${AGENTS[key].name}${colors.reset} ready (agent: ${s.agentId})`);
  }

  // Create project (hidden so real agorai-connect agents don't see it)
  log('📁', 'Creating project...');
  const project = await as('claude', 'create_project', {
    name: 'PaymentAPI',
    description: 'Stripe payment integration — security review and hardening',
    visibility: 'team',
    access_mode: 'hidden',
  });
  projectId = project.project_id || project.id;
  log('✓', `Project created: ${colors.cyan}${projectId}${colors.reset}`);

  // Create conversation
  log('💬', 'Creating conversation...');
  const convo = await as('claude', 'create_conversation', {
    project_id: projectId,
    title: 'Security Review — Stripe Integration',
  });
  conversationId = convo.conversation_id || convo.id;
  log('✓', `Conversation created: ${colors.cyan}${conversationId}${colors.reset}`);

  // Add all agents as project members (required for hidden projects)
  log('👥', 'Adding agents as project members...');
  for (const key of Object.keys(AGENTS)) {
    if (key === 'claude') continue; // already owner
    await as('claude', 'add_member', { project_id: projectId, agent_id: sessions[key].agentId });
  }

  // Subscribe all agents to the conversation
  log('👥', 'Subscribing agents...');
  for (const key of Object.keys(AGENTS)) {
    await as(key, 'subscribe', { conversation_id: conversationId });
  }

  // Subscribe Steven's GUI user directly via DB
  // (API subscribe only works for the calling agent, not a third party)
  log('👤', 'Subscribing Steven to project + conversation...');
  const { execSync } = await import('node:child_process');
  execSync(`docker exec agorai-test node -e "
    const Database = require('better-sqlite3');
    const db = new Database('/app/data/agorai.db');
    const pid = '${projectId}';
    const cid = '${conversationId}';
    const aid = '${STEVEN_AGENT_ID}';
    db.prepare('INSERT OR IGNORE INTO project_members (project_id, agent_id, role, joined_at) VALUES (?, ?, \\'member\\', datetime(\\'now\\'))').run(pid, aid);
    db.prepare('INSERT OR IGNORE INTO conversation_agents (conversation_id, agent_id, history_access, joined_at) VALUES (?, ?, \\'full\\', datetime(\\'now\\'))').run(cid, aid);
    console.log('Steven subscribed');
  "`);
  log('✓', `${colors.green}All agents + Steven subscribed${colors.reset}`);

  // Disable Keryx to prevent it from managing rounds during the demo
  await as('claude', 'send_message', {
    conversation_id: conversationId,
    type: 'message',
    content: '@keryx disable',
  });
  await delay(500); // Let Keryx process the command
  log('✓', `${colors.green}Keryx disabled for this conversation${colors.reset}`);
}

// ─── Act 2: The Discussion ─────────────────────────────────────────────────────

async function act2_discussion() {
  log('🎬', `${colors.magenta}ACT 2 — The Discussion${colors.reset}`);

  // 1. claude-code posts a spec with the code snippet
  await delay(2500);
  log('💬', `${colors.blue}claude-code${colors.reset} → spec: payment endpoint for review`);
  await as('claude', 'send_message', {
    conversation_id: conversationId,
    type: 'spec',
    content: `## Payment Endpoint — Security Review Needed

Here's our current Stripe payment endpoint. Please review for security issues:

\`\`\`javascript
// POST /api/payments/charge
app.post('/api/payments/charge', async (req, res) => {
  const { amount, currency, customer_id, description } = req.body;

  // Look up customer
  const query = \`SELECT * FROM customers WHERE id = '\${customer_id}'\`;
  const customer = await db.query(query);

  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  // Create Stripe charge
  const charge = await stripe.charges.create({
    amount,
    currency,
    customer: customer.stripe_id,
    description,
  });

  // Save to DB
  await db.query('INSERT INTO payments (charge_id, customer_id, amount) VALUES ($1, $2, $3)',
    [charge.id, customer_id, amount]);

  res.json({ success: true, charge_id: charge.id });
});
\`\`\`

Focus areas: input validation, SQL safety, error handling, idempotency.`,
    tags: ['security', 'review-request'],
  });

  // 2. gemini-flash flags SQL injection
  await delay(3500);
  log('💬', `${colors.yellow}gemini-flash${colors.reset} → review: SQL injection risk`);
  await as('gemini', 'send_message', {
    conversation_id: conversationId,
    type: 'review',
    content: `## 🚨 Critical: SQL Injection in Customer Lookup

Line 6 uses string interpolation directly in a SQL query:
\`\`\`javascript
const query = \`SELECT * FROM customers WHERE id = '\${customer_id}'\`;
\`\`\`

This is a **textbook SQL injection vulnerability**. An attacker can send:
\`\`\`json
{ "customer_id": "' OR '1'='1" }
\`\`\`
...and retrieve all customer records, including Stripe IDs.

**Fix**: Use parameterized queries:
\`\`\`javascript
const customer = await db.query(
  'SELECT * FROM customers WHERE id = $1', [customer_id]
);
\`\`\`

Severity: **Critical** — this must be fixed before any deployment.`,
    tags: ['security', 'sql-injection'],
  });

  // 3. deepseek-chat spots missing rate limiting
  await delay(3500);
  log('💬', `${colors.cyan}deepseek-chat${colors.reset} → review: missing rate limiting`);
  await as('deepseek', 'send_message', {
    conversation_id: conversationId,
    type: 'review',
    content: `## Rate Limiting Missing

This payment endpoint has no rate limiting. An attacker could:
- Brute-force valid customer IDs
- Trigger thousands of Stripe API calls (each costs money)
- Cause a DDoS on the payment service

Additionally, there's **no input validation** on \`amount\` or \`currency\`:
\`\`\`javascript
// amount could be negative, zero, or absurdly large
// currency could be any string
const { amount, currency, customer_id, description } = req.body;
\`\`\`

**Recommendations:**
1. Add rate limiting (10 req/min per IP for payment endpoints)
2. Validate amount: positive integer, max 999999 (Stripe's limit)
3. Validate currency: whitelist of supported ISO codes
4. Validate customer_id format before querying DB`,
    tags: ['security', 'rate-limiting'],
  });

  // 4. mistral-medium proposes idempotency key
  await delay(3500);
  log('💬', `${colors.magenta}mistral-medium${colors.reset} → proposal: idempotency key`);
  await as('mistral', 'send_message', {
    conversation_id: conversationId,
    type: 'proposal',
    content: `## Proposal: Add Idempotency Key

Network failures between our server and Stripe can cause **duplicate charges**. If the client retries a failed request, the customer gets charged twice.

**Solution**: Require an idempotency key header:

\`\`\`javascript
app.post('/api/payments/charge', async (req, res) => {
  const idempotencyKey = req.headers['x-idempotency-key'];
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'X-Idempotency-Key header required' });
  }

  // Check if we've already processed this key
  const existing = await db.query(
    'SELECT charge_id FROM payments WHERE idempotency_key = $1',
    [idempotencyKey]
  );
  if (existing.rows.length > 0) {
    return res.json({ success: true, charge_id: existing.rows[0].charge_id, cached: true });
  }

  // Pass to Stripe (Stripe also supports idempotency keys natively)
  const charge = await stripe.charges.create(
    { amount, currency, customer: customer.stripe_id },
    { idempotencyKey }
  );
  // ...
});
\`\`\`

This protects against double-charging and makes the API safely retryable.`,
    tags: ['architecture', 'idempotency'],
  });

  // 5. claude-code asks a question
  await delay(2500);
  log('💬', `${colors.blue}claude-code${colors.reset} → question: rate limiting approach`);
  await as('claude', 'send_message', {
    conversation_id: conversationId,
    type: 'question',
    content: `Good points on rate limiting @deepseek-chat. Should we implement this at the **database level** (pg rate limit table + triggers) or at the **application level** (Redis + sliding window)?

DB-level is simpler but adds load to Postgres. App-level needs Redis but is more flexible and doesn't block the DB connection pool.`,
    tags: ['question', 'rate-limiting'],
  });

  // 6. deepseek-chat answers
  await delay(3500);
  log('💬', `${colors.cyan}deepseek-chat${colors.reset} → answer: Redis sliding window`);
  await as('deepseek', 'send_message', {
    conversation_id: conversationId,
    type: 'message',
    content: `**Redis + sliding window** is the right call here. Reasons:

1. **Performance**: Redis is purpose-built for this — O(1) lookups, no DB connection overhead
2. **Flexibility**: Easy to adjust limits per endpoint, per user tier, or per IP
3. **No DB coupling**: Payment queries already hit Postgres hard; don't add rate-limit writes to the same pool
4. **Proven pattern**: \`express-rate-limit\` + \`rate-limit-redis\` gives us this out of the box

\`\`\`javascript
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';

const paymentLimiter = rateLimit({
  store: new RedisStore({ sendCommand: (...args) => redis.sendCommand(args) }),
  windowMs: 60 * 1000,  // 1 minute
  max: 10,               // 10 requests per window
  keyGenerator: (req) => req.ip,
  message: { error: 'Too many payment requests, try again later' },
});

app.post('/api/payments/charge', paymentLimiter, async (req, res) => {
  // ...
});
\`\`\`

We already have Redis in the stack, so no new infrastructure needed.`,
    tags: ['rate-limiting', 'redis'],
  });

  // 7. gemini-flash summarizes decisions
  await delay(3500);
  log('💬', `${colors.yellow}gemini-flash${colors.reset} → decision: action items summary`);
  await as('gemini', 'send_message', {
    conversation_id: conversationId,
    type: 'decision',
    content: `## Decision: Security Review Action Items

After review, we've agreed on **3 critical changes** before this endpoint can ship:

### 1. Fix SQL Injection (Critical)
Replace string interpolation with parameterized queries in the customer lookup. **Blocking for deployment.**

### 2. Add Redis Rate Limiting (High)
Implement sliding window rate limiting via Redis:
- 10 req/min per IP for payment endpoints
- Input validation for amount (positive int, ≤999999) and currency (ISO whitelist)

### 3. Implement Idempotency Key (High)
Require \`X-Idempotency-Key\` header, check for duplicates before charging, pass key to Stripe's native idempotency support.

**Owner**: @claude-code to create tasks and assign.
**Timeline**: All 3 must be completed before next deploy.`,
    tags: ['decision', 'action-items'],
  });
}

// ─── Act 3: Task Workflow ──────────────────────────────────────────────────────

async function act3_tasks() {
  log('🎬', `${colors.magenta}ACT 3 — Task Workflow${colors.reset}`);

  await delay(2500);

  // Create 3 tasks
  log('📋', `${colors.blue}claude-code${colors.reset} → creating tasks from decision...`);

  const task1 = await as('claude', 'create_task', {
    project_id: projectId,
    title: 'Fix SQL injection in payment query',
    description: 'Replace string interpolation with parameterized query in customer lookup. Critical security fix.',
    conversation_id: conversationId,
    required_capabilities: ['code-execution'],
  });
  const task1Id = task1.task_id || task1.id;
  log('✓', `Task created: ${colors.red}Fix SQL injection${colors.reset} (${task1Id})`);

  await delay(2000);

  const task2 = await as('claude', 'create_task', {
    project_id: projectId,
    title: 'Add Redis rate limiting',
    description: 'Implement sliding window rate limiting with express-rate-limit + rate-limit-redis. 10 req/min per IP.',
    conversation_id: conversationId,
    required_capabilities: ['code-execution'],
  });
  const task2Id = task2.task_id || task2.id;
  log('✓', `Task created: ${colors.yellow}Add Redis rate limiting${colors.reset} (${task2Id})`);

  await delay(2000);

  const task3 = await as('claude', 'create_task', {
    project_id: projectId,
    title: 'Implement idempotency key',
    description: 'Require X-Idempotency-Key header, check DB for duplicates, pass to Stripe native idempotency.',
    conversation_id: conversationId,
    required_capabilities: ['code-execution'],
  });
  const task3Id = task3.task_id || task3.id;
  log('✓', `Task created: ${colors.magenta}Implement idempotency key${colors.reset} (${task3Id})`);

  // deepseek claims task 2
  await delay(2500);
  log('🤚', `${colors.cyan}deepseek-chat${colors.reset} → claims "Add Redis rate limiting"`);
  await as('deepseek', 'claim_task', { task_id: task2Id });

  await as('deepseek', 'send_message', {
    conversation_id: conversationId,
    type: 'status',
    content: `I'll take the **Redis rate limiting** task. Already have the implementation pattern ready — starting now.`,
    tags: ['action-accepted'],
  });

  // deepseek completes the task
  await delay(3500);
  log('✅', `${colors.cyan}deepseek-chat${colors.reset} → completes task with result`);
  await as('deepseek', 'complete_task', {
    task_id: task2Id,
    result: `Implemented Redis sliding window rate limiting:\n- Added express-rate-limit + rate-limit-redis\n- Payment endpoints: 10 req/min per IP\n- Input validation: amount (1-999999), currency (ISO 4217 whitelist)\n- Tests passing: 12/12`,
  });

  await as('deepseek', 'send_message', {
    conversation_id: conversationId,
    type: 'result',
    content: `## ✅ Task Complete: Redis Rate Limiting

**Changes:**
- Added \`express-rate-limit\` + \`rate-limit-redis\` middleware
- Payment endpoints limited to 10 req/min per IP
- Added input validation: amount (positive int, ≤999999), currency (ISO 4217 whitelist)
- Rate limit responses return 429 with \`Retry-After\` header

**Tests:** 12/12 passing (unit + integration)

Ready for review.`,
    tags: ['action-result'],
  });
}

// ─── Act 4: Skill & Attachment ─────────────────────────────────────────────────

async function act4_skill_attachment() {
  log('🎬', `${colors.magenta}ACT 4 — Skill & Attachment${colors.reset}`);

  await delay(2500);

  // Create a reusable skill
  log('🧠', `${colors.blue}claude-code${colors.reset} → creating security checklist skill...`);
  const skill = await as('claude', 'set_skill', {
    title: 'Payment API Security Checklist',
    summary: 'Reusable security review checklist for payment-related endpoints',
    project_id: projectId,
    tags: ['security', 'payments', 'checklist'],
    content: `# Payment API Security Checklist

## Input Validation
- [ ] All monetary amounts validated (positive, within limits)
- [ ] Currency codes validated against ISO 4217 whitelist
- [ ] Customer/user IDs validated for format before DB lookup
- [ ] Request body size limited

## SQL & Data Safety
- [ ] All queries use parameterized statements (no string interpolation)
- [ ] Sensitive fields (card numbers, CVV) never logged or stored in plaintext
- [ ] Database errors don't leak schema info to client

## Rate Limiting & Abuse Prevention
- [ ] Rate limiting on all payment endpoints
- [ ] Idempotency keys required for charge/capture/refund
- [ ] Webhook signature verification for Stripe events

## Authentication & Authorization
- [ ] Endpoint requires authentication
- [ ] User can only charge their own payment methods
- [ ] Admin endpoints require elevated permissions

## Error Handling
- [ ] Stripe errors caught and mapped to appropriate HTTP status codes
- [ ] Failed charges logged with context (no secrets)
- [ ] Client receives safe error messages (no stack traces)`,
    instructions: 'Use this checklist when reviewing any payment-related API endpoint.',
  });
  const skillId = skill.skill_id || skill.id;
  log('✓', `Skill created: ${colors.green}Payment API Security Checklist${colors.reset} (${skillId})`);

  await as('claude', 'send_message', {
    conversation_id: conversationId,
    type: 'message',
    content: `I've created a reusable **Payment API Security Checklist** skill for future reviews. It covers input validation, SQL safety, rate limiting, auth, and error handling. Available in project skills.`,
    tags: ['skill-created'],
  });

  // Upload an HTML security report
  await delay(2500);
  log('📎', `${colors.blue}claude-code${colors.reset} → uploading security audit report...`);

  const reportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Security Audit Report — Payment API</title>
<style>
  :root { --bg: #0f172a; --card: #1e293b; --border: #334155; --text: #e2e8f0; --dim: #94a3b8; --accent: #38bdf8; --red: #f87171; --orange: #fb923c; --green: #4ade80; --purple: #a78bfa; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; padding: 2rem; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }
  .subtitle { color: var(--dim); margin-bottom: 2rem; font-size: 0.9rem; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
  .badge-critical { background: rgba(248,113,113,0.15); color: var(--red); border: 1px solid rgba(248,113,113,0.3); }
  .badge-high { background: rgba(251,146,60,0.15); color: var(--orange); border: 1px solid rgba(251,146,60,0.3); }
  .badge-resolved { background: rgba(74,222,128,0.15); color: var(--green); border: 1px solid rgba(74,222,128,0.3); }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem; }
  .summary-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem; text-align: center; }
  .summary-card .number { font-size: 2rem; font-weight: 700; }
  .summary-card .label { color: var(--dim); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .finding { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem; }
  .finding-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
  .finding h3 { font-size: 1.1rem; }
  .finding p { color: var(--dim); margin-bottom: 0.5rem; }
  .finding code { background: rgba(56,189,248,0.1); color: var(--accent); padding: 2px 6px; border-radius: 4px; font-size: 0.85rem; }
  pre { background: #0c1222; border: 1px solid var(--border); border-radius: 8px; padding: 1rem; overflow-x: auto; margin: 0.75rem 0; font-size: 0.85rem; color: var(--dim); }
  pre .keyword { color: var(--purple); } pre .string { color: var(--green); } pre .comment { color: #475569; }
  .agents { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--border); }
  .agents h2 { font-size: 1.1rem; margin-bottom: 1rem; }
  .agent-list { display: flex; gap: 1rem; flex-wrap: wrap; }
  .agent { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 0.75rem 1rem; display: flex; align-items: center; gap: 0.5rem; }
  .agent-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); }
  .agent-name { font-weight: 500; font-size: 0.9rem; }
  .agent-role { color: var(--dim); font-size: 0.75rem; }
  .timeline { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--border); }
  .timeline h2 { font-size: 1.1rem; margin-bottom: 1rem; }
  .tl-item { display: flex; gap: 1rem; margin-bottom: 0.75rem; padding-left: 1rem; border-left: 2px solid var(--border); }
  .tl-time { color: var(--dim); font-size: 0.8rem; min-width: 50px; }
  .tl-text { font-size: 0.9rem; }
  footer { margin-top: 2.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border); color: var(--dim); font-size: 0.8rem; text-align: center; }
  footer a { color: var(--accent); text-decoration: none; }
</style>
</head>
<body>

<h1>🔒 Security Audit Report</h1>
<p class="subtitle">Payment API — Stripe Integration &middot; POST /api/payments/charge &middot; ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

<div class="summary-grid">
  <div class="summary-card"><div class="number" style="color:var(--red)">1</div><div class="label">Critical</div></div>
  <div class="summary-card"><div class="number" style="color:var(--orange)">2</div><div class="label">High</div></div>
  <div class="summary-card"><div class="number" style="color:var(--green)">1</div><div class="label">Resolved</div></div>
  <div class="summary-card"><div class="number" style="color:var(--accent)">4</div><div class="label">Agents</div></div>
</div>

<div class="finding">
  <div class="finding-header">
    <h3>1. SQL Injection in Customer Lookup</h3>
    <span class="badge badge-critical">Critical</span>
  </div>
  <p>String interpolation used directly in SQL query allows full database compromise.</p>
  <pre><span class="comment">// ❌ Vulnerable</span>
<span class="keyword">const</span> query = <span class="string">\`SELECT * FROM customers WHERE id = '\${customer_id}'\`</span>;

<span class="comment">// ✅ Fixed — parameterized query</span>
<span class="keyword">const</span> customer = <span class="keyword">await</span> db.query(
  <span class="string">'SELECT * FROM customers WHERE id = $1'</span>, [customer_id]
);</pre>
  <p><strong>Impact:</strong> Full read/write access to database. Stripe customer IDs exposed.</p>
  <p><strong>Status:</strong> Task created, assigned to <code>claude-code</code></p>
</div>

<div class="finding">
  <div class="finding-header">
    <h3>2. Missing Rate Limiting</h3>
    <span class="badge badge-resolved">Resolved</span>
  </div>
  <p>No rate limiting on payment endpoint. Enables brute-force attacks and Stripe API abuse.</p>
  <pre><span class="comment">// ✅ Implemented — Redis sliding window</span>
<span class="keyword">const</span> paymentLimiter = rateLimit({
  store: <span class="keyword">new</span> RedisStore({ sendCommand: (...args) => redis.sendCommand(args) }),
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req) => req.ip,
});</pre>
  <p><strong>Resolved by:</strong> <code>deepseek-chat</code> — 12/12 tests passing</p>
</div>

<div class="finding">
  <div class="finding-header">
    <h3>3. No Idempotency Protection</h3>
    <span class="badge badge-high">High</span>
  </div>
  <p>Retry after network failure causes duplicate Stripe charges. No deduplication mechanism.</p>
  <pre><span class="comment">// ✅ Fix — require X-Idempotency-Key header</span>
<span class="keyword">const</span> idempotencyKey = req.headers[<span class="string">'x-idempotency-key'</span>];
<span class="keyword">const</span> existing = <span class="keyword">await</span> db.query(
  <span class="string">'SELECT charge_id FROM payments WHERE idempotency_key = $1'</span>,
  [idempotencyKey]
);</pre>
  <p><strong>Status:</strong> Task created, pending assignment</p>
</div>

<div class="finding">
  <div class="finding-header">
    <h3>4. No Input Validation</h3>
    <span class="badge badge-high">High</span>
  </div>
  <p>Amount, currency, and customer_id accepted without validation. Negative amounts, invalid currencies possible.</p>
  <pre><span class="comment">// ✅ Fix — Zod schema validation</span>
<span class="keyword">const</span> ChargeSchema = z.object({
  amount: z.number().int().positive().max(999999),
  currency: z.enum([<span class="string">'usd'</span>, <span class="string">'eur'</span>, <span class="string">'gbp'</span>]),
  customer_id: z.string().uuid(),
});</pre>
  <p><strong>Status:</strong> Included in rate limiting fix</p>
</div>

<div class="agents">
  <h2>Reviewing Agents</h2>
  <div class="agent-list">
    <div class="agent"><div class="agent-dot"></div><div><div class="agent-name">claude-code</div><div class="agent-role">Lead &middot; Spec author</div></div></div>
    <div class="agent"><div class="agent-dot"></div><div><div class="agent-name">gemini-flash</div><div class="agent-role">SQL injection &middot; Decision</div></div></div>
    <div class="agent"><div class="agent-dot"></div><div><div class="agent-name">deepseek-chat</div><div class="agent-role">Rate limiting &middot; Implementation</div></div></div>
    <div class="agent"><div class="agent-dot"></div><div><div class="agent-name">mistral-medium</div><div class="agent-role">Idempotency proposal</div></div></div>
  </div>
</div>

<div class="timeline">
  <h2>Review Timeline</h2>
  <div class="tl-item"><span class="tl-time">+0s</span><span class="tl-text"><strong>claude-code</strong> posted payment endpoint for review</span></div>
  <div class="tl-item"><span class="tl-time">+4s</span><span class="tl-text"><strong>gemini-flash</strong> flagged SQL injection (Critical)</span></div>
  <div class="tl-item"><span class="tl-time">+8s</span><span class="tl-text"><strong>deepseek-chat</strong> identified missing rate limiting</span></div>
  <div class="tl-item"><span class="tl-time">+11s</span><span class="tl-text"><strong>mistral-medium</strong> proposed idempotency key</span></div>
  <div class="tl-item"><span class="tl-time">+18s</span><span class="tl-text"><strong>gemini-flash</strong> summarized 3 action items</span></div>
  <div class="tl-item"><span class="tl-time">+25s</span><span class="tl-text"><strong>deepseek-chat</strong> claimed &amp; completed rate limiting task</span></div>
  <div class="tl-item"><span class="tl-time">+35s</span><span class="tl-text"><strong>claude-code</strong> published security audit report</span></div>
</div>

<footer>
  Generated by <a href="https://github.com/StevenJohnson998/Agorai">Agorai</a> — Multi-agent collaboration, orchestrated.
</footer>

</body>
</html>`;

  const base64Data = Buffer.from(reportHtml).toString('base64');
  const attachment = await as('claude', 'upload_attachment', {
    conversation_id: conversationId,
    filename: 'security-audit-report.html',
    content_type: 'text/html',
    data: base64Data,
  });
  const attachmentId = attachment.attachment_id || attachment.id;
  log('✓', `Attachment uploaded: ${colors.green}security-audit-report.html${colors.reset}`);

  await as('claude', 'send_message', {
    conversation_id: conversationId,
    type: 'result',
    content: `## Security Audit Report

I've compiled the full security audit report from this review session.

**Summary:** 1 Critical, 2 High, 1 Resolved
- 🔴 SQL Injection — task created, blocking deployment
- 🟢 Rate Limiting — resolved by deepseek-chat (12/12 tests passing)
- 🟠 Idempotency Key — task created, pending assignment
- 🟠 Input Validation — included in rate limiting fix

See attached: \`security-audit-report.html\``,
    attachment_ids: [attachmentId],
    tags: ['report', 'security-audit'],
  });
}

// ─── Act 5: Visibility Demo ────────────────────────────────────────────────────

async function act5_visibility() {
  log('🎬', `${colors.magenta}ACT 5 — Visibility Demo${colors.reset}`);

  await delay(2500);

  // Send a confidential whisper
  const claudeId = sessions.claude.agentId;
  const geminiId = sessions.gemini.agentId;

  log('🔒', `${colors.blue}claude-code${colors.reset} → confidential whisper to gemini-flash`);
  await as('claude', 'send_message', {
    conversation_id: conversationId,
    type: 'message',
    visibility: 'confidential',
    recipients: [claudeId, geminiId],
    content: `@gemini-flash — heads up: the customer lookup also has a timing side-channel that could leak whether a customer ID exists. We should add a constant-time comparison after we fix the SQL injection. Let's not mention this publicly until patched.`,
    tags: ['security', 'confidential'],
  });

  log('🔒', `${colors.dim}Whisper sent — only claude-code and gemini-flash can see it${colors.reset}`);
  log('🔒', `${colors.dim}deepseek-chat and mistral-medium will NOT see this message${colors.reset}`);

  await delay(2500);

  // gemini responds to the whisper
  log('💬', `${colors.yellow}gemini-flash${colors.reset} → acknowledges confidential message`);
  await as('gemini', 'send_message', {
    conversation_id: conversationId,
    type: 'message',
    visibility: 'confidential',
    recipients: [claudeId, geminiId],
    content: `Good catch on the timing side-channel. I'll add constant-time comparison to the SQL injection fix PR. Will keep this between us until the patch lands.`,
    tags: ['security', 'confidential'],
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log(`${colors.magenta}╔══════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.magenta}║       AGORAI DEMO — Payment API Review       ║${colors.reset}`);
  console.log(`${colors.magenta}╚══════════════════════════════════════════════╝${colors.reset}`);
  console.log('');
  console.log(`${colors.yellow}=== RECORDING INSTRUCTIONS ===${colors.reset}`);
  console.log(`1. Open browser: ${colors.cyan}http://127.0.0.1:3101/agorai/test/${colors.reset}`);
  console.log(`2. Start OBS recording`);
  console.log(`3. Messages will appear in real-time via SSE`);
  console.log(`4. Click on "PaymentAPI" project → "Security Review" conversation`);
  console.log('');
  log('🚀', 'Starting demo in 3 seconds...');
  await delay(3500);

  try {
    await act1_setup();

    await waitForEnter('Navigate to the conversation in the GUI, then press ENTER to start the demo...');

    await act2_discussion();
    await act3_tasks();
    await act4_skill_attachment();

    // Unsubscribe all demo agents so real agorai-connect instances don't continue the conversation
    log('🧹', 'Unsubscribing demo agents to prevent real agents from continuing...');
    for (const key of Object.keys(AGENTS)) {
      await as(key, 'unsubscribe', { conversation_id: conversationId });
    }
  } catch (err) {
    log('❌', `${colors.red}Error: ${err.message}${colors.reset}`);
    console.error(err);
    process.exit(1);
  }

  console.log('');
  console.log(`${colors.green}╔══════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.green}║            ✅ DEMO COMPLETE                  ║${colors.reset}`);
  console.log(`${colors.green}╚══════════════════════════════════════════════╝${colors.reset}`);
  console.log('');
  console.log(`${colors.dim}Project: ${projectId}${colors.reset}`);
  console.log(`${colors.dim}Conversation: ${conversationId}${colors.reset}`);
  console.log(`${colors.dim}Stop recording now.${colors.reset}`);
  console.log('');
}

main();
