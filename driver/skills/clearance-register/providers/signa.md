# Provider adapter — Signa (signa.so)

Provider-specific tool names + operator vocabulary for the register-search skill when the active register
provider is **Signa**. The universal logic lives in [../SKILL.md](../SKILL.md); only Signa specifics live here.
(Selected by the deployment environment: `CLEAROTRON_DATABASE=signa`. One register provider per
workflow — never both.)

How a question is asked and how its answer reads on this register (operator vocabulary, filters, totals, record fields
and coverage) is in `signa-questions.md`.

## Plugin reference

| Tool | Endpoint | Params |
|---|---|---|
| `register_search` | `POST /v1/trademarks` — raw Layer-1 register search | `query`, one of `strategies[]`/`match`, `nice_classes[]`, `offices[]`, `owner`, `status[]`, `limit` (max 100), `cursor` |
| `register_enumerate` | the same endpoint, paged to exhaustion | as above, plus `in_scope_classes[]` for screening |
| `register_execute_plan` | runs the frozen plan for one axis | `plan_path`, `axis`, `output_path` |
| `register_record_fetch` | `GET /v1/trademarks/{id}` — full detail, NORMALIZED | `record_id` (the `/mark/<office>/<id>` ref from search, or a raw Signa id) |
| `register_propose_supplemental` | Judgment-addition queries: CODE mints, executes and writes the band | `axis`, `output_path`, `proposals[]` |

Auth: `Authorization: Bearer <SIGNA_API_KEY>`. There is **no** batch-screen tool and **no** clearance tool
(`/v1/analysis/clearance` 404s). There is no batch-screen tool here; the search row already carries status and classes.

**Do not page or plan by hand.** `register_enumerate` owns the page loop and returns a completeness state;
`register_execute_plan` runs every dictated entry for an axis. A hand-assembled band is not a band.

## Pagination

Cursor-based, and `register_enumerate` owns it — you never pass a cursor. On raw `register_search` the
response carries `next_cursor`; pass it back as `cursor`. `has_more` flags more results. `limit` is capped
at 100 by the API.

## record_id grammar

`register_search` rows carry a synthetic `record_id = /mark/<office>/<id>` where `<office>` is the record's
**ISO `jurisdiction_code`** (us, eu, ch, wo, …) and `<id>` is the Signa id (e.g. `tm_019d1db7-…`). **Cite
this `record_id` in findings and pass it to `register_record_fetch`** — it is the citation key the driver's
gates verify against.

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
