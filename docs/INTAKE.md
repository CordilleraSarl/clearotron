# Intake contract — how a clearance run enters the system

*How work reaches the engine: the job file, the queue, and the two supported doors.*

The engine is headless: work arrives as a **job file** in a queue directory, and the runner
(`driver/runner.mjs`, fired by a filesystem watcher and/or a periodic timer) claims and runs it.
There are exactly **two supported intake doors**, both writing the identical job shape and both
validated by the same `driver/enqueue-schema.mjs` (one validator, two doors):

1. **The enqueue CLI** — `node driver/enqueue.mjs` (see `--help`). Validate-first, atomic write,
   machine exit codes (`0` queued / `2` refused / `3` id collision / `1` other).
2. **The ops-MCP `start_run` tool** (`mcp-server/lib/ops.mjs`) — same job assembly + validation,
   for agent/programmatic operators over MCP.

Anything else that writes a syntactically valid job file into a queue dir will also run — the two
doors are conveniences with validation at the edge, not gatekeepers — but they are the supported
contract surface.

## Queue directories

Resolution (the runner drains **all** of these; `config.queueDirs`):

| Source | Path | Use |
|---|---|---|
| `CLEAROTRON_QUEUE_DIR` env | one explicit dir | **headless deployments** (the product default; no agent workspaces needed). Jobs here run as `config.defaultAgent`. |
| workspace scan | `<CLEAROTRON_WORK_DIR>/workspace-<agent>/studio/prelim-search/queue` | legacy/agent-adjacent deployments; the agent identity is derived from the queue location |

The enqueue CLI resolves its target the same way: `--queue-dir` flag → `CLEAROTRON_QUEUE_DIR` →
the default agent's workspace queue.

## The job JSON

`driver/enqueue-schema.mjs` (`validateJob`) returns `{ ok, errors, warnings, classify }` with
`classify ∈ run | clarify | reject`:

- **`reject`** — can't run or can't even reply. Missing any of:
  - `id` — the queue filename + per-message dedup key (re-delivery overwrites the same file)
  - `msgId` — reply threading (`In-Reply-To` on delivery)
  - `forwarder` — the requester/reply-routing key; rides every delivery/event packet
- **`clarify`** — runnable identity but an unresolvable **search subject**. The only content
  reasons a search may not start:
  - no mark name (`markName` / `name` / `marks[].name`)
  - neither `classes` (or `marks[].classes`) **nor** a goods description (`goods`/`use`) —
    either one suffices, and the request is not the only place classes may come from. When it
    names none, the door resolves the same ladder the run does (request → saved search →
    project overlay → customer profile, `effective-scope.mjs`) and admits the job if any layer
    supplies them, recording which one in a warning. A request under a project that carries the
    classes is therefore admitted, not clarified. The clarify stands only when no layer has any,
    and it then names what was consulted
  - a `profileKey` that names no known customer (a typo must clarify, never silently
    mis-route to the generic profile on a paid run)
  - an unknown `product`/`recipeKey`, both selectors set at once, a `deliveryRoute`
    outside `email | portal`, `caseLaw` or `nativeLanguage: false` (neither is a request setting —
    each is refused, never dropped), or a batch past the product's name limit — the same discipline
    throughout: a typo must never silently run a different-priced product
  - malformed per-run **scope**: a `jurisdictions` entry that is not a 2–40 character territory
    (or more than 20 of them), a `platforms` entry that is not a bare store domain (or more than
    10), or a Nice class outside 1–45 — in `classes` or in any `marks[].classes`. Same discipline
    again: each of these can be wrong in a way that searches the wrong place and says nothing.
- **`run`** — everything else. Notable **warnings** (proceed-with-default, never block):
  - no `ref`/`tmp` → runs under a `noref<hash>` slug
  - `customerUnknown: true` with no instructions → generic profile + late-bind watch armed;
    identical hits reported as ordinary findings with an "if this is the applicant's own
    filing, disregard" note
  - non-boolean `customerUnknown`/`dupOverride` → treated as unset
  - a malformed `parentRunId` → treated as unset (escalation lineage is garnish, never a block)
  - an unreadable `deadline` → treated as unset, so no envelope is applied (a date typo must not
    stop a runnable search; a bare `YYYY-MM-DD` is read as the END of that day, UTC)
  - `jurisdictions` naming the same territory twice → deduped, first spelling wins

Other consumed fields (see `EXAMPLE_JOB` in `enqueue-schema.mjs` for the full annotated shape):
`forwarderEmail`, `forwarderDomain`, `provider`, `marks[] = [{ref,name,classes}]`, `customer`
(applicant → self-exclusion set), `profileKey` (customer account → profile/framework/template),
`upfrontInstructions`, `brief`, `rawRequest`, `deliverableSpec`, `commercialFlexibility`,
`priorUse`, `deadline` (ISO-8601, drives the deadline envelope), `enqueuedAt`, and
`conversationId` — best-effort email-thread id consumed by the **matter dedup** below.
Per-run **scope** — WHERE the search points, as against the depth selectors below which choose WHICH
machinery runs:

- `jurisdictions` — the instructed territories, e.g. `["US","EU","JP"]`. Present ⇒ **authoritative**:
  the matter frame is told not to widen past them, the register plan derives its regions from them and
  the native-language lanes deepen only inside them. Omit ⇒ the project/customer `defaultJurisdictions`. Names and
  codes both read; deduped case-insensitively; max 20.
- `platforms` — extra marketplaces to sweep, as bare store domains. **Additive only**: unioned onto
  the account's own before the profile freeze, so the common-law grid floor and batch size re-derive
  from the surface actually swept. A request can widen a client's mandated marketplaces and has no way
  to narrow them. Max 10; `web` is implicit and must not be listed.

`platforms` belongs to the **clearance** pipeline alone. A knockout has no marketplace grid to add to
— its sweep is one broad question per mark, not a per-store grid — so `platforms` named against one
**clarifies** (`checkScopeAgainstPolicy` in `driver/search-policy.mjs`), checked against the explicit
selector here and against the RESOLVED product at the runner's admission gate, exactly like the batch
budget. Never recorded-and-ignored.

`jurisdictions` is not restricted that way. A Knockout search accepts worldwide **or** any set of
territories, so `checkProductScope` passes it unconditionally, and the sweep states whichever it got:
the instructed territories when the request names any, and "Global — all jurisdictions" only when it
names none (`driver/stages-knockout.mjs`).

Selection fields (`driver/products.mjs` declares the four): `product` (one of the four in the offering), `recipeKey` (a
saved customer search — mutually exclusive with `product`), `nativeLanguage` (the one toggle, and only
on a Multi-country focus search — `true` adds it, and `false` is refused because it never switched
anything off), `geography` (`{mode: worldwide|named|account-default}` — stated,
because "everywhere" and "I said nothing" resolve differently), `deliveryRoute` (`email` default |
`portal`), `parentRunId` (escalation lineage). `caseLaw` is NOT a field: it is what a Full country
search IS, and sending it is refused rather than dropped. The runner's admission gate resolves
job → project → customer → **the resolved scope** and PARKS AS CLARIFY any selection this
build/deployment cannot run — never a silent substitution, never a drop.

### Prose sidecars (optional)

Writers that cannot safely escape JSON (e.g. sandboxed agents) may write prose fields as raw
plain-text sidecars next to the manifest — `<id>.brief.md`, `<id>.markName.md`,
`<id>.rawRequest.txt`, `<id>.goods.txt`, `<id>.upfrontInstructions.txt`,
`<id>.deliverableSpec.txt`, `<id>.commercialFlexibility.txt`, `<id>.priorUse.txt` — which the
runner overlays onto the scalar manifest at claim (`assembleJob`; a non-empty sidecar wins).
A self-contained job (all fields inline) assembles identically. **The CLI and `start_run`
serialize proper JSON, so they never need sidecars.**

## Atomicity + queue lifecycle

- **Publish**: write `<id>.json.tmp`, rename to `<id>.json` — the runner (and any `.path`
  watcher) never sees a half-written job.
- **Claim**: rename `<id>.json` → `<id>.processing` (atomic; only one runner wins) + a
  `.processing.pid` liveness sidecar so crash recovery never re-claims an in-flight job.
- **Terminal markers** (in the origin queue): `<id>.done` + `<id>.done.result` (JSON) |
  `<id>.failed` + `<id>.failed.reason` | `<id>.duplicate` + `<id>.duplicate.reason` |
  `<id>.postponed` + `<id>.postponed.meta` (rate-limit park; auto-resumes when the window
  elapses). Prose sidecars are swept at terminal state.

Every intake failure also emits a requester-facing **event packet** (`intake-rejected`,
`duplicate-skipped`) on the outbox seam — see [DELIVERY.md](DELIVERY.md). The `.reason` file
records the notify outcome (`notify: packet <path>` in handoff mode).

## Matter-level dedup

The queue's `id` dedups per **message**; a follow-up in the same thread ("please proceed")
re-enters as a new id. The runner additionally dedups per **matter** within a
fixed 24-hour window, via an append-only ledger one level
above each queue:

- **signature** dimension: normalized `forwarder|mark|classes|customer|ref`
- **thread** dimension: same `conversationId` **and** same mark (distinct marks forwarded in
  one email are separate matters and all run)

A duplicate parks as `.duplicate` (recoverable), never runs. `"dupOverride": true` is the
explicit requester-confirmed force-run (it still records the matter, so later true duplicates
are caught). A **failed** run drops its ledger entry so a genuine re-send is never blocked.

## Relevant environment

`CLEAROTRON_QUEUE_DIR`, `CLEAROTRON_WORK_DIR`, `CLEAROTRON_QUEUE_SCAN_MS`,
and `CLEAROTRON_MAX_CONCURRENT_RUNS` govern the intake behaviour described above. Their
defaults and full meanings are in
[architecture/04 — Configuration Reference](architecture/04-configuration-reference.md#environment-variable-reference)
and [architecture/05 — Config Governance](architecture/05-config-governance.md).

Their defaults are deliberately not restated here. A second table is not a second source — it is the
same fact with an extra place to go stale, and this page carried a wrong `CLEAROTRON_WORK_DIR`
default for exactly that reason.
