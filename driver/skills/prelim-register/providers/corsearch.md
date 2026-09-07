# Provider adapter — Corsearch (ExaMatch / supremesearch)

This file is the Corsearch-specific translation of the universal logic in `../SKILL.md`. Operator vocabulary, filter field names, plugin tool references, and provider-specific behaviour.

## Plugin reference

The skill calls these 4 tools. THE TOOL NAMES ARE PROVIDER-AGNOSTIC — one register, and the adapter
behind it is deployment configuration, so a skill never names a vendor in a tool call:

| Tool | Purpose | Key params |
|---|---|---|
| `register_search` | Trademark register search | `name`, `names[]`, `match_mode`, `phonetic_variants[]`, `nice_classes[]`, `regions[]`, `registries[]`, `owner_country`, `application_date_after/before`, `registration_date_after/before`, `name_not[]`, `limit`, `page`, `sort`, `ascending`, `fields[]`, `product`, `owner`, `representative` |
| `register_record_fetch` | Full 46+ field detail record | `record_id` (URI), `translate` |
| `register_image_fetch` | Figurative-mark image metadata | `image_path`, `size` |
| `register_expand_phoneme` | AI phoneme expansion | `word`, `language` (en_US, de_DE, fr_FR, it_IT, es_ES) |

Plugin source: `providers/corsearch/src/index.js`.

Auth: `CORSEARCH_SESSION_KEY` environment variable, supplied from the deployment's env file. Never logged or committed.

## Operator vocabulary

Corsearch's supremesearch API uses single-character prefixes on field names. All field values must be **backtick-quoted** (the plugin handles this).

| Match mode | API prefix | Semantics | Hit volume (NIKE benchmark) |
|---|---|---|---|
| `default` | (none) | Exact-token, case-insensitive — catches tokenisation splits and case variations | ~15,083 |
| `exact` | `=` | Strictest — full-string match | ~3,014 |
| `phrase` | `"` | Ordered phrase match | ~10,075 |
| `starts_with` | `^` | Prefix | ~7,681 |
| `ends_with` | `$` | Suffix | ~8,248 |
| `phonetic` | `*` (or `P`) | Server-side phoneme match; extend with `phonetic_variants[]` | ~5,854 bare / ~6,022 with variants |
| `fuzzy` | `~` | Approximate (diacritics, transliterations) | ~143,184 |
| `not` | `!` (or `-`) | Complement; useful in compound queries | — |
| `must` | `&` | Force AND within same-field stacking | ~433 (NIKE + ADIDAS) |

**Critical:** No explicit `AND` / `OR` keywords — those return HTTP 400. Composition is space-separated. Repeated fields = implicit OR. Use `must` prefix for AND within same field. Repeated `nice-class:` fields are therefore an implicit-OR union — `nice_classes:[9,28,41,42]` correctly scopes to *any of* those classes.

> **The hit-volumes above are UNSCOPED (all-class).** On a funnel `register_enumerate` EVERY match mode MUST be
> `nice_classes`-scoped to the matter's in-scope Nice set — an unscoped `default` / `starts_with` / `ends_with` /
> `phonetic` enumerate pulls thousands of all-class records that flood the band and time the stage out (the
> NOVAPULSE/BIOVELTRIN failure). `fuzzy` (~143k) is **never** an enumerate mode at all. Class-scope is breadth the
> matter instructed, not sufficiency.

Wildcards (`*` and `?`) work inside backticks: `name:\`NIK*\`` valid; `name:\`NIK*\`` outside backticks → HTTP 500.

## Filter field names

| Universal concept | Corsearch field | Format |
|---|---|---|
| Nice class | `nice-class:` | integer 1-45, **hyphenated field name** |
| Region (validity) | `region:` | UPPERCASE 2-letter ISO |
| Registry (indexing source) | `registry:` | lowercase 2-letter |
| Owner element | `owner:` | free-text |
| Owner country | `owner-country:` | UPPERCASE 2-letter, **hyphenated** |
| Representative | `representative:` | free-text |
| Product element | `product:` | free-text (English) |
| App date (after) | `app-after:` | ISO YYYY-MM-DD, **hyphenated** |
| App date (before) | `app-before:` | Same |
| Reg date (after) | `reg-after:` | Same |
| Reg date (before) | `reg-before:` | Same |

The plugin's `register_search` tool maps these from snake_case params (e.g., `nice_classes: [9]` → `nice-class:\`9\``).

## Owner-bound search (for competitor / enforcer sweeps)

The `register_search` tool accepts `owner: "<free-text>"` as a top-level parameter mapping to the `owner:` field. Useful for:

- Watchlist-driven proactive sweeps (competitors / aggressive enforcers from the variant manifest)
- Cross-pollination Trigger 1 (every common-law owner → register check)
- Targeted "does competitor X have a related mark?" probes

Example:

```
register_search({
  owner: "Aureon Interactive Entertainment",
  nice_classes: [9, 28, 41, 42],
  limit: 50,
})
```

Owner matching is fuzzy on free-text. Try both the formal name (`"Aureon Interactive Entertainment Inc."`) and common variants (`"Aureon Interactive Entertainment"`, `"Aureon Computer Entertainment"`, `"SCE"`). The owner-aggregation step in digest mode normalises hits later.

## Pagination

- `limit` max 100 per page
- `page` 0-indexed
- 5000-record hard cap: pagination stops at record 5000 regardless of `total_hits`
- `cap_warning` is populated in normalized response when `total_hits > 5000`
- `next_page_token` is a hint — incrementing `page` is equivalent and simpler

## Sort options

- `Relevancy` (default) — confirmed
- `Name` — confirmed
- `ApplicationDate`, `RegistrationDate`, `Owner` — supported by plugin schema but not exercised in test fixtures

## Status filter caveat

**Do NOT rely on `status:` field-side filtering** — it does not select live records on this provider. Use the [status-rules.md](../status-rules.md) keep-list applied AFTER detail-fetch instead.

## Response field limitations

On `/search/trademark`, only 3 fields are reliably populated on search rows regardless of `fieldsInclude`:

- `uri`
- `name`
- `representativeName`

Everything else (`niceClassification`, `owners`, `corsearchStatusCode`, dates, jurisdictions, mark feature, image path) requires `register_record_fetch`. Plugin defaults to requesting the 3 working fields; callers can override via `fields[]` param to e.g. `["uri"]` for cheapest count-only probes.

## Detail-record fields (46+ fields)

The `register_record_fetch` endpoint returns ~46-field JSON. The fields the skill uses:

| Skill concept | Corsearch field |
|---|---|
| Mark text | `markVerbalElementText` (or `onomaticsName` fallback) |
| Nice classes | `niceClassification` (zero-padded string array) |
| Status | `corsearchStatusCode` (or `corsearchEstimatedStatusCode` / `markCurrentStatusCode` fallback) |
| Status date | `markCurrentStatusDate` |
| Application date | `applicationDate` |
| Registration date | `registrationDate` |
| Expiry date | `expiryDate` |
| Owner name | `owners[0].organizationName` → `onomaticsName` → `onomaticsOwner` → `freeFormatNameLine` (see `../status-rules.md#owner-extraction-fallback-chain`) |
| Owner country | `owners[0].addressCountry` (with fallback chain) |
| Jurisdictions | `onomaticsJurisdictionsStatuses` (country → status map) |
| Opposition history | `onomaticsOppositions[]` — VERBATIM CAPTURE |
| Image path | `imagePath` (for figurative marks) |
| Image features | `markFeature` ("Figurative" vs "Verbal") |

## Opposition records — the highest-signal field

When `onomaticsOppositions[]` is populated, the entries are gold. Each entry contains:

- `caseParties[].organizationName` — opponent identity
- `caseParties[].addressCountry` — opponent country
- `caseParties[].casePartyProperties[].priorRightMarkText` — opponent's prior right
- `caseParties[].casePartyProperties[].priorRightApplicationNumber` — opponent's prior right's app number
- `caseParties[].casePartyProperties[].priorRightCountryCode` — opponent's prior right country
- `caseBasisText` — case basis (commonly "Likelihood of confusion")
- `caseFilingDate` — when opposition filed
- `oppositionIdentifier` — unique ID
- `onomaticsOfficialOppositionUri` — link to official record

Capture VERBATIM in the register findings file's "Opposition history" section. Don't paraphrase — the reviewing lawyer relies on the actual filing details.

## Phoneme expansion availability

Corsearch supports phoneme expansion via `register_expand_phoneme`. Returns `{ base, aiVariants[] }`. Use the variants as `phonetic_variants[]` in `register_search` with `match_mode: "phonetic"`.

Declared languages: `en_US` (~29 variants per word), `de_DE` (~29), `fr_FR` (~49). Other languages (`it_IT`, `es_ES`) are supported by the API but UNDECLARED here — treat them as a stated unknown, not as unavailable.

**Usage pattern:** for multi-language jurisdictions, call expand-phoneme once per relevant language, concatenate `aiVariants[]`, pass to a single search call. Don't run multiple separate phonetic searches — costs more, returns largely overlapping results.

## Image fetch

`register_image_fetch({ image_path, size: "300x200" })` returns image metadata + URL. The plugin returns `{ url, content_type, size_bytes, requested_size }`. To embed the image in the deliverable Excel, fetch the binary out-of-band using the returned URL.

Only invoke for marks where `markFeature: "Figurative"` or `markFeature: "Stylised"`. Skip for word marks.

## What Corsearch DOESN'T do (vs other providers)

Be aware these capabilities are missing, so the skill doesn't promise them:

- **POCA scoring** — not available through this adapter. Skill returns `null`
- **Cross-language search within one query** — Corsearch doesn't support "search this mark in Japanese AND English in one query." Skill handles this by generating transliteration variants in `prelim-variants` and querying each separately.
- **Server-side stem-folding** — present but not configurable (the default match-mode tokenizer catches LEGEND ↔ LEGENDS). The variant manifest's `plural-root` category encodes this — search the root form to catch inflected forms.

## Provider-specific behaviour

- `status:` field-side filtering does not select live records — see above.
- `nextRequest` envelope is structured, not opaque — but treat as a hint; incrementing `page` is equivalent
- Owner is empty on ~93% of records via `organizationName` — use the fallback chain
- Chinese status strings appear verbatim — apply substring dictionary in `../status-rules.md`
- Madrid (`/mark/int/*`) records have non-trivial `onomaticsJurisdictionsStatuses` aggregation — see `../status-rules.md#madrid-protocol-designations`

## API budget

Sustained-burst behaviour is UNDECLARED. The skill's per-tool budget (20 search / 40 detail-fetch / 5 expand-phoneme / 10 image-fetch per mark) stays well inside practical limits.

Session-key validation: send one cheap `register_search({ name: "EXAMPLEMARK", limit: 1 })` before doing any real work. If it returns 401/403, halt and surface to orchestrator immediately.

## Where the contract lives

`providers/corsearch/src/capabilities.js` is the machine-readable capability contract the plan compiler
reads. If this document and that file disagree, the contract wins and this document is the bug.

## Record base host

`https://tm.corsearch.com`

The composition rule is in [status-rules.md](../status-rules.md#record-url-contract): the full clickable
record URL is this host + the record's `uri` path. Example: `/mark/<cc>/<number>` → `https://tm.corsearch.com/mark/us/86264144`.

This host is a fact about THIS provider and it belongs here, not in `status-rules.md` — that file is
loaded on every register run whatever the provider, and it carried one vendor's host as the rule for all
of them. `parseFindingsJson` now refuses a record URL whose host is not the one the active
provider declares, so composing another register's host is a stage refusal, not a silent dead link.
