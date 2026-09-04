# prelim-register — MODE B (DIGEST)

> Read `SKILL.md` first (the shared spine). This file is the DIGEST-mode procedure + the register-findings output format. **Do NOT read `unit.md`.**

## Output — the findings you hand back through `record_register_digest`

**YOU WRITE NO FILE.** The driver renders `register-findings.md` from what you send. It composes the
title, the summary counts, every identifier cell, the clickable record URL, the register tag, the
Negative-results provenance fields, the audit trail and the record ids you read — all from the band and
from its own receipts. Nothing you write by hand is read, and you hold no `Write` or `Edit` tool for it.

### What the call takes

| Field | One entry per | You send | The driver renders |
|---|---|---|---|
| `findings_rows` | Sheet-1 position | `uri`, `flag_reason`, `verify` (`yes`/`no`) | URI, Mark, Owner, Country, Classes, Status, Filed, Expiry + the clickable URL |
| `incumbent_rows` | Sheet-2 position | the same three | the same cells |
| `negative_rows` | dropped candidate | `uri`, `drop_reason`, optional `variant` | the Mark cell and the Notes provenance (URI, `screen_verdict`, class, status) |
| `instructed_checks` | requester ask | `ask`, `answer` | the record ids you read while answering |
| `disagreement_resolutions` | disagreement / borderline | `subject`, `ADOPTED`\|`OVERRODE`, `reason` | the section and its rows |
| `opposition` / `merch_sweep` / `cross_checks` / `open_flags` | — | your prose | the headings around it |

**`uri` IS THE JOIN, and the join is the check.** You cite any one constituent record uri; the driver
looks it up in this run's band and renders every cell from the record it finds. A uri the band does not
carry is REFUSED on the call, naming it — so a mistyped or remembered uri is caught in the turn you make
it, instead of shipping as a row of cells that look typed-in and are wrong.

**Send `patch: true`** when a correction ADDS or CHANGES named rows: rows merge by `uri`, and everything
you do not name is kept. Send a whole call (no `patch`) when the correction is about which rows belong
at all — a patch never DELETES a row, because dropping a finding is a decision and it arrives where a
reader can see it.

### The contract each row carries

#### Summary counts

Driver-computed from its own receipts. **There is no field for them and you do not state them.** The
COVERAGE judgment is not among them: it is yours, and it rides `record_coverage` (below), which is also
where the rolled-up `sufficient` line comes from.

#### `findings_rows` — Sheet 1 (risk-relevant) and `incumbent_rows` — Sheet 2

One entry per POSITION. You send three things and only three:

- **`uri`** — any one constituent record uri of the position.
- **`flag_reason`** — why this position is risk-relevant (or, on Sheet 2, why it is incumbent context
  rather than a conflict). This is the judgment the row exists to carry.
- **`verify`** — EXACTLY one bare token of: `yes` / `no`. Does the row still need verification against
  the live register?

**ONE ROW PER POSITION (identity collapse — the 25-rows/9-rights lesson).** The shape's
**Positions** section (`## Positions`, full detail in `_driver/register-positions.json`) is the
code-derived exact-identity collapse: same right across territories (mark+owner identity, UK009
Brexit-clone arithmetic, Madrid IR↔base linkage) = ONE position with territories listed. Sheet-1
rows follow POSITIONS, never registrations: one row per position, the Country/Classes cells the
union, the Flag reason naming the senior leg.

**The URI cell must cite AT LEAST ONE constituent record URI — any one of them.** Listing all of a
position's constituents (`/mark/gb/… ; /mark/em/…`) is the better row and stays the recommendation,
but ONE is what the driver's reconciliation requires: an ending on any constituent ends the whole
position, so a row citing only the senior leg is complete and can never block the run. (This used to
say "EVERY constituent URI", which made a prose sentence delivery-blocking — a compliant one-URI row
left its sibling records unended and the pre-verdict floor killed the delivery. The gate and this
instruction now count the same thing: positions.)

Records the projection did NOT fold stay separate rows. Where registration arithmetic links two
records whose OWNERS differ, the shape lists them under **Cross-references** rather than folding them
— an assignment recorded at one office and not the other is two rights until you say otherwise.
Folding them, like any residual fold that is JUDGMENT (related owners, brand families,
same-owner-different-mark), remains yours, made openly with its reasoning — the projection never
makes them for you.

**Source attribution and the clickable record URL are the DRIVER's — there is no field for either.**
Exactly one register runs per run, so the tag is a constant the driver holds; the record base host is a
code fact. The driver composes `[<uri>](<host><uri>)` for every row from the uri you cite.

#### `opposition`, `merch_sweep`, `cross_checks`, `open_flags` — your prose, sent as strings

The opposition-history read (per URI, full opposition data, captured verbatim where high-signal), the
cross-class merchandising sweep, the Option-D cross-checks and the open verification flags are prose
fields on the call. The driver renders the heading around each and places it; omit a field and its
section does not appear.

#### `negative_rows` — every candidate screened OUT

One entry per dropped candidate. You send the **`uri`**, your one-line **`drop_reason`**, and optionally
the **`variant`** the candidate came back on.

**The provenance is the DRIVER's.** The Notes cell's URI, `screen_verdict`, class and status are all
fields of the batch-screen record already in the band; the driver composes that cell from the record your
`uri` names, in the column shape `publish/audit-from-spine.mjs` parses, so the drop reaches the published
`# Negative Results` by construction.

**What stays yours is the DROP DECISION and its why.** When a
unit screened candidates out via a provider batch-screen tool (Corsearch: `register_batch_screen`; a
`drop:dead` / `drop:out-of-class` `screen_verdict`, or an owner-mismatch), union its negative-results
contribution into `negative_rows` — one entry per dropped candidate. A batch-dropped candidate with no
entry vanishes from the published audit — a **silent recall loss** — and a drop with no stated reason is
refused on the call. **Never** batch-drop a `surface:in-scope-live` / `surface:all-class`
row on goods/services (brand-json lacks G&S) — those fall through to `record_fetch` and are decided on real
goods; **never** drop a Slice-A exact-in-class-live candidate or class-drop an `all_class` row. **Never** batch-drop a `surface:in-scope-live` / `surface:all-class`
row on goods/services (brand-json lacks G&S) — those fall through to `record_fetch` and are decided on real
goods; **never** drop a Slice-A exact-in-class-live candidate or class-drop an `all_class` row.

**Fetch the SENIOR leg.** When a kept conflict's owner holds SEVERAL
registrations of the same mark (a multi-country family), deep-fetch the **senior live leg** — the
earliest `applicationDate` among live batch-screen rows, a registered right before a pending
application — verify goods/status from THAT record, and cite it as the finding's source (use
`translate=true` where the senior register is non-Latin; same call, one param). Do **not** fetch
additional legs: one leg per family is fetched either way — this only redirects WHICH one. The
VENZY defect: the report read "verified" from the junior AE 2015 leg while the senior TR 2009
registration — the right an opponent would assert first — was never pulled. The driver's
senior-right closure re-fetches the senior leg when the digest cites a junior one, so citing the
junior leg wastes a paid call.

**Relevance-gate drops (provenance — floor-critical).** A candidate that PASSED the status filter but the
relevance gate (Step 2) dropped as genuinely field-irrelevant is recorded the SAME way — one row per drop in
THIS table, in the column shape the deterministic audit builder parses — so it reaches the published
`# Negative Results` (the internal/senior-facing workbook's defensibility record of what was considered and
ruled out). Do **not** put these under a separate "audit-only" heading: a heading `buildAuditMd` does not parse
never leaves the spine, so the drop vanishes from the delivered audit. An **in-scope-live** off-field drop
(verdict `surface:in-scope-live` / `surface:all-class`) must rest on a `record_fetch` of the real goods, never
a batch-row guess — the driver's acceptance gate **rejects the digest** if such a URI was never fetched. Carry
the **`screen_verdict`, `class`, and `status`** into Notes so the gate can identify the row.

**ONE ROW PER RECORD — the row is the unit of DISMISSAL, so it is one record (floor-critical).** A drop row
names **exactly one** record URI, and its reason is a decision about *that* record's fetched goods. Never
group several records under one row and one shared rationale, however alike they look: a rationale that is
true of a group is not a decision about any of its members, and the gate then polices a batch on one member.
(Live failure: a 14-record row dismissed as "Cl.35/41 retail/advertising/education services, no Cl.9/42
software, no AI-customer overlap" — false for two of its members, which recited AI-integration advisory
services in an instructed class.) The acceptance gate now reads **every** URI in a row and holds each to the
fetch requirement separately, and a goods/field drop row with **no** URI is itself a violation — an unnamed
drop can be neither examined nor audited. Batching stays correct for *retrieval* (`register_batch_screen`,
enumeration, `_query` attribution); it is only forbidden as a unit of dismissal.

One entry, one record, one reason. A `drop_reason` is the judgment alone — the uri, verdict, class and
status are rendered beside it: `dropped — off-field (relevance gate): DAWN-only hit; the
descriptive-compound risk theory retains DAWN-only hits only in gaming, and this is film production`.

### Dominant-element reconciliation (driver-gated — every screened composite ENDS somewhere)

The driver joins, after EVERY digest pass (including flush rewrites), the set of **live, in-scope,
screen-surfaced records whose mark carries the dominant element** — as a standalone token, an edit-1
token, or concatenated inside a longer word (`TIKITONK`-class) — against your endings. **The unit is
the POSITION, the same collapse Sheet-1 rows follow**: the driver groups those records by
`_driver/register-positions.json` and an ending on ANY ONE constituent URI ends the whole position.
A position with NO ending is a hard discrepancy: one warm follow-up, then the run **blocks
delivery**. An ENDING is exactly one of:

1. **a finding row** — a constituent URI in a findings-table row (Risk-relevant / Incumbent-context /
   watchlist / out-of-scope), or
2. **an individually reasoned negative** — a `### Negative results` drop row citing a constituent URI
   (one position per row, decided on that right's facts), or
3. **membership of the explicitly ruled, COUNTED dominant-element crowd** — ONE coverage row, added
   through the `record_coverage` tool as a row of your own. It is the only seat row you are ever
   compelled to add, and it carries the same FIVE fields every seat row carries (the full rules are
   under "Coverage ledger" below and in the dispatch's coverage block): `"kind": "seat"`, an `axis`
   from the closed four-token set, a `unit` label, a `status` and a `reason`. Put the ruling — why
   crowd membership is the reasoned ending for this residual class — in the `reason`.

   **The `unit` label carries the crowd token AND the count, in this exact grammar:**

   `<axis> / dominant-element crowd (<N> members): <one-line label for the residual class>`

   **`<N>` goes in the `unit` value and NOWHERE else.** The driver's reconciliation reads the count out
   of that value only — a count you write into the `reason` instead reads as ZERO, the crowd then covers
   no position, and delivery blocks over a ruling you did make. Write it as a bare integer. The count
   must be at least the number of POSITIONS you did not individually end, the same denominator the
   driver counts, and the follow-up always states the current number. (The shape's Positions section
   and `band_lookup` give you the numbers; the driver verifies the count and re-verifies after every
   rewrite — a rewrite that silently drops a previously-named mark without a drop row is exactly what
   this gate exists to refuse. A re-sent row with the same unit REPLACES the recorded one, so
   refreshing the count is one call.)

   You do NOT type this as a markdown table row. The driver renders the table from what the tool
   records, replacing whatever is in that section — so a row typed into the table is erased before
   anything reads it.

The **code-ranked top slice** (closest positions: registered rights first, then the freshest in-class
pendings) must ALWAYS end individually (1 or 2) — the crowd never ends a top-slice position. The
crowd is a legitimate reasoned ending for the residual: rule it once, count it, and spend your
individual reasoning where it matters. This is not a write-everything rule — it is a no-silent-death
rule.

### Coverage ledger — you rule the driver's form rows through `record_coverage` (orchestrator: the driver renders the `## Coverage ledger` section and `register-coverage-ledger.json` from what the tool records; synthesis lifts the rolled-up sufficiency into `coverage_judgment`)

You are JUDGMENT (Layer B), not the funnel. The funnel handed up the band in **two states only**: `enumerated`
(paged to `has_more:false` — complete) or `incomplete` (a crowd descriptor it could not exhaust). The funnel wrote
**no** clearance verdict — **you** read the complete band and author this per-slice coverage reconciliation. The
decider of "does an `incomplete` gap matter" is your judgment on the risk picture, **never** a count threshold.
There is **no re-search re-loop and no halt**: a material slice you could not fully clear ships as a **CONDITIONAL**
with an honest, specific flag — a lawyer always gets a report unless something technically breaks.

For each crowd descriptor in the band (the shape's `crowds` list; each rides along on matching lookups too) — and each expectation-mismatch from the band reconciliation — consuming
`placement-inquiry`'s `### Coverage rulings & open questions` rulings, rule ONE status per slice:

| Ruling | When | Status you write | Effect |
|---|---|---|---|
| **cleared** (enumerated + judged clear, OR immaterial noise) | The slice `enumerated` and you cleared it; OR the `incomplete` crowd is genuinely off-field noise (single-character substring pile, an unrelated class) that would not change the risk read. This IS judgment-sufficiency — you decide it is enough. | `confirmed-clean` | None — the run can deliver clean (subject to the findings). |
| **material gap** (a dangerous slice NOT fully cleared) | The exact mark / a near-identical named variant in an in-scope class was NOT enumerated to `has_more:false`, or a material jurisdiction's named band is unfinished — and it bears on whether you can sign. | `coverage-limited` (reason NAMES the slice + count) | `sufficient:false` → the run ships **CONDITIONAL**, surfacing this slice as an explicit open gap in # Actions. No re-search, no halt. |
| **could-not-reach** (the funnel could not run the slice at all) | A provider error / tool absence meant the slice never reached its data. | `deferred` | Same as material gap → `sufficient:false` → CONDITIONAL; the gap is named. |

**You do not write the Coverage ledger table, and you do not open or edit any coverage file.** The
driver computes a coverage form on every digest pass it dispatches, and renders both the `## Coverage
ledger` table and its JSON mirror from what you record afterwards. A run that can carry no rows still
gets a form — one declaring that, and naming its cause from a closed vocabulary — so "there is no form"
is not a state you will meet.

The dispatch ENUMERATES the form's rows — one per axis, one per unaccounted crowd block and one per
deferred slice, each with its `row_id` — and every identifier is computed by the driver from the frozen
register plan and the plan-execution receipt: the coverage unit, the query id, the hit count, the
unaccounted classes and terms, and each deferred slice's own receipt reason. Rule **every** row by
calling the **`record_coverage` tool**, one entry per row, with two values of yours:

- `status` — EXACTLY one bare token: `confirmed-clean` / `coverage-limited` / `deferred`. Qualifiers
  never go in the status; they go in the reason.
- `reason` — the sentence the lawyer reads.

The driver validates each row as it arrives — a refused row names what to change, and the rest of the
call is kept — and holds the record itself; statuses accumulate across attempts, so a row settled once
stays settled. Everything else on a row is the driver's, regenerated from the plan on every pass:
there is nothing for you to copy and nothing you can alter. The driver renders the `## Coverage ledger`
table and its JSON mirror from the record after your pass, so your findings file carries no ledger
table you wrote.

**You may ADD rows of your own**, for coverage units the plan does not contain — sent through the same
`record_coverage` tool. Those are judgment, and the ledger a lawyer reads has always carried them. A row
you add carries FIVE fields (no `row_id` — the driver mints it; to withdraw one, send a `retract` entry
naming its row_id) — the dispatch's coverage block repeats this list and the allowed axis tokens:

- `"kind": "seat"`.
- `axis` — EXACTLY one bare token of: `saturation-probe` / `primary-sweep` / `transliteration-numeric` /
  `incumbent-class`. **That vocabulary is CLOSED** and a row whose axis is outside it is refused. File the
  row under the axis whose coverage it qualifies: a per-jurisdiction reconciliation or a cross-class /
  cross-check / merch sweep is `primary-sweep`; an owner, incumbent, watchlist-owner or stealth-filer
  sweep is `incumbent-class`; a counted dominant-element or meaning-token crowd is `saturation-probe`; a
  transliteration or numeric-form slice is `transliteration-numeric`. Never a jurisdiction, a class, a
  sweep name or a descriptive phrase — and never blank.
- `unit` — `<the same axis> / <what you swept>`, the shape the driver's own rows use. The axis is
  recovered from this label if the `axis` cell is ever lost in a re-emit.
- `status` and `reason` — as above.

Worked examples, one per shape you are likely to add:

| What you are adding | The axis it goes under | Its unit label |
|---|---|---|
| the per-jurisdiction reconciliation | `primary-sweep` | `primary-sweep / CH reconciliation` |
| the cross-class merch check | `primary-sweep` | `primary-sweep / cross-class merch` |
| the counted dominant-element crowd | `saturation-probe` | `saturation-probe / dominant-element crowd (<N> members): <one-line label for the residual class>` |

The last row is the compulsory one and its label is not free text: the driver's dominant-element
reconciliation reads the crowd token and the member count out of that `unit` cell, so `(<N> members)`
with a bare integer is load-bearing. Drop it and the ruling covers nothing and the run blocks delivery.
The other three labels are yours to phrase; only the leading axis is dictated.

**A row marked `open` cannot be `confirmed-clean`, and its own `open_because` says why.** There are two
kinds and they take different statuses:

- **A never-searched slice.** The active register provider cannot express it at all — it was never
  searched and nothing can make it run, which the plan recorded before this stage began. Status
  `deferred`, quoting its receipt reason.
- **An unaccounted crowd block.** The band left this slice neither verified-zero nor individually
  enumerated nor itself a ruled crowd. That search RAN and saturated, so the honest status is
  `coverage-limited`. Do **not** call it `deferred`: that means a slice which could not run at all, and
  it clamps the run's verdict to CONDITIONAL.

Either way the gap is an OPEN, disclosed question for the lawyer, never a clean negative.

**Each open row is discharged only by ITSELF.** A `coverage-limited` row about one slice does not
account for a different slice's block, however plainly its reason discusses the axis — so set the status
on the row that owns the block. This is the same rule the gate has always applied: a disclosure counted
only where it named that block. What changed is that you no longer have to name it, because the driver
wrote the block its own row. Rows about slices that genuinely enumerated to `has_more:false` STAY
`confirmed-clean` — do not downgrade them, that trades one false claim for another.

Never retype a query id, a hit count or any other identifier into a reason cell to prove you read
something. Nothing joins on your typing; the driver supplies every identifier. Your reason is your
reasoning.

**Rolled-up coverage judgment (synthesis lifts this into `findings.json` `coverage_judgment`):** state
`sufficient: <true\|false>` and a one-line `reason`. `sufficient:false` iff any **material** slice above is
`coverage-limited`/`deferred` (name it in the reason). `sufficient:true` → the run delivers (clear, subject to
findings); `sufficient:false` → the verdict clamps CLEAR→CONDITIONAL and the gap is surfaced in # Actions. **There
are no `commands[]` and no `halt`** — a material gap is delivered as a conditional with an honest flag, never a
re-enumeration loop and never a no-deliver halt.

**Saturated dominant/meaning-token (the COLORA→色彩 case).** The funnel enumerates the class-scoped contains band
for a saturated dominant element or `translit-*-meaning` token (the token kept as the search predicate;
goods-vocabulary words are **never** ANDed into the search text — goods-relevance is judged at SELECTION). If that
named slice came back `enumerated`, read it and clear or surface its hits. If it came back `incomplete` AND it is
material (the exact / near-identical in-class slice is the highest-relevance category), write it `coverage-limited`
with a reason that NAMES the slice and the count → the run ships **CONDITIONAL**. An everyday-word-scale count on
its own (a count-only saturation probe) is off-field noise — `confirmed-clean`, immaterial — never a clean of the
dangerous category and never a reason to drop the token, re-narrow it, or swap it for the phonetic form.

**recently-dead is a status you weigh, not a date-cutoff the funnel applied.** Lapsed / lapse-date /
revival-window records arrive in the band with their status. Whether a recently-lapsed near-identical matters
(revival risk, field history, non-use vulnerability) is your call — surface it as a finding/context, never drop
it on age. Volume of the dead-inclusive band is handled by the two-state contract: enumerate it if bounded,
else it is an `incomplete` crowd you rule on here.

**Open judgment vs incomplete search — hold the line.** A **genuine open judgment** (the search IS complete and
the legal/commercial answer honestly admits more than one defensible call — "coexistence with the partner is the
client's commercial call"; "get a second opinion on the EU class-25 angle"; an unsettled dispute-type) is the
lawyer's product: it is **surfaced as reasoning and it SHIPS** (carry placement-inquiry's `### Open questions`
into the synthesis narrative). It is **not** a coverage gap — it does NOT set `sufficient:false`. The test: *is the
uncertainty about whether I LOOKED, or about what the COMPLETE picture MEANS?* Whether-I-looked → a coverage gap
(`coverage-limited` → CONDITIONAL); what-it-means → open judgment, ships. Do not throw the second out with the first.

**Axis labelling is the driver's on every row the driver wrote — and yours on every row you add.** Each
driver row already carries its axis and its coverage unit, composed by the driver from the plan entry the
row is about: you never retype one of those, so a transposed or markdown-wrapped axis is no longer a
reachable failure on them. A row YOU add is the one place an axis cell is still yours, and it is a closed
four-token vocabulary — the list is above, it is in the dispatch's coverage block, and the tool refuses
an axis outside it at call time with the rejected value named.

**A form with NO rows — the driver's own declaration, not your assignment.** Reachable and rare: the plan
apparatus was out of reach (no plan-execution receipt, or no frozen plan), so there is nothing to compute
coverage rows from. The driver writes the form either way — a table you typed would sit in the position of
the record every coverage gate reads, the one arrangement the form exists to end. Where there are no
rows it carries `rows: []` and an `absence` field naming the cause, the dispatch carries no coverage
block, and the driver renders that declaration into the findings itself.

So the instruction is the same on every run: **never write a `## Coverage ledger` table, never save a
coverage JSON, and never open or edit any coverage file.** Where the dispatch lists rows, rule them
through `record_coverage`. Where it lists none, the declared cause is carried for you — a run whose
coverage ledger is unavailable supports no clean, limited or deferred claim anywhere in the findings,
and the declaration says so to the reader in as many words.

Everything else — the three statuses, the closed axis vocabulary, the counted dominant-element crowd and the
rolled-up `coverage_judgment` — is unchanged, because there is no second arm for it to differ on.

#### The audit trail and the status-filter summary are the DRIVER's

Per-unit search and detail-fetch counts, the `_query` attribution stamped at merge, the live/dead/ambiguous
distribution, and the record ids you read — all from the run's own receipts. **There is no field for any
of them.** The JUDGMENT half stays yours: a unit that shortcut its axis is flagged in your prose.

#### `instructed_checks` — one entry per requester ask this stage owns

Send `{ask, answer}`. Answer from the FROZEN material via the band tools; a check the frozen material
genuinely cannot answer is answered honestly AND recorded as an open coverage row naming the missing
query. The driver renders the record ids you read beneath each answer.

#### `disagreement_resolutions` — one entry per disagreement, and per borderline

One entry per disagreement `placement-inquiry` surfaced in its "Disagreements / flags surfaced to
downstream" section, AND one per entry it declared `"borderline": true` in `placements.json` — each
EXPLICITLY resolved, the borderline ones by answering the promotion question (does this conflict change
the advice, or only complete the record?) either way in writing. Send nothing when placement-inquiry
surfaced and declared none.

- **`subject`** — which placement, by mark and, where it helps a reader, its uri.
- **`decision`** — EXACTLY one bare token of: `ADOPTED` / `OVERRODE`.
- **`reason`** — an override QUOTES the reason it contradicts; a kept tier still says why.

For example: subject `PHINIA — placed at watchlist-annex, class-match said headline (cl.12 overlap)`,
decision `ADOPTED`, reason `the cl.12 overlap is auto-parts vs the applicant's software; off-field`.

**Coverage ledger → the `coverage_judgment` contract.** You rule every row of the driver's coverage form
through `record_coverage` (a `confirmed-clean` / `coverage-limited` / `deferred` status and a reason on
every row — the driver renders both the `## Coverage ledger` table and `register-coverage-ledger.json`
from what the tool records), plus the rolled-up sufficiency line. The **synthesis stage** lifts the rolled-up line into `findings.json`
as the top-level `coverage_judgment` field: `{ "sufficient": <bool>, "reason": "<why>" }`. The FORM is the
single source of truth; the rendered table and the JSON mirror are both derived from it, so they agree by
construction and neither can be the thing that drifts. Driver
semantics: `sufficient:false` (any material `coverage-limited`/`deferred` slice) ⇒ the verdict clamps
CLEAR→CONDITIONAL and the named gap surfaces in # Actions (the report still ships); `sufficient:true` ⇒ deliver.
There are **no `commands[]` and no `halt`** — a material gap is a delivered conditional, never a re-enumeration
loop and never a no-deliver halt.

# MODE B — DIGEST (combine the complete named band → register findings)

You are JUDGMENT, not the machine. The funnel (the unit-mode workers) decided **nothing** about relevance, sufficiency, or materiality — it either **enumerated** a search to completion or reported it **incomplete** (a crowd descriptor). It handed you the **complete named band**; the relevance gate below is the *only* relevance gate, run over **everything that was found**, not a pre-pruned list.

Your task gives the paths to: the per-axis prose digests (`register-units/<axis>.md` — audit-trail summary only), the variant manifest, `matter-context.md`, and `placement-recommendations.md`. The **band itself is read through the band tools** — you hold `band_shape` / `band_lookup` / `band_record`, and every call you make lands in the run's reading audit (that on-the-record trail is the point: the reading layer is as auditable as the frozen search plan).

**The band is the material you judge — read it through the band tools (never by slicing files with shell):**
- **`band_shape` FIRST** — the deterministic shape of the complete merged band (all axes, de-duped): totals, mechanical similarity tiers, **THE FLOORS** (every live in-class identical/near-identical record, listed individually and unconditionally — every floor row must end up rated, placed, or explicitly reasoned away; the list is complete by construction and no lookup pattern excuses skipping one), the class/status/registry/recency census, owner concentrations, the crowd descriptors, and the blind spots the shape mechanically cannot see. The tiers are string mechanics, never a relevance call — Step 2's relevance gate is still yours, and still the only relevance judge. A floors-heavy shape is served in PARTS (the response labels itself part N/M and names the next call): read EVERY part before reasoning — a partial shape is never the shape, and the parts split at line boundaries so every floor row arrives intact.
- **`band_lookup`** — pull the records your reasoning needs: by owner, class, tier, plan entry (`qid` — the exact join to the frozen plan's execution ledger), slice (`_query`), mark text, status. Records carry `record_id, mark_text, classes, status, owner_name, owner_country, application_date, registration_date, expiry_date, jurisdictions, screen_verdict` (+ `_query`). These are the real records — the firewall is lifted, nothing was pre-gated. Matching un-enumerated crowds ride along on every lookup, so a counted-only zone can never read back as a clean.
- **`band_record`** — the official registry record fetched into this run for a given `record_id`, when detail beyond the band row decides a point. Read-only: an unfetched record is an honest gap to state, never a value to guess.
- **`incomplete` crowd descriptors** (`query, total_hits, fetched, reason` — in the shape, and riding along on lookups) are NOT findings and NOT clean negatives. Each is a slice the funnel could not exhaust; you (with `placement-inquiry`'s rulings) decide whether it matters → **cleared** (immaterial noise, `confirmed-clean`) or **material gap** (`coverage-limited` → CONDITIONAL) (see "Coverage ledger" below). Never render a material crowd descriptor as `confirmed-clean`.
- Where the prose digest and the band material disagree, the **band wins** (it is the complete record; the prose is a summary). If the shape reports an axis absent, or a lookup errors because the band is missing/unreadable, that axis's complete band did not cross the firewall — that is a **coverage failure → set that axis's form row `coverage-limited`/`deferred` (CONDITIONAL), never an empty/clean result**, do not fall back to calling the axis clean off the prose. (The fresh-run fan-in gate also hard-fails a missing band, so a clean can never ship over an unsearched band.)

Every judgment below spans the band and/or needs data a single unit cannot have, so it MUST happen here.

**Consume `placement-recommendations.md` (from Touchpoint 2 `placement-inquiry`).** The per-candidate tiers ALSO arrive structured in `placements.json` beside the md — `{mark, owner, jurisdiction, records[], tier, reason}` per candidate (plus an optional `borderline: true` — see below), `reason` carrying placement's stated reasoning. When present, the JSON is the authoritative tier record: adopt or override each tier BY ENGAGING ITS `reason` (an override quotes the reason it contradicts — never a silent re-tier; a kept tier may tighten a label while reusing the reason). The md remains the home of the rulings tail (Disagreements, Coverage rulings, Open questions), which you carry forward exactly as below. On a corrective/repair pass do NOT re-read the whole md — the tiers are in the JSON, and the driver hands you the md's rulings tail verbatim in the dispatch (a `PLACEMENT RULINGS TAIL` block): adjudicate against it there, adopting or counter-reasoning each ruling. For each enumerated record in the complete band (the shape's census + your lookups):
- Find the matching entry in `placements.json` (mark text + owner + jurisdiction match; fall back to the md's tier sections on runs that predate the JSON)
- Adopt the graduated outcome (`headline-candidate` / `sheet-2` / `watchlist-annex` / `out-of-scope-filtered`) as the placement
- **Between `headline-candidate` and `sheet-2`, what you are adopting is an ANSWER, not a label.** Those two tiers are placement-inquiry's written answer to one question — *does this conflict change the advice, or only complete the record?* (a headline entry names what it changes; a sheet-2 entry states why the advice reads the same either way). Adopting means adopting that answer. **Overriding means answering the SAME question the other way, in writing**, in your `### Disagreement resolutions` row — never re-labelling the tier and never substituting a risk-tier argument for the question. An override that does not say what the conflict does (or does not do) to the advice has not engaged the placement
- **A `"borderline": true` entry in `placements.json` is placement declaring that its own answer could be argued either way on this record.** That is the expected place for your judgment to differ, and it is a correct declaration rather than a defect — but it must be **resolved either way, explicitly**, in a `### Disagreement resolutions` row (`ADOPTED placement-inquiry — <the reading you took, and why>` / `OVERRODE — <the other reading, and why>`), never silently carried and never left as a shrug. **The declaration is internal adjudication only**: it belongs in your audit trail beside the other open verification flags, and no borderline mark, no "arguably", no "either way" derived from it goes into the findings prose the client reads — you resolve it here so the report does not have to hedge it there
- The "Disagreements / flags surfaced to downstream" section names cases where placement-inquiry deviated from class-match — read those reasonings carefully
- **Resolve EVERY disagreement explicitly (#7).** For each item in that section, send ONE `disagreement_resolutions` entry — `{subject, decision: ADOPTED|OVERRODE, reason}`. A disagreement that just vanishes (neither adopted nor overridden) is the miss the driver's grading tripwire flags; a blank / `tbd` / `pending` reason trips it too, and a `decision` outside the two tokens is refused on the call. Send none only when placement-inquiry surfaced no disagreements.
- You MAY override placement-inquiry's placement with your own counter-reasoning, but you MUST state that counter-reasoning as the `reason` on its `disagreement_resolutions` entry (never silently). The narrative-refutation gate downstream will flag any override that isn't defensible against the source files
- Candidates `placement-inquiry` placed at `out-of-scope-filtered` go to the Excel Out-of-Scope tab with their reasoning, NOT to the Findings tab. Candidates at `watchlist-annex` go to the audit-tab plus optionally a brief narrative mention with the monitor-trigger condition
- **Carry placement-inquiry's `### Coverage rulings & open questions` into the coverage form (through `record_coverage`)** (its per-crowd-descriptor cleared/material-gap rulings + band-reconciliation mismatches) — onto the driver row each ruling is about, or as a seat row where it is about a slice the driver did not write. Adopt or counter-reason each, exactly as you do its placements. **Carry its `### Open questions for the client / reviewer` (genuine open judgment) into the synthesis narrative** — those ship; they are NOT coverage gaps.

**Per-jurisdiction sub-query attribution.** Each enumerated record carries `_query` (the slice that surfaced it — the driver stamps it at merge; `band_lookup`'s `query` filter selects on it) and `jurisdictions`, so a record from a materially-matters-jurisdiction sub-query is identifiable by its `_query`. Carry the attribution forward in the findings file's audit trail — `matter-context` says PH matters, the PH sub-query (`_query`) returned this record, so the audit trail records the chain explicitly.

### Step 1 — Identical-match test + cross-class merchandising sweep

Across the complete band, run the **identical-match test** per
[status-rules.md](status-rules.md) (normalised mark text identical to the input) — the shape's
`identical` tier + floors give you the mechanical candidates in one read; verify each with
`band_lookup`/`band_record`. For each identical match, check the class-25 (apparel) merchandising
slice **in the band** (`band_lookup` with `nice_class: "25"` — the funnel's exact-identical cross-class
merch check writes that slice, live AND dead records carried). You hold **no live register tools** here
(by design, never an outage): if the band carries no class-25 exact slice for an identical match, that
is an open coverage-form row — a seat row saying which slice is missing (the escalation lane proposes it
through the supplemental mint), never a search you improvise and never a silent pass. Identical-mark hits in
apparel block merchandising plans even when target classes are clear. If no identical matches, document
"no identical matches."

### Step 2 — Relevance gate

**The gate decides field-relevance, never filer-importance.** Run it over **every enumerated record in the complete band** (work tier by tier / slice by slice through `band_lookup` until the shape's totals are accounted for) — the funnel pre-gated nothing, so this is the only relevance judge. For each enumerated record, ask only: **is the mark on-point — identical / near-identical, sharing the dominant element —
and in or adjacent to the target field?** If yes, it is surfaced and characterised, full stop. **Who**
filed it (a multinational, a one-person studio, a tail-market individual) and **how vulnerable** it
looks (dormant, revocable, within the non-use grace period) are NOT gate criteria — they are Stage-2
mitigants the digest/synthesis weighs later. A small or individual filer of an in-class identical mark
is a *paper conflict to characterise*, not noise to drop. The only thing that takes a candidate below
the line is genuine field-irrelevance (the goods/services are commercially unrelated); filer size,
entity-vs-individual status, and apparent dormancy never do.

With that posture fixed, the question is simply: **could an examiner or court plausibly find confusion here —
is this worth keeping for the Stage-2 confusion test to assess?** **Cast wide; Stage-2 / synthesis
discriminates.** The archetype table below is a **sanity-aid for that question, not a lookup to run first** —
read it after you've asked the field-relevance question, and where it conflicts with your read, follow the
read. Keep if plausibly on-point; drop only genuine field-irrelevance — and **log every drop as a row in the
`### Negative results` table** (mark, surfacing variant, `Result: dropped — off-field (relevance gate)`, and
`Notes: URI <uri>; <one-line why>`) so it reaches the published `# Negative Results` audit, per the
*Relevance-gate drops* format above. Units did NOT pre-gate — this is the only relevance judge.

| Archetype | Keep when | Drop when |
|---|---|---|
| **Coined word** | Mark text contains a phonetic/visual neighbour of the coined element; or is the coined element exact-match | Mark text shares only an unrelated real-word token via tokenisation (e.g., searching coined THORNMANTLE and surfacing a mark whose only overlap is a "LIGHT" token) |
| **Descriptive compound** | Mark contains the distinctive anchor; OR is an identical/near-identical compound-phrase match; OR is a single-element registered mark on a common element with goods/services in the target field | Mark is a 5+ element compound that happens to share one common token (e.g., a film studio's "DAWN OF JUSTICE" filing surfaced when searching "Dawn: Legends of Thornmantle" — DAWN is common, surrounding context unrelated) |
| **Slogan** | Mark matches the slogan structure (same template, same semantic field, family-pattern hit, verb-swap, slang variant, co-brand wildcard); OR is the unique distinctive token of the slogan if any | Single-word hit on a slogan element in an unrelated context (DAWN alone surfaced when searching "DAWN OF NEW DAY" slogan); slogan in a wildly different semantic field with no template overlap |
| **Acronym / initialism** | Mark text contains the letter string in target classes; OR is the expansion form of the acronym | Random word that happens to contain the letters as a substring of a longer word |
| **Device-led** (modifier) | Standard tests for primary archetype, plus visual similarity per design-code search | Pure-text noise with no visual signal |
| **Famous-element-masked** (modifier) | Mark text contains the famous element exact-match (in any class/context); OR is owned by the famous-mark holder | Compound hit that doesn't include the famous element; unrelated owner with a different element overlap |

**Operating rule:** conservative-by-default for slogan and descriptive-compound (drops common-element
single-word noise that doesn't match risk theory); liberal for famous marks (keeps the hit because a famous
mark crosses sectors). **Famous near-marks:** a famous mark that is a visual / phonetic **neighbour** of the
dominant element (one keystroke or a homophone away) and that covers the target goods or an adjacent field is
**KEPT** — *field-divergence is never a reason to drop it.* Goods-proximity sets how deeply Stage-2 assesses
it (close-in-goods → full confusion test; genuinely off-field → kept and **noted with its goods-distance**),
but a famous neighbour is **never** silently dropped or demoted out of the findings on field-divergence
alone. **Grounding:** "kept" means carried forward for assessment, NOT that it must become a register
*finding*. A famous neighbour with a fetched register record travels as a normal candidate (it has a record
URI); one known only from general knowledge — no register record fetched, no common-law record cited — is
carried at synthesis as a typed **context note** (`context_notes[]`, type `famous-neighbour-ungrounded`),
never as a finding with an empty or fabricated registration (the findings contract rejects that, and an
ungrounded finding must never ship). Surfaced either way, never dropped. **When in doubt, KEEP and flag
`Verify? ✅`** — better to surface a borderline candidate than drop a
real risk. Log every gate drop. **Filer size, individual-vs-entity status, and apparent dormancy are never
in-doubt-DROP reasons for an on-point in-class mark** — they travel WITH the kept candidate into Stage-2 as
characterisation, they do not keep it out of the findings.

### Step 3 — Owner aggregation

Aggregate across ALL units (the same owner appears under name variants in different digests):
normalised owner name (strip suffixes — "Ltd", "GmbH", "Co.", commas, periods) × address country
(different countries with same normalised name = separate entities). Assign an owner-cluster ID.

**Owner-identity conflict flag.** When the owner-extraction fallback chain yields *conflicting* names
for the same URI across fields or sources, OR an EUIPO cross-check disagrees with the vendor record on
owner identity, OR a portfolio-size signal (many filings clustering under a normalised owner) would
materially change the enforcement-appetite read, do NOT silently pick one. Surface both readings in the
findings row and set `Verify? ✅` with reason "owner-identity conflict — confirm before enforcement
read." Owner identity drives enforcer-profiling (see `prelim-search/firm-wide-reasoning.md`, *Enforcer profiling*
rule) — a wrong owner is a wrong risk read.

### Step 4 — Proactive competitor + aggressive-enforcer sweep

**Plan-first:** when the frozen plan carries the owner lane (the manifest seeded `watchlist_owners`),
the incumbent-class band ALREADY holds, per seeded owner, the owner×formative enumerate slices
(qids `…+owner-<owner>`) and one bare-owner count descriptor (qid `…+watch`). **The slices are the
owner's coverage — read them record-by-record. The bare-owner count is crowd context** whose
`covered_by`/reason points at the slice qids: cite it as portfolio size, never as coverage, and
**"portfolio too large, noted" is never a finding** — the answer to a watchlist owner is the slice
records (or their honest per-class `class_counts` accounting when a wide-class slice crowds), not a
number and a shrug. Only fall back to the sweep below for a watchlist entity the plan did not seed.

**The screen's own receipt is handed to you as DATA — write the negative FROM IT, never from a lookup
you had to invent.** The dispatch carries a driver-computed line naming, per owner: the slice qid,
whether it enumerated, how many records it attributed, and — when it did not run — the mechanical
reason. Three rules follow, and they are not stylistic:
- A negative about a named owner may rest ONLY on a slice the receipt lists as **enumerated with zero
  records**. Name those owners; the sentence has to say which slices enumerated.
- An owner listed **NOT RUN** (the active provider has no owner surface, or the slice was refused
  deterministically) is a **disclosed gap**, not a clean. Give it a `deferred` status on its coverage-form
  row — its own row, never a sibling's — and never write "no marks found" for that owner.
- An owner listed **count-only** was never enumerated: report the portfolio size as crowd context and
  say the record-by-record answer is outstanding.
Never write that the owner screen "produced no records" while the receipt says records were
attributed — that sentence shipped on a live run whose screen had returned eleven, and it turned a
working instrument into a disclaimer.

For each unseeded entity in the manifest's `competitors` AND `aggressive_enforcers` watchlists (NOT
`major_brand_owners` — too broad), run one owner-bound search (`owner: "<entity>"`, target classes,
limit 50). Apply the Step 2 relevance gate to results; detail-fetch new ones; merge as
`Type: Competitor Intelligence`.

**Applicant own-rights sweep (gated on priority-live — surfacing only, never a conflict).** When a unit has
surfaced a senior on-point conflict (an identical / near-identical in-class incumbent) AND `matter-context` /
the request form indicates the applicant may hold prior rights of its own (prior use, or co-pending / unclear
priority — i.e. priority is *live*), run the **same owner-bound search on the applicant's own name** — the one
name the applicant-exclusion (`matter-context`) normally drops — with `active_only: false` to catch the
applicant's own lapsed filings. Tag every hit `applicant_own_rights: true`. This is a **surfacing exception
for the applicant only**: these rows are **never conflicts, never Findings-sheet rows, and never gate or
down-rank the conflict sweep** — they exist solely to resolve the *filing* branch of the priority question
(does the client have earlier rights of its own?) for the synthesis's "client's own prior rights" note. The
applicant-exclusion for conflict-ranking is otherwise untouched. If priority is not live, do not run it.

### Step 5 — Apply watchlists

Flag owners against `aggressive_enforcers` ("aggressive enforcer; always include"),
`major_brand_owners` ("major brand owner; business-relevant"), `competitors` ("competitor;
business-relevant"). **Watchlist-flagged rows enter findings regardless of relevance-gate result.**

**Watchlist / named-owner status is an ADDITIVE surfacing channel, never a FILTER.** Step 4's
competitor/enforcer sweeps and this step's watchlist flags are *enrichment and priority-decoration* — they
can only ever ADD a finding or attach context, never gate one out or down-rank it. An in-class
identical / near-identical incumbent surfaces on **field-relevance ALONE** — the exact same surfacing it
would get if its owner happened to sit on a watchlist — with any named-owner context attached as
enrichment. A finding is **never** down-ranked or omitted because its owner was not pre-named in
`matter-context`'s watchlist-owner seeds. The named-owner channel exists to *guarantee* the famous/aggressive
owner surfaces; it must not become an asymmetry that demotes the un-named in-class incumbent the gate already
kept.

### Step 6 — Stealth-filer detection + Option-D cross-checks

Run the stealth-filer regex ([stealth-filer-indicators.md](stealth-filer-indicators.md)) over all
owners. Then per the orchestrator's cross-pollination logic:

- **Trigger 1:** every common-law owner found → register check (your unit work already covers in-target-class filings by surfaced owners; run a targeted follow-up for any not yet covered)
- **Trigger 2:** every register stealth-filer pattern (law-firm owner) → common-law check (flag for orchestrator)
- **Trigger 3:** every watchlist-hit owner in register but not in common-law → common-law check (flag)
- **Trigger 4:** every common-law finding without a register tie → register query (run here)

Execute Triggers 1 and 4 to the extent you have inputs; FLAG Triggers 2 and 3 for the orchestrator.

### Step 7 — Compile register findings file + flag thin units

**Call `record_register_digest` before you return — returning without the call is a failure** (the
deterministic driver gates on the document that call renders: if it is missing after your turn it
fails/retries the stage under a fresh session key; a digest that never lands is how an on-point hit gets
lost between judgment and the Excel). **You write no file and you name none.**

The per-unit counts are rendered from the run's own receipts, so the audit trail is not yours to compile.
What IS yours is the judgment beside it: **explicitly flag any unit
that reported it shortcut its axis**, in your `open_flags` prose — the orchestrator's skeptic review
decides whether to re-run that unit (the driver resumes that unit's own session warm, at its own tier —
not a fresh Opus spawn). You do NOT re-run anything.

**Rule the coverage form and reconcile the complete band against `matter-context`.** Rule every
crowd descriptor (cleared / material-gap) by recording that row's status and reason through
`record_coverage` — and write the rolled-up sufficiency line. Then **reconcile the band against `matter-context`'s materially-matters jurisdiction list**:
every material jurisdiction must be accounted for. A material jurisdiction whose exact-in-class-live slice was
**enumerated** and judged clear is `confirmed-clean`. A material jurisdiction the band shows as an **`incomplete`
crowd** — OR one with **no `enumerated` block and no crowd descriptor at all** (the funnel never reached it) — is
an **unsearched dangerous slice**: rule it material and write it `coverage-limited` (or `deferred` if it could not
reach its data at all), with a reason that NAMES the slice — `sufficient:false` → the run ships **CONDITIONAL**
and the gap surfaces in # Actions. **Never** write a missing material jurisdiction as a self-accepted clean — but
it is a delivered conditional, not a re-search loop and not a halt. Each slice is prefixed by the axis that ran
(or owes) its sweep — `primary-sweep / CH (material)`, never a bare `CH (material)`. Do not re-judge a unit's
enumeration; rule on its materiality. The synthesis step (which emits `coverage_judgment`) and the
narrative-refutation skeptic both consume this section.

## Provider facts the driver stamps — and the two you must still not compose

Conversion 11 moved the composing here into the driver: `record_register_digest` takes no record field,
so the register name, the environment word and the record link are stamped from the run's own config
onto every row. That changes WHO writes them. It does not retire the rules, and both of these were
learned by a run losing hours to them.

**The corpus is the driver's receipt, never a tag you type.** Exactly one register is searched per run;
which one, and for EUIPO which environment, is recorded on every receipt in `_driver/receipts.json`.
Never tag it in the findings — a seat retyping it onto records is how the two disagreed.

**Record-URL (see [status-rules.md → Record-URL contract](status-rules.md#record-url-contract)).** The
`URI` column is the record's canonical identity and it is a RELATIVE `/mark/<cc>/<number>` path, not a
clickable address. The driver composes the full URL from the record base host in `providers/<name>.md`
and emits the identity alone when that provider publishes no per-record page — **and "nothing" has a
spelling: `source.resolved_link` is `""`**, the empty string. NOT the `uri`, not a fragment, not another
vendor's host. "Leave the `uri` as it is" means do not MODIFY the record's own `uri` field; it has never
meant carry that path into a link field. Wherever you still state a link in your own prose or in a field
you set, the same rule binds you: a relative path presented as an address is a dead link in a lawyer's
table, and it cost a synthesis attempt to learn once already.

## Provider adapter pattern

This skill's universal logic — per-axis funnel, status filter, relevance gate, owner aggregation, cross-class merch, watchlists, cross-checks — applies to any provider. Provider-specific concerns live in `providers/<name>.md`.

## Checklist before handing off — digest mode

**Digest mode:**
- [ ] **Complete band read through the band tools** (`band_shape` first, then `band_lookup`/`band_record` until the shape's totals are accounted for — every floor row rated, placed, or reasoned away); any missing/unreadable band ruled a coverage failure (`coverage-limited`/`deferred` → CONDITIONAL), never called clean off the prose digest; identical-match test run over the band; class-25 merch slice checked in the band (or its absence written as an open Coverage row)
- [ ] **Band reconciled against the expectation for THIS mark** — saturated field with no enumerated exact-owner slice ruled a material gap (`coverage-limited` → CONDITIONAL), anything famous-missing surfaced, partner-as-headline flagged for de-prioritisation
- [ ] `matter-context.md` read and informing placement (jurisdiction attribution, off-field framing, watchlist seeds)
- [ ] `placement-recommendations.md` read and informing tiering; each candidate's graduated outcome adopted or counter-reasoned with audit-trail justification; its coverage-commands/open-questions carried forward
- [ ] Per-jurisdiction sub-query attribution (`_query`) carried forward in the findings file's audit trail
- [ ] Relevance gate applied per archetype over the **complete enumerated set** (field-relevance only — filer size/dormancy held for Stage-2, never a drop reason); drops logged
- [ ] Owner aggregation across the band; owner-identity conflicts flagged `Verify? ✅` (never silently picked)
- [ ] **Every coverage-form row ruled through `record_coverage`** — the tool's answer reports nothing outstanding; every `incomplete` crowd descriptor ruled cleared/material-gap; reconciled against `matter-context`'s material-jurisdiction list (every material jurisdiction enumerated-and-cleared, or written `coverage-limited`/`deferred` → CONDITIONAL — never a self-accepted clean over an unsearched slice); rolled-up `{sufficient, reason}` stated for synthesis to emit; genuine open judgment surfaced to ship (not a coverage gap)
- [ ] Competitor + enforcer owner-bound sweep run
- [ ] Applicant own-rights sweep run **if priority is live** (tagged `applicant_own_rights`; never a conflict / Findings row / gate)
- [ ] Watchlist matches flagged (override the gate)
- [ ] Stealth-filer detection + Option-D triggers (exec 1 & 4, flag 2 & 3)
- [ ] Out-of-scope-filtered candidates routed to Excel Out-of-Scope tab with reasoning (NOT to Findings)
- [ ] Watchlist-annex candidates routed to audit-tab + optional brief narrative mention with monitor trigger
- [ ] **Dominant-element reconciliation satisfied** — every screened-live dominant-element POSITION ends as a finding row, a drop row citing any one constituent URI, or membership of the ONE counted `dominant-element crowd` row ADDED THROUGH `record_coverage`, whose `unit` value carries `(<N> members)` with `<N>` >= the residual POSITION count (the count is read from `unit`, never from `reason`); the code-ranked closest positions ended individually
- [ ] **Sheet-1 rows are POSITIONS** (one row per position, citing at least one constituent URI; owner-divergent pairs left as separate rows per the shape's Cross-references) — never one row per registration of the same right
- [ ] Register findings file written; per-unit counts + per-jurisdiction-subquery counts + thin-unit flags in the audit trail
- [ ] Open verification flags listed; API budget summed and under the workflow cap (150)
