# 04 — Configuration Reference

> Part of the architecture pack (`docs/architecture/`). The driver's module tree and the headless
> integrator contract are in [`driver/README.md`](../../driver/README.md).

> **Scope note:** this reference covers the DRIVER-COMPUTE surface (the `driver.config.mjs` layer).
> The rest of the repo's env vars — the MCP faces, the three admin services, native-language/knockout lanes,
> outbox, brand and auth — are catalogued, with ownership tiers and the drift/rotation map, in
> **[05-config-governance.md](05-config-governance.md)**. When adding a var anywhere in the
> repo, add its row there. `node scripts/env-audit.mjs` reports every name read by code, splits
> product from harness-only, and lists the product names that have no governance row yet; the
> placeholder-default guards in `driver/test/deployment-hostnames.test.mjs` enforce the fallback
> rules mechanically.

Configuration lives in three layers, resolved in this order:

1. **Environment variables** → `driver.config.mjs` — mechanics: paths, caps, timeouts, engine and
   provider selection, feature gates. In production these come from the systemd unit's
   `EnvironmentFile=%h/.env` (the single secrets/overrides file) plus `Environment=` lines in the
   unit files.
2. **The stage table** → `stages.mjs` — the single source of truth for what each pipeline stage
   runs: model tier, reasoning effort, timeouts, skills, output file, validator, message. Per-stage
   behaviour changes happen here, nowhere else.
3. **Customer profiles** → `profiles/` — per-client knowledge and delivery configuration, frozen
   per run. Documented in [05 — Customer profiles](05-customer-profiles.md).

**Resolution semantics matter.** Every value on the `config` object is a **getter**, read at access
time, so all of them honour a mid-process env flip — the file's own NOTE beside `config` says why:
`./driver.config.mjs` resolves to ONE cached module instance across the offline test fleet, so
import-time captures silently pinned every test to the first test's env. What IS frozen at first import
is the module-level declarations beside it — the consts `REGISTER_PROVIDER` and
`UNREACHABLE_SENIOR_POLICY`, and `MODELS.azure`, a plain property reading `CLEAROTRON_AZURE_MODEL`.
Because the driver runs as a systemd **oneshot** (a fresh process per activation), editing the
deployment's `.env` takes effect on the next queue-triggered run with no deploy and no restart — that is the
supported way to change caps and A/B toggles. One trap: `synthesis.model` reads
`CLEAROTRON_SYNTHESIS_MODEL` at module load (`stages.mjs`), which is fine for the oneshot service
but stale in a long-lived test process.

**A numeric setting either parses or refuses — it is never `NaN`.** The two ways a numeric line can
say nothing are different questions and get different answers:

| What you wrote | What you get |
|---|---|
| the line is absent, `NAME=`, or only whitespace | **the default.** An `X=` line means "not configured". |
| `NAME=two`, `NAME=3x`, a stray letter | **a refusal naming the variable**, at the read, before the value is used. |

Nothing falls back past a value it could not parse. Running the deployment on a number nobody chose is
the failure this rule exists to prevent, and the shape it replaced was worse than a wrong number:
`Number("two")` is `NaN`, every comparison against `NaN` is false, so a typo'd
`CLEAROTRON_MAX_CONCURRENT_RUNS` left the driver accepting work and starting none of it — no error, no log
line, no timeout, presenting only as a queue that would not drain.

Range is a separate question and is unchanged: `0` and negative values are numbers, and each setting
floors them as its row describes. An explicit `CLEAROTRON_MAX_CLAIM_AGE_MS=0` is a choice and still
disables the ceiling.

One exception, and it is a rule rather than an oversight: `CLEAROTRON_CARD_CONCURRENCY` falls back to its
default rather than refusing, because it is read mid-run and changes only how long a phase takes, never
what the phase concludes. **A configuration typo discovered mid-run must never turn a delivering search
into a refusal.**

The fallback is loud. The run's record carries a line naming the variable, quoting what it holds, and
stating the number the run actually used — because a fallback nobody can see is how a deployment ends up
running on a number nobody chose, which is the defect this whole rule exists to prevent, one register
quieter. Continuing silently is not one of the two options.

## The stage table

All 16 stages, exactly as declared in `stages.mjs` (`STAGES`). Timeouts are
seconds; the engine's hard kill lands at `timeoutSec + 60`. An empty stall
column means the global watchdog (`CLEAROTRON_STALL_MS`, 120 s) applies. Fatality is what the pipeline
does after the stage's full retry ladder fails ([03 §5](03-run-lifecycle.md#5--failure-handling)).

| # | Stage | Model · effort | Timeout / stall | Gated output (file truth) | Fatality |
|---|---|---|---|---|---|
| 1 | `matter-frame` | opus · high | 300 / 300 | `matter-context.md` | fatal |
| 2 | `prelim-variants` | opus · high | 600 / 450 | `variant-manifest.md` (+ `.json` sibling, strict-parsed) | fatal |
| 3 | `blind-frame` | opus · high | 600 / 450 | `blind-frame-model.json` (strict-parsed; the prose twin was retired 2026-08-03 — nothing read it) | non-fatal (frame-diff skipped this run) |
| 4 | `common-law` | haiku · low | 2250 / 1100 | `common-law-findings.md` (+ grid ledger, plugin-written) | fatal at fan-in |
| 5 | `common-law-half` | per seat: `COMMON_LAW_SEAT_TIER` — halves `a`/`b` haiku · low; meaning seat `m` `CLEAROTRON_MEANING_SEAT_MODEL` \|\| haiku · low | 2250 / 1100 | `common-law-findings.half-{a,b,m}.md` (+ per-seat grid ledgers) | fatal at fan-in; one-half transient quarantine allowed |
| 6 | `register-unit` | per axis: `saturation-probe` haiku · off; sweeps sonnet · adaptive | 1500 / 1100 | `register-units/<axis>.md` + `<axis>-band.json` (plan mode: tool-written, qid-stamped) | fatal at fan-in (after band-vocabulary quarantine / collapsed-band repair) |
| 7 | `placement-inquiry` | opus · high | 2700 / 600 | `placement-recommendations.md` | fatal |
| 8 | `register-digest` | opus · **low** (was high until 2026-08-01 — 3.49× wall/output against a 1.03× fixed-effort control, with no detectable effect on which records it tiers; override an arm with `CLEAROTRON_STAGE_THINKING`) | 2400 / 900 | `register-findings.md` (coverage-ledger JSON is code-derived from its prose) | fatal (every digest pass) |
| 9 | `skeptic` | sonnet · high | 600 / 600 | `skeptic-flags.md` (verbatim `ESCALATE: <axis>` lines) | non-fatal (no escalation on failure) |
| 10 | `frame-diff` | sonnet · low | 600 / — | `frame-diff.md` + `frame-diff.json` | non-fatal (no reopen) |
| 11 | `synthesis` | `CLEAROTRON_SYNTHESIS_MODEL` \|\| opus · high | 2500 / 900 | `narrative.md` + **`findings.json`** (schema v7 — `FINDINGS_SCHEMA_VERSION`, interpolated into the contract the stage message dictates: `findings`, `coverage`, `mark_assessment`, `four_answers`, `actions`, `coverage_judgment` and `rated_under_framework`, plus `context_notes` / `ask_answers` where they apply) | quasi-fatal: unrepaired finding defects are terminal; corrective re-synthesis is fatal on failure |
| 12 | `case-law` | sonnet · adaptive | 900 / — | `case-law-findings.md` | non-fatal; conditional on the PRODUCT — `decideCaseLaw` (`pipeline.mjs`) runs it on **every** `full-country-search`, because the case-law and opposition reading is what that product IS and `policy.caseLaw` is set from the product spec. A narrative that turns on a precedent or an opposition is the second, redundant arm there; on any other product that reading is recorded as `declined`, never run |
| 13 | `narrative-refutation` | opus · high | 900 / 600 | `senior-eye-review.md` (verdict on first line) | fatal |
| 14 | `report-overview` | sonnet · low | 900 / — | `report-overview.md` (shell only; cards + "Only you can close these" are code-built) | fatal |
| 15 | `report-card` | sonnet · low | 600 / — | `report-cards/<ord>.md` | non-fatal per card (structured-only fallback) |
| 16 | `doubt-closure` | sonnet · low | 300 / — | `doubt-closure.md` (dictated `SETTLED`/`IMMATERIAL`/`OPEN` lines; code re-verifies every quote) | non-fatal (the open doubts and asks ship `OPEN`, as they would without the stage) |

Notes that keep maintainers out of trouble (all verified against code):

- **`skillReads` on a stage entry is declarative metadata only.** The live skill reads are the
  `reads([...])` call inside each stage's `message()`, which resolves per-customer framework and
  worked-examples files via the profile. Do not "reconcile" the two — that breaks per-customer
  framework selection (guarded by `test/profiles.test.mjs`).
- **Stage messages embed verbatim machine contracts** (`ESCALATE:` lines, `- ord:` stamps, closed
  enums, band `state` values). Code parses these strings; rewording a message can break the parser.
- **`register-unit` and `common-law-half` take their tier from `axisTier(axis)`**, not from their
  own entry — declaring a static `model` on either would win over the function and make the
  per-axis/per-seat map dead. `axisTier` names the three grid seats explicitly, so a seat id can
  never fall through to the register default.
- **haiku + `adaptive` is forbidden** (the model rejects it and silently bounces to sonnet);
  `assertTierSanity()` throws at startup on any such pairing.
- **`--from` ordinals** come from `STAGE_ORDER` (`stages.mjs`), which is not the whole table above. The
  code-only steps (audit, publish) are deliberately absent — they self-gate — and so is one model
  stage, `doubt-closure` (condition-only), with its reason recorded in `STAGE_ORDER_EXCLUDED`.
  `stageOrdinal` returns -1 for it, so it is not a `--from` target. Three SEND stages sat at the end
  of this table until  (`notify`, `notify-chat`, `notify-fail-chat`); they ran only under a
  delivery mode that has been deleted, so `--from report-card` is now the last resume target and
  everything after it is code.
- Timeout values carry their calibration history in code comments beside each entry in `stages.mjs`
  — dense-marketplace matters measured ~1854–1904 s in the common-law grid, hence 2250;
  treat those comments as the changelog and extend them when re-calibrating.

## Model tiers and resolution

Two resolution levels sit between a stage's declared alias and what actually runs:

**Level 1 — driver aliases** (`MODELS`, `driver.config.mjs`; `resolveModel()` passes
through anything containing `/`):

| Alias | Full catalog id |
|---|---|
| haiku | `anthropic/claude-haiku-4-5` |
| sonnet | `anthropic/claude-sonnet-5` |
| opus | `anthropic/claude-opus-5` |
| gemini | `google/gemini-3.1-pro-preview` |
| gemini-flash | `google/gemini-3-flash-preview` |
| deepseek-v4-pro | `together/deepseek-ai/DeepSeek-V4-Pro` |
| azure | `CLEAROTRON_AZURE_MODEL` (default `azure-openai/gpt-5.4`) |

The bottom four are **legacy names that no stage declares and no engine can run** — they resolve at
level 1 and then throw at level 2 (below). They are catalogue entries, not available tiers.

**Level 2 — the active engine** maps aliases to the CLI's own model names. On `anthropic-agent`
(`CLAUDE_MODEL` in `engine/anthropic-agent.mjs`): **opus and sonnet are pinned** to `claude-opus-5`
and `claude-sonnet-5` so neither drifts with what the CLI currently calls "opus"/"sonnet"; `haiku`
and `fable` pass through as aliases. A bare or dated Anthropic id (`claude-haiku-4-5-20251001`)
still resolves to its family — that is a naming form of a model the CLI can run, not a substitution
of a different one.

**Anything else throws.** There is no regex fall-through to sonnet and no cross-provider
substitution: the `gemini`/`gemini-flash`/`deepseek-v4-pro`/`azure` mappings are gone with the
failover chain that needed them. The reason is attribution — a silent substitution logged the alias
that was *asked for* while billing the model that *ran*, so an A/B arm and every token rollup
downstream of it were keyed to a model that never executed. `openai-agent` refuses a non-GPT id the
same way. Register a new alias in the engine's map before naming it anywhere.

**Thinking → effort remap** (the CLI has no `--thinking`): off/low → low, medium/adaptive → medium,
high → high, max → max, unknown → medium.

**One model per stage.** `chainEntries(stage, axis)` resolves the single model a stage runs on — its
own declared `model`, or `axisTier(axis)` where it declares none (`register-unit`, `common-law-half`)
— with the thinking tier `thinkingFor()` gives it. There is no fallback rung and no cross-provider tail.

There used to be: a model-failover chain (same-family fallback, then `azure` and `gemini`) gated on a
multi-provider engine. It is **deleted** (, 2026-08-03). It had never run — no stage ever declared
a fallback and the engine gate was never true — so it was dead machinery with a report-HTML block and a
test attached. It was deleted rather than armed, because arming it means untested code firing for the
first time in the middle of a production failure, and a silent mid-run model swap changes which model
makes judgment calls inside one matter. A stage whose model cannot do its work is a capability problem
fixed at assignment time. **Recovery is the retry ladder** (`runStage` attempts, the one extended
timeout shot, warm patch, backoff), the lane-wedge re-dispatch, and the rate-limit park.

## Engine and auth selection

| Setting | Values | Effect |
|---|---|---|
| `CLEAROTRON_AI` | `anthropic-agent` (default) \| `openai-agent` | Compute engine (a registered provider adapter). `anthropic-agent` = `claude -p`; `openai-agent` = `codex exec` (both off-gateway, same normalized contract). An **unregistered** value — a typo, or the gateway-runtime adapter removed in the extraction — **fails loud**: no silent wrong-provider run. Production default is unchanged. |
| `CLEAROTRON_AI_BILLING` | `subscription` (default) \| `api-key` | Billing mode for the selected engine. ONE variable for both, and only the LIVE engine's setting is read — it fills each engine's billing knob, and the engine that is not selected is never consulted. **`anthropic-agent`:** subscription **deletes `ANTHROPIC_API_KEY` from the child env** so `claude -p` uses OAuth subscription credentials (a present key would override them); `api-key` keeps the key — the scale setting and standing fallback. **`openai-agent`:** subscription seeds `auth.json` into the per-run `CODEX_HOME` from `CLEAROTRON_OPENAI_AUTH_FILE` (default `~/.codex/auth.json`) and strips API keys; `api-key` keeps `CODEX_API_KEY`. **Fail-loud either way:** `api-key` with no `ANTHROPIC_API_KEY` / `CODEX_API_KEY` throws, and never silently bills the subscription. The resolved mode is stamped on every stage telemetry row (`engine`, `authMode`, `apiBilled`). |
| `CLEAROTRON_CLAUDE_PATH` · `CLEAROTRON_CODEX_PATH` | `claude` / `codex` on `PATH` | The engine binary to spawn, ONE PER ENGINE: `CLEAROTRON_CLAUDE_PATH` under `anthropic-agent`, `CLEAROTRON_CODEX_PATH` under `openai-agent`. Only the live engine's is read, and a box that runs both sets both — they were one variable until it met a box needing two different paths. Give it an **absolute** path if the binary is not on `PATH` — stage subprocesses run with cwd set to the run directory, so a relative path does not resolve there, and `npx clearotron doctor` refuses one. |
| `CLEAROTRON_OPENAI_AUTH_FILE` | `~/.codex/auth.json` | The credentials file seeded into the per-run `CODEX_HOME` under subscription billing. Was exempted from the August 2026 rename as an `openai-agent` internal rather than an install-surface name; the owner's 2026-09-04 ruling **reversed that exemption** and renamed the whole namespace, so it carries the house prefix like everything else. One spelling, no exceptions. |
| `CLEAROTRON_OPENAI_MODEL_JUDGMENT` / `CLEAROTRON_OPENAI_MODEL_SWEEP` / `CLEAROTRON_OPENAI_MODEL_CHEAP` | `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna`. | Maps the driver's abstract `opus`/`sonnet`/`haiku` tiers onto the codex ladder, the way the anthropic engine maps onto its own (owner ruling 2026-09-02, superseding the single-model mapping). A tier that cannot hold its stage contract announces itself at that stage — `missing:negative-results`, `no_coverage_status_row`, `named_band_missing` in `_driver/<stage>.jsonl` — not at delivery. |
| ↳ why they are three, and what the old measurement still says | superseded 2026-09-02, not erased | The three defaulted to `sol` alone on a MEASUREMENT, never a placeholder: on 2026-08-11/12, with `SWEEP=gpt-5.6-terra` / `CHEAP=gpt-5.6-luna`, every codex clearance died on structural-output gates — `missing:negative-results`, `no_coverage_status_row`, `named_band_missing` — over 2 scenarios × 3 stage families, **byte-identically on retry**, so no retry budget rescued it. That measurement stands for the code and the codex CLI **of that date**, and it is why the judgment tier keeps `sol`. Three weeks of stage-contract work and several codex minor versions sit between it and the 2026-09-02 ruling that split the three. **The symptom to match against this cause is unchanged**: those same three gates, as a fail row in`_driver/<stage>.jsonl`, inside the first few dispatches of a clearance and identical on every retry — a model incapable of a contract is not flaky at it. It reads as an engine bug when the only fault is this configuration. A cheap-tier experiment still belongs in the three constants in `driver/engine/openai-agent.mjs` where a reviewer sees it, not in an untraceable env line. |
| `CLEAROTRON_DATABASE` | **REQUIRED — no default.** `corsearch` \| `clarivate` \| `signa` \| `euipo` \| `uspto-local` \| `free-tier` | Active register provider — one per run, set in the environment the deploy carries, in every environment including production. There is **no default**: unset resolves to `null` and every use of it throws, so a run refuses at start rather than calling a vendor nobody chose ( — the removed`corsearch` fallback named a vendor the deployment did not choose). Three are paid global sweeps; `euipo` (EU) and `uspto-local` (US) are free single-office sources, and `free-tier` composes those two as one register. Choosing a free value makes every territory outside its coverage a disclosed *deferred* row. Unknown ids throw loudly, and the gather layer throws at stage time for any provider without a built MCP server. |
| `CLEAROTRON_CODEX_SANDBOX_BYPASS` | unset | `1` runs `codex exec` with its own sandbox helper bypassed, for hosts where that helper cannot spawn. It removes a defence: with it set, the run dir is writable by the seat and only the deny-hook stands between a stage and `_driver/`. Set it because the host forces it, never for convenience. |

## Environment variable reference

Grouped by concern. "Default" is the code default at the grounding commit; the live `.env` on a
deployment may override (verify live values per deployment).

### Paths and locations

| Var | Default | Meaning |
|---|---|---|
| `CLEAROTRON_WORK_DIR` | `$HOME/trademark/workspace` | Root holding `workspace-<agent>/` (queues, run dirs). Same name as before, new default: it used to be an agent platform's own dot-directory, which README says in bold the engine does not require. Nothing to migrate — the variable's spelling did not change — but **a deployment that ran on the old default and does not pin this variable moves its run directories on upgrade**, and`driver/systemd/prelim-driver.path` / `prelim-outbox.path` hardcode absolute globs that no environment variable can reach (read the units — the literal is in them). Set it explicitly on every deployed box; the units' globs must name the same root. |
| `CLEAROTRON_INSTRUCTIONS_DIR` | `<driver>/skills` | Compute-skills tree; the engine absolutizes `skills/…` refs against it and grants `--add-dir`. |
| `CLEAROTRON_SKILLS_STORE_STRICT` | unset (warn) | Hard mode for the run door's doctrine-store check (,`driver/skills-store-provenance.mjs`). The door classifies the store `CLEAROTRON_INSTRUCTIONS_DIR` names into the publication gate's three outcomes — **pass**, **fail** (uncommitted changes under the served path, or a HEAD not contained in the main line), **blocked** (could not be determined: git absent, an unreadable ancestor, no main-line ref, or a store no commit tracks). A store affirmatively outside any checkout passes: the walk to the filesystem root must complete with every step readable, so "no git evidence" can never be inferred from a directory this process cannot see. Unset, a non-pass prints one `[preflight]` line to stderr and stamps a `skills-store` event into the run's `_driver/run.jsonl`, and the run proceeds. Set (`1`; `0`/`off`/`false`/`no`/empty do not arm it), any non-pass **refuses the run before any spend** — `blocked` included, because a store whose state nobody can name is not a store anybody can reproduce. |
| `CLEAROTRON_SKILLS_STORE_MAIN_BRANCH` | `main` | Which branch name the check above treats as the main line. A deployment whose config store is on `master` sets this; otherwise that store has no main-line ref to be measured against and every run reports `blocked`. Only the branch name — the check prefers `origin/<name>` and falls back to the local ref. |
| `CLEAROTRON_MIN_FREE_DISK_MB` | `500` | Free space the run door requires on the filesystem holding `CLEAROTRON_WORK_DIR`, in MB. Below it a run is **refused** before anything is written — a disk that fills mid-run surfaces as a *missing artifact* at some later stage, which is indistinguishable from an engine or provider fault. Not a sizing estimate: one real delivered run measured 5.85 MB, so 500 MB is the line below which the filesystem is in trouble for reasons of its own.`0` disables the check; a non-numeric value **throws** rather than silently disabling it. A disk that cannot be measured is reported and the run proceeds — never read as room. |
| `CLEAROTRON_REPORTS_DIR` | **none — set it** | Publish pool (web-served). **No default since: unset refuses and names the variable.** It read`/srv/trademark-archive` — a deployed server's real client archive — so a forgotten export published into somebody else's matter, and two entry points already carried hand-written defences against exactly that (`bin/onboard.mjs`, `bin/example.mjs`). Same shape as `CLEAROTRON_DATABASE` and `scripts/purge-runs.mjs`: guessing wrong is expensive, so it does not guess. Read-only surfaces (flag snapshot, status page, MCP options) degrade to "no pool" instead of throwing; anything that writes refuses. `driver/production-pool-guard.mjs` still names `/srv/trademark-archive` on purpose — that constant is a fact about where the archive is, not a default. |
| `CLEAROTRON_REPORTS_URL` | **none — set it** | Pool base URL used in notification links. No placeholder default: unset ⇒ the link is omitted and the runner logs `deployment config MISSING` at activation. It does not gate the queue (a missing hostname costs a link, not the deliverable), so treat that log line as the alarm. |
| `CLEAROTRON_ACCESS_DOMAIN` | unset (note omitted) | Identity domain named in the delivery email's access note ("sign in with a `<domain>` account"). Unset ⇒ the note is omitted rather than naming the wrong domain. |
| `CLEAROTRON_RUN_LOCK_DIR` | `<workspaceRoot>/prelim-run-locks` | Run-slot lock dir (turn locks under `…/turns`). |
| `CLEAROTRON_OUTBOX_DIR` | `<workspaceRoot>/prelim-outbox` | Delivery outbox (`<runId>.pending` wake markers). |
| `CLEAROTRON_OAUTH_BRIDGE` | module-relative `providers/oauth-mcp-bridge/bridge.mjs` | Case-law MCP bridge script. (Portable since the module-relative default; set explicitly only for a bridge outside the repo tree.) |
| `CLEAROTRON_REGISTER_CALL_LOG` | `~/trademark/telemetry/register-calls.jsonl`, or the existing file wherever it already is | Billing-grade provider-call ledger, shared by whichever ONE register provider is wired — not a vendor artifact. Every read site derives the default from`homedir()` at call time (2026-07-19: two sites had hardcoded a literal account home, splitting the ledger under any other service account — guarded by `test/deployment-hostnames.test.mjs`). |
| `CLEAROTRON_REGISTER_RECORD_LOG` | **runtime-injected per run**: `<runDir>/_driver/register-record-bodies.jsonl` | Citation-fidelity log: the BODY of every fetched official record. ** moved it INTO the run** — created with the run, unioned into the run's`_records/`, archived and purged with it. There is no retention setting and no cleanup job, because it no longer grows on the box: held globally it reached 432 MB in 61 days on production and needed a rotation timer on every install. **Do not set this by hand** — a fixed value pins every run's bodies to one file and restores the problem. A box upgraded across still holds its old global file; nothing writes or reads it, the driver names it once per process on stderr, and archiving it is one`mv`. An empty log cannot read as verified: the run's successful `record_fetch` rows in the (still global) call ledger are compared against the assembled record set, and a gap is reported as a failure. |
| `CORSEARCH_CALL_LOG` / `CORSEARCH_RECORD_LOG` | — | **Deprecated, honoured for one release.** The pre- names. Unset on every deployed box (all three ran the homedir default), so what actually protects an upgrade is the filename fallback: a`corsearch-calls.jsonl` / `corsearch-records.jsonl` already on disk keeps being read where it sits. Resolution order is in `providers/_shared/ledger-path.mjs`. |
| `CLEAROTRON_BAND_RUN_DIR` | set per dispatch | The run dir the band MCP server writes into, injected per stage — unset means the server has no run to write to and says so rather than guessing one. |
| `CLEAROTRON_FEEDBACK_DIR` | `<poolRoot>/_feedback` | Where report feedback flags are stored. Beside the pool by default so a deployment that moves the pool moves the flags with it. |
| `USPTO_LOCAL_DB` | **none — set it to use `uspto-local`** | The local USPTO index (`node:sqlite` + FTS5) that `bin/uspto-sync.mjs` builds and the free US register reads. Named in `.env.example`; this is the reference row. |
| `CLEAROTRON_JX_SUBCLASS_DB` | unset ⇒ the lane refuses by name | Path to the built similar-group database the JX subclass lane reads, produced by `providers/jx-subclass/load-public.mjs` from the committed public tables. It names WHERE the table lives; what the table says is the build's. Absence is a refusal rather than an empty answer — a clearance that silently found no similar groups is indistinguishable from one where the file was missing. |
| `CLEAROTRON_SUITE_TELEMETRY_DIR` | unset ⇒ the box's ledger | Redirects the provider telemetry ledger into a suite run's own temp root, so a suite never writes the box's ledger and never inherits it. Sits BELOW an explicitly-named ledger file: a test naming its own path is being deliberate, and this exists for the runs that name nothing. |
| `FEEDBACK_GH_TOKEN` | unset ⇒ `gh`'s own auth | GitHub token for the unattended feedback minter (`scripts/feedback-mint.mjs`), for a service account with no `gh auth` login. Present ⇒ exported to `gh` as `GH_TOKEN` for that call only. A credential: it is not a placeholder value and must not be committed. |
| `USPTO_API_KEY` | unset ⇒ the download path refuses | API key for the USPTO bulk download path in `bin/uspto-sync.mjs`. The INGEST path needs no key and says so; only the download half reads this. A credential. |

### Concurrency and admission

| Var | Default | Meaning |
|---|---|---|
| `CLEAROTRON_MAX_CONCURRENT_RUNS` | **2** (min 1; re-read at call time) | Global run-slot cap — concurrently executing whole runs, however launched (manual CLI runs included). A deployment's `.env` may set a different value; read the live value rather than this column when you need the one in force. A value that is not a number is refused at the read, by name; the staff status page and the portal report the cap as absent with the reason rather than stating a number nobody chose. |
| `CLEAROTRON_GATHER_CONCURRENCY` | 7 | Parallel gather members per run (also batches escalation re-runs, the closure fan-out, the envelope close and the frame-reopen sweep). A split gather is three common-law seats + four register units = 7, so the default runs them in one wave; it was 6 before the meaning seat got its own dispatch. Report cards have their own knob, `CLEAROTRON_CARD_CONCURRENCY` (default 8). |
| `CLEAROTRON_RUN_LOCK_POLL_MS` | 15000 | Run-slot acquire poll cadence. |
| `CLEAROTRON_ADMISSION_BUDGET_MS` | 7200000 (2 h) | Runner stops claiming new jobs after this per activation; leftovers re-trigger a fresh activation. |
| `CLEAROTRON_QUEUE_SCAN_MS` | 10000 (min 1000) | Mid-drain re-scan for newly arrived jobs. |
| `CLEAROTRON_WHATIF_MAX_CONCURRENT` | 1 (min 1) | How many client what-ifs the runner drains at once. Deliberately NOT a run-slot: an experiment that took one from `CLEAROTRON_MAX_CONCURRENT_RUNS` could block an admitted paid clearance rather than merely share the box with it. This is a concurrency bound and not a spend control — the owner ruled spend controls out when he opened what-if to clients (2026-08-27), and nothing here refuses a client's next experiment. |
| `CLEAROTRON_STOP_GRACE_MS` | 60000 | Grace after first SIGTERM before exit(1). |
| `CLEAROTRON_MAX_CLAIM_AGE_MS` | 172800000 (48 h; 0 disables) | Hard ceiling on a claim's age (from the `.pid` sidecar mtime) — beyond it, re-claim regardless of liveness. |
| `CLEAROTRON_KNOCKOUT_VARIANT_CAP` | unset (⇒ the lane's own cap) | Ceiling on variants a knockout screens per name. Set only to bound an unusually wide batch; absent means the lane decides. |
| `CLEAROTRON_KNOCKOUT_RECORD_CAP` | unset (⇒ the lane's own cap) | Ceiling on records a knockout fetches per hit. Same shape as the variant cap: absent is the normal state. |

### Retries, timeouts, watchdogs

| Var | Default | Meaning |
|---|---|---|
| `CLEAROTRON_MAX_RETRIES` | 2 (⇒ 3 attempts) | Per-stage same-model retry budget; fresh session key per retry. |
| `CLEAROTRON_RETRY_BACKOFF_MS` | 20000 (`0` disables) | Inter-attempt backoff; attempt 1 never waits. |
| `CLEAROTRON_WARM_RETRY` | on (`0` disables) | The single warm-patch retry for allowlisted content defects. |
| `CLEAROTRON_STALL_MS` | 120000 | Global zero-streamed-output stall watchdog; per-stage `stallSec` overrides. A stall kill maps to `timeout`/`lane_wedge` for the ordinary ladder. |
| `CLEAROTRON_KILL_ESCALATE_MS` | 5000 (min 50) | Watchdog group SIGTERM → SIGKILL grace. |
| `CLEAROTRON_ENGINE_MAX_BUFFER` | 64 MiB of chars (min 1024) | Same cap on an engine subprocess's stdout/stderr: an endless newline-free stream resets the stall clock forever and would otherwise grow to the V8 string limit; overflow tree-kills and fails the turn as a plain `nonzero_exit` (never a timeout/wedge), and the truncated tail is never parsed. |
| `CLEAROTRON_RATE_LIMIT_DEFAULT_BACKOFF_MS` | 1200000 (20 min) | Park backoff for a 429 with no reset timestamp (immediate resume would hot-loop on the 90 s tick). |
| `CLEAROTRON_RECOVERY_MAX` | 3 | Auto-recovery park budget per run (backoffs 2/15/60 min). |
| `CLEAROTRON_MAX_BUDGET_USD` | unset | Optional `--max-budget-usd` ceiling passed to the engine subprocess. |
| `CLEAROTRON_NO_PROGRESS_MS` | unset (⇒ derived, see below) | PINS the no-progress watchdog to a fixed wall. Set only to reproduce a stall deliberately — a pinned value overrides the derivation entirely. |
| `CLEAROTRON_HARD_MS` | unset (⇒ stage timeout + 60s, else 660s) | PINS the hard turn ceiling, ms. That ceiling measures ACTIVE time — elapsed minus tool wait — so a turn waiting on a slow register call is not killed for waiting; a turn generating for the whole budget still is. Set only to drive the ceiling in a test: the derivation floors at 61s. A non-positive or unparseable value falls through to the derivation, so this cannot disable the wall. |
| `CLEAROTRON_NO_PROGRESS_FLOOR_MS` | `300000` (5 min) | The FLOOR under the derived no-progress wall: the watchdog waits `max(stage stall clock, this)`. A stage whose own clock is shorter still gets five minutes of silence before it is called stalled. |
| `CLEAROTRON_RATE_LIMIT_PROBE_MS` | `600000` (10 min) | How long a run parked on a provider cap waits before re-probing. Clamped to a 60s minimum — a probe loop tighter than that bills the cap it is waiting on. |
| `CLEAROTRON_RATE_LIMIT_PROBE_CEILING_MS` | `2400000` (40 min) | The longest that backoff may grow to. Also clamped to 60s minimum. |
| `CLEAROTRON_WALL_RESCUE` | **on** | The wall-clock rescue that salvages a torn draft when a stage hits its wall. `0`/`off`/`false`/`no` disarms it; anything else, including unset, leaves it armed. |

### Pipeline feature gates and caps

The **gates** default on, and `0` disables most of them. One does not read it that way:
`CLEAROTRON_PLAN_DISPATCH` goes through `envGateOn` and so takes any off-word. (`CLEAROTRON_COMMONLAW_SPLIT`
was the other, and its `!== "off"` test meant `0` left the split armed — a spelling trap that is gone
with the switch, deleted by item 8.) The numeric
**caps** and the policy enum in the last three rows are not on/off switches at all: `0` disables none of
them — it falls back to the stated default, and on `CLEAROTRON_UNREACHABLE_SENIOR` it is simply an
unrecognised policy value that leaves the default behaviour standing.

| Var | Gates |
|---|---|
| `CLEAROTRON_RECALL_PROBES` / `CLEAROTRON_RECALL_TRIPWIRE` | Prior-confirmed-conflict plan probes / recall store reads + regression check. |
| `CLEAROTRON_PLAN_DISPATCH` (`0` or `off` disables) | Pure-code provider `executePlan` repairs at fan-in and reopen. **Never silently inert:** every entry in `PROVIDERS` ships an `executePlan` adapter, and `preflightCredentials` refuses the run before any spend under one that does not — a credential is not a capability. §5.4 of [05-config-governance.md](05-config-governance.md) still lists `signa` as the exception to that and has not been updated since its two missing tools were mounted. |
| `CLEAROTRON_FRAME_REOPEN` (+ `CLEAROTRON_FRAME_REOPEN_MAX`, default 1) | The bounded frame-diff reopen. |
| `CLEAROTRON_REGISTER_GAP_CLAMP` | The registerGap + deadline-carry verdict clamp arms. |
| `CLEAROTRON_REOPEN_MAX_FETCH` (default 150) | Detail-fetch ceiling inside the reopen closure pass. |
| `CLEAROTRON_UNREACHABLE_SENIOR` (`open-item` \| `clamp`, default `open-item`) | Policy when a verdict-driving senior right can't be retrieved. |

### Payload ceilings

Chunking bounds, not timeouts. The one that remains is clamped to a floor so a mistyped value cannot
shrink a payload to nothing — a ceiling of `1` would otherwise turn a working sweep into a silent stream
of truncations.

| Var | Default | Meaning |
|---|---|---|
| `CLEAROTRON_BAND_RESPONSE_CHARS` | the shape-part size | Characters per band-server response. Floor 4096; defaults to whatever the shape part is set to, so raising one raises both unless this is set too. |

### Surfaces beside the driver — portal, demo, e2e harness

These are read by code that ships in this repository but is not a clearance stage. They are here
because 's rule is about what PRODUCT CODE reads, not about what a run reads.

| Var | Default | Meaning |
|---|---|---|
| `DEMO_PORT` | `18900` | Port `npx clearotron demo` serves the replayed report on. `--port` overrides it. |
| `CLEAROTRON_DEMO` | unset | `1` puts this install in the DEMO posture. **Ordering is real**: the four products are listed and orderable, the form, the plan and the confirmation are the product's own, and the confirmation resolves to a finished report that already exists rather than dispatching — no engine turn, no register call, no queue entry, no run directory (owner ruling 2026-08-31, superseding the greyed-control ruling of the same day). A product the demo carries no finished report for refuses and names which one. It also re-aims two boot warnings written for an operator of a real deployment at the visitor who is not one, from one place (`driver/demo-posture.mjs`). **Set by `npx clearotron demo`, not by an operator** — it is passed explicitly to the two processes that have a reason to know (the portal and the MCP door; the worker is not told, because a demo never queues anything for it to drain), and those run with `CLEAROTRON_NO_ENV_FILE=1`, so a stray `.env` can neither put a live install into demo mode nor take a demo out of one. Anything but the literal `1` is not a demo. Replaces `PORTAL_DEMO`, which named only one of the processes that has to know. |
| `PORTAL_LOCAL_CREDENTIAL` | `~/.cordillera/portal-local-credential.json` | Where local sign-in keeps its passphrase DIGEST. `npx clearotron demo` points it inside the demo's own base directory, so a demo mints its own passphrase instead of inheriting a digest minted for another address — and removing the demo stays one `rm -rf`. |
| `PORTAL_LOCAL_PASSPHRASE` | unset | **NEVER set this in a file.** An internal one-shot handoff, not an operator control: on a first FOREGROUND start the supervisor mints the passphrase and hands it to the portal it spawns *at the spawn call*, so the closing summary can print the value beside the address rather than sending a first-time reader back into eleven startup log lines for the one value in this product that cannot be read back. It is deliberately absent from the composed child environments, because that composition is what `--background` writes into the units' env file — a passphrase there would be a permanent plaintext copy on disk and the product's own sentence, "it is stored only as a digest", would stop being true. Setting it in any env file recreates exactly that. Lost passphrase: `clearotron passphrase --reset`. |
| `PORTAL_URL` | `http://127.0.0.1:18802`, or built from `PORTAL_SERVICE_HOST`/`PORTAL_SERVICE_PORT` | Where the deploy tick's live-surface check expects to reach the portal. |
| `PORTAL_OPS_TOKEN_FILE` | `~/.config/systemd/user/trademark-portal.service.d/secrets.conf` | The systemd drop-in the live-surface check reads `PORTAL_OPS_TOKEN` out of. It reads the FILE rather than the environment so a check run by hand sees the same token the service does. |
| `CLEAROTRON_AGENT_MCP_URL` | unset (⇒ `null`) | The API-key MCP door advertised to a signed-in client. Null until that door is deployed, and the UI keeps its honest empty state rather than inventing a URL. |
| `CLEAROTRON_AGENTS` | derived | Comma-separated agent ids for `scripts/purge-runs.mjs` to sweep. |
| `CLEAROTRON_E2E_DIR` | **none — the script refuses without it** | The config repo's `e2e/` directory. There is one suite and it is not in this repo (owner ruling 2026-08-07), so the comparison script names the variable rather than defaulting anywhere. |
| `CLEAROTRON_E2E_EXPECT_DEMO_ROSTER` | unset | `1` makes the live-surface check REQUIRE the bundled demo roster. For a box that is meant to ship the demos; off elsewhere, so a real deployment is not failed for lacking them. |

### Gates that are OFF by default

The section above is default-on switches. This one is the opposite and is kept separate so the two
cannot be read as one list.

| Var | Default | Meaning |
|---|---|---|
| `CLEAROTRON_SCREEN_GATE_UNNAMED` | unset (⇒ evidence only) | `enforce` arms the unnamed-row screen gate as terminal. Unset, the run RECORDS whether it enumerated anything under each unnamed row and does not fail — the evidence a decision about the semantics would be built from. Named in `.env.example`; this is the reference row. |


### Credentials and gather services (names only — values live in the deployment `.env`)

| Var | Consumer |
|---|---|
| `ANTHROPIC_API_KEY` | Engine child env in `api-key` mode only (deleted in subscription mode). |
| `OPENAI_API_KEY` | **Read only to be DELETED.** The `openai-agent` adapter strips it from the `codex exec` environment under subscription billing, so an unrelated key exported on the box cannot spoil a clean subscription bill. It is never the api-key credential for this product — that is `CODEX_API_KEY`. Listed because a reader who has one set needs to know it is removed. |
| `CORSEARCH_SESSION_KEY` | Register provider auth (session cookie). **Preflighted at run start — a missing credential fails fast before any model spend.** |
| `CLARIVATE_API_KEY` / `CLARIVATE_API_BASE` | Clarivate adapter — on the engine path: `clarivate-server.mjs` in `gather-config.mjs`'s stage-grant table, plus driver-side `recordFetch` / `countHits` / `listRecords` / `executePlan`. `CLARIVATE_API_BASE` overrides the core's `DEFAULT_BASE`. |
| `SIGNA_API_KEY` / `SIGNA_BASE_URL` | Signa adapter — the recommended tier's credential pair, with the same four driver-side adapters and its own `signa-server.mjs`. `SIGNA_BASE_URL` is optional and falls back to the core's `DEFAULT_BASE`. See [`providers/README.md`](../../providers/README.md), which carries the one open gap on this path: the stage grant in `gather-config.mjs` hands Signa a far narrower register-tool set than the other providers, `register_enumerate` among the withheld, and gives no probed reason for it. |
| `PERPLEXITY_API_KEY` | Marketplace grid research server. |
| `EUIPO_CLIENT_ID` / `EUIPO_CLIENT_SECRET` / `EUIPO_ENVIRONMENT` | EUIPO OAuth2 client-credentials; environment defaults to **sandbox** — production requires an explicit set. |
| `CLEAROTRON_MCP_URL` | Staff "Ask your AI" connector base, baked into the report at render — there is one report, and `portal-report.mjs` strips the block for non-staff readers at serve time. Fails closed → link omitted when unset. |
| `CLEAROTRON_CLIENT_MCP_URL` | Client "Ask your AI" connector base, served LIVE by the portal's `/portal/api/mcp-access` (the Use-your-AI screen) — set it on the portal unit, or the screen shows its (correct) empty state. The render no longer reads it: the baked block is the staff connector above. Fails closed → `{url:null}` when unset. **Never pin a placeholder value:** the fail-closed branch keys on the var being EMPTY, so a placeholder host defeats the guard and hands out a dead connector address. |
| `CLIENT_MCP_ACCOUNT_ACCESS` | `1` admits the signed-in CLIENT principal (kind `account`) on the client MCP surface: no token, scoped to the accounts the CF-verified email is granted. Off by default. Set WITHOUT `CLEAROTRON_ACCESS_FILE` ⇒ fatal start (`accountsForEmail` answers `"*"` with no guest list, and an unscoped wildcard must never be admitted). See `docs/CLIENT-MCP.md` — enabling this for an account with no `runCaps.dailyRuns` lets it start paid searches all day. |

### Scrub guard

| Var | Default | Meaning |
|---|---|---|
| `CLEAROTRON_IDENTIFIER_BLOCKLIST` | unset (⇒ sentinels) | Path to `identifier-blocklist.json` in the customer-config store: every customer and mark this repo has carried, paired with the demo twin that replaced it. Read by the client-identifier guard and the publication scan, never on a run path. **Unset is a supported mode**, not a degraded one — the guard runs on synthetic sentinels built into it, which exercise every branch of the matcher and identify nobody; that is how the public repository runs it. Set but unreadable, malformed, or below the size floor ⇒ **throws** (a truncated table reads as a smaller blocklist, and a smaller blocklist reads as a cleaner repo). The table is kept out of the product repo because the list of names *is* the thing the guard protects. |

### A/B, telemetry, debug

| Var | Default | Meaning |
|---|---|---|
| `CLEAROTRON_SYNTHESIS_MODEL` | unset (⇒ opus) | Stage-specific synthesis model override — the live A/B toggle (e.g. `fable`). Alias must be registered in the engine map or the dispatch REFUSES by name (; it used to run sonnet silently and log the alias asked for). Read at module load; effective per fresh oneshot process. |
| `CLEAROTRON_MEANING_SEAT_MODEL` | unset (⇒ `haiku`) | The common-law MEANING seat's model (`COMMON_LAW_SEAT_TIER[MEANING_SEAT]`, `stages.mjs`). The default moved sonnet → haiku on measured evidence: 2 attempts / 423 s against 1 attempt / 1674 s for the same outcome. **Margin:** sufficient at every load the test suite exercises, but at its densest scenario haiku used the last rung of the retry ladder — suspect this variable first if a dense matter's meaning seat goes terminal. Set`sonnet` to roll back with no code change. The thinking budget is NOT overridable (one variable, by design). |
| `CLEAROTRON_STAGE_THINKING` | unset (⇒ each stage's declared tier) | Per-stage thinking-tier override, `<stage>=<tier>[,…]` (e.g. `register-digest=high`) — the A/B instrument, so a suite arm needs no code fork or redeploy between runs. Thinking only: models are deliberately not overridable here, so one arm can never move two variables. **The env override is a dev/test instrument**; a permanent change edits the tier in `stages.mjs` and ships. Unknown stage or tier **throws** — `effortFor()` falls back to `medium`, so a typo would otherwise run a stage at a tier nobody chose and every number measured against it would be wrong. Read per call, so an arm can flip mid-process. |
| `CLEAROTRON_AZURE_MODEL` | `azure-openai/gpt-5.4` | Target of the `azure` alias — a legacy catalogue entry no engine can run (see model tiers above). |
| `CLEAROTRON_DUMP_JSON` | unset | Dump each attempt's raw engine envelope to `_driver/<stage>.attempt<N>.rawjson.json`. Opt-in: any value except `0`/`off`/`false`/`no`/empty arms it. |
| `CLEAROTRON_DISPATCH_RECORD` | **on** | Write the verbatim message of every stage dispatch to `_driver/<stage>.attempt<N>[.repair<M>].dispatch.txt`, with `{file, sha, bytes, chars, kind}` on the attempt row. **Default ON** — `0`/`off`/`false`/`no` disarms it. Unlike `CLEAROTRON_DUMP_JSON` beside it, this is opt-OUT: the question it answers ("was the model given this?") is asked *after* the run that raised it, so a flag someone had to remember would be off on exactly the run that needed it. The files carry client identity verbatim and are deliberately not in the artifact table. |
| `CLEAROTRON_GATHER_SESSION_KEY` / `CLEAROTRON_GATHER_AGENT` / `CLEAROTRON_GATHER_SESSION_ID` | set per stage | Telemetry attribution into the provider-call ledger (set by the gather config; not operator-set). |
| `CLEAROTRON_RECORD_AXIS` | set per dispatch (unset ⇒ the stage is not fanned out) | Binds one fan-out turn of a recording stage to the single member it may write. `stageOnce` suffixes a fan-out stage's label with its axis, the gather config resolves `<stage>:<axis>` back to the base stage's tool group, and this carries the axis to the recording server. A call whose payload names a different member than the turn is bound to is REFUSED, so a seat cannot write into a sibling's file — without the binding every turn of the fan-out would record over member one. Set by the driver; not operator-set. |
| `PORTAL_READ_MODEL` | `claude-sonnet-5` | The model the portal's own compose-read turn uses. Distinct from the pipeline's tiers: this is a portal surface, not a stage. |
| `CLEAROTRON_ORDER_PROBE_SEED` | unset | Seed for `scripts/band-shape-probe.mjs`, so an ordering probe can be replayed. A diagnostic script's knob, not a run's. |
| `PROBE_TERM` | `DELTA` | The mark word `providers/uspto-local/bin/verify-index.mjs` searches when verifying a built local USPTO index. A diagnostic script's knob, not a run's. Change it when a row reports MEASURES NOTHING: that means the term had no exact hit, so the row's timing is not a result. |

### Retired — set these and nothing happens

`#1838` deleted the settings below. Nothing in any environment set them, so each became the constant it
had always resolved to. **They are listed because an operator whose `.env` still carries one needs to
know it is inert** — an unread setting is indistinguishable from a setting that works.

| Was | Now fixed at |
|---|---|
| `CLEAROTRON_BAND_SHAPE_PART_CHARS` | 70000 characters per shape part |
| `CLEAROTRON_DEDUP_WINDOW_HOURS` | 24 hours, and the window can no longer be disabled |
| `CLEAROTRON_FETCH_MAX_CHARS` | 200000 characters per fetched page |
| `CLEAROTRON_FETCH_TIMEOUT_MS` | 30 seconds per fetch request |
| `CLEAROTRON_KNOCKOUT_COUNT_CONCURRENCY` | 3 parallel count calls |
| `CLEAROTRON_KNOCKOUT_SWEEP_CONCURRENCY` | 3 parallel sweep calls |
| `CLEAROTRON_NATIVE_LANGUAGE_WEDGE_BACKOFF_MS` | 60 seconds between whole-stage re-dispatches |
| `CLEAROTRON_NATIVE_LANGUAGE_WEDGE_CHAIN_RETRIES` | 2 re-dispatches |
| `CLEAROTRON_SUPPLEMENTAL_MAX` | 24 supplemental queries per axis |
| `CLEAROTRON_SUPPLEMENTAL_PER_CALL` | 12 supplemental queries per call |
| `CLEAROTRON_WALL_RESCUE_QUIESCE_MS` | 60 seconds waiting for a killed tree to quiesce |

## Change management

- **Live env flip (no deploy):** caps, backoffs, feature gates, A/B toggles — edit the deployment's
  `.env`; next activation picks it up. Keep the committed default and the live value reconciled, or
  note the divergence: config drift between code and `.env` has produced stale documentation before.
- **Deploy required:** stage-table changes, anything in `stages.mjs`/`driver.config.mjs`, and
  systemd unit changes — see [06](06-operations-runbook.md).
- **A/B required:** any grade-moving change — model family, effort level, tier remap
  (the model-swap doctrine: paid A/B against the reference library —
  [07 §7](07-quality-and-audit.md#7--the-memory-that-keeps-it-honest)).
