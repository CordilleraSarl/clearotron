---
name: prelim-register
description: Register-side execution for the v3 preliminary trademark search workflow. **Invoked exclusively by the `prelim-search` orchestrator** — do not call directly. Runs in one of two modes the orchestrator selects via the spawn task. **Unit mode (the FUNNEL — Layer A):** execute ONE register search axis (saturation / primary-sweep / transliteration-numeric / incumbent-class) against the variant manifest — ENUMERATE each named query to completion via `register_enumerate` (the completeness primitive that owns the page loop), describe saturation crowds as count-only incomplete descriptors, and write the COMPLETE NAMED BAND (`register-units/<axis>-band.json`) carrying every record with its status; the funnel decides NOTHING about relevance / sufficiency / prioritisation and never samples or self-accepts; only the raw character-noise pile dies in this session. **Digest mode (judgment — Layer B):** read the complete merged band through the band tools (`band_shape` / `band_lookup` / `band_record` — every call on the run's reading audit; never by slicing band files), run the cross-cutting judgment (relevance, identical-match + cross-class merchandising, owner aggregation, watchlists, stealth-filer + Option-D cross-checks, opposition), decide sufficiency, and hand the register-side findings back as typed rows — the driver renders the document the orchestrator synthesises from; the seat writes no file.
---

## Spawned session

Invoked from `prelim-search` (the orchestrator) as an **isolated depth-2 worker**, in one of two
modes. **This skill never spawns sub-agents** — the orchestrator owns all dispatch. (This is
deliberate: the announce/completion chain supports one nesting level — `main → orchestrator →
workers` — so every register worker is a flat depth-2 sibling of the common-law worker, not a nested
sub-tree.)

Two modes, chosen by the orchestrator and stated in the spawn `task`:

- **Unit mode (the FUNNEL — Layer A)** — the task names ONE axis (`saturation-probe` | `primary-sweep` |
  `transliteration-numeric` | `incumbent-class`), the variant manifest path, archetype + risk theory,
  active provider, target classes / jurisdiction / industry. The worker runs that axis only — it
  ENUMERATES each named query to completion via `register_enumerate` (or reports honest `incomplete`),
  describes saturation crowds as count-only descriptors, and writes the named-band array
  `register-units/<axis>-band.json`. **It decides NOTHING about relevance / sufficiency / prioritisation —
  no sampling, no top-N, no "searched enough".** Only the raw character-noise pile stays in this session;
  the **complete named band + crowd descriptors** cross the firewall as the band JSON.
- **Digest mode (judgment — Layer B)** — the task gives the paths to the per-axis prose digests (audit
  summaries) and the manifest; the driver has already MERGED the per-axis bands into the run's complete
  band. The worker reads that COMPLETE band **through the band tools** (`band_shape` first, then
  `band_lookup` / `band_record` — every call lands in the reading audit; never by opening or slicing band
  files), performs all cross-cutting judgment (relevance, owner aggregation, opposition, Option-D),
  DECIDES SUFFICIENCY, and writes `studio/prelim-search/<slug>/<date>/register-findings.md`.

Reads (both modes): the variant manifest at `studio/prelim-search/<slug>/<date>/variant-manifest.md` (archetype + risk
theory), the `matter-context.md` at `studio/prelim-search/<slug>/<date>/matter-context.md` (Phase 0 strategic anchor — names materially-matters jurisdictions, watchlist-owner seeds, off-field sectors), the request context, the active **provider**. The **watchlist-owner seeds are enrichment / additive-surfacing context, not a search or priority filter** — an in-class identical/near-identical incumbent surfaces on field-relevance alone whether or not its owner is named (see `digest.md` Step 5).

**Digest mode also reads**: `placement-recommendations.md` at `studio/prelim-search/<slug>/<date>/placement-recommendations.md` (Touchpoint 2 per-candidate placements — informs digest tiering), and its structured mirror `placements.json` beside it (one `{mark, owner, jurisdiction, records, tier, reason}` entry per candidate; when present, the authoritative per-candidate tier record — the md carries the rulings tail as prose).

Writes:
- Unit mode — TWO artifacts, both gate-checked, neither optional. `studio/prelim-search/<slug>/<date>/register-units/<axis>.md` is the stage's DECLARED OUTPUT: the driver fails the pass outright when it is absent, and the digest worker reads it as an input. `studio/prelim-search/<slug>/<date>/register-units/<axis>-band.json` is the COMPLETE named band — a JSON array of `enumerated` / `incomplete` blocks (see `unit.md` → *Named-band artifact*) — carrying every record and no clearance verdict. The md narrates and proves nothing on its own: an md narrating a completed sweep while the band its plan entries call for is missing is refused as `named_band_missing`. In plan mode `register_execute_plan` writes the band itself and you never hand-write its blocks.
- Digest mode: `studio/prelim-search/<slug>/<date>/register-findings.md`. Coverage statuses are NOT a file you write: they ride the `record_coverage` tool into a driver-held record, and the driver renders the `## Coverage ledger` table and its JSON mirror from it (see *Coverage ledger* below and `digest.md` → *Coverage ledger*). Optional: `register-details/` snapshots inside the run-dir.

Returns to the orchestrator: your **final session message** — a 2–3 line summary (counts + the
absolute path of the file you wrote). Keep raw character-noise records out of the message and out of any
upward summary; keep clearance verdicts out of the unit message (verdicts are Layer B's).

Companion files:
- [register-recipes.md](register-recipes.md) — archetype playbooks (one per archetype + modifier patterns)
- [status-rules.md](status-rules.md) — live-status keep-list, Madrid handling, Chinese-status normalisation
- [stealth-filer-indicators.md](stealth-filer-indicators.md) — law-firm / stealth-filer owner detection
- [providers/corsearch.md](providers/corsearch.md) — Corsearch-specific operator vocabulary
- [providers/clarivate.md](providers/clarivate.md) — Clarivate-specific operator vocabulary + its capability gaps

## Trigger

Called by `prelim-search` after `prelim-variants` has produced the manifest. The orchestrator spawns
the unit-mode workers and the common-law worker together, then spawns the digest-mode worker once the
unit digests exist. Not invoked directly by operators.

## Model

Set by the orchestrator per mode (set `model` explicitly on the spawn — omitting it mis-tiers):

- **Unit mode** — `saturation-probe` → **`haiku`**, thinking off (count-only, pure data-pull). The
  three sweep axes (`primary-sweep`, `transliteration-numeric`, `incumbent-class`) → **`sonnet`**,
  adaptive thinking (run the manifest's given searches, detail-fetch, apply the rule-based status
  filter — nuanced rule-following, not open analysis).
- **Digest mode** — **`opus`**, thinking medium. All the precision-critical judgment lives here
  (relevance gate, owner clustering, opposition interpretation, Option-D).

The old "register sweep must be Opus or it truncates" lesson came from a *monolithic* single session
doing searching **and** judgment at once. The work is now split: units execute (cheap tiers), the
digest worker judges (Opus). If a unit shortcut its axis, the orchestrator's skeptic review catches
it and re-spawns it escalated to Opus — that decision belongs to the orchestrator, not here.

## Provider

Set by orchestrator via `provider` — **exactly one register per run**: Corsearch, Clarivate, Signa, or
EUIPO. Operator vocabulary and field names live in `providers/<name>.md`; the universal logic in THIS
SKILL.md applies whichever sits behind the neutral `register_*` tools. There is no second register and
no cross-check alongside it: where the active provider's coverage does not reach a territory, that is a
**deferred coverage row** you disclose, never a gap you fill from elsewhere.

**EUIPO covers the EU alone** and is free. Running it makes every non-EU territory a deferred row —
the honest trade, not a fault. Sandbox and production hold different corpora and must never be
mistaken — so the DRIVER records which answered, on every receipt in `_driver/receipts.json`.
Never tag it in the findings.

## Tool call budget — and why it is NOT a sufficiency lever

The funnel runs each named query through **`register_enumerate`**, which owns the page loop and pages to
`has_more:false`. **A budget ceiling is therefore NOT a "searched enough" knob and NEVER a reason to sample,
top-N, or self-accept a slice.** Cost is bounded structurally: the named slices (the exact mark, the
class+region-scoped substring band, the phonetic fringe, the per-jurisdiction named queries) are **small and
cheap by construction**, so they enumerate fully and cheaply. A saturation crowd is **described** with one
count-only call (`limit:1`), not enumerated. The expensive failure mode of the old funnel — deep-paging a
saturated raw pile — does **not** exist: crowds are descriptors, named slices are bounded.

| Worker | register_enumerate calls (named slices) | count-only crowd descriptors | Phoneme | Image |
|---|---|---|---|---|
| `saturation-probe` unit | 0 | ~3–4 (count-only) | 0 | 0 |
| `primary-sweep` unit | ~8–14 (exact + substring band + per-major + meaning, where applicable) | ~1–2 | up to 5 (phonetic recipes) | up to 10 (device-led) |
| `transliteration-numeric` unit | ~4–6 (one per script/variant query) | ~1 | 0 | 0 |
| `incumbent-class` unit | ~2–4 | 0 | 0 | 0 |
| digest worker (merch-sweep + Option-D follow-ups) | ~2–4 | 0 | 0 | 0 |

**A genuine resource/time limit produces an `incomplete` block, never a sufficiency accept.** If
`register_enumerate` hits the provider 5000-record window or a resource ceiling on a slice, it returns
`{state:"incomplete", …, reason}` — the funnel writes that block verbatim and **stops there for that slice**.
That `incomplete` is the signal to **judgment (Layer B)**, which decides whether the crowd is material and
either **commands a narrower named enumeration** (which the funnel then runs) or **halts to a human**. The
funnel never converts a resource limit into a clean negative and never re-adds a record/count ceiling that
says "searched N, ship clean". (Phoneme at 5 and image at 10 are observed budgets — exceeding them usually
indicates a worker repeating itself, not finding new content.)

**The per-major and per-jurisdiction named queries are breadth, not a budgeted sufficiency allowance.** Each
in-scope major (US/EU/UK/CN/JP) and each material jurisdiction the matter-frame declared is a **named slice
the funnel COVERS** — and when the region-scoped in-scope sweep (Recipe 1 Step 2) returns `enumerated`
(complete), that complete set provably contains every in-scope slice, so the per-major/per-jurisdiction slices
are taken from it **machine-side by `jurisdictions`**, NOT re-run as redundant per-major `register_enumerate`
calls (Recipe 1 §2b/§2c — this drops the per-jurisdiction call-count + timeout fragility). A slice gets its OWN
`register_enumerate` call only on the guarded crowd-narrow path — when the in-scope sweep returned `incomplete`
and a major/material jurisdiction may sit in the un-paged remainder. Either way no slice is sampled; the
manifest/matter-frame chose the breadth (judgment, upstream); the funnel covers every such slice. There is **no "ring-fenced allowance" that breadth
yields to** any more (that was a sufficiency trade — breadth-vs-coverage), because no slice is sampled: every
named query enumerates or returns `incomplete`. If a declared jurisdiction's query genuinely cannot run
(provider error), it surfaces as an `incomplete` block (a could-not-reach gap for judgment), never a silent
drop and never a sufficiency-accepted omission.

**The dangerous-category named enumeration is the same contract, not a separate budget floor.** The
`primary-sweep` unit's dangerous-category enumeration (`unit.md` → *the dangerous-category named enumeration*)
runs **every** named slice through `register_enumerate` — the exact name-list, the substring band, the
per-major region-scoped band, the phonetic fringe — **for the DISTINCTIVE anchor. A common saturated component
that is not the anchor (a stripped common word — GREAT / OUTDOORS) is count-only via `saturation-probe`, not
enumerated here** (`unit.md` → *the dangerous-category named enumeration*; an all-common-words phrase mark is
searched as the exact phrase + near-neighbours). It does **not** "detail-fetch every candidate up to a
budget then mark coverage-limited on overrun" (that was the old sufficiency floor) — `register_enumerate`
either enumerates the slice or returns `incomplete`, and the funnel writes the block. A sampled dangerous
category is **structurally impossible** now: there is no sampling verb in the funnel.

## Failure fallback

`register_enumerate` handles retry / backoff / window-cap internally and returns `incomplete` (count + sample
+ reason) rather than throwing or silently truncating — so most "failure" handling is just **writing the
`incomplete` block verbatim** and letting judgment act on it.

- **Provider session-key invalid** → halt; surface to orchestrator with one-line diagnostic (no band can be written).
- **A named slice cannot be enumerated** (provider 5000-record window, resource ceiling, persistent provider error) → `register_enumerate` returns `{state:"incomplete", …, reason}`; **write that block verbatim.** Do NOT narrow-and-call-clean and do NOT fabricate an empty. The `incomplete` block (a could-not-reach / crowd signal) crosses to judgment, which commands a narrower named enumeration or halts.
- **Rate-limit signal (429 or sustained 5xx)** → handled inside the primitive (back off); a persistent failure surfaces as an `incomplete` block with the error in `reason`.
- **A unit's axis is not applicable** to this manifest (e.g. transliteration-numeric with an English-only mark) → write a single "not applicable" `incomplete` block (`reason:"not applicable — <why>"`, `total_hits:0`) so the band file lands, and return cleanly. Do NOT fabricate work.
## Coverage = the band blocks (the funnel emits NO clearance verdict)

A negative is only as good as the search behind it — and under the two-layer split the **funnel proves the
search by the band blocks themselves**, not by authoring a `confirmed-clean` / `coverage-limited` verdict. The
old funnel ledger collapsed two different things into one row and let the machine call a search "clean" — that
**was** the sufficiency-in-the-machine bug. It is removed from the funnel. The funnel emits exactly two block
states, and **the state IS the coverage signal**:

- **`enumerated`** = `register_enumerate` paged that named slice to `has_more:false`. Every record crossed
  the firewall. This is "the search ran to completion" — but **the funnel does not append a clearance verdict
  to it**; whether the *absence of relevant hits* is a real clean negative is **judgment's** call, made over
  the complete enumerated band. (There is no "saturated-field qualifier" to satisfy here any more — a saturated
  field's dangerous slices are themselves `enumerated` blocks, never sampled, so there is no "sampled but
  marked clean" state to guard against.)
- **`incomplete`** = the slice could not be enumerated (crowd over the provider window/resource ceiling) OR
  could not reach its data (provider error, tool absent) OR is a count-only crowd descriptor. **The funnel
  never grades an `incomplete` as an "accepted limit" vs a "closeable gap"** — that grading was a sufficiency
  judgment (is this gap OK to ship over?) and now belongs to **judgment (Layer B)**: the lawyer reads the
  `incomplete` block (its `total_hits` / `sample` / `reason`), decides whether it is material, and either
  **commands a narrower named enumeration** (which the funnel runs) or **halts to a human**. The funnel's job
  is only to surface the `incomplete` honestly — count + sample + reason — never to decide it is tolerable.

**The exact name-list is always an `enumerated` block.** The dominant element's `match_mode:exact` × in-scope
class × per major+material jurisdiction slice is small and cheap by construction, so `register_enumerate`
returns it `enumerated`. A bare-exact incumbent in a filed class is the highest-relevance category — it can
**never** be sampled, rolled into a count, or left as a crowd descriptor; if it ever came back `incomplete`,
that block crosses to judgment which commands its closure. (The funnel does not author a "closeable vs
accepted" judgment on it — it just enumerates it.)

**Count-only crowd descriptors describe, they do not clear.** The `saturation-probe` axis (`limit:1`, no
enumeration) measures how crowded an element is — it is written as an `incomplete` crowd-descriptor block
(`fetched:0`, `reason:"crowd descriptor — …"`) and **clears nothing**. The named slices inside the crowd (the
exact name-list, the class+region-scoped substring band) are the `enumerated` blocks; judgment reads the
descriptor's count alongside them.

The DRIVER merges the per-axis band blocks into the run's complete band (`parseNamedBand` / `mergeNamedBands`
in `named-band.mjs` — code, not a model). Judgment (Layer B) reads that union **through the band tools**
(`band_shape` / `band_lookup` / `band_record`; every call on the reading audit — never by reading or slicing
the band files), reconciles against `matter-context`'s materially-matters list, settles ONE status per
coverage unit, and **decides sufficiency** there.
Synthesis emits the rolled-up signal in `findings.json` (`coverage_judgment` — `{sufficient, reason}`):
`sufficient:false` (a material slice not fully cleared) clamps the verdict CLEAR→CONDITIONAL and the named gap
ships as an open item — the report still delivers. `sufficient:true` → deliver clean. **There is no re-search
re-loop and no halt** (a lawyer always gets a report unless something technically breaks); a missing band is the
one hard stop — the driver fails fan-in on it, so a clean can never ship over an unsearched band. **The funnel
writes no `coverage_judgment` and no clean verdict** — it hands up the complete band + honest `incomplete`s and
lets judgment decide.

### Coverage ledger — which document you owe, and what the three status tokens mean

**The status vocabulary is CLOSED: EXACTLY one bare token of: `confirmed-clean` / `coverage-limited` /
`deferred`.** Qualifiers never go in a status cell; they go in the reason. The distinction between the last
two is doctrine, not wording, and the driver relabels a row that gets it wrong:

- **`coverage-limited`** — the search RAN and could not be exhausted: a crowd over the provider window, a
  count-only saturation descriptor, a volume/pagination ceiling. A re-run cannot close it, so the escalation
  gate skips it and it does not on its own make the run unfinished.
- **`deferred`** — the search could not run or could not reach its data: tool absent, provider error, fetch
  blocked, a predicate or an office the active provider cannot express. It is a CLOSEABLE gap — escalate and
  disclose — and it clamps the verdict CLEAR→CONDITIONAL. Mislabel one of these `coverage-limited` and a
  fixable hole disappears into an accepted limit.
- **`confirmed-clean`** — the slice ran to completion and judgment cleared it.

**HOW those statuses are recorded is not yours to assume — the dispatch states it, and it is one route,
the `record_coverage` tool.** The driver computes the form before every digest dispatch and enumerates
its rows into the dispatch itself, so the prompt and the gate cannot disagree about what the run owes —
there is nothing for them to disagree about:

- **Every run has a coverage form, and you never open or edit it.** The driver has already computed one
  row per coverage unit, every identifier included, and the dispatch lists the rows with their `row_id`s.
  Record `status` and `reason` on every row by calling `record_coverage` — the driver validates each row
  as it arrives, holds the record itself, and a row settled once stays settled — and write **no
  `## Coverage ledger` table at all**: the driver renders that table and its JSON mirror FROM the record
  after your pass, so a table you type into the findings is erased before anything reads it. Rows you ADD
  go through the same tool (`kind: "seat"`); the field list and the closed axis vocabulary are stated in
  the dispatch's coverage block, so read them there rather than from memory.
- **A form carrying NO rows is still a complete answer, and it is the driver's.** Where the plan apparatus
  was out of reach there is nothing to compute rows from, so the form carries `rows: []` and an `absence`
  field naming the cause, and the dispatch carries no coverage block. You are not asked to record anything
  and you still write no `## Coverage ledger` table: the driver renders the declaration, so the report
  states what is true about the run rather than a reconstruction of it. A run with no coverage ledger
  supports no coverage claim anywhere in the findings.

`digest.md` → *Coverage ledger* carries the full per-slice ruling procedure. Nothing else in this spine
restates the row shape: one copy, told at dispatch beside the rows themselves.

## Mode router

This skill runs in one of two modes, **selected by the caller**, which states which file to read:
- **Unit mode (the FUNNEL — Layer A)** → read this spine + [`unit.md`](unit.md). Run ONE axis: ENUMERATE each named query via `register_enumerate`, describe crowds as count-only descriptors, write `register-units/<axis>-band.json` (the complete named band). Decide NOTHING about relevance / sufficiency / prioritisation. Do NOT perform digest judgment.
- **Digest mode (judgment — Layer B)** → read this spine + [`digest.md`](digest.md). Read the complete merged band through the band tools (`band_shape` first, then `band_lookup` / `band_record` — never by slicing band files), apply relevance + sufficiency + prioritisation, hand the findings back through the `record_register_digest` tool (the driver renders the document — see [`digest.md`](digest.md), *What the call takes*), and settle the coverage judgment through the `record_coverage` tool (*Coverage ledger* above). Two transports, two statements, and no file to write in either.

Companion references (load as needed): `register-recipes.md`, `status-rules.md`, `stealth-filer-indicators.md`, `providers/<name>.md`.
