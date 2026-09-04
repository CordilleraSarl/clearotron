# 08 — Development Guide

> Part of the architecture pack (`docs/architecture/`). The driver's module tree and the headless
> integrator contract are in [`driver/README.md`](../../driver/README.md).

How to work on the driver without breaking the properties that make it trustworthy. Read
[02 — Architecture](02-architecture.md) first; this chapter assumes its vocabulary.

## Dev environment

- **Node ≥ 22** (every workspace `package.json` declares it; CI pins 22.23.2). The repo is an npm
  workspace — `npm ci` at the root installs `driver`, `mcp-server`, `providers/oauth-mcp-bridge`
  and `portal-ui` together. Production deploys install with `--omit=dev --ignore-scripts`.
- **Tests**: `npm test` in the driver dir runs the *contributor* tier
  (`scripts/test-run.mjs` → `scripts/test-fast.mjs` over `test/*.test.mjs`), which leaves out the
  slowest end-to-end files so a first run finishes in minutes. `npm run test:full` is the
  unfiltered suite, and it is the merge gate: CI runs it, and `CONTRIBUTING.md` says nothing merges
  without it. Run tests through the
  script rather than bare `node --test`: the driver's wrapper is what sets the run up. The suite is
  offline by design — domain models are pure (no `node:` imports, no env reads), and the
  engine/gateway tests run against `test/mock-claude.mjs` / `test/mock-codex.mjs`, which also
  *enforce* the canonical usage shape (a wrong usage mapping fails the mock, not production).
- **If `fetch()` fails for every vendor API in your shell, check `ulimit -v`.** A hard
  virtual-memory cap breaks undici's WASM HTTP parser, and **every** node `fetch()` then fails —
  which looks like a broken adapter and is not one. Raise the cap or run in a shell without it.
- **Manual runs / experiments**: use the pipeline CLI ([03 §6](03-run-lifecycle.md#6--resume-experiment)) —
  `--experiment` gives you a shadow-dir, usage-isolated single-stage run; `--from <stage>` re-runs a
  stage and everything after it. `CLEAROTRON_DUMP_JSON=1` dumps each attempt's raw engine envelope.

## Ground rules — the conventions that are load-bearing

These are the things a well-meaning refactor breaks. Each is enforced somewhere; none is stylistic.

1. **The fail taxonomy is API.** `timeout | lane_wedge | embedded_fallback | nonzero_exit_<code> |
   unparseable_json | status_<s> | missing_file:<f> | invalid_file:<f>:<reason>` (+
   `status_overloaded`, `rate_limited`). Warm-eligibility regexes, the taint chain, recovery
   classification, and replay snapshots all parse these strings verbatim.
2. **Validator reason tokens are API.** Corrective-retry hints, the warm-patch allowlist, the
   repairs classifier, replay snapshots, and the client-gate prefix matches all key on tokens like
   `coverage_status_offenum` or `finding_use_check_missing`. Token first, detail after; don't
   reword casually.
3. **Validators never throw.** `runStage` calls them bare; wrap parser throws and convert to
   `fail()`. Strict parsers throw with the offending token *first* so hints can key on it.
4. **New gates must be receipt-keyed.** Key every new check on a driver-written sidecar being
   present (fresh runs repair; archived runs replay unchanged). The one deliberate replay-*active*
   exception is the taint validator gate — its archived flip is a regression pin. Forget this rule
   and the replay corpus mass-flips (the off-enum gate would have flipped 27/64 archived files).
5. **File truth end to end.** A stage's success is its declared output existing and validating —
   never the model's claim, never a byte-diff alone (a byte-changed band with a wrong-scope block
   closes nothing; re-run the same detector that found the gap).
6. **Stage messages embed machine contracts.** `ESCALATE:` lines, `- ord:` stamps, closed enums,
   band states — code string-matches these. Changing message wording is a parser change; treat it
   as one.
7. **Frozen sidecars are never silently re-derived.** Profile, framework, register plan: corrupt ⇒
   loud crash; the freeze is the run's identity. A new profile field must be carried by
   `freezeProfile` or it silently never applies ([05](05-customer-profiles.md#maintainer-gotchas)).
8. **Tokens, not dollars.** No USD in driver telemetry or tuples; the provider's own stream keeps
   its cost fields untouched.
9. **Purity discipline.** Domain models (`*-model.mjs`, receipts, ledger contracts) take data in,
   return data out — no I/O, no env. Env knobs live in `driver.config.mjs` and the consumers.
10. **Shipped functionality is never hidden behind env flags.** The register-plan flag was removed
    on this principle. Env gates exist for *rollback*, and default on.

## How to: add or change a pipeline stage

1. **Declare it** in `stages.mjs` `STAGES`: model/thinking (tier discipline: judgment = opus/high;
   sonnet for sweeps/curation; haiku never with `adaptive` — `assertTierSanity` throws), `timeoutSec`
   (+ `stallSec` **strictly less than** the timeout for any stage whose first action can stream
   nothing — a long tool call looks like a stall), `out(paths)` (absolute path via `paths()`),
   `validate`, and the `message(ctx)` with its `reads([...])` (the *live* skill reads —
   `skillReads:` is declarative metadata only; do not "reconcile" them, per-customer framework
   selection depends on the difference).
2. **Write its validator** in `verify.mjs` — lenient enough never to false-fail a valid leaf,
   strict on truncation/emptiness/wrong-stage output. If it needs run context, read the frozen
   sidecars via the walk-up readers (absent ⇒ legacy off; present-but-corrupt ⇒ fail).
3. **Wire the call site** in `pipeline.mjs` and *decide its fatality class consciously*:
   `must(stage(...))` for a spine stage, note-and-continue for a checker. Add it to `STAGE_ORDER`
   (for `--from`) and `stageInputs()` (telemetry + experiment sandboxing — blind-frame's entry
   deliberately lists only the raw request; keep input diets honest).
4. **Timeout calibration is documented in place**: the existing entries carry their incident
   history as comments (`stages.mjs` etc.). When you re-calibrate, extend the comment —
   it is the changelog the next maintainer reads.
5. **Tests**: a validator test (offline fixtures), a mock-engine test if the stage has novel
   retry/repair behaviour, and a replay-snapshot update if the validator touches archived shapes
   (update on main, diff on candidate — every flip must be an intended fix).

## How to: swap a model or tier

Mechanically a config change ([04](04-configuration-reference.md#model-tiers-and-resolution)); two
traps and one law. Traps: an alias not registered in the engine's model map now **refuses the
dispatch by name** ( — it used to run sonnet silently and log the alias you asked for, which is
the `fable` lesson turned into an error), and `CLEAROTRON_SYNTHESIS_MODEL` is read at module load (fine
for the oneshot service, stale in long-lived processes). The law: any grade-moving
change — family, effort, tier remap — ships only through the paid A/B against the reference
library, plus the $0 replay harness (the model-swap doctrine —
[07 §7](07-quality-and-audit.md#7--the-memory-that-keeps-it-honest)).

## How to: add an engine

The seam is real but has known single-vendor assumptions outside it. The full path:

1. Implement `runTurn(opts)` returning the normalized tuple (`{code, killed, wall, stdout, stderr,
   laneWaitMs, json, usage, sessionRef, modelWire, signals, reads, readsTruncated}`) with a synthesized
   gateway-shaped envelope — `engine/anthropic-agent.mjs` is the reference implementation;
   `engine/CONTRACT.md` is the spec (read both; the contract file is a design reference, the code is
   the API).
2. Preserve the fail taxonomy verbatim; map the provider's usage into the canonical shape
   (`{input, output, cacheRead, cacheWrite, total}` — NO reasoning-token field, retired 2026-07-30:
   thinking spend is billed inside `output` and never broken out); return `laneWaitMs: 0` for
   off-gateway engines; thread `sessionRef`/`resumeRef` for warm patches; implement a stall watchdog
   (or document the hard-wall fallback); surface `rateLimited`/`resetsAt` signals.
   **Answer both gauges three-valued, never by omission** (AD-4): `signals.thought` — `true`/`false`
   when the engine can tell thinking engaged, `null` when it cannot — and `reads`, the files the turn
   opened (`[]` = ran and read nothing; omit the key only if the adapter genuinely cannot observe
   reads, and the gateway will journal `reads: null`). An absent field must never be readable as a
   zero. `modelWire` is the same discipline for the model gauge: the served id the turn OBSERVED on the
   wire, or `null` — never the alias you asked for. The gateway derives `modelActual` / `modelBasis` /
   `modelMismatch` from it, so an adapter that never sets it stamps every row `unknown`.
3. Register it: add the adapter to the `ENGINES` map in `gateway.mjs` (or call `registerEngine()`),
   and add its binary to `ENGINE_BINARIES` in `driver.config.mjs` so the setup wizard can offer it —
   the two lists are pinned against each other, because "the wizard offers an engine the driver does
   not ship" and "the driver ships an engine setup cannot reach" are both invisible otherwise. Then
   check the remaining engine-aware call sites: the `engine.usesGatherMcp` gather gate (declare it
   explicitly — omitting it opts your adapter IN, so no name check catches you) and `selectEngine`.
   The old `engineIsMultiProvider` blocker is gone with the failover chain it gated — a
   multi-provider engine that wants cross-provider recovery designs and tests it then, rather than
   inheriting a dormant one.
4. Copy the test posture of `test/engine.anthropic.test.mjs` (auth toggle, model/effort maps,
   arg construction, rate-limit signals, stall override, routing) with a mock binary.

## How to: add a register provider

The reasoning layer dictates what it needs; a thin adapter supplies it. Concretely:

1. **Plugin core** (gateway-side estate adapter): query translation, pagination, status-enum
   normalization, record normalization into the provider-neutral fields the driver reads
   (`REC` accessors in `registry-fidelity.mjs` — application/registration numbers, dates,
   `statusClass`, proprietor, designations).
2. **Engine-local MCP server**: wrap the core like `engine/mcp/corsearch-server.mjs` (~130 lines); add
   it to `REGISTER_SERVERS` in `gather-config.mjs` (`registerEntry()` **throws loudly** for any provider
   without a built server — a provider flip without the server breaks every register unit, loudly).
3. **Driver config**: a `PROVIDERS` entry in `driver.config.mjs` (label, credential env name,
   `recordFetch` + `executePlan` adapters, public-record-URL capability) — the credential is
   preflighted at run start. Add the id to `KNOWN_REGISTER_PROVIDERS` too, or the error message that
   tells an operator what to set will omit it. Selection is `CLEAROTRON_DATABASE` in every
   environment, production included; there is no committed default to flip.
4. **Skill doc**: `skills/prelim-register/providers/<provider>.md` — the provider-specific craft
   the register stages read.
5. **The empirical verification checklist** — the real work is not code volume: operator
   vocabulary and composition semantics, pagination behaviour to `has_more:false`, status-enum
   truth-testing against known-live/known-dead marks, record-field mapping, rate/ceiling behaviour.
   The primary provider's engineered-around realities (hard record caps, broken server-side status
   filters, session-cookie auth) are exactly the class of thing to verify per estate.
6. **A/B + replay** before any live matter, like every grade-moving change.

## How to: edit doctrine (skills)

The methodology lives in the driver's `skills/` tree — 12 top-level directories, nearly all of it
Markdown carrying **prose only**, no executable code. The machine-parsed
exceptions are the four framework manifests (`skills/prelim-search/risk-framework*.manifest.json`); one
further non-Markdown file rides along, `skills/prelim-search/templates/search-request-form.html`, named
only in `publish/index.mjs`.
The engine reads skills **in place from the git-deployed driver tree**: `absolutizeSkillRefs`
rewrites `skills/…` tokens to absolute paths and grants `--add-dir`. Code comments saying skills
live in the agent workspace are stale.

What to know before editing:

- **Which stage reads what** is dictated solely by each stage message's `reads([...])` in
  `stages.mjs` — read it there rather than trusting this summary. Broadly: matter-frame,
  prelim-variants (+ `transliteration-scripts.md`), blind-frame, prelim-common-law (every grid seat),
  prelim-register spine + `unit.md` *xor* `digest.md` (mode-routed — a unit must never read
  digest doctrine and vice versa) + the active provider's `providers/<name>.md`,
  placement-inquiry, `phase2-execution.md` §skeptic (that one section only), frame-diff,
  synthesis (synthesis-rules + per-profile framework + worked examples + conditionally
  `field-doctrine-pharma.md` for pharma-shaped matters — a code predicate), case-law-citation,
  narrative-refutation, and delivery-contract for the two report stages.
- **Force-read vs pointer-read is a real class distinction.** Files named in `reads([...])` load
  every run; files merely *linked* from a SKILL.md ("read as needed") are a model-discretion second
  hop that can silently be skipped — a load-bearing rule that lived in a pointer file once silently
  reverted run to run until it was promoted to force-read. Decide the class when you add a rule.
- **Skill prose embeds machine contracts** — band-block states, coverage-ledger vocabulary,
  `ESCALATE:` grammar, the negative-results drop-row schema (frozen because the audit builder
  parses it), the identical-match reference algorithm. Validators and driver parsers string-match
  these; edit them as API.
- Several skill files are **legacy and not stage-read** (email/Excel templates, the formatting
  reference). Verify a file appears in some stage's `reads([...])` before treating its claims as
  live; where a legacy file and the code disagree, the code and `stages.mjs` win.
- The pharma module (`skills/prelim-search/field-doctrine-pharma.md`, loaded by a code predicate on
  pharma-shaped matters) ships behind a named legal reviewer's sign-off — doctrine edits in
  regulated verticals go through the practitioner, not just review.

Protections around doctrine edits: stage validators pin the embedded contracts; the framework-lint
suite pins deck⇄manifest agreement; the replay harness catches validator flips; the deploy pipeline
*your host supplies* is **required** to scan skills and abort on live-workspace drift — this repository
ships no deploy script, so unlike the other three that one is an obligation on the installer and nothing
in-tree enforces it ([06](06-operations-runbook.md#deploy)); and any change that moves reasoning quality
is A/B territory.

## Testing reference

**Every `*.test.mjs` file** under `driver/test/` — the `.mjs` files there that do not match are
mock binaries, fixtures and helpers — fully **offline and $0 by design**: the mock engine binaries
(`mock-claude.mjs`, `mock-codex.mjs`) share one stage-fixture writer so the
e2e pipeline is engine-parametric; harnesses satisfy the credential preflight with a dummy value
and disable the plan-dispatch repair (which would otherwise hit the real provider adapter).
Groupings: engine + gateway (auth toggle, model maps, stall/kill escalation, overflow, retries,
warm patch, lane wedge), runner/claims/dedup/admission/locks, the pipeline e2e harnesses,
validators + domain models, coverage/plan/band/taint, profiles/framework (freeze, lint, prompts,
service, page), publish/render/delivery/client-gate, and deliver-trigger (with blocking `bash -n`).

CI is `.github/workflows/ci.yml`. It triggers on `pull_request` **and** `push` to main, runs the
whole repository (no path filter), pins Node 22.23.2, and runs `npm ci` then **`npm run test:full`**
— the unfiltered tier, not the `npm test` contributor tier. A test reads the workflow file and
fails if that step is pointed back at the fast tier, because the swap stays green while covering a
fraction of what it did. Alongside the suite: an Ubuntu job and a macOS job, provider-core tests
(the provider cores are not npm workspaces, so the suite never reaches them), a `bash -n` sweep, an
SPDX-header check, a relative-markdown-link check, and a portal browser/secret-scan job.

Four realities to respect:

- **Exclusion is by filename convention only.** Anything named `*.test.mjs` runs in CI; billable or
  manual harnesses must not match the glob (historical one-off proofs with hard-coded dev paths are
  not kept; the last billable hand-run harness, `selftest.mjs`, was deleted at).
- **The `||=` env guards leak**: a shell exporting a real register credential or
  `CLEAROTRON_PLAN_DISPATCH=on` is *not* overridden by the harness — run the suite in a clean env.
  (CI is safe.)
- **A skipped guard is not a passed guard.** Several checks enumerate every tracked file (no client
  identifier, no operator identity, no citation of a path the public tree will not carry, every env
  var written down) and can only do that off a git checkout; off a source zip they skip by name.
  CI asserts both that no guard printed `[repo-guard] SKIPPED` *and* that at least one printed
  `[repo-guard] ok` — the second half matters, because "no SKIPPED line" also passes on an empty log.
- **Config freezes at import**: pipeline test harnesses re-import with a cache-busting query for
  fresh config, and scrub the mock knobs between scenarios — copy an existing harness, not just its
  assertions. Files run in parallel processes; artificially tight stall values can false-trip under
  full-suite load.

Beyond unit tests, the quality ladders ([07 §7](07-quality-and-audit.md#7--the-memory-that-keeps-it-honest)):
the replay harness (PR gate over archived runs), gate metrics on holdout archives, and the paid A/B
against the reference library. A fourth rung, the selftest probes, is gone: it measured an agent
gateway's linchpins, and that gateway left the product.

## The recorded baselines, and when to regenerate them

Four files record a measurement rather than an expectation. Each prints what moved **before** it writes,
so an author records a change they have read.

```sh
git add -A && npm run generators
```

**That one command is the ritual.** It runs all five, in order, and fails loudly if any of them cannot
run — do not retype the paths at a shell. They live in two directories, and a generator invoked from the
wrong one exits `MODULE_NOT_FOUND` whose last line is the node version: piped through `tail` it reads
almost exactly like a quiet success, and the ritual's own success test — *"and then `git diff` is
empty"* — is satisfied **precisely when nothing ran**.

| File | Regen | What it records |
|---|---|---|
| `driver/contract-e3-baseline.json` | `node driver/test/contract-e3-baseline.mjs --write` | structure-as-text per stage dispatch and per skill file |
| `driver/contract-arm2-baseline.json` | `node driver/test/contract-arm2-baseline.mjs --write` | contract elements no validator token speaks about |
| `driver/test/fixtures/skill-instruction-load.json` | `node driver/test/skill-instruction-load.mjs --write` | instruction bytes per (dispatch × profile) cell |
| `THIRD-PARTY-NOTICES.md` | `node scripts/third-party-notices.mjs` | the licence attribution for every package npm installs into the PRODUCTION tree |
| `driver/suite-census.json` | `node scripts/mint-suite-census.mjs --apply` | the test file inventory that makes a deleted or gutted suite visible |

A guard holds this table and `npm run generators` to each other, so a
generator known to only one of them fails the build rather than going quietly missing from a ritual.

**The census REFUSES rather than re-stamping when a count goes down.** A test file gone from it,
or fewer tests or assertions inside one, stops the ritual and names the file. That is the whole point of
the census: re-stamping over a gutting makes the census agree with the gutted tree, and the arm that
compares them then agrees with both — measured, eight assertions deleted and 12 pass / 0 fail. Growth
and additions never trip it. When the loss is deliberate — a test genuinely deleted, a guard genuinely
retired — `npm run generators -- --allow-loss` accepts it, and the PR body says what was lost and why.

**Two orderings, now enforced rather than remembered.** Both cost real time before they were:

- Regen is the last action before you commit, re-run unconditionally. "After the final edit" is only
  knowable in hindsight — a later fix to a measured file silently invalidates numbers you already wrote.
- The census reads the git index, so it must run **after** `git add`. Run it before and a new file is
  invisible to it while the dry run reports "no additions". `npm run generators` refuses to start
  against an unstaged tree for this reason.

**`--write`, never `--write --all`.** `--write` records what moved. `--all` *additionally* re-records
cells that drifted **down**, which its own usage text asks you to do deliberately, having read them. In a
routine it re-baselines a shrinking surface into a green suite — the precise laundering these files exist
to prevent — so the ritual does not pass it and a test asserts it never starts.

**The first two are exact, not ceilings.** A surface that shrinks turns them RED until it is
regenerated, and that is the mechanism rather than friction: as ceilings, a shrink passed silently and the
vacated room stayed open for a new violation to land in unnoticed. Three E3 surfaces sat loose that way
for five merges, and one of them was a recording stage whose dispatch may not dictate a line shape at all.

## Debugging a live run

1. `status.json` → state + last stage; `run.jsonl` → the decision trace (grep the event keys listed
   in [06](06-operations-runbook.md#monitoring--where-to-look)).
2. `_driver/<stage>.jsonl` → per-attempt rows: fail tokens, kill signals, walls, usage; the
   `attemptFails` history distinguishes a clean success from a taint-suspect one.
3. `CLEAROTRON_DUMP_JSON=1` + `--from <stage>` reproduces a stage and its tail with raw envelopes;
   `--experiment` does one stage without touching the canonical run.
4. The receipts (`_driver/*.json`) tell you which gates armed and what they decided — most
   "why is this CONDITIONAL?" questions are answered by `verdict.json`'s reasons/kinds, and most
   "why did this repair fire?" by `repairs.json` epochs.
