# mcp-server/lib — where the tools' behaviour lives

`../server.mjs` declares the tool schemas and routes each call into this directory; the two HTTP faces
(`../http-server.mjs`, `../http-server-client.mjs`) route into the same modules, so the three faces cannot drift
into three policies. **Most of this reads and nothing else**; the modules that write or spend are named below.

## The chokepoints

Change behaviour in these files, never in a tool handler.

| File | Decides |
|---|---|
| `scope.mjs` | **Who may call what.** A re-export shim over `../../shared/scope.mjs` — the canonical minting and `authorize()` — because the report renderer mints the tokens this server verifies, and one copy cannot disagree with itself |
| `scrub.mjs` | **What artifact text a client sees.** The rule is *what the report already shows them, no more and no less*; `../../driver/portal-report.mjs` is the serve-time counterpart. Never add an MCP-only rule here |
| `evidence.mjs` | The evidence projection — named structured fields and enums derived from them, the one declared exception to the scrub. Its header states that no code path forwards free prose |
| `driver.mjs` | **The read path's coupling point to the driver.** `paths()`, `STAGE_ORDER`, `config` and the parse/verify/compare/progress exports come through here, so renaming one of those fails loudly in this file instead of drifting quietly. It is not the whole dependency surface: 24 other `../driver/` imports sit outside it — `plan.mjs`, `options.mjs`, `ops.mjs`, `evidence.mjs` and `whatif.mjs` import the engine's policy and gate modules directly, as do `../server.mjs` and `../http-server.mjs`. Nothing enforces the funnel — no import-discipline test, no lint rule |

## What writes or spends

- `ops.mjs` — the write verbs: `start_run`, `stop_run`, `feed_context`, plus the delivery seam
  (`list_outbox_events`, `get_delivery_packet`, `ack_event`, `mark_sent`). Writes in an agent's own queue and run
  dirs *and* clears `.pending` markers in the one shared outbox (`CLEAROTRON_OUTBOX_DIR`, default
  `<workspaceRoot>/prelim-outbox`), which is why `ack_event` is account-gated; shells nothing. **`start_run`
  enqueues a job that spends real money.**
- `whatif.mjs` — the approval-gated counterfactual. `whatIfPlan()` never spends and returns the cost prior, what
  downstream will *not* be recomputed, a completeness verdict and a `confirmationToken`; `whatIfRun(token)` re-runs
  one stage in `_experiments/`. Imported lazily, so the read path never pulls `exceljs` or a native addon.
- `audit.mjs` — the access log, appended only from `http-handler.mjs`; a locally spawned server writes no entry.

## Reading a run

| File | Answers |
|---|---|
| `runs.mjs` | Discovery. Walks `CLEAROTRON_WORK_DIR` for run directories, live and archived. **Mirrors** the driver's `progress.mjs` status walk rather than importing it, so this server stays a pure additive consumer — keep `SKIP_DIRS` in step |
| `artifacts.mjs` | Artifact name → the stage that produced it, and the versions that actually exist on disk (`_history/`, `_experiments/`) |
| `findings.mjs` | Structured findings from `audit.md`, with `buildAuditMd` as the backstop when it is absent, plus the curated cards |
| `brief.mjs` | The one plain-language briefing of a run, sourced from the published `report-data.json` — the start point for "what did the search find" |
| `trace.mjs` | Full provenance from any target back through the stage that emitted it, its inputs and their shas at consumption |
| `coverage.mjs` | What was searched vs what is a gap: per-artifact validity, per-axis presence, the coverage-ledger marker |
| `events.mjs` | `_driver/run.jsonl` projection — the decision timeline and the change feed are both folds over it |
| `usage.mjs` | Provider call tallies, recomputed live from the ledger and flagged when the cached figure has drifted |
| `lexsearch.mjs` | Ranked lexical line matching. `all` / `any` / `phrase`; no embeddings, no index |
| `plan.mjs`, `options.mjs` | The free preview of a job before it is queued, and the menu of what this deployment offers |
| `instructions.mjs` | Picks which pack under `../packs/` is served as the MCP `instructions` field |
| `cf-access.mjs`, `ratelimit.mjs`, `http-handler.mjs` | The hosted faces' JWT verification, rate limiting and request plumbing |
| `util.mjs` | Capped reads and mime resolution |

## Two rules learned the hard way

**Read what enforces, not what declares.** A tool a server module registers grants nothing until the grant table
names it; `../../driver/test/server-tools-granted-or-stated.test.mjs` exists so nobody holds that in their head.

**A pack is guidance, not a boundary.** `../packs/*/SKILL.md` shapes how a model answers and does nothing about
access. Access is `authorize()` plus the `clientSafe`/`accountSafe` gate; artifact text is `scrub.mjs`.

## Where to start

`driver.mjs`, then `runs.mjs` — together they are how this server finds anything at all. Then `scope.mjs` before any
tool file, because the answer to "can a client see this?" is never in the tool.
