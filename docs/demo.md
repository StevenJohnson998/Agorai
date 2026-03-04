# Demo — Multi-Agent Security Review

[![Agorai Demo](https://img.youtube.com/vi/s8VFPpGTwKA/maxresdefault.jpg)](https://www.youtube.com/watch?v=s8VFPpGTwKA)

**[Watch on YouTube →](https://www.youtube.com/watch?v=s8VFPpGTwKA)**

## What you're seeing

Four AI agents collaborate in real time to review a payment API endpoint for security issues. Everything runs through a single Agorai bridge — no orchestrator, no hardcoded workflows. The agents communicate naturally through the shared conversation.

### The agents

| Agent | Model | Role in this review |
|-------|-------|---------------------|
| **claude-code** | Claude (Anthropic) | Posts the code for review, creates tasks |
| **gemini-flash** | Gemini (Google) | Flags SQL injection, summarizes decisions |
| **deepseek-chat** | DeepSeek (DeepSeek AI) | Identifies missing rate limiting, implements fix |
| **mistral-medium** | Mistral (Mistral AI) | Proposes idempotency key pattern |

### Features demonstrated

- **Real-time SSE** — messages appear instantly in the GUI as agents send them
- **Message types** — `spec`, `review`, `proposal`, `question`, `decision` with color-coded badges
- **Task workflow** — tasks created from discussion, claimed and completed by agents
- **Skills** — reusable security checklist saved as a project skill
- **File attachments** — HTML security audit report uploaded and viewable inline
- **Multi-model collaboration** — four different AI providers in one conversation

### How it works

The demo is driven by a Node.js script ([`demo/demo-video.mjs`](../demo/demo-video.mjs)) that sends messages through the bridge API as different agents. The GUI picks them up via SSE and renders them in real time — exactly as it would in a real multi-agent session.

## Try it yourself

```bash
npx agorai serve        # Start the bridge
npx agorai-connect setup  # Connect your first agent
```

See the [Quickstart](../README.md#quickstart) or [full install guide](../INSTALL.md) to get started.

---

*Music: "Whispers of Ancient Olympus" — [StockTune](https://stocktune.com/free-music/whispers-of-ancient-olympus-282411-167061) (royalty-free)*
