# Provider adapter — Clarivate (Compumark Content API)

The Clarivate-specific translation of the universal logic in [../SKILL.md](../SKILL.md): operator
vocabulary, field names, office codes, response shapes, and the capability gaps that must be disclosed
rather than worked around. Active when the deployment environment carries
`CLEAROTRON_DATABASE=clarivate` (one register provider per run — never two).

How a question is asked and how its answer reads on this register (operator vocabulary, filters, crowds, status and
what it cannot do) is in `clarivate-questions.md`.

**Tool names are NEUTRAL.** You call `register_search`, `register_enumerate`, `register_execute_plan`,
`register_propose_supplemental`, `register_record_fetch`, `register_batch_screen`, `register_image_fetch`
— the same names on every provider (see [README.md](README.md)). This file is the *vocabulary behind*
them: what `match_mode: "phonetic"` maps to, which office codes are legal, what the records carry.

> **This file states the adapter's live behaviour.** An earlier version made two
> claims that were WRONG and cost recall: that multi-class needed an N-call fan-out (it does not — it is
> one call), and that `default` was a phrase-EQUALS you had to escape into `contains` (it is now a true
> contains). If you are working from memory of the old doc, discard it.

## Tool surface — 7 of the 8 neutral tools

| Tool | What it does here |
|---|---|
| `register_search` | One `/search` call → the **COMPLETE** matching set. No pagination exists and none is needed. Fails loud past 30 000 hits. |
| `register_enumerate` | The completeness primitive: a one-request `/count` probe **first**, then (if under the ceiling) one `/search`, then screening. Returns `enumerated` or `incomplete` — never a partial list dressed as a clean. |
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

## Records — `register_record_fetch` / `register_batch_screen`

`/text` takes **exactly 100 ids** per call and refuses a longer list; the adapter chunks at 100. Response splits
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

A record whose `statusClass` is `unknown` is never auto-dropped: deep-fetch it.

**`test_mode: true` is dev-only.** Bodies are obfuscated and **not persisted** to the record
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

## Provider-specific behaviour

- `/text` body key is `ids`, not `guids` (`guids:` → 400).
- `/image` body is singular `{ id: <guid> }`; the adapter loops.
- Upstream dates are bare `YYYYMMDD`; the normalizer converts to ISO. `_raw` keeps the original.
- `EXACT_APPLICANT_NAME` exists but is documented as un-combinable with other fields — not wired.
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
