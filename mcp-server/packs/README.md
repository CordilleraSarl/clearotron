# Connector packs — the client-side glue for external agents

The MCP server controls **access** (auth, scopes, tools). A pack is the **other half**: a versioned,
installable bundle that makes a generic agent *good at using* this server — the portable skill text,
the per-host connection recipes, and worked example prompts. Three audiences, three packs:

| Pack | Audience | Surface | Token |
|---|---|---|---|
| `client/` | report recipients (client legal teams) | plain-language read layer: `brief`, `list_findings`, `read_artifact` (the report — the only artifact a report link may read), one run | the run-scoped link embedded in their report ("Ask your AI") |
| `account/` | a customer's own assistant, across all of that customer's searches | the client layer, the evidence reads (`list_evidence`, `list_searches`, `get_search_coverage`), the audit chain (`read_artifact` over the chain artifacts, `list_findings` raw, `get_finding`, `get_run`, `trace`, `decision_timeline` — owner ruling 2026-08-27), what-if as a QUEUED sandbox job (`what_if_plan`, `what_if_run`, `what_if_result`) and their own run lifecycle (`describe_options`, `plan_run`, `start_run`, `stop_run`) | their sign-in on the client surface, or an account API key (`mint-token.mjs --scope account`) — both refused unless that surface is started with `CLIENT_MCP_ACCOUNT_ACCESS=1` |
| `ops/` | integrator/operator agents that run searches and courier deliveries | `start_run` / `feed_context` / `stop_run`, the outbox courier verbs, triage reads | a verb-scoped ops token (`mint-token.mjs`, docs/architecture/06-operations-runbook.md) |

## Where the prompt text lives

**The `SKILL.md` files are not in this directory any more.** They moved to `skills/` at the repository
root, because a Claude Code plugin installs skills from there and the alternative was a second copy of
live doctrine drifting silently against this one:

| pack | prompt text |
|---|---|
| `client/` | [`skills/clearotron-client/SKILL.md`](../../skills/clearotron-client/SKILL.md) |
| `account/` | [`skills/clearotron-account/SKILL.md`](../../skills/clearotron-account/SKILL.md) |
| `ops/` | [`skills/clearotron-ops/SKILL.md`](../../skills/clearotron-ops/SKILL.md) + `COURIER.md` beside it |

`lib/instructions.mjs` reads them from there and serves them at `initialize`, stripping the YAML
frontmatter that makes them discoverable as skills — that frontmatter addresses the plugin host, not
the assistant being briefed.

**A pack has a second half now: the named prompts.**`server.mjs` serves a small set of
one-click questions — "Explain my report", "Walk me through the risks", "What wasn't covered",
"Compare the search options", "Draft a note to my team" — gated by audience the same way the packs
are, so a report-link principal is never offered an action its own briefing calls out of scope. They
are the connector's front door for a user who has not typed anything yet; keep them and the pack
saying the same thing.

## Installing a pack into an agent

The `SKILL.md` (and for ops, `COURIER.md`) is portable prompt text: paste it into Claude project
instructions, a ChatGPT GPT/system prompt, or any agent's system context — or, in Claude Code, install
the whole thing at once by opening this repository as a plugin (`.claude-plugin/plugin.json`).
`CONNECT.md` is for the human doing the wiring. `manifest.json` names the pack version, the files that
stayed here, and the `skill.directory` its prompt text moved to, so an integrator can pin + diff
upgrades.

## Versioning

Semver in `manifest.json`. Bump MINOR when guidance changes behavior, MAJOR when the server's tool
surface changes shape underneath it. The packs describe the tool surface of the server version they
ship with — install the pack that came with your server.
