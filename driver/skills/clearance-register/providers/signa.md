# Provider adapter — Signa (signa.so)

Provider-specific tool names + operator vocabulary for the register-search skill when the active register
provider is **Signa**. The universal logic lives in [../SKILL.md](../SKILL.md); only Signa specifics live here.
(Selected by the deployment environment: `CLEAROTRON_DATABASE=signa`. One register provider per
workflow — never both.)

## Plugin reference

| Tool | Endpoint | Params |
|---|---|---|
| `register_search` | `POST /v1/trademarks` — raw Layer-1 register search | `query`, one of `strategies[]`/`match`, `nice_classes[]`, `offices[]`, `owner`, `status[]`, `limit` (max 100), `cursor` |
| `register_enumerate` | the same endpoint, paged to exhaustion | as above, plus `in_scope_classes[]` for screening |
| `register_execute_plan` | runs the frozen plan for one axis | `plan_path`, `axis`, `output_path` |
| `register_record_fetch` | `GET /v1/trademarks/{id}` — full detail, NORMALIZED | `record_id` (the `/mark/<office>/<id>` ref from search, or a raw Signa id) |
| `register_propose_supplemental` | Judgment-addition queries: CODE mints, executes and writes the band | `axis`, `output_path`, `proposals[]` |

Auth: `Authorization: Bearer <SIGNA_API_KEY>`. There is **no** batch-screen tool and **no** clearance tool
(`/v1/analysis/clearance` 404s) — so the spine's batch-screen step is skipped under Signa; detail-fetch
candidates directly (per `unit.md` step 5). Screening needs no extra call either way: the search row already
carries status and classes.

**Do not page or plan by hand.** `register_enumerate` owns the page loop and returns a completeness state;
`register_execute_plan` runs every dictated entry for an axis. A hand-assembled band is not a band.

## Operator vocabulary — TWO SHAPES, and they are mutually exclusive

Signa answers "how does this term match" in two different ways, and the API rejects a request carrying both.
Pass one:

| Skill intent | Send | Shape |
|---|---|---|
| exact / identical | `strategies: ["exact"]` | ranked |
| sound-alike | `strategies: ["phonetic"]` | ranked (native; no variant pre-generation needed) |
| typo / approximate | `strategies: ["fuzzy"]` | ranked |
| unanchored / contains | `match: "contains"` | deterministic |
| starts-with | `match: "starts_with"` | deterministic |
| ends-with | `match: "ends_with"` | deterministic |

Ranked strategies may be stacked when you mean OR; a deterministic `match` is one per call and forbids
`strategies`. One operator per call otherwise, to preserve audit traceability.

There is **no wildcard/infix operator**: a pattern anchored at both ends or at neither (`*ACME*`, `ACME`) has
no mapping, and `contains` is not one — it would search the asterisks. Use `fuzzy`/`phonetic` plus the
variant manifest for those, and give the slice a `deferred` row if the manifest cannot cover it.

## Filters

- `nice_classes: [25, 9, …]` — OR across classes (top-level filter; not per-clause).
- `offices: [...]` — the office keys below, or their ISO codes; both are accepted. Omit for all offices.
- `owner: "…"` — the owner NAME, composed with `query` in the **same** request. It is a text match, so it
  **widens** on a shorter string ("NIKE" reaches far more than "NIKE, INC."). Never read a result as that
  entity's whole portfolio, and never read an empty one as the entity having no marks.
- `status: [...]` — `pending` | `active` | `inactive` | `unknown`.

## Totals, and the one number that is not one

`total_hits` is the **register's own corpus total** — everything matching, whether or not it was fetched.
On a broad sweep the vendor will not count exactly and reports an approximation instead; the plugin
suppresses those, so **`total_hits: null` means UNKNOWN, never zero**. A band whose total is unknown cannot
be read as either exhausted or clean: it comes back `state: "incomplete"` and belongs to judgment as a
crowd descriptor.

## Pagination

Cursor-based, and `register_enumerate` owns it — you never pass a cursor. On raw `register_search` the
response carries `next_cursor`; pass it back as `cursor`. `has_more` flags more results. `limit` is capped
at 100 by the API.

## record_id grammar

`register_search` rows carry a synthetic `record_id = /mark/<office>/<id>` where `<office>` is the record's
**ISO `jurisdiction_code`** (us, eu, ch, wo, …) and `<id>` is the Signa id (e.g. `tm_019d1db7-…`). **Cite
this `record_id` in findings and pass it to `register_record_fetch`** — it is the citation key the driver's
gates verify against.

## Normalized record fields (`register_record_fetch` → flat shape — read directly)

`register_record_fetch` returns the record NORMALIZED to the shared provider shape (the plugin flattens
Signa's nested record; the full upstream record is under `_raw`):

| Skill concept | Normalized field |
|---|---|
| Citation id | `uri` (the `/mark/<office>/<id>`) |
| Mark text | `markText` |
| Status (live/dead) | `statusClass` — `live`/`dead`/`unknown`, from the authoritative `status.primary` — **USE THIS** |
| Status (label) | `statusText` (e.g. `registered`) |
| Application no. | `applicationNumber` |
| Registration no. | `registrationNumber` |
| Filing / reg / expiry dates | `applicationDate` / `registrationDate` / `expiryDate` (ISO `YYYY-MM-DD`) |
| Nice classes | `niceClasses` (int array) |
| Owner | `owner` (+ `ownerCountry`) |
| Representative | `representative` |
| Image present | `imageAvailable` (bool) |
| **How the right arose** | `filingRoute` — `direct_national` / `direct_regional` / `madrid_ir` / `madrid_designation` / `transformation` / `divisional`; with `irNumber`, `originOffice`, `designationDate` |
| Opposition | `oppositionWindow` + `proceedingsCount`. Per-proceeding detail (`/v1/trademarks/{id}/proceedings`) is not wired — **never render "none found"** for opposition |
| Full raw record | `_raw` (owners[], attorneys[], madrid, text_variants, …) |

`filingRoute` is what lets a finding say which register a right sits on. Use it rather than inferring the
route from the office code.

## Coverage — Signa's live office set (11) + the disclosure rule

Derived from `GET /v1/offices` and committed as a snapshot (`providers/signa/src/offices.generated.js`), so
a change in what we claim to search arrives as a reviewable diff:

| Office | Key | ISO |
|---|---|---|
| USPTO | `uspto` | US |
| EUIPO | `euipo` | EM (jurisdiction `EU`) |
| WIPO / Madrid | `wipo` | WO |
| **UK IPO** | `ukipo` | GB |
| Switzerland IGE/IPI | `ipi` | CH |
| Canada | `cipo` | CA |
| Australia | `ipau` | AU |
| France INPI | `inpi-fr` | FR |
| Singapore | `ipos` | SG |
| Norway | `nipo` | NO |
| Sweden | `prv` | SE |

**Each of the eleven is searched as a TERRITORY, not as one register.** The adapter sends
`filters.jurisdictions` + `territory_match: "protection"` — every right with effect there, whatever
register it sits on — rather than `filters.offices`, which searches the national register alone. The
difference is not a margin. On the same term:

| request | national | regional | madrid |
|---|---|---|---|
| `filters.offices: ["inpi-fr"]` | 6898 | 0 | 0 |
| `filters.jurisdictions: ["FR"]`, protection | 6898 | 10000+ | 2708 |

**So an EU trade mark that blocks use in France is now found**, and it never appears in the French
register. Every covered territory reaches its Madrid layer this way and the EU members additionally reach
the EU register; Switzerland, under no regional register, returns regional 0 either way and its Madrid
layer arrives all the same. It is ONE call, not three — no extra spend.

Do not describe a covered territory's result as "the national register": it is the stack of rights in
force there, and a finding may sit on any layer of it.

**NOT covered: China (CNIPA), Germany, Japan, Korea, Benelux, and other nationals.** The territory
expansion above does not change this and must not be read as widening it: `SIGNA_OFFICE_KEYS` maps only
these eleven, an unmapped region abandons the translation, and a territory the vendor does not index is
not reachable by asking the question a different way. A Madrid designation of Germany is found only when
Germany is the territory searched, and it cannot be. For any matter jurisdiction outside this set, give
that slice a `deferred` coverage-form row (the register sweep **cannot reach** it on Signa — a closeable
gap a different provider or a manual check can cover, never an accepted limit) so the digest + synthesis
surface it and the skeptic can escalate. This follows the keystone doctrine
in `../SKILL.md` → *Coverage ledger*: a could-not-reach gap is **`deferred`** (escalate + disclose),
never `coverage-limited` (a searched-but-unexhausted DATA limit a re-run cannot close).

**A territory search reaches every register that binds the territory — national, regional and Madrid.**
The executor sends `filters.jurisdictions` with `territory_match: "protection"`, not `filters.offices`, so a
French slice returns the EU trade marks and the Madrid designations that block use in France alongside the
French national marks. On the same term:

| what the executor sends | national | regional | Madrid |
|---|---|---|---|
| `filters.offices: ["inpi-fr"]` (the shape this doc used to describe) | 6898 | 0 | 0 |
| `filters.jurisdictions: ["FR"]`, `territory_match: "protection"` | 6898 | 10000+ | 2708 |

It is ONE call, not three. A territory under no regional register — Switzerland — returns regional 0 either
way and still reaches its Madrid layer, which is what shows `protection` adds a LAYER rather than just more
rows.

**So do not disclose an office-scoped shortfall here; there is not one.** This paragraph described the
earlier behaviour and outlived it: the executor changed and the doctrine did not, which is the same skew
that left the grant at two tools while the server served four. The residual gap is the office set above —
a territory OUTSIDE the eleven, which gets the `deferred` row the previous paragraph specifies.

## Record base host

**None — this provider publishes no per-record public page.**

Do NOT compose a record URL. Leave the record's `uri` as it is and cite the office register in the text.

**`source.resolved_link` is `""`** — the empty string. NOT the `uri`, not a fragment, not another vendor's host. "Leave the `uri` as it is" means do not MODIFY the record's own `uri` field; it does NOT mean carry that path into the link field.
See [status-rules.md](../status-rules.md#record-url-contract). Borrowing another vendor's host here is
exactly the defect closed, and `parseFindingsJson` now refuses it
(`finding_record_url_foreign_host`).

## Where the contract lives

`providers/signa/src/capabilities.js` is the machine-readable capability contract the plan compiler
reads. If this document and that file disagree, the contract wins and this document is the bug.
