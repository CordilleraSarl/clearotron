# Provider adapter — USPTO (local index)

Provider-specific vocabulary for the register-search skill when the active register provider is the
**local US index**: a synced copy of the USPTO bulk register, searched on disk. The universal logic lives
in [../SKILL.md](../SKILL.md); only the specifics live here.
(Selected by the deployment environment: `CLEAROTRON_DATABASE=uspto-local`. One register provider
per workflow — never both.)

## Read this first: it is a FILE, not an API

Every other provider is somebody else's server. This one is a database file on this machine, pointed at
by `USPTO_LOCAL_DB`. Three consequences change how you read its answers:

1. **It can be STALE, and stale is not the same as empty.** A remote register is current by definition; a
   copy is current only until the office publishes the next daily file. An index older than 24 hours
   cannot support a clean negative, so the count **refuses** — `total: null`, with the reason — rather
   than returning a number. Read that as UNKNOWN. It is never "0 while we re-sync".
2. **It holds ONE office.** US only. Any other jurisdiction in the matter is a `deferred` coverage row,
   decided at plan time — see *Coverage* below.
3. **Queries are free, and that changes nothing about completeness.** A cheap query is still a query that
   can be the wrong one. The ceiling, the crowd descriptor and the count-first rescue all apply exactly as
   they do on a metered provider.

## Plugin reference

Six of the eight neutral tools. Auth is the index path, not a key.

| Tool | What it does | Params |
|---|---|---|
| `register_search` | paged search over the index | `name` \| `names[]`, `owner`, `predicate`, `nice_classes[]`, `status[]`, `limit`, `offset` |
| `register_enumerate` | the completeness primitive — count probe, chunking and screening in one call | as above, plus `in_scope_classes[]` |
| `register_record_fetch` | full normalized record for one mark | `record_id` (a `/mark/us/<serial>` ref or a bare serial) |
| `register_batch_screen` | screening rows for many marks at once | `uris[]`, `in_scope_classes[]` |
| `register_execute_plan` | runs the frozen plan's axis and writes the band | `plan_path`, `axis`, `output_path` |
| `register_propose_supplemental` | mints and executes judgment-addition queries | `axis`, `output_path`, `proposals[]` |

**`register_image_fetch` and `register_expand_phoneme` are NOT mounted.** The bulk product is text: it
carries the drawing code (so `markFeature` is populated — word / design / combined) and no image data,
and there is no phonetic surface over a plain text column. Neither is stubbed with something weaker.

## Operator vocabulary — `predicate`

The plan speaks `match_mode` and the index speaks `predicate`; the plugin translates between them, so
either name works. What matters is which of them this source can actually serve:

| Skill intent | `predicate` | `match_mode` | Served by |
|---|---|---|---|
| identical | `exact` | `exact` | a btree index on the mark text |
| containing (the default) | `default` / `wildcardInfix` | `default` | a full `LIKE '%term%'` scan |
| starts-with | `wildcardPrefix` | `starts_with` | full-text prefix, then verified with a `LIKE` |
| ends-with | `wildcardSuffix` | `ends_with` | full-text prefix over a REVERSED copy of the text, then verified |
| owner | `owner` | — | `LIKE '%term%'` on the applicant name |
| sound-alike | **unavailable** | `phonetic` | nothing — the slice is refused and disclosed |

**`default` is a TRUE contains, not a token match.** It finds a term buried inside a longer word, which is
the whole point of it (`ARBORA` inside `NOVARBORAX`). Do not read it as a word search.

**A phonetic slice defers, it does not degrade.** The capability contract declares `phonetic: null`, so
the planner stamps such a slice `unsupported` before it is dispatched and it becomes a `deferred` coverage
row. If you want sound-alikes on this source, put the variants in the manifest as explicit terms — the
variant lane generates them, and each one is then a real query with its own qid.

**Wildcards are anchors, not a query language.** `TERM*`, `*TERM` and `*TERM*` are understood and mapped
to the three predicates above. A star in the MIDDLE of a term (`AR*RA`) cannot be expressed and is refused
as a capability gap — never searched literally, because a literal search for an asterisk finds nothing and
would read as a clean negative.

## Filters

- `nice_classes: [9, 42, …]` — **bare numbers**, not the register's zero-padded form. USPTO stores `009`;
  the index canonicalises both sides, so `9` and `"009"` find the same marks. Multiple classes are one
  query (they are a column, not a fan-out).
- `status: [...]` — raw USPTO status codes. Rarely what you want: screening already classifies live/dead
  from the row, and filtering at the query hides the dead marks a lawyer reads and dismisses.
- `owner` — alongside `names` it is a SCOPE field (the owner's filings within the term band); alone it is
  the query itself.
- **No `regions` / `offices` parameter.** One office. A territorial narrowing that has nothing to narrow
  would only invite the belief that something was narrowed.

## OR-stack width — 25, and it is set by the worst predicate

`names[]` is an OR stack, and the plan caps it at 25. Not a round number: `exact` and the two anchored
wildcards are index-narrowed and stay cheap at any width, but the unanchored `default` scan costs the same
per term whether it is batched or not, so a wide stack on that one predicate is near-linear. Do not
re-chunk a stack the plan dictated — the chunk boundary is what joins a qid to its query.

## Pagination

`limit` / `offset` — an OFFSET, not a page number. Pages are wide by default (1000): on a local index,
offset re-scans from the start of the result set, so one wide page beats six narrow ones.

## record_id grammar

Search rows carry `record_id = /mark/us/<serial>`, where `<serial>` is the USPTO **serial number** (the
application number). **Cite this in findings and pass it to `register_record_fetch`** — it is the citation
key the driver's gates verify against. A bare serial is also accepted.

## Normalized record fields (`register_record_fetch`)

| Skill concept | Field |
|---|---|
| Citation id | `uri` (the `/mark/us/<serial>`) |
| Mark text | `markText` |
| Status (live/dead) | `statusClass` — `live` / `dead` / `unknown`, classified from the USPTO status code — **USE THIS** |
| Status (raw) | `statusText` — the three-digit code itself |
| Application no. | `applicationNumber` (the serial) |
| Registration no. | `registrationNumber` |
| Filing / reg / expiry dates | `applicationDate` / `registrationDate` / `expiryDate` (ISO `YYYY-MM-DD`) |
| Nice classes | `niceClasses` |
| Owner | `owner` (+ `ownerCountry`) |
| Mark feature | `markFeature` — `word` / `design` / `combined`, or null when the office has not assigned one |
| Goods and services | `goodsAndServices` |
| Public record | `resolved_link` — a TSDR page for the serial |
| Opposition | `oppositions: null` — TTAB proceedings are a **separate** USPTO bulk product not in this index; **never render "none found"** |

**A missing date is `null`, not an old date.** The bulk format writes `00000000` where a date does not
apply. It is parsed as absent. A record with no registration date has not been registered.

## Status codes — read `statusClass`, never the number

USPTO status is a three-digit code and the ranges do not mean what they look like. `800` is REGISTERED AND
RENEWED — live. `715` is CANCELLED - RESTORED TO PENDENCY — live, inside a run of cancelled codes. The
classification is enumerated from the office's own table, and an unrecognised code becomes `unknown`,
which screens as `deepfetch:ambiguous`: looked at, never dropped. See [../status-rules.md](../status-rules.md)
for what the classification is then used for.

## Coverage — one office, and the disclosure rule

This source covers **US only**. For every other jurisdiction in the matter, the register sweep cannot
reach it here: give that slice a `deferred` coverage-form row so the digest and synthesis surface it and
the skeptic can escalate. It is a closeable gap — a different provider or a manual check can cover it —
never an accepted limit. This follows [../SKILL.md](../SKILL.md) → *Coverage ledger*.

The same rule covers the two capability gaps above: a phonetic slice and an internal-wildcard pattern are
`deferred`, not `coverage-limited` and never clean.

## Provenance

Built against USPTO's *Trademark Applications DTD V2.0*; status codes enumerated from the office's status
code table. Predicate behaviour, class canonicalisation, the chunk-boundary and freshness refusals, and
the `match_mode` translation are each covered by tests under `providers/uspto-local/test/`, run against
fixtures written to the DTD's element names.

**The empirical-verification checklist in [README.md](README.md) is NOT complete, and the reason is
recorded rather than glossed.** Bulk download needs a free USPTO account with ID.me identity
verification, which has not been obtained yet, so no real bulk file has been ingested. Verified against
fixtures; **unverified against real data**:

- whether `ownerCountry` and the status date are populated in practice, or mostly absent
- the real delta cadence — if the office publishes weekly rather than daily, the 24-hour freshness rule
  refuses every count and the threshold is wrong, not the data
- `nativeScriptIndex` — **declared `null` (undeclared), not `false`**. Nobody has probed the tokenizer
  against non-Latin filings. Until someone does, a non-Latin term defers and is disclosed; it is not
  answered by its romanisation. Guessing `false` here would silently romanise every such term.
- the true record count and the measured build time at full scale

Treat each as an open question, not a settled fact. An unprobed capability is declared `null` for exactly
this reason: an absent field and a declared "we do not know" read identically to a human, and only one of
them is honest.

## Record base host

`https://tsdr.uspto.gov`

The composition rule is in [status-rules.md](../status-rules.md#record-url-contract): the full clickable
record URL is this host + the record's `uri` path. Example: TSDR, the USPTO's public status-and-document page for the serial.

This host is a fact about THIS provider and it belongs here, not in `status-rules.md` — that file is
loaded on every register run whatever the provider, and it carried one vendor's host as the rule for all
of them. `parseFindingsJson` now refuses a record URL whose host is not the one the active
provider declares, so composing another register's host is a stage refusal, not a silent dead link.
