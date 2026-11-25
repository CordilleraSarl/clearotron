# Clarivate — asking the register and reading its answers

Use this guide to interpret the supplied filings and propose follow-up register questions.

## Operator vocabulary — the query language lives INSIDE the value string

Compumark Content does not use per-field operator enums for matching semantics the way the old doc
claimed. Booleans, parentheses and wildcards are parsed **inside `searchFields[].value`**; the
`operator` stays `EQUALS` and the value does the work.

| `match_mode` | Field + value shape | Semantics | Probe |
|---|---|---|---|
| `default` | `WORD_MARK_SPECIFICATION` = `*TERM*` | **A TRUE CONTAINS** — the substring band | `*TERM*` |
| `exact` | `EXACT_WORD_MARK_SPECIFICATION` = `TERM` | Full-string, case-insensitive, **punctuation-sensitive** (punctuation is stripped client-side for you) | `TERM` |
| `wildcard` | `WORD_MARK_SPECIFICATION` = your pattern, untouched | `*` and `?` are native | `TERM*`, `*TERM`, `TER?` |
| `starts_with` | `WORD_MARK_SPECIFICATION` = `TERM*` | prefix | `TERM*` |
| `ends_with` | `WORD_MARK_SPECIFICATION` = `*TERM` | suffix | `*TERM` |
| `phonetic` | `PHONETIC_WORD_MARK_SPECIFICATION` = `TERM` | Native server-side sound-alike. Opaque — no variant list. | — |

`contains` is accepted as an alias of `default` and produces the identical query. There is no separate
"contains mode" to reach for any more.

**Booleans are explicit and native**, and they are evaluated as real set operations rather than as text.
An `OR` stack answers the union of its legs — on two names that share no marks that is the two totals
added, and on names that overlap it is less, because nothing is counted twice. `AND` and `NOT` compose the
same way. Parentheses group. Regex is not supported despite what the field description hints: a regex
value matches nothing rather than erroring.

**Multi-word terms work — pass them normally.** A bare space is an implicit *AND*, and it is order-blind,
so the tool compiles your phrase to the **ADJ** adjacency operator instead — an ordered phrase match,
which matches only the order you write it in. You write the term the way a
lawyer would say it; the tool does the translation. This applies to `default`/`contains`/`wildcard`/
`starts_with`/`ends_with`/`phonetic` alike.

Two things to know when you read the results:

- **A multi-word `starts_with`/`ends_with` is not anchored.** No string anchor exists on this provider
  (`BEGINS_WITH` on a multi-word value degrades to a per-token AND, which is a superset of the ordered
  phrase), so it runs as a phrase-*contains* — a superset of what you asked. Extra hits, never fewer.
  Screen them as usual.
- **`exact` is still the tightest read** — `EXACT_WORD_MARK_SPECIFICATION` is an ordered whole-string
  match — the whole string as written, so the same words in another order are a different string. Use it
  when you want the mark itself, not the neighbourhood.

**A term you pass is never silently re-parsed.** Parentheses, or (outside `wildcard`) a stray `*`/`?`,
are **REJECTED** with a plain-English error and the slice defers — there is no escape syntax for those.
An operator word *inside* a phrase is handled for you: "BLACK AND DECKER" goes out as
`*BLACK ADJ2 DECKER*`, its other words in order. The term that still defers is one made only of
operator words, such as `OR` alone.

`names[]` (an OR-stack) becomes ONE value joined with explicit ` OR `. The safe width is **496 terms** —
the bound is the JSON parser's document-nesting cap, which the register names in the refusal it answers a
wider stack with. `register_enumerate` chunks wider stacks for you at that bound.

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

`INT_CLASS_NUMBER` value `"9 OR 28 OR 41 OR 42"` returns the deduplicated union of what four per-class
calls returned — the comma form `"9,28,41,42"` is the same. The old per-class fan-out and its `warnings[]`
breakdown have been **deleted from the core**. N classes take one call; and ignore
any older guidance that told you to size a class fan-out.

### Office codes — `EM`, not `EU`

The EUIPO is **`EM`**. The adapter translates `EU`/`EUIPO` → `EM`,
`BENELUX` → `BX`, `OAPI` → `OA`, `ARIPO` → `AP`, `MADRID`/`WIPO` → `WO` for you, then membership-checks
against the 186-code vocabulary. A jurisdiction **outside** that vocabulary is rejected loudly and
becomes a `deferred` coverage row — it is never quietly dropped from the filter.

An international (WO) registration reaches **only its designated countries** — read
`madridDesignations`; never imply "international = global". When the extract omits that field, a particular country's
coverage cannot be resolved from the WO office code alone.

### Owner search — resolve first, and never emit CONTAINS

`APPLICANT_NAME` supports `EQUALS`, `BEGINS_WITH`, wildcards (a trailing `*` with EQUALS is equivalent to
`BEGINS_WITH`), and `OR`. **`CONTAINS` is a hard HTTP 400** —
*"Operator CONTAINS is not supported for search field APPLICANT_NAME"* — and is never emitted anywhere.

This provider has something Corsearch does not: **`POST /resolution/company`** returns confidence-scored
exact applicant names. `register_enumerate` runs it automatically for an owner sweep (opt out with
`resolve_owner: false`) and sweeps *your term ∪ the resolved names ≥ 50 confidence* — strictly
**additive**, so it can only gain recall. A failed resolution degrades to the un-resolved sweep, never to
a narrower one. The result carries an `owner_resolution` note; cite it when the owner band matters.

## Completeness, crowds and the ceiling

`/search` has **no pagination** and needs none: it returns one guid for every hit the count reports, at
any size below the ceiling. **The ceiling is 30 000**, and past it the search **fails loud** with a
`tooManyResults` HTTP 400 naming that maximum and how many results the search reached.

`register_enumerate` therefore probes `POST /count` first. `/count` is one request, takes the same body, works
at **any** magnitude, and returns a `counts` object keyed by office code in one call.

**A `tooManyResults` / over-ceiling band is `state:"incomplete"` — a CROWD DESCRIPTOR, never an error and
never a clean negative.** It is dilution the lawyer reads. On this provider the crowd block also carries
`per_office_counts`: the jurisdictional *shape* of the crowd, which is exactly what judgment needs to
weigh materiality. (Exception: a `names` stack wider than the 496 chunk bound is enumerated
window-by-window, so no whole-stack per-office count exists — the field is then null with a stated
reason, because a mislabelled per-jurisdiction figure is worse than none.)

Narrow a crowd by the steps under *Read the identical mark first* in your own manual. Never by "take the first N".

## Status — read `statusClass`, and let it fail open

Normalized records carry `statusClass` ∈ `live` | `dead` | `unknown` plus the granular `statusText`
(`cmNormalisedStatus`, e.g. `REGISTERED`/`EXPIRED`/`ABANDONED`). The classifier **fails open**: only a
confidently dead signal yields `dead`; an unrecognised token becomes `unknown` and must never auto-drop. `status.active` is the vendor's own boolean, used as the second-rank signal.

`activeOnly` filters server-side and strictly. Applied naïvely it drops the dead records
[../status-rules.md](../status-rules.md)'s invalid-but-keep-if-identical rule *keeps*. Leave it off:
dead identical records then come back in the named band with their status, and no separate identity
leg is run.

## What this provider cannot do

- **No phoneme-variant preview** — `/similarity/word/*` is not available. `register_expand_phoneme` is not exposed. Phonetic search itself works.
- **No ranked-similarity / confidence score** on `/search` or `/text`.
- **No opposition signal** — `/text` does not populate the opposition fields, so `oppositions` stays `null`: say
  "not available from this provider", never "none found".
- **No public per-record URL** — cite the office register plus the `/mark/<office>/<guid>` ref; there is no link to resolve.
- **No sort parameter** — sort after fetch.
- **No regex** — wildcards and booleans cover the plan vocabulary.
- **No cross-language single query** — ask one script question per market the frame names, by its
  romanised form (below); where that romanised form is a Latin question the plan already asks, do not
  ask it again.
- **No native-script search — send the ROMANISATION instead.** This index holds non-Latin marks by
  their transliteration and does not hold the characters at all. A native-script term answers nothing;
  its own transliteration answers records that carry those very characters. Universal — every non-Latin
  record sampled across CN/TW/JP/KR/TH/GR/UA/EG/SA/IL
  carried a populated `markTransliteration`. A native term you send is REFUSED client-side (a 0 here
  would read as clean), so send the romanised form and say in the report that the register was
  searched by transliteration. Two rules that come with it:
  - use **contains, not `exact`** — the office writes its own spacing and trailing tokens, so
    `exact` on a transliteration can be a silent zero where the same term under contains answers;
  - the romanisation is **broader than the characters, not narrower** — the search key is the
    romanisation, so it returns every character set filed under that pronunciation and not only the one
    you meant, which is the shape most Chinese squatting takes.

Each of these, when it blocks a dictated slice, is a **`deferred` coverage row** — disclose it; no
search on this register can close it, so it is not escalated, and it is never clean.
Never substitute a weaker query under the same heading.
