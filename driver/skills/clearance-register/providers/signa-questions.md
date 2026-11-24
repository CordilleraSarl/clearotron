# Signa — asking the register and reading its answers

Use this guide to interpret the supplied filings and propose follow-up register questions.

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

## Coverage — Signa's live office set (15) + the disclosure rule

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
| Spain OEPM | `es` | ES |
| Mexico IMPI | `mx` | MX |
| Brazil INPI | `br` | BR |
| Italy UIBM | `it` | IT |

**Each of the fifteen is searched as a TERRITORY, not as one register.** The adapter sends
`filters.jurisdictions` + `territory_match: "protection"` — every right with effect there, whatever
register it sits on — rather than `filters.offices`, which searches the national register alone. The
difference is not a margin. On the same term:

| request | national | regional | madrid |
|---|---|---|---|
| `filters.offices: ["inpi-fr"]` | yes | **none** | **none** |
| `filters.jurisdictions: ["FR"]`, protection | yes | yes | yes |

**So an EU trade mark that blocks use in France is now found**, and it never appears in the French
register. Every covered territory reaches its Madrid layer this way and the EU members additionally reach
the EU register; Switzerland, under no regional register, returns regional 0 either way and its Madrid
layer arrives all the same. It is ONE call, not three.

Do not describe a covered territory's result as "the national register": it is the stack of rights in
force there, and a finding may sit on any layer of it.

**NOT covered: China (CNIPA), Germany, Japan, Korea, Benelux, and other nationals.** The territory
expansion above does not change this and must not be read as widening it: `SIGNA_OFFICE_KEYS` maps only
these fifteen, an unmapped region abandons the translation, and a territory the vendor does not index is
not reachable by asking the question a different way. A Madrid designation of Germany is found only when
Germany is the territory searched, and it cannot be. For any matter jurisdiction outside this set, give
that slice a `deferred` coverage-form row (the register sweep **cannot reach** it on Signa) — disclose
it; no search on this register can close it, so it is not escalated, and it is never clean. This follows
the keystone doctrine in `../SKILL.md` → *Coverage ledger*: a could-not-reach gap is **`deferred`**,
open and disclosed, never `coverage-limited` (a searched-but-unexhausted DATA limit a re-run cannot close).
