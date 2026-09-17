# Provider adapter — Clarivate (Compumark Content API)

The Clarivate-specific translation of the universal logic in [../SKILL.md](../SKILL.md): operator
vocabulary, field names, office codes, response shapes, and the capability gaps that must be disclosed
rather than worked around. Active when the deployment environment carries
`CLEAROTRON_DATABASE=clarivate` (one register provider per run — never two).

**Tool names are NEUTRAL.** You call `register_search`, `register_enumerate`, `register_execute_plan`,
`register_propose_supplemental`, `register_record_fetch`, `register_batch_screen`, `register_image_fetch`
— the same names on every provider (see [README.md](README.md)). This file is the *vocabulary behind*
them: what `match_mode: "phonetic"` maps to, which office codes are legal, what the records carry.

> **This file states the adapter's live behaviour.** An earlier version made two
> claims that were WRONG and cost recall: that multi-class needed an N-call fan-out (it does not — it is
> one call), and that `default` was a phrase-EQUALS you had to escape into `contains` (it is now a true
> contains). If you are working from memory of the old doc, discard it. See **Provenance** at the bottom.

## Tool surface — 7 of the 8 neutral tools

| Tool | What it does here |
|---|---|
| `register_search` | One `/search` call → the **COMPLETE** matching set. No pagination exists and none is needed. Fails loud past 30 000 hits. |
| `register_enumerate` | The completeness primitive: cheap `/count` probe **first**, then (if under the ceiling) one `/search`, then screening. Returns `enumerated` or `incomplete` — never a partial list dressed as a clean. |
| `register_execute_plan` | Runs the frozen plan for one axis and writes the band itself, qid-stamped. Count entries probe `/count`; enumerate entries run the full funnel. |
| `register_propose_supplemental` | Judgment-addition queries: you propose, **code** mints qids, executes and writes the band. |
| `register_record_fetch` | `/text`, batched at exactly 100 ids → normalized records (+ full `_raw`). |
| `register_batch_screen` | Same `/text` batching, returning screening rows with the **shared** closed-set `screen_verdict` vocabulary. |
| `register_image_fetch` | Figurative-image metadata (never bytes into context). |

**`register_expand_phoneme` DOES NOT EXIST on this provider — and is not stubbed.** The endpoint that
would preview phoneme variants (`/similarity/word/*`) is not available on this provider: it answers
HTTP 403, confirmed with a schema-correct body. Phonetic
**search** works fine (`match_mode: "phonetic"`); what is unavailable is the *variant list*. If a step
asks you to preview variants before searching, that step is **deferred** on this provider — say so; do
not substitute a literal search for the phonetic band and call it done.

Auth: `CLARIVATE_API_KEY`, sent as `X-ApiKey`. Base overridable with `CLARIVATE_API_BASE`.

## Operator vocabulary — the query language lives INSIDE the value string

Compumark Content does not use per-field operator enums for matching semantics the way the old doc
claimed. Booleans, parentheses and wildcards are parsed **inside `searchFields[].value`**; the
`operator` stays `EQUALS` and the value does the work.

| `match_mode` | Field + value shape | Semantics | Probe |
|---|---|---|---|
| `default` | `WORD_MARK_SPECIFICATION` = `*TERM*` | **A TRUE CONTAINS** — the substring band | `*NIK*` = 806 |
| `exact` | `EXACT_WORD_MARK_SPECIFICATION` = `TERM` | Full-string, case-insensitive, **punctuation-sensitive** (punctuation is stripped client-side for you) | `NIKE` = 34 on CH |
| `wildcard` | `WORD_MARK_SPECIFICATION` = your pattern, untouched | `*` and `?` are native | `NIK*` = 128, `*NIKE` = 36, `NIK?` = 48 |
| `starts_with` | `WORD_MARK_SPECIFICATION` = `TERM*` | prefix | `NIK*` = 128 |
| `ends_with` | `WORD_MARK_SPECIFICATION` = `*TERM` | suffix | `*NIKE` = 36 |
| `phonetic` | `PHONETIC_WORD_MARK_SPECIFICATION` = `TERM` | Native server-side sound-alike. Opaque — no variant list. | — |

`contains` is accepted as an alias of `default` and produces the identical query. There is no separate
"contains mode" to reach for any more.

**Booleans are explicit and native.** `"NIKE OR ADIDAS"` = 38 = 34 + 4 exactly. `AND` works. `NOT` works
(`"NIK* NOT NIKE"` = 94 = 128 − 34). Parentheses group. Regex is not supported (`/NIK./` = 0) despite
what the field description hints.

**Multi-word terms work — pass them normally.** A bare space is an implicit *AND*
(`*KESTREL BEVERAGE*` = `*KESTREL* AND *BEVERAGE*` = 75, and it is order-blind: `*CORAL PUP*` =
`*PUP CORAL*` = 11), so the tool compiles your phrase to the **ADJ** adjacency operator instead —
`*CORAL ADJ PUP*`, an ordered phrase match (11 hits; reversed = 0). You write the term the way a
lawyer would say it; the tool does the translation. This applies to `default`/`contains`/`wildcard`/
`starts_with`/`ends_with`/`phonetic` alike.

Two things to know when you read the results:

- **A multi-word `starts_with`/`ends_with` is not anchored.** No string anchor exists on this provider
  (`BEGINS_WITH "ALPINE SPRING"` = 9 vs the phrase's 7), so it runs as a phrase-*contains* — a superset
  of what you asked. Extra hits, never fewer. Screen them as usual.
- **`exact` is still the tightest read** — `EXACT_WORD_MARK_SPECIFICATION` is an ordered whole-string
  match ("KESTREL BEVERAGE" = 4, "BEVERAGE KESTREL" = 0). Use it when you want the mark itself, not the
  neighbourhood.

**A term you pass is never silently re-parsed.** Parentheses, or (outside `wildcard`) a stray `*`/`?`,
are **REJECTED** with a plain-English error and the slice defers — there is no escape syntax for those.
An operator word *inside* a phrase is handled for you: "BLACK AND DECKER" goes out as
`*BLACK ADJ A?D ADJ DECKER*` (the `?` stops the parser reading AND as an operator). The one term that
still defers is a bare two-letter operator word — `OR` alone has no interior character to wildcard.

`names[]` (an OR-stack) becomes ONE value joined with explicit ` OR `. The safe width is **500 terms**
(80/200/500 all fine; 1000 → HTTP 500 *"Document nesting depth (1001) exceeds the maximum allowed"*).
`register_enumerate` chunks wider stacks for you at that bound.

## Filters

| Concept | Where it goes | Format |
|---|---|---|
| Jurisdiction | `registrationOfficeCodes[]` — **REQUIRED**, top-level, not a searchField | 2-letter Compumark codes; pass `regions: [...]` |
| Nice class | `INT_CLASS_NUMBER` — **ONE field, OR-list value** | `nice_classes: [9,28,41,42]` |
| Owner | `APPLICANT_NAME`, operator `EQUALS` (+ native wildcards) | `owner:` / `owners: []` |
| Representative | `REPRESENTATIVE_OR_CORRESPONDENT_NAME` | `representative:` |
| Active only | `queryOptions.activeOnly` | `active_only: true` |
| English plurals | `queryOptions.plurals` | `plurals: true` |
| Cross-references | `queryOptions.crossReferences` | `cross_references: true` |
| Madrid scoping | `limitWOresultsToDesignated` | `limit_wo_to_designated` (defaults ON when WO rides with national/regional offices) |

### Multi-class is ONE call — the fan-out is gone

`INT_CLASS_NUMBER` value `"9 OR 28 OR 41 OR 42"` returns **18** — identical to the deduplicated union of
four per-class calls (`"9,28,41,42"` also = 18). The old per-class fan-out and its `warnings[]` cost
breakdown have been **deleted from the core**. N classes cost one call; budget accordingly, and ignore
any older guidance that told you to size a class fan-out.

### Office codes — `EM`, not `EU`

The EUIPO is **`EM`**. The adapter translates `EU`/`EUIPO` → `EM`,
`BENELUX` → `BX`, `OAPI` → `OA`, `ARIPO` → `AP`, `MADRID`/`WIPO` → `WO` for you, then membership-checks
against the 186-code vocabulary. A jurisdiction **outside** that vocabulary is rejected loudly and
becomes a `deferred` coverage row — it is never quietly dropped from the filter.

### Owner search — resolve first, and never emit CONTAINS

`APPLICANT_NAME` supports `EQUALS` (156 hits), `BEGINS_WITH` (159), wildcards (`"NIKE*"` with EQUALS =
159, i.e. equivalent to BEGINS_WITH), and `OR`. **`CONTAINS` is a hard HTTP 400** —
*"Operator CONTAINS is not supported for search field APPLICANT_NAME"* — and is never emitted anywhere.

This provider has something Corsearch does not: **`POST /resolution/company`** returns confidence-scored
exact applicant names. `register_enumerate` runs it automatically for an owner sweep (opt out with
`resolve_owner: false`) and sweeps *your term ∪ the resolved names ≥ 50 confidence* — strictly
**additive**, so it can only gain recall. A failed resolution degrades to the un-resolved sweep, never to
a narrower one. The result carries an `owner_resolution` note; cite it when the owner band matters.

## Completeness, crowds and the ceiling

`/search` has **no pagination** and needs none: it returns the whole guid set (128 guids for a count of
128; 806 for 806). Past 30 000 it **fails loud**: HTTP 400 *"tooManyResults — The search returned 209012
results. Maximum number of results is 30000."*

`register_enumerate` therefore probes `POST /count` first. `/count` is cheap, takes the same body, works
at **any** magnitude, and returns per-office counts in one call
(`{"counts":{"CH":34,"EM":60,"WO":7,"CN":14345,"GB":91,"US":138}}`).

**A `tooManyResults` / over-ceiling band is `state:"incomplete"` — a CROWD DESCRIPTOR, never an error and
never a clean negative.** It is dilution the lawyer reads. On this provider the crowd block also carries
`per_office_counts`: the jurisdictional *shape* of the crowd, which is exactly what judgment needs to
weigh materiality. (Exception: a `names` stack wider than the 500 chunk bound is enumerated
window-by-window, so no whole-stack per-office count exists — the field is then null with a stated
reason, because a mislabelled per-jurisdiction figure is worse than none.)

Narrow by: office set, class list, date range, `active_only`. Never by "take the first N".

## Status — read `statusClass`, and let it fail open

Normalized records carry `statusClass` ∈ `live` | `dead` | `unknown` plus the granular `statusText`
(`cmNormalisedStatus`, e.g. `REGISTERED`/`EXPIRED`/`ABANDONED`). The classifier **fails open**: only a
confidently dead signal yields `dead`; an unrecognised token becomes `unknown` and must never auto-drop —
deep-fetch it. `status.active` is the vendor's own boolean, used as the second-rank signal.

`activeOnly` filters server-side and strictly. Applied naïvely it drops the dead records
[../status-rules.md](../status-rules.md)'s invalid-but-keep-if-identical rule *keeps*. For any
identical-match probe, run the identity leg with `active_only: false` and **without** the class filter —
identical-match is class-agnostic.

## Records — `register_record_fetch` / `register_batch_screen`

`/text` takes **exactly 100 ids** per call (101+ → HTTP 400); the adapter chunks at 100. Response splits
into `trademarks[]` and `nonTrademarks[]` (design-only / bookkeeping artefacts — generally skip, but
sanity-check it if results look sparse).

`record_id` grammar: a synthetic **`/mark/<office>/<guid>`** ref. Cite that in findings and pass it back
to the tools — it is the citation key the driver's fidelity gates verify against. The office segment
comes from the search's `ids{}` key, never from the guid.

| Concept | Normalized field |
|---|---|
| Citation id | `uri` |
| Mark text / feature | `markText`, `markFeature` (SHOUTY: `WORD ONLY`, `FIGURATIVE`, `WORD AND DEVICE`), `markDisclaimers` |
| Status | `statusClass` (**use this**), `statusText` |
| Numbers | `applicationNumber`, `registrationNumber` |
| Dates (ISO) | `applicationDate`, `registrationDate`, `expiryDate`, `renewalDate`, `lastPublicationDate`, `publicationDates[]`, `abandonmentDate`, `cancellationDate` |
| Classes / G&S | `niceClasses` (ints), `goodsServices` (includes the machine EN translation of non-English text) |
| Owner | `owner`, `ownerCountry` — **only** `applicantName` → `applicantNameNative`; `freeFormatNameLine` and `organizationName` DO NOT EXIST in the vendor schema |
| Reach / seniority | `priorities`, `seniorities`, `basicRegistrationApplications`, `madridDesignations.{protocol,agreement,aripo}` |
| Opposition | `oppositions: null` — see below |
| Everything else | `_raw` (full ST.66 record) |

An international (WO) registration reaches **only its designated countries** — read
`madridDesignations`; never imply "international = global".

**`test_mode: true` is dev-only.** Bodies are obfuscated, unbilled, and **not persisted** to the record
ledger — so a test-mode fetch can never back a real finding.

## Opposition data — NOT AVAILABLE (never "none found")

The vendor's schema *does* define `Trademark.markRecords[].oppositionPeriodEndDate` / `oppositionPeriodText`, but
`/text` does not populate them — a report must say "not available", never "none found". Genuinely
sparse fields (`seniorities`, `priorities`) *do* appear, proving the full schema is delivered and the
absence is real.

So `oppositions` stays `null` and every rendering must say **"not available from this provider"**.
Reporting "no oppositions found" would be a fabricated clean. Full opposition/enforcement history needs a
different product (Clarivate IP Data + darts-ip) or the office's own register — disclose it, do not
silently omit the dimension.

## What this provider cannot do

- **No phoneme-variant preview** — `/similarity/word/*` is not available. `register_expand_phoneme` is not exposed. Phonetic search itself works.
- **No ranked-similarity / confidence score** on `/search` or `/text`.
- **No opposition signal** (above).
- **No public per-record URL** — cite the office register plus the `/mark/<office>/<guid>` ref; there is no link to resolve.
- **No sort parameter** — sort after fetch.
- **No regex** — wildcards and booleans cover the plan vocabulary.
- **No cross-language single query** — run the variant manifest per script.
- **No native-script search — send the ROMANISATION instead.** This index holds non-Latin marks by
  their transliteration and does not hold the characters at all. `华威豹` answers **0**; its own
  transliteration `HUA WEI BAO` answers **32**, and those 32 include 华威豹. Same for `小米` (0) vs
  `XIAOMI` (57632). Universal — every non-Latin record sampled across CN/TW/JP/KR/TH/GR/UA/EG/SA/IL
  carried a populated `markTransliteration`. A native term you send is REFUSED client-side (a 0 here
  would read as clean), so send the romanised form and say in the report that the register was
  searched by transliteration. Two rules that come with it:
  - use **contains, not `exact`** — the office writes its own spacing and trailing tokens, so
    `exact` on a transliteration is a silent zero (GR 0/10, EG 0/7);
  - the romanisation is **broader than the characters, not narrower** — it catches homophone
    variants (`HUA WEI BAO` → 华威豹, 华味宝, 华为爆破), which is the shape most Chinese squatting takes.

Each of these, when it blocks a dictated slice, is a **`deferred` coverage row** — escalate and disclose.
Never substitute a weaker query under the same heading.

## Provider-specific behaviour

- `/text` body key is `ids`, not `guids` (`guids:` → 400).
- `/image` body is singular `{ id: <guid> }`; the adapter loops.
- Upstream dates are bare `YYYYMMDD`; the normalizer converts to ISO. `_raw` keeps the original.
- `EXACT_APPLICANT_NAME` exists but is documented as un-combinable with other fields — not wired.
- `INT_GOODS_SERVICES_DESCRIPTION` is searchable server-side; not wired yet, a real narrowing lever.
- `POST /filingdate` reports per-register data freshness (`recordLastUpdated`) — a coverage claim is only
  as good as the register behind it.
- Sustained-burst limits are UNDECLARED — a stated unknown, not an absence of limits.

## Where the contract lives

`providers/clarivate/src/capabilities.js` is the machine-readable capability contract the plan compiler
reads. If this document and that file disagree, the contract wins and this document is the bug.

## Record base host

**None — this provider publishes no per-record public page.** Compumark Content exposes no per-record public page.

Do NOT compose a record URL. Leave the record's `uri` as it is and cite the office register in the text.

**`source.resolved_link` is `""`** — the empty string. NOT the `uri`, not a fragment, not another vendor's host. "Leave the `uri` as it is" means do not MODIFY the record's own `uri` field; it does NOT mean carry that path into the link field.
See [status-rules.md](../status-rules.md#record-url-contract). Borrowing another vendor's host here is
exactly the defect closed, and `parseFindingsJson` now refuses it
(`finding_record_url_foreign_host`).
