# Delivery contract — how results leave the system

*What the engine emits when a run finishes, and who does the sending.*

The engine **never sends anything**. In the default comms mode (`handoff`) it publishes the
report to the pool and writes **self-contained event packets** to the outbox; the integrator
consumes them and does the sending. This is the productized seam: wire your channel layer
(email/chat/webhook) against the packets below and you never touch engine internals.

## Comms mode — there isn't one

The heading is kept for the reader who came looking for it. There is no comms mode and no setting:
everything below always applies, no gateway, no messaging binary, the driver fully headless. A second
mode existed until — it routed the same events through one agent platform's gateway as chat
pings, wrote no packets, and needed a binary this product does not ship. If your environment still
sets `CLEAROTRON_DELIVERY` (or `CLEAROTRON_DELIVERY`), the driver prints a warning on every run and
ignores the value.

## The outbox

`config.outboxDir` = `CLEAROTRON_OUTBOX_DIR` (default `<CLEAROTRON_WORK_DIR>/prelim-outbox`).
All packets are written atomically (`.tmp` + rename) — a watcher never sees a half-written
file. Every packet carries a `ts` ISO timestamp. Watch the dir for `*.pending` (systemd
`.path`, inotify, or poll); a periodic scan of run `status.json` files is the recommended
backstop (the markers are edge-triggers, **not** the source of truth — see Write-back below).

## Event packet catalog

| Event | Outbox file | Body | Also written |
|---|---|---|---|
| **delivered** | `<runId>.pending` | ⚠ legacy shape: the agent id + `\n` (plain text, NOT JSON) | the full packet: `_driver/delivery.json` in the run dir |
| **run-failed** | `<runId>.failed.pending` | JSON packet (self-contained) | `_driver/failure.json` in the run dir |
| **intake-rejected** | `intake-<base>.failed.pending` | JSON packet | `<base>.failed` + `.reason` in the queue |
| **duplicate-skipped** | `intake-<base>.duplicate.pending` | JSON packet | `<base>.duplicate` + `.reason` in the queue |
| **pre-run-failed** | `intake-<base>.prerun-failed.pending` | JSON packet | `<base>.failed` + `.reason` in the queue |
| **late-bind-ack** | `<runId>.bindack.pending` | JSON packet | `customer-late-bind-ack` event in `_driver/run.jsonl` |

`runId` is `<slug>-<date>-<codename>` — the SAME id `status.json`, the pool and every status surface
carry. **There is one canonical form, and every minting site writes it.** Packets and outbox markers
were once minted dateless as `<slug>-<codename>` while the outbox rescan re-dropped markers under the
dated form, so a single delivery could carry TWO markers minutes apart. Older dateless packets stay
resolvable (`resolveRun` accepts both), and the `.sent` orphan guard (`outbox-backoff.mjs`) matches
both forms as defence.

### `delivered` — `_driver/delivery.json`

| Key | Type | Notes |
|---|---|---|
| `runId` | string | `<slug>-<date>-<codename>` (canonical; older packets may carry the dateless `<slug>-<codename>` — both resolve) |
| `agent` | string | forwarding-agent/namespace id |
| `forwarder` | string | requester handle (absent if the job omitted it) |
| `forwarderEmail` | string | absent if omitted |
| `msgId` | string | thread with `In-Reply-To:` on the email |
| `subject` | string | on a clearance, `<the product's own name> — <mark>` (`deliverySubject`, e.g. `Global preliminary search — NOVAPULSE`; the mark falls back to `ref`, then `matter`). On a knockout, `Knockout trademark review — <ref> (N marks)` |
| `emailBodyHtml` | string | the FULL email body, one self-contained inline-HTML fragment — send **verbatim**, do not re-encode; report + audit links are already inside |
| `whatsappTo` | string \| null | optional chat recipient |
| `whatsappText` | string | ready-to-send completion line (includes every report URL) |
| `url` | string \| null | the run's published report URL — **null for a multi-name knockout**, which has no single report. See below |
| `reports` | `[{mark, url}]` | one entry per published document, one per name. Written by the KNOCKOUT lane only — **absent** on a clearance packet, whose single document is`url` |
| `verdict` | string | `CLEAR` / `CONDITIONAL` / `BLOCKING` |
| `markName` | string \| null | for a batch, the first name plus a count — the same string the pool and the portal show |

**One report per mark.** A knockout accepts up to eight names and now publishes one document per
name; every clearance product accepts exactly one name, so a clearance packet is unchanged in shape and
in bytes. `emailBodyHtml` already carries every link — it is composed from this same list — so **an
integrator that sends the body verbatim needs no change at all.**

`url` is null rather than the first report on purpose. A batch has no document that is "the report", and
any one URL in that field would be one name standing for all of them — the defect the fan-out removed,
re-entering here. An integrator that reads only `url` therefore fails visibly on a batch instead of
mailing one name in eight as though it were the answer. Read `reports` where you need the links.

Retired fields: `clientReady`/`defects` are no longer written — there is one report and one routing.
An older packet may still carry them; ignore them and route as normal
(`skills/clearotron-ops/COURIER.md` says the same). Machine-QC results are telemetry, not delivery
routing — see
"Machine QC is a record, not a gate" below. Surviving machine-check failures are not a routing signal
either: they are enumerated, in the same plain wording, on the audit workbook (the Summary's
machine-check rows on a clearance, the **Machine Checks** sheet on a knockout) and in
`_driver/predelivery-lint.json`. The cover note carries no machine-check block at all — a failing
internal check is not a coverage gap, and the reader of `emailBodyHtml` cannot act on it.

Note: by the time `.delivered` exists the run dir has already **moved to the archive**
(`<archiveRoot>/<YYYY-MM>/<slug>/<date>-<codename>/`); `delivery.json` and `status.json`
travel with it. `status.json` carries `{ state: "delivered", sendPending: true }` until your
layer sends.

### `run-failed` — `_driver/failure.json` + `<runId>.failed.pending`

`{ ts, kind: "run-failed", runId, agent, forwarder, forwarderEmail, msgId, markName,
failedStage, reason, terminalKind, refused, whatsappTo, text }` — `text` is the ready-to-send human
line ("… failed at <stage> — <reason>. Nothing has been delivered."). Written from the pipeline's
failure path; a rate-limit **postpone is not a failure** (the run parks resumable and no
failure event fires).

`refused: true` means this run was **declined by the product**, not broken by the engine —
`terminalKind: "designed-refusal"`, raised when a preflight finds that this deployment cannot serve
the search that was ordered. The packet still routes as a no-delivery notice (`kind` and `failed` are
unchanged, so no relay needs teaching); only its copy differs, saying REFUSED rather than FAILED. The
field is written `true` or `false` on every packet — an absent key means a packet older than the
field, never "this was not a refusal".

### `intake-rejected` — `intake-<base>.failed.pending`

`{ ts, kind: "intake-rejected", classify: "clarify"|"reject", base, agent, jobId, msgId,
forwarder, forwarderEmail, markName, errors[], text }` — `classify: "clarify"` means the fix
is a question back to the requester (see [INTAKE.md](INTAKE.md)); `"reject"` means the job was
malformed. `text` is ready to send ("… Nothing has been searched or delivered. Job parked as
<base>.failed …").

### `duplicate-skipped` — `intake-<base>.duplicate.pending`

`{ ts, kind: "duplicate-skipped", base, agent, jobId, msgId, forwarder, forwarderEmail,
markName, text }` — the matter-dedup gate parked the request instead of running a second paid
search. The queue-side `.duplicate.reason` explains the match and the `dupOverride` force-run.

### `late-bind-ack` — `<runId>.bindack.pending`

`{ ts, kind: "late-bind-ack", runId, agent, forwarder, forwarderEmail, msgId, customer,
action, whatsappTo, text }` — confirmation that a mid-run applicant binding (`feed_context` /
`customer-bind.json`) was received and what was done with it (`action`:
`warm-redigest` variants or `front-matter-note`).

## The PURE-MCP integrator loop (no filesystem access needed)

An agent-platform integrator (e.g. one whose file sandbox cannot reach the product's data plane)
drives the whole delivery side over the ops MCP face — mint its token verb-scoped:
`--verbs start_run,feed_context,mark_sent,ack_event`.

1. **`list_outbox_events`** — every pending event, parsed (legacy delivered markers normalized to
   `{kind:"delivered", runId}`; the other kinds return their full self-contained packet).
2. For `delivered`: **`get_delivery_packet(runId)`** → send `emailBodyHtml` verbatim (+ optional
   chat line) → **`mark_sent(runId, messageId | attestation)`** (writes `.sent`, flips
   `sendPending`, clears the marker — idempotent). **A settle is a receipt, not an intention:** with
   neither `messageId` nor an `attestation` it REFUSES, and if the send was blocked or
   failed you do not call it at all — the marker stays and the send stays owed.
3. For every other kind: route the packet's ready-made `text` → **`ack_event(file)`** (idempotent;
   validated as a bare `*.pending` name).

The filesystem loop below remains equivalent for integrators that do have data-plane access.

## The integrator's loop

1. **Discover**: wake on `*.pending` in the outbox (instant), and/or scan run `status.json`
   for `state: "delivered", sendPending: true` (backstop).
2. **Send**: for `delivered`, email `emailBodyHtml` verbatim to the requester behind
   `forwarder`/`forwarderEmail`, `Subject:` = `subject`, `In-Reply-To:` = `msgId`; optionally
   chat `whatsappText` to `whatsappTo`. For every other kind, `text` is ready to route as-is.
3. **Write back**: create a `.sent` marker in the (archived) run dir after a successful send —
   the idempotency guard that prevents double-sends if markers fire twice. Then clear the
   consumed `.pending` files. The MCP verb writes it as JSON
   (`{ts, messageId, via, attestation?, settled: "delivery"|"failure"}`), and `settled` is worth
   copying: a `.sent` beside a failure packet means the requester was told the run failed, not that
   they got their report. Integrators without filesystem access (e.g. an agent whose write
   sandbox cannot reach the run dirs) use the ops-MCP **`mark_sent`** verb instead — it writes
   `.sent`, flips `status.json sendPending`, and clears every outbox marker form that delivery could
   have been minted under, in one idempotent call (`{ runId, messageId?, attestation? }` — one of
   the two evidence fields is REQUIRED, and the attestation is recorded verbatim; a retry returns
   `ok + alreadySent`, never an error).

The markers are edge-triggers; `status.json.sendPending` + `.sent` are the source of truth.
A lost marker never loses a delivery (the backstop scan finds it); a duplicate marker never
double-sends (`.sent` guards it).

## Legacy notes

- The `delivered` outbox marker's plain-text body (agent id) predates the JSON packets and is
  kept for compatibility with the existing watcher (`driver/deliver-trigger.sh` + the
  `driver/systemd/` reference units, which wake an agent). Those are **one deployment's reference
  integration**, not part of the headless product contract; the full packet is always in
  `_driver/delivery.json`.

## One report per run

A run publishes ONE report document per mark, on every lane. There is no internal variant and no client
variant, and nothing writes `report.client.html` — internal working material (staff notes, the
model's register estimate) is not stripped from the report, it is not in the report: it lives in the
audit workbook. Two renderings of one run is how the wrong link gets sent.

Beside it the run publishes `report-data.json` (`schema: "report-data/1"`): the run as data — level
identity, bands, per-mark points, evidence links, register counts. That is the input a bespoke,
forwardable client email is drafted from. The engine composes exactly one email shape, a cover note
pointing at the report; per-customer formatting is not a config knob.

The second document was a real hazard while it existed: any surface that opened a report **by file
path** bypassed the serve-time preparation, so a client-facing path pointed at the wrong file served
the internal report. Two properties close that, and both are load-bearing for anyone building a
client-facing surface on this engine:

- **Publish writes one file.** No lane produces `report.client.html`, and the per-customer index
  (`customer/<key>/index.html`) links `report.html` (`publish/index.mjs`) with no split language.
- **One preparation chokepoint.** What a non-staff reader receives is prepared by the portal's
  `readReport()` (`driver/portal-report.mjs`, `staff:false`), which removes the reader-visible
  deltas — `[internal]` review tails, the internal band/reviewer shorthand, the staff Ask-your-AI
  connector — in one place, rather than at render time into a second document.

**A client-facing surface must read through `readReport()`, never open a report by path.** That is
the whole guarantee: the preparation is on the read, so a surface that skips it serves unprepared
bytes. Pool directories from before the change may still hold a `report.client.html`; nothing reads
those files, and `publish/pool-admin.mjs` deliberately leaves them alone rather than retrofitting
them.

## Machine QC is a record, not a gate

A finished report ALWAYS reaches the reviewing lawyer, the run always ends `delivered`, and a run you
have access to is always listed and always served. The machine checks
(`evaluateClientGate`: stale corrections, a failed escalation, registry arithmetic, record-match
fidelity, correction consistency, a blocked-tool explanation for missing coverage, unreadable
findings, a quarantined finding, and an absent required publish input) run at publish, and their
result decides nothing about who may read.
There is no preflight that fails a run before anything touches the pool, and no readiness state.

- **Telemetry.** On failure the pipeline logs a **`machine-qc-failed`** event to
  `_driver/run.jsonl`: the plain-language `reasons[]` always, plus stable `reasonCodes[]`
  whenever the evaluation produced them — so a classifier reading the spine never hashes prose.
  Nothing emits a `client-gate-closed` event; a watcher looking for one sees nothing on a run whose
  QC failed.
- **The record.** `meta.json` keeps the historical stamp name — `clientGate: { released, reasons }`
  — so old and new metas read uniformly, and the `.published` sentinel carries the same object as
  the publish-time observability copy. The staff archive index derives its `⚠ QC` pill from it (a
  staff surface only, pointing the reviewer at the workbook), and the audit workbook's Summary
  carries a plain `⚠ Machine QC` row. The `⛔ Not released to the client` row is retired with the
  release decision it announced.
- **Nothing is suppressed.** No held-run state; no `clientReady`/`defects` on `status.json`, the
  outbox packet or the sentinel; one completion message for every delivered run. The portal run
  list, the report route and the workbook route answer for anyone with access to the run.
- **The report says nothing about itself.** ZERO banners or QC flags at any level. A defect that
  changes the LEGAL ANSWER is the verdict clamp's job and rides the report as a fact about the mark
  (a CONDITIONAL/BLOCKING verdict) — never as a warning about the document.
- **The defects are enumerated, in the reader's language.** A record nobody reads
  is not a record: the surviving failures are enumerated on the audit workbook the reviewing lawyer
  keeps — the Summary's machine-check rows, beside the report link, as a warning that never delays or
  withholds the artifact. That enumeration is the code-owned projection (`predelivery-lint.mjs`
  `deliveryFlagLines`): one plain sentence per failing check, with a count. The checks' own `detail`
  never leaves the internal lane — it quotes fetch causes, register URIs, model field names and
  instructions to whoever re-runs the job. **The cover note carries no machine-check block**, on
  either lane: `emailBodyHtml` is sent verbatim to `forwarderEmail`, which on a client-started run is
  the client's own address, and a failing internal check does not change what was searched, so that
  reader cannot act on it. One enumeration surface, and it is the one the reviewer already opens.

### The knockout lane runs a SUBSET of the predelivery lint

`publishKnockout` runs the applicable subset over the merged findings, writes
`_driver/predelivery-lint.json`, and projects the report-surface failures (`deliveryFlagLines` — one
projection, never a second composed at the mail) onto the one delivery surface that carries them: a
conditional **Machine Checks** sheet on the audit workbook. No flags ⇒ no block and no sheet, a
byte-identical workbook — and the cover note is byte-identical either way, because it renders none of
them. `qcFlags` still reaches `composeKnockoutEmail`; that seam simply does not print it.

**Why a subset.** The clearance lint exists because clearance surfaces are model-authored prose
whose numbers and cross-references can drift from the stores. The knockout deliverable is already
the store-rendered end-state: `publishKnockout` renders from validated `knockout-findings.json`, and
`validateMergedFindings` plus the per-chunk validators are its own lint — schema, ladder vocabulary,
plan-parity, degraded-parity, tone, quantitative claims, URL receipts. Most clearance checks then
read surfaces this lane does not produce: no register record store (it counts hits, it does not
retrieve records), no actions register, no verdict sidecar, no client summary, no card assembly, no
reviewer correction cycle, no intake-ask register.

So the checks that run are exactly those whose whole input is model-authored text —
**permission-prose**, **scope-numbers-in-prose**, **counting-consistency**,
**wipo-designation-language**, **prescription-prose**. Every other clearance check is listed in the
receipt under `notApplicable` with the reason its input does not exist here
(`KNOCKOUT_ABSENT_BY_DESIGN` in `driver/predelivery-lint.mjs`). That is a third state (/),
and it is the point: a check that cannot apply is recorded as absent, never as a silent pass, and
never as a `pass:false` that would project to the lawyer as a defect.

**Why the lane cannot simply skip the lint.** The lint receipt IS the workbook's QC record
(/), so a lane that writes no`_driver/predelivery-lint.json` produces an *empty* QC record
rather than a deliberately-absent one — and an empty record reads as "not evaluated", never
"passed". And since recorded defects reach the reviewing lawyer only through the projected
machine-check sheet on the audit workbook, a lane with nothing to project is a lane whose
defects reach nobody.

Two properties are load-bearing:

- **Flags, not fails.** Nothing added can refuse, delay or re-order a knockout delivery. The hard
  gate on this lane is unchanged and still lives in `verify-knockout.mjs` (the chunk validator's
  permission-prose re-ask + the merged-file backstop), which refuses the run long before publish is
  called. The publish-path lint decides nothing, and a lint that throws costs a receipt, not a
  delivery. The knockout lane never reaches `evaluateClientGate`, so its receipt is read by no gate.
- **Only report-surface failures are projected.** Every projected sentence says "the report …", and
  the lane's internal working prose (staff notes, the model's register estimate) is workbook
  material, not the reader's document. It is scanned, and its failures stay in the receipt.

One thing the subset closes rather than re-records: the hard gate's merged span is the executive
summary plus each mark's `contextFraming`/`basis`/`factors`/`counterFactors`/`mitigation`/`bullets`/
`purpleNotes`/`registerEstimate` (`mergedProse` in `verify-knockout.mjs`) — it does not
cover `findings[].name`/`.description`, which the report renders onto the page. A fabricated
tool-blocked excuse there used to ship; it is now flagged to the lawyer holding the report.
