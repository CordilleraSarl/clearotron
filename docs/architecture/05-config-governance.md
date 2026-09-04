# 05 — Configuration Governance

> The register of every configurable knob in the **trademark clearance product**: where it lives,
> who manages it, and through which surface. Companion to
> [04-configuration-reference.md](04-configuration-reference.md) (per-var semantics of the
> driver-compute layer), plus the non-env config surfaces in §4. The authoritative count is not in
> this file: `node scripts/env-audit.mjs` sweeps the tracked tree and reports every name read by
> code, split into the ones product code reads (which need a row here) and the ones only tests,
> mocks and dev scripts read (which do not). It also lists the product names that have **no**
> governance row yet — run it before trusting this register to be complete.
>
> **Scope:** this repo's product only. Deployment-*state* (a specific box's AUD tags, env-file
> layout, backups, cron) belongs in the deployment's own ops repo, not here — this document stays
> generic so it is true for every install.
>
> **Maintenance rule:** adding a var anywhere in the repo means adding its row here (pick a tier).
> Unset must mean *omitted or loudly missing*, never *looks configured* — no `example.com` placeholder
> defaults, no hardcoded `/home/<user>` fallbacks. `driver/test/deployment-hostnames.test.mjs` enforces
> those two and seven more; read its test names rather than assuming which of your changes it covers.

## 1. The five management tiers

| Tier | Who changes it | Through what | Examples |
|---|---|---|---|
| **T1 — Client** | The client (self-service) | Agent conversation → job spec; client portal | mark, classes, deadline, own profile fields, flags |
| **T2 — Staff/ops UI** | Firm staff | the portal's brand screens, profile-service | customer profiles, project overlays, saved searches, run curation |
| **T3 — Operator env** | Ops, on the box | the EnvironmentFile + restart/next-activation | hostnames, models, caps, timeouts, feature gates |
| **T4 — Backend-only** | Ops, deliberately | env secrets, unit files, code defaults | credentials, token secrets, data-plane paths, dev seams |
| **T5 — Edge auth** | Ops, in the edge console | the auth proxy's own console, off-box (reference: a Cloudflare Zero-Trust tenant) | ingress routes, access apps + policies |

The UI mapping, as the `portal-ui` nav is actually structured: T2 → **`brand.profile`** ("Brand
profile", everything specific to one brand owner) + **`brand.projects`** + **`brand.searches`**
("Custom searches"), plus **`admin.access`** ("People & access") for who may sign in; T3 →
**read-only** in **`admin.config`** ("Global config"): which engine is running the searches and who is
billed for them, and every provider a search depends on with a configured-or-missing state — secrets,
paths and switch names deliberately excluded, visible to staff, changed only on the backend.

`admin.config` listed the engine's feature switches by name until. It stopped because the listing
answered a question nobody opens the page to ask: a person arrives wanting to know what this instance is
running and what is not wired up, and a register of internal machinery answers neither. A provider with
no credential is shown as a row saying MISSING rather than omitted — an omitted row is invisible, and a
page listing two providers reads exactly like a complete set of two.

The switches themselves are still RECORDED in the snapshot (`flagsDeclared`, `postureDelta`);
changed what is rendered, not what is written. The auth row that page will also carry is not built: it
waits, which has to settle the access model first.

Both admin screens are **built and read-only by design**, not stubs awaiting a write path. Granting
access from a browser is a production change; it belongs in the grants file where it is reviewed and
recorded.

## 2. Where the product's configuration lives

| # | Place | Holds | Change path |
|---|---|---|---|
| 1 | The EnvironmentFile (`%h/.env`) | secrets + T3 operator env for the generic units | ops, by hand. **Keep it dedicated to this product where possible** — sharing one env file with another stack couples rotation and backup blast-radius across products |
| 2 | systemd user units (`driver/systemd/`, `mcp-server/remote/`) | ports, CF Access mirrors, paths. Two kinds — **generic** (defer to the EnvironmentFile; safe to sync verbatim) vs **template** (placeholders in-repo, real identity-edge values in the live copies; merge by hand after a diff — banner-marked). Copying a template over a live unit replaces working auth with placeholders that *look* configured, which is why the two kinds are distinguished at all | this repo's deploy |
| 3 | The config store (separate git repo) | customer profiles, project overlays, frameworks/skills | profile-service + client portal git auto-commit; frameworks by git edit (deliberate) |
| 4 | Client allowlist file (`CLIENT_ACCESS_MAP` JSON) | client per-email → customer grants | git + PR (today it lives in the integrator's repo — a candidate to move into the config store so the product owns all its config) |
| 5 | Web-server / edge routing (reverse-proxy block or tunnel ingress; this deployment: Caddy + Cloudflare) | which hostname reaches which loopback port; the pool's file-server root | ops |
| 6 | Data roots (`CLEAROTRON_REPORTS_DIR`, shares) | published reports, quality flags | services |
| 7 | **Edge console** (off-box; reference: Cloudflare) | ingress routes + access apps and who they admit | ops — **not recoverable from the box**; keep an exported note of apps/AUDs in the deployment's ops repo |
| 8 | Integrator mirrors (optional) | when deployed beside an agent platform, register-provider credentials and the artifacts-MCP env block may be **duplicated into the integrator's config**. Treat every such copy as a mirror: rotate in the same change | integrator's deploy |

## 3. The edge model — one mechanism, three roles

Recurring confusion, settled: "we configure the MCP servers at the edge" is true only for the
**edge**. The worked example below is a Cloudflare Zero-Trust deployment; any JWT-fronting proxy
fills the same three roles, and the product requires none of them by name.

1. **Edge auth (T5, dashboard):** the tunnel routes each public hostname to a loopback port, and a
   CF Access app decides *who* may reach it (staff domain gate; client per-email policy; dev app).
2. **Local verification (T4, unit files):** every service *independently re-verifies* the CF Access
   JWT. For that it needs the team + the app's AUD tag — so `CF_ACCESS_TEAM`/`CLEAROTRON_OIDC_AUDIENCE`/
   `MCP_ALLOWED_EMAIL_DOMAINS` appear in unit files as **mirrors of the dashboard**, not a second
   setup. They must match the edge; rotation touches both. The CF-gated loopback services
   deliberately do NOT load the shared EnvironmentFile so one app's AUD can't shadow another's
   (client-access/client-mcp refuse to start if client AUD == staff AUD).
3. **Rendered links (T3, env):** `CLEAROTRON_REPORTS_URL`, `CLEAROTRON_MCP_URL`, `CLEAROTRON_CLIENT_MCP_URL`,
   `CLEAROTRON_ACCESS_DOMAIN` are neither of the above — they are what gets *printed into reports and
   emails*. Wrong values render dead links; unset values are omitted.

Every deployment should keep its own app↔mirror pairing table (which Access app fronts which hosts,
and which unit files carry that app's AUD) in its ops repo — that list is deployment state, not
product doc.

## 4. Non-env config surfaces (T1/T2)

| Surface | Tier | Managed via | Storage | State today |
|---|---|---|---|---|
| **Job spec** (per matter): id, forwarder(+email/domain), markName/marks[], classes\|goods/use, ref, profileKey, projectKey, searchLevel/recipeKey, deliveryRoute, customer(+Unknown), deliverableSpec, commercialFlexibility, priorUse, dupOverride, deadline, brief | T1 | agent conversation → `start_run` MCP verb (ops token) → queue; validated by `enqueue-schema.mjs` | queue → run dir | LIVE (conversational; portal `run/plan`+`run` API exists) |
| **Customer profile** (17 keys — identity/rating/provenance: name, matchDomains, selfExclusionOwners, frameworkPath, workedExamplesPath, allowedRecipes, jxPolicy, runCaps, demoData (`true` marks the record as demo data; a real clearance is refused at the runner's admission wall); overlayable: platforms, defaultClasses, defaultJurisdictions, marketplaceDensity, delivery, riskAppetite, industry, defaultProduct) | T2 (staff) + T1 (client edits own via portal §C) | profile-service UI (staff, `/profiles/*`); client-access UI (own profile) | config store, git auto-commit | LIVE. Merge law: project **replaces** every overlayable key except `platforms`, which **unions** (client floor never subtractable) |
| **Project overlays** (8 overlayable keys) | T2 | profile-service UI | config store `profiles/projects/<cust>/` | LIVE. The project form deliberately withholds `defaultProduct` and both `delivery` sub-keys — for the first the sparse save path has no `""` ⇒ clear branch, so the control could only ever be turned on; for the second the engine replaces `delivery` wholesale, so a partial overlay would silently drop the customer's other sub-keys. Both are customer-level controls until the server side changes |
| **Frameworks / skills** (risk-framework-<key>.md + .manifest.json, worked examples, SKILL.md) | T2 (senior-lawyer content) | git edits in the config store (deliberate — the prose deck is the rating authority) | config store `skills/prelim-search/` | LIVE via git; no UI by design |
| **Recipes / saved searches** (base level + component toggles + emailTable/defaultDeadlineDays/standingInstructions) | T2 | recipe-service UI | `<recipesDir>/<cust>/<slug>.json`, git | **DARK** — code complete, no unit deployed. A saved search is honoured wherever it resolves (the `CLEAROTRON_RECIPES_MODE` door was retired 2026-07-27) |
| **Run curation** (archive folds, republish, index regen) | T2 | `pool-admin.mjs` CLI only | pool `archive-tags.json` | LIVE, CLI-only |
| **Client allowlist** (`{version, grants:[{email, customer}]}`) | T2 | git + PR on the `CLIENT_ACCESS_MAP` file | see §2 row 4 | LIVE, file-only; surfaced read-only at `admin.access` |
| **Ops tokens** (scope ops/user, verbs, accounts, TTL) | T4 | `mint-token.mjs` CLI; jti denylist file | operator-held tokens | LIVE, CLI |

## 4b. The install surface names (,)

The variables a **customer or installer** ever types carry the product’s own prefix. They are listed
by name in §5 below and in the upgrade table in INSTALL.md.
`PRELIM` is the internal codename of the first product this engine shipped and means nothing to a reader
who has not read the code. Vendor credentials keep the vendor’s name (`SIGNA_API_KEY`,
`PERPLEXITY_API_KEY`, `ANTHROPIC_API_KEY`) — that already says who you bought them from.

**THERE IS ONE SPELLING.** The compatibility window that read both closed on 2026-08-26 by owner ruling:
no migration, no legacy support. A deployment is REBUILT from the install rather than carried across,
which is also the only thing that proves the install works for a new reader — a migrated box tests a path
no new user ever walks.

**A retired spelling is not checked for either** — owner ruling, same day, asked directly. The premise
is what makes the absence correct rather than careless: a machine reaches this code through the install,
the install writes the names in force, and the boxes that predate the rename are rebuilt rather than
deployed onto. There is no population left holding the old lines.

**Open, and older than the rename.** A machine with NO configuration still falls back silently —
`CLEAROTRON_CUSTOMERS_DIR` unset means the bundled DEMO roster and `CLEAROTRON_INSTRUCTIONS_DIR` unset
means the bundled instructions, so a run answers from demo data and says nothing. That was true before
this change and is true after it. It is a product question rather than a rename question, and nobody
has taken it.

**`CLEAROTRON_JX_LANES` was held back from the August 2026 rename** — it was RETIRED 2026-07-27
(`pipeline.mjs` `RETIRED_ENV`, `jx-units.mjs`) and nothing reads it, so renaming a dead name looked like
handing an operator a name that warns about nothing. The owner's 2026-09-04 ruling reversed that: the
whole namespace carries one prefix, dead names included, because a tree spelled two ways costs more
than a retired row spelled consistently. The per-lane `CLEAROTRON_NATIVE_LANGUAGE_<code>` switch in the same row **is** live and is
fail-OPEN: unset means ON (§5.5,).

Variables outside the install surface were left alone by the August rename — `CLEAROTRON_ENGINE_MAX_BUFFER`
and its siblings were never in that window. **That separate decision was taken on 2026-09-04**: the owner
ruled the rename global and pre-cut, so the internals carry the house prefix too and the public tree never
shows the old namespace. No compatibility layer, no alias reading, no migration — greenfield, and our own
boxes rebuild.

## 5. Env-var register (by domain → tier)

Tiers: T3 = operator-tunable (candidate for read-only display); T4 = backend-only (secret,
structural, or dev seam); [dev] = dev/test seam, never set in prod.

### 5.1 Deployment identity & rendered links — T3 (the dead-link class)

| Var | Default | Meaning |
|---|---|---|
| `CLEAROTRON_REPORTS_URL` | none — required (else links omitted + loud preflight) | Pool public base URL in notification links |
| `CLEAROTRON_MCP_URL` | fail-closed omit | Staff "Ask your AI" connector base |
| `CLEAROTRON_CLIENT_MCP_URL` | fail-closed omit | Client connector base |
| `CLEAROTRON_ACCESS_DOMAIN` | omit note | Identity domain in the delivery email access note |
| `CLEAROTRON_BOX` | unset ⇒ the expected-but-absent check is suppressed | Which deployment this is (`prod` \| `test`), for `scripts/live-surface-check.mjs`'s unit inventory. Self-declared, never inferred from the account name: an unrecognised value suppresses the arm rather than reporting every production unit missing |
| `CLEAROTRON_BRAND_NAME` / `CLEAROTRON_BRAND_TAGLINE` / `CLEAROTRON_BRAND_PRODUCT` | reference-tenant literals in `shared/brand.mjs` | Tenant brand seam (single-sourced) |

### 5.2 Engine & models — T3

`CLEAROTRON_AI` (anthropic-agent | openai-agent; default anthropic-agent), `CLEAROTRON_AI_BILLING`
(subscription|api-key), `CLEAROTRON_AI_BILLING` (subscription|api-key), `CLEAROTRON_CODEX_PATH`,
`CLEAROTRON_OPENAI_AUTH_FILE`, `CLEAROTRON_OPENAI_MODEL_JUDGMENT` / `CLEAROTRON_OPENAI_MODEL_SWEEP` /
`CLEAROTRON_OPENAI_MODEL_CHEAP` (all gpt-5.6-sol),
`CLEAROTRON_CLAUDE_PATH` (claude), `CLEAROTRON_AZURE_MODEL`,
`CLEAROTRON_SYNTHESIS_MODEL` (opus), `CLEAROTRON_KNOCKOUT_MODEL` (opus),
`CLEAROTRON_KNOCKOUT_PRESET` (pro-search), `CLEAROTRON_MAX_BUDGET_USD` (unset).

### 5.3 Concurrency, admission, retries, walls — T3 (walls are load-bearing; change deliberately)

`CLEAROTRON_MAX_CONCURRENT_RUNS` (2), `CLEAROTRON_GATHER_CONCURRENCY` (7), `CLEAROTRON_CARD_CONCURRENCY` (8),
`CLEAROTRON_ADMISSION_BUDGET_MS` (2h), `CLEAROTRON_QUEUE_SCAN_MS` (10s), `CLEAROTRON_MAX_RETRIES` (2⇒3
attempts), `CLEAROTRON_RETRY_BACKOFF_MS` (20s), `CLEAROTRON_STALL_MS` (120s), `CLEAROTRON_SPAWN_GRACE_MS` (2s,
and only where it exceeds the stall window), `CLEAROTRON_KILL_ESCALATE_MS`
(5s), `CLEAROTRON_HTTP_TIMEOUT_MS` (30m), `CLEAROTRON_ENGINE_MAX_BUFFER` (64MiB),
`CLEAROTRON_RATE_LIMIT_DEFAULT_BACKOFF_MS` (20m),
`CLEAROTRON_RECOVERY_MAX` (3), `CLEAROTRON_MAX_CLAIM_AGE_MS` (48h),
`CLEAROTRON_STOP_GRACE_MS` (60s), `CLEAROTRON_RUN_LOCK_POLL_MS` (15s),
`CLEAROTRON_MIN_FREE_DISK_MB` (500 — free space the run door requires on the filesystem holding
`CLEAROTRON_WORK_DIR`; below it the run is refused before anything is written, because a disk that
fills mid-run surfaces as a *missing artifact* at a later stage rather than as a disk error. `0`
disables; a non-numeric value throws rather than silently disabling the guard.).

### 5.4 Pipeline feature gates & kill switches — T3 (defaults ON; `0` disables)

`CLEAROTRON_PLAN_DISPATCH`, `CLEAROTRON_SATPROBE_CODESIDE`,
`CLEAROTRON_BAND_TRUTH_GATE` (**never disable in prod — restores the fabrication**),
`CLEAROTRON_FRAME_REOPEN` (+`CLEAROTRON_FRAME_REOPEN_MAX`=1, `CLEAROTRON_REOPEN_MAX_FETCH`=150),
`CLEAROTRON_REGISTER_GAP_CLAMP`, `CLEAROTRON_RECALL_PROBES`, `CLEAROTRON_RECALL_TRIPWIRE`, `CLEAROTRON_WARM_RETRY`,
`CLEAROTRON_MODEL_WIRE_CHECK` ( — fails a turn whose
provider reports a different model FAMILY than the driver asked for; disarming it silences the refusal
and never the record: `modelActual`/`modelMismatch` keep landing on every dispatch row), `CLEAROTRON_FORM_REPAIR`
( — repairs a form-class stage failure inside the dispatch, up to twice; disarmed, the defect
falls through to the retry ladder exactly as it did before, visibly, and is never swallowed as
"validated fine"). Policy knob: `CLEAROTRON_UNREACHABLE_SENIOR`
(open-item|clamp). Enumerate: `CLEAROTRON_ENUMERATE_CEILING` (600/OR-stack),
`CLEAROTRON_ENUMERATE_NAMES_CHUNK` (80).

**Three of these are conditional on the wired register provider, and turning them ON cannot make them
run.** They are `&&`-ed with a provider capability, so under a provider that lacks it the gate is
already off and the ON setting is a no-op:

| Gate | Needs | corsearch | clarivate | signa |
|---|---|---|---|---|
| `CLEAROTRON_PLAN_DISPATCH` | an `executePlan` adapter | yes | yes | **no — inert** |
| `CLEAROTRON_SATPROBE_CODESIDE` | an `executePlan` adapter (it rides the same lane) | yes | yes | **no — inert** |

Nothing is broken here — a provider that cannot execute a plan cannot dispatch one — but the run does
change shape without announcing it, so the conditionality is stated rather than left to be inferred.
The capability contract is the authority (`providers/<id>/src/capabilities.js`, resolved by
`driver/register-capabilities.mjs`); `driver/flag-snapshot.mjs` is where a caller outside the engine's
environment reads what the ACTIVE provider can actually do.

### 5.5 Search-depth spine — T3 (defaults OFF; arm deliberately)

Per-lane `CLEAROTRON_NATIVE_LANGUAGE_<XX>` — `zh`, `ja` and `ko` all work (`LANGUAGE_LANES` in
`driver/jx-lanes.mjs`); default on, set `0` to kill one lane — plus `CLEAROTRON_JX_SERP_DEADLINE_MS`.
`CLEAROTRON_JX_SERP_GRID`, `CLEAROTRON_JX_NATIVEREAD` and `CLEAROTRON_JX_CONSUME` were **deleted by item 8**
under ADR-0002: each was off here and on in production, so the shipped default described a
configuration nobody ran. The slices now run on conditions a client can already see.

`CLEAROTRON_KNOCKOUT_MODE`, `CLEAROTRON_JX_LANES` and `CLEAROTRON_RECIPES_MODE` were **RETIRED 2026-07-27** and
have no reader. Depth availability is decided by `BUILT` (`driver/search-policy.mjs`) and the wired
provider, in every process, with no environment involved. The `pipeline.mjs` CLI warns on stderr if
any of the three is still set — it does not refuse, because a dead variable in a stale
EnvironmentFile changes nothing and refusing on it would turn a stale line into a failure to run.
Delete the lines. Register provider: `CLEAROTRON_DATABASE` — **required, no default, in every
environment including production**; unset resolves to `null` and throws at first use. See
[04](04-configuration-reference.md#engine-and-auth-selection) for the six accepted values.

### 5.6 Data-plane paths — T4 (structural; systemd/EnvironmentFile owned)

`CLEAROTRON_WORK_DIR` (~/trademark/workspace since; the two`.path` units
hardcode the old glob — see 04), `CLEAROTRON_WORKSPACE_PREFIX` (workspace-), `CLEAROTRON_QUEUE_DIR`,
`CLEAROTRON_INSTRUCTIONS_DIR` (config store), `CLEAROTRON_CUSTOMERS_DIR` (config store), `CLEAROTRON_RECIPES_DIR`,
`CLEAROTRON_REPORTS_DIR` (**no default since — unset refuses**),`CLEAROTRON_RUN_LOCK_DIR`, `CLEAROTRON_OUTBOX_DIR`,
`CLEAROTRON_STAFF_POOL_ROOT`, `CLEAROTRON_REGISTER_CALL_LOG` (~/trademark/telemetry/…, homedir-derived at
call time, resolved by existence over the pre- telemetry directory too; the pre-
`CORSEARCH_*_LOG` names remain accepted for one release),
`CLEAROTRON_REGISTER_RECORD_LOG` (**no longer a box path since ** — the driver injects
`<runDir>/_driver/register-record-bodies.jsonl` per run; setting it by hand pins every run's record
bodies to one file and restores the unbounded growth the move removed),
`TRADEMARK_MCP_AUDIT_LOG`, `PORTAL_AUDIT`, `PROFILE_AUDIT`, `RECIPE_AUDIT`,
`PROFILE_REPO_ROOT`, `RECIPE_REPO_ROOT`, `CLEAROTRON_OAUTH_BRIDGE` (module-relative),
`OAUTH_BRIDGE_CREDS_DIR`, `OAUTH_BRIDGE_CLIENT_NAME`.

`PROFILE_DIR` **left this list.** The customer store is named once, by
`CLEAROTRON_CUSTOMERS_DIR`, and resolved through `shared/customer-store.mjs` for the settings
surface and the runs alike. It is not accepted as a fallback: a box setting only the retired name
would otherwise pull the settings surface onto a second store, which is the split that issue
closed. It still appears in `env-set-in-production.txt` because production is measured, not
edited — that box runs pre-rebuild code and genuinely still sets it.
| `CLEAROTRON_JX_SUBCLASS_DB` | unset ⇒ the similar-group lookup REFUSES by name | Path to `similar-groups.db`, built by `node providers/jx-subclass/load-public.mjs` from the committed `public/` tables. Not committed (the office sources permit redistributing the data, not their prose), so a deployment builds it. Unset or missing is a refusal, never an empty answer: `node:sqlite` creates an empty file on open and every lookup over it would read as "no similar groups" — a false clear in the offices a Western client can least check |

### 5.7 Delivery & comms — T3/T4

`CLEAROTRON_DEFAULT_AGENT` (clawdi), `CLEAROTRON_SEND_TOOL_PREFIX`
(clawdi_send_), `CLEAROTRON_AGENT_WHATSAPP`, `CLEAROTRON_OUTBOX_BACKOFF_BASE_SEC` (60) / `CLEAROTRON_OUTBOX_BACKOFF_CAP_SEC` (900) /
`CLEAROTRON_OUTBOX_BACKOFF_MAX_RETRIES` (5) / `CLEAROTRON_OUTBOX_GIVEUP_COOLDOWN_SEC` (3600 — note this one
drops BACKOFF from the prefix, which the elided spelling this row used to carry actively misled about),
`CLEAROTRON_OUTBOX_NOPROGRESS_MAX`, `TRADEMARK_MSGID_DOMAIN` (enqueue.local).
Code-set per stage (not operator-set): `CLEAROTRON_GATHER_AGENT` / `CLEAROTRON_GATHER_SESSION_KEY` / `CLEAROTRON_GATHER_SESSION_ID`.

### 5.8 Credentials — T4 (secrets; EnvironmentFile only; mirror-aware — see §6)

`ANTHROPIC_API_KEY`, `CORSEARCH_SESSION_KEY` (fail-closed preflight),
`CLARIVATE_API_KEY`/`CLARIVATE_API_BASE`, `SIGNA_API_KEY`/`SIGNA_BASE_URL`, `PERPLEXITY_API_KEY`,
`SERPAPI_API_KEY`, `EUIPO_CLIENT_ID`/`EUIPO_CLIENT_SECRET`/`EUIPO_ENVIRONMENT` (sandbox — prod needs explicit
set), `TRADEMARK_MCP_TOKEN_SECRET` (+`TRADEMARK_MCP_TOKEN_SECRET_PREVIOUS` rotation window, `TRADEMARK_MCP_TOKEN_DENYLIST`),
`PORTAL_SECRET`, `PORTAL_OPS_TOKEN`, `CLEAROTRON_ACCESS_FILE` (unset = enforcement off **for the MCP faces
only**; the portal refuses to start without it — see [docs/SECURITY.md](../SECURITY.md)).

**Scrub guard (test-time only — never read on a run path, and outside the five tiers above).**
`CLEAROTRON_IDENTIFIER_BLOCKLIST` points at `identifier-blocklist.json` in the customer-config store: the
retired customer/mark roster the scrub guard matches on, kept out of the product repo because the list
of names *is* what the guard protects. Unset is a SUPPORTED mode, not a degraded one — the guard runs
on synthetic sentinels built into the guard, which is how the public repository runs
it. Set-but-unreadable, malformed, or below the size floor **throws**: a truncated table reads as a
smaller blocklist, and a smaller blocklist reads as a cleaner repo. **Whether the real table is required
is the CALLER's declaration, never the environment's**: `publication-scan.mjs` asks for it in its own
source and refuses by name before it runs a single check if it cannot reach it. There is no switch —
`CLEAROTRON_REQUIRE_BLOCKLIST` was deleted by owner ruling, because a variable that decides whether a scrub
guard looks for anything real has a silent OFF position, and silent-off is the one state this module
exists to make impossible: without the table, "matched nothing" and "had nothing to match on" are the
same green.

### 5.9 Service faces (staff MCP / client MCP / portal / profile / recipe) — T4 + T5 mirrors

Staff MCP: `TRADEMARK_MCP_HTTP_PORT` (18790), `TRADEMARK_MCP_HTTP_HOST`,
`TRADEMARK_MCP_ALLOWED_HOSTS`, `TRADEMARK_MCP_SESSION_TTL_MS` (30m), `TRADEMARK_MCP_SESSION_MAX` (500),
`TRADEMARK_MCP_RATE_PER_MIN` (120), `TRADEMARK_MCP_OPS_RATE_PER_MIN` (30),
`TRADEMARK_MCP_MAX_BYTES` (64MiB), `TRADEMARK_MCP_OIDC_ISSUER`, `TRADEMARK_MCP_JWKS_URL`,
`TRADEMARK_MCP_EMAIL_CLAIM`, `TRADEMARK_MCP_AUTH_HEADER`, `TRADEMARK_MCP_URL`,
`TRADEMARK_MCP_AUTH_MODE` (see below),
`TRADEMARK_MCP_AUTH_DISABLED` / `TRADEMARK_MCP_DEV` (dev seams — never set in prod).
Client MCP: `CLIENT_MCP_HTTP_PORT` (code default 18811, matching the deployed unit; it was 18795,
which collided with a co-hosted warm-MCP block, so keep any unit override that names a port),
`CLIENT_MCP_HTTP_HOST`, `CLIENT_MCP_ALLOWED_HOSTS`,
`CLIENT_MCP_SESSION_TTL_MS`, `CLIENT_MCP_SESSION_MAX`, `CLIENT_MCP_RATE_PER_MIN`, `CLIENT_MCP_URL`,
`CLIENT_MCP_TOKEN_ONLY`, `CLIENT_MCP_AUTH_DISABLED` / `CLIENT_MCP_DEV` (dev seams — never set in prod). CF mirrors (T5): `CF_ACCESS_TEAM`, `CLEAROTRON_OIDC_AUDIENCE`,
`CLEAROTRON_CLIENT_OIDC_AUDIENCE`, `MCP_ALLOWED_EMAIL_DOMAINS`, `MCP_ALLOWED_EMAILS`. Admin services:
`PORTAL_SERVICE_PORT` (18802) / `PORTAL_SERVICE_HOST`, `PORTAL_STAFF_DOMAINS`, `PORTAL_MCP_URL`,
`PORTAL_RATE_PER_MIN`, `PORTAL_LOCAL_WORKER` (set only by `bin/start.mjs` when it supervises a worker,
and what licenses the portal to say a queued job is waiting for one — a deployed instance drains via
systemd, writes no heartbeat, and must keep saying "waiting to start" rather than invent an alarm),
`PROFILE_PORT` (18794) / `PROFILE_HOST` / `PROFILE_RATE_PER_MIN` (60),
`RECIPE_PORT` (18801) / `RECIPE_HOST` / `RECIPE_RATE_PER_MIN`, `CLIENT_ACCESS_HOST` / `CLIENT_ACCESS_PORT` / `CLIENT_ACCESS_POOL` /
`CLIENT_ACCESS_REPO_ROOT` / `CLIENT_ACCESS_MAP` (**read by the integrator's process, not by this
repo** — `git grep process.env.CLIENT_ACCESS` here returns nothing, so they are governed here and
never appear in the audit).

**Which identity source the portal runs (,) — T4, and it is chosen by name, never inferred.**
`PORTAL_AUTH_MODE` selects the door: unset or `auth-proxy` (the default for a hosted deployment) means
any login system in front that authenticates in the browser and forwards a verifiable JWT per request.
**Any OIDC or JWT proxy is a choice per deployment** — for example Cloudflare Access, which is not a
special case in the code; `local` means one address and one passphrase on loopback. **`cf-access` is the older word for `auth-proxy`, accepted forever and meaning
exactly the same thing** — normalised where the mode is read rather than by an alias row, because
`shared/env-aliases.mjs` maps variable NAMES and there is no value-alias mechanism.

**Bringing your own login provider ( item 1, completed by) — T4.**`PORTAL_OIDC_ISSUER`,
`PORTAL_JWKS_URL`, `PORTAL_EMAIL_CLAIM` and `PORTAL_AUTH_HEADER` are the portal-side spelling of the four
values the staff MCP face already reads as `TRADEMARK_MCP_OIDC_ISSUER`, `TRADEMARK_MCP_JWKS_URL`,
`TRADEMARK_MCP_EMAIL_CLAIM` and `TRADEMARK_MCP_AUTH_HEADER`. `makeAccessVerifier` has always accepted them; the portal
never passed them, which is how one product shipped a provider-agnostic API face and a single-vendor
web portal.

**ALL FIVE DOORS READ THE FOUR NOW, and 's "the auth mechanism is out of scope" boundary is
superseded** (owner, 2026-08-23: an installation brings its own identity provider and this product may
not force one). The two write services and the client MCP origin gained the set they lacked; the table
below names every one of the twelve. The client door's four fall back to the staff face's equivalents
before falling back to the vendor-derived shapes, because those two doors sit behind one provider and
are told apart by AUDIENCE — pointing them at different issuers is a mistake the audience check cannot
catch, so it has to be deliberate. The client door also passes `authHeader` into `makeHttpHandler` now;
it did not before, so its seam would have been settable and inert.

**Named in full rather than as a prefix**, because a row that abbreviates a family documents nothing an
operator can search for — and `#692`'s own second arm fails exactly that, which is how this table came
to be written out.

| service | issuer | JWKS | identity claim | token header |
|---|---|---|---|---|
| profile service | `PROFILE_OIDC_ISSUER` | `PROFILE_JWKS_URL` | `PROFILE_EMAIL_CLAIM` | `PROFILE_AUTH_HEADER` |
| recipe service | `RECIPE_OIDC_ISSUER` | `RECIPE_JWKS_URL` | `RECIPE_EMAIL_CLAIM` | `RECIPE_AUTH_HEADER` |
| client MCP origin | `CLIENT_MCP_OIDC_ISSUER` | `CLIENT_MCP_JWKS_URL` | `CLIENT_MCP_EMAIL_CLAIM` | `CLIENT_MCP_AUTH_HEADER` |

Each is T4, each is optional, and each unset falls back exactly as the two older sets do — the client
row to the staff face's matching value first (`TRADEMARK_MCP_OIDC_ISSUER`, `TRADEMARK_MCP_JWKS_URL`,
`TRADEMARK_MCP_EMAIL_CLAIM`, `TRADEMARK_MCP_AUTH_HEADER`), then to the shapes derived from
`CF_ACCESS_TEAM` for whichever JWT-fronting proxy the deployment runs.

The set is guarded rather than listed: `driver/test/a-verifier-takes-its-issuer-from-configuration.test.mjs`
walks the tracked tree for every call to `makeAccessVerifier` and fails one that names no issuer, and
fails any door whose boot guard still demands a team outright. A sixth door is in scope the day it
lands. Unset ⇒ the shapes derived from `CF_ACCESS_TEAM`, so no existing deployment changes.
**The boot guard is an audience PLUS either a team or an issuer** — before this, a deployment using
your own OIDC issuer and no vendor team could not start at all, and missing both is still fatal. `PORTAL_AUTH_HEADER` is **lowercased when read**, because Node lowercases incoming header
names and a verbatim `Cf-Access-Jwt-Assertion` would match nothing and refuse every correctly
authenticated user. Nothing is inferred —
a missing `CF_ACCESS_TEAM`/`CLEAROTRON_OIDC_AUDIENCE` is still a refusal to start, never a silent switch to local,
and an unrecognised value is fatal rather than treated as the default. Loopback cannot be the signal:
the test box and production both bind 127.0.0.1 behind a tunnel.

Local mode adds two values and no third: `PORTAL_LOCAL_USER` is the one email address that signs in
(mandatory in that mode — the service refuses to start without it, and the address must ALSO be enrolled
in `CLEAROTRON_ACCESS_FILE` or on a staff domain, because signing in is not being enrolled), and
`PORTAL_LOCAL_CREDENTIAL` optionally relocates the credential file, which otherwise lives at
`~/.cordillera/portal-local-credential.json` (mode 0600, never in the repository and never inside the
pool or the archive). `PORTAL_SECRET` is required in BOTH modes and signs both token families — the
confirmation tokens unprefixed, the session cookie prefixed with a domain separator so neither can be
replayed as the other. First start in local mode mints a passphrase and prints it once.

**Which identity source the staff MCP face runs — T4, same rule, same reason.**
`TRADEMARK_MCP_AUTH_MODE` selects the door: unset or `cf-access` is a JWT-fronting proxy at the edge
(reference: Cloudflare Access) and is
byte-for-byte the behaviour that shipped before the name existed, dev bypass included; `token` requires
a valid HMAC-signed scoped access key on **every** request and runs no auth proxy at all. An
unrecognised value is fatal. `token` is the far end of the local install's Start button — the portal
holds a verb-scoped, account-capped ops key and this door demands it — and it is **not** a bypass:
`lib/http-handler.mjs` refuses outright to build it alongside `TRADEMARK_MCP_AUTH_DISABLED`, because a
synthetic identity would answer before the mandatory key ever ran. The mode is loopback-only (an ops key
travels in a header or the query string), requires `TRADEMARK_MCP_ALLOWED_HOSTS` exactly as the
authenticated door does, and mirrors its mandatory `CLEAROTRON_ACCESS_FILE`.

**The local install sets all of the above itself.**`npx clearotron start` (`bin/start.mjs`) is a supervisor:
it resolves one set of ports, derives `PORTAL_MCP_URL` and `TRADEMARK_MCP_ALLOWED_HOSTS` from them, mints
the ops key in memory, and hands each child an explicit environment carrying `CLEAROTRON_NO_ENV_FILE=1`. So
exactly one process in that tree reads `<repo>/.env` — the supervisor — and nothing a laptop runs needs
a value written down twice. It configures nothing hosted: the systemd units, the reverse-proxy routes
and the auth proxy's edge configuration are untouched and remain the only way a deployment is
configured.

### 5.10 Dev seams — T4 [dev] (never set in prod)

**Every name here is written in full, and that is load-bearing** — see the note at the end of this
section.

Auth seams, profile and recipe services only: `PROFILE_AUTH_DISABLED`, `PROFILE_DEV`,
`RECIPE_AUTH_DISABLED`, `RECIPE_DEV`. The portal's pair was DELETED by, which replaced the bypass
with the local identity source above. The client-MCP and trademark-MCP services have their own auth
seams; those are **not** covered by this row and remain in the backlog — deliberately not named
here, because this document is the thing the guard reads, and a name written down in order to say it
is undocumented would mark itself documented.

Dev cockpit: `PORTAL_PORT`, `PORTAL_HOST`.

Diagnostics and fixtures: `CLEAROTRON_DUMP_JSON`,
`CLEAROTRON_REPLAY_SNAPSHOT`, `CLEAROTRON_REPLAY_ROOTS`, `CLEAROTRON_JX_FIXTURES`,
`CLEAROTRON_KNOCKOUT_SWEEP_FIXTURES`, `SIGNA_FIXTURES_DIR` (and its accepted alias
`CLAWDI_SIGNA_FIXTURES_DIR` — `providers/signa/src/core.js` reads the plain name first and falls back
to the prefixed one, so an operator who sets only the alias must be able to find it here),
`PORT` (smoke test), and the `MOCK_*` fixture vars. Those are part of
the harness-only set `scripts/env-audit.mjs` counts separately and this register deliberately omits.

Build-time sync tooling: `SIGNA_SYNC_STAMP` — read only by `bin/signa-sync.mjs`, and only to make its
output reproducible. The generated office snapshot carries a `fetched_at` value, and if that came from
a clock read then re-running the sync would produce a different file every time and its diff would
review nothing. Setting this pins the stamp so the same vendor response yields the same bytes. Unset in
every deployment, and it is never read at run time.

CI workspace declaration: `CLEAROTRON_DOCTOR_ASSUME_PINNED` — read only by `bin/onboard.mjs`, and only
to answer whether this checkout being behind its upstream is a question worth asking. `actions/checkout`
parks a branch tracking `origin/main` at the sha under test, so a workspace goes genuinely one commit
behind the moment another merge lands while the job queues, and the doctor's `--check` arms then fail
together — decided by queue position rather than by anything in the change. Setting
this declares the checkout pinned, which is the answer the check already gives a branch with no upstream.
It must be **asked for**: a real deployment behind its upstream still reports behind and still fails, a
blank value is not a declaration, and the doctor names this variable in its output when it obeys it. Set
it in CI and nowhere else — on a deployed box it silences the one check that notices the box is stale.

> **Write every name out. No `*`, no `{A,B}`, no `/_SUFFIX`.** The enforcement test matches a name on
> a word boundary, so shorthand documents a variable to a human and hides it from the guard. This row
> is where that was found: `*_AUTH_DISABLED`, `*_DEV` and `CLEAROTRON_REPLAY_SNAPSHOT`/`_ROOTS` left five
> genuinely-documented variables sitting in the backlog, and the same shorthand in
> `04-configuration-reference.md` hid three more. A`governance-shorthand` test now fails on
> any of the three forms. `.env.example` carries only names this repository's code reads. Credentials
> belonging to a process *outside* the repo do not go in it: the four `AZURE_OPENAI_*` names (an
> integrator's gateway) and `COURTLISTENER_TOKEN` (the case-law MCP holds its own OAuth credential —
> see `providers/oauth-mcp-bridge/README.md`) were listed there for years and read by nothing, which
> made a reader configure a variable and get no behaviour.
>
> `COURTLISTENER_TOKEN` is gone. The four`AZURE_OPENAI_*` names are **still there and stay**:
> they are a reconstructed external contract, the file says so in place and tells a reader to verify
> the spellings against the platform that consumes them. Naming a foreign contract is not the same
> defect as inviting someone to set a variable this product reads — the rule above is about the
> second.

`portal-ui/` has **zero** env config (no `VITE_*`, no `import.meta.env`) — the SPA talks to its
origin; all portal config lives server-side in portal-service.

## 6. Drift patterns — values that are mirrored by design

Wherever one value must exist in more than one place, name every copy and rotate them in one
change. The product's known mirror classes:

| Value class | Copies (by design) | Break mode if they diverge |
|---|---|---|
| CF Access team / AUD / domain gates | edge (dashboard) + each fronted unit's inline env | staff or client lockout, service by service |
| `TRADEMARK_MCP_TOKEN_SECRET` | EnvironmentFile + any integrator-hosted artifacts-MCP env block | run-bound client tokens fail verification |
| Register-provider credentials | EnvironmentFile + integrator plugin config (when both consume the provider) | one consumer silently unauthenticated |
| Profiles/skills store paths | EnvironmentFile + service unit files (+ integrator MCP env) | roster-mismatch class (the PR #14 incident) |
| Pool root | code default + units + web-server file root (+ integrator MCP env) | reports publish where nothing serves |
| Public hostnames | EnvironmentFile (rendered links) + router + edge | dead links / dead routes |

A deployment's concrete copy-map (which files on which box) belongs in its ops repo, next to the
AUD pairing table.
