# Contributing to Agorai

Contributions are welcome. Here's how to get started.

## Setup

```bash
git clone https://github.com/StevenJohnson998/Agorai.git
cd Agorai
npm install
npm run build
```

## Development

```bash
npm run lint     # type-check without emitting
npm run build    # full build
```

## What we're looking for

- **Bridge tools** — new collaboration tools for agent workflows
- **Store backends** — alternative storage backends (PostgreSQL, Redis, etc.)
- **Auth providers** — OAuth, JWT, external identity providers
- **Visibility filters** — custom filtering logic, auto-classification
- **Agent adapters** — new LLM integrations (OpenAI, local LLMs, etc.)
- **Consensus protocols** — new resolution strategies
- Bug fixes, edge case handling, and tests

## Pull requests

1. Fork the repo and create a feature branch
2. Make your changes
3. Make sure `npm run lint` passes
4. Open a PR with a clear description of what and why

Keep PRs focused. One feature or fix per PR.

## Code style

- TypeScript strict mode
- Interfaces over classes where possible
- Explicit types on public APIs, inferred elsewhere
- No `any` unless absolutely unavoidable (and document why)
- Early returns over deep nesting

## Contributor License Agreement

By submitting a pull request, you agree that your contributions are licensed under the project's AGPLv3 license and that the project maintainer retains the right to relicense contributions as part of a dual-licensing arrangement.

This is a standard open-core CLA. It lets us offer commercial licenses to companies that need them, while keeping the open-source version fully AGPLv3.

If you have questions about the CLA, open an issue and we'll clarify.

## Reporting issues

Open a GitHub issue. Include:
- What you expected
- What happened instead
- Steps to reproduce
- Your environment (OS, Node version, agent CLIs installed)
