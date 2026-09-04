# driver/engine — how a stage reaches a model

Every reasoning stage in this system is a **child process**. The driver writes a prompt, spawns a coding
CLI, waits, and reads what the CLI wrote to disk. This directory is that boundary: two adapters
implementing one contract, the billing-mode resolver they share, and the tool servers a stage's model
process is handed.

There is no HTTP client here and no SDK. If you are looking for the place this code calls a model API, it
does not exist — that is the design, and [`CONTRACT.md`](CONTRACT.md) is the document that states it.

| File | Role |
|---|---|
| [`CONTRACT.md`](CONTRACT.md) | **The adapter contract.** What an engine must implement, the model-tier map, and what a turn is allowed to assume. Read this before either adapter |
| `anthropic-agent.mjs` | Spawns `claude -p`. Skill-reference absolutization, `--add-dir` grants, rate-limit and no-progress handling |
| `openai-agent.mjs` | Spawns `codex exec`. A per-run `CODEX_HOME` carrying a rendered `config.toml`, and the session-rollout reader that recovers the turn's usage |
| `auth.mjs` | `resolveAuthMode()` — subscription or API key, resolved once per turn and stamped on the telemetry |
| `probe.mjs` | Drives one cheap turn through whichever adapter is configured, to prove the engine can complete a turn at all. What `npm run setup` spends |
| `common.mjs` | Helpers both adapters share |
| `deny-authority-write.mjs` | A PreToolUse hook. `--add-dir` has no read-only form, so the read-only intent over the skills tree is enforced here |
| [`mcp/`](mcp/README.md) | The tool servers a stage mounts, and the per-stage grant table |

## One engine per install, chosen once

`CLEAROTRON_AI` selects the adapter, install-wide. There is no per-stage engine and no fallback between
them: a stage that cannot complete on the configured engine fails as that stage, rather than quietly
succeeding on the other one. A run's manifest records which engine served it.

## Billing mode is resolved here, and it fails loud

`resolveAuthMode()` is the single place "subscription or API key" is decided, and it is deliberately
unforgiving in one direction:

```
CLEAROTRON_AI_BILLING=api-key with no ANTHROPIC_API_KEY  → throws, by name, before any turn runs
CLEAROTRON_AI_BILLING=api-key    with no CODEX_API_KEY      → throws, by name, before any turn runs
```

The reason is a real footgun: a present API key **overrides** a CLI's stored subscription credentials, and
an absent one falls back to them. So both mistakes are silent by default — you believe you are metered and
you are not, or the reverse. The adapters therefore *strip* the key from the child environment on the
subscription lane (`anthropic-agent.mjs`, `openai-agent.mjs`) rather than trusting the child to prefer the
right credential, and the resolved `{ provider, mode, apiBilled }` is stamped on the per-attempt telemetry
row so a finished run can be **shown** to have billed the way it claimed.

`resolveAuthMode()` is provider-blind: an unknown engine gets `mode: "unknown"` and never throws.

## What a turn actually receives

A stage message, the files its `skillReads` names, and a tool surface assembled per stage by
[`mcp/gather-config.mjs`](mcp/README.md). Two things it does **not** receive: a credential in its config
(they reach the tool servers by environment inheritance) and any tool the grant table does not name.

The write boundary is enforced twice, because `--add-dir` grants read and write together: the
`deny-authority-write.mjs` hook refuses a write to the skills tree while the turn is live, and
`../stray-artifacts.mjs` sweeps afterwards for anything that landed where it should not.

## Where to start

`CONTRACT.md`, then `probe.mjs` — the probe is the shortest complete path through a turn, which makes it
the best way to see the contract being used before reading either adapter in full. `anthropic-agent.mjs` is
the reference implementation; `openai-agent.mjs` is the one to read if you want to know what a second
engine costs, because everything it does differently is a place the CLI differs rather than a place the
contract does.
