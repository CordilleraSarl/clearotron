# Provider adapter — EUIPO (EU trade mark search API)

This file is the EUIPO-specific translation of the universal logic in `../SKILL.md`. Operator
vocabulary, field names, tool references, and the quirks that will otherwise cost you a wrong answer.

**EUIPO is a single-office register.** It holds EU trade marks and international registrations
designating the EU, and nothing else. A German DPMA filing, a French INPI filing, a UK one — all of
them are different registers this source does not hold. Every non-EU territory in the matter becomes a
**deferred coverage row**, disclosed on the face of the report. That is the deliberate trade of running
the free tier, not a fault to work around.

## Plugin reference

The skill calls these 7 tools. THE TOOL NAMES ARE PROVIDER-AGNOSTIC — one register, and the adapter
behind it is deployment configuration, so a skill never names a vendor in a tool call:

| Tool | Purpose | Key params |
|---|---|---|
| `register_search` | Register search | `name`, `names[]`, `match_mode`, `owner`, `nice_classes[]`, `nice_classes_mode`, `status[]`, `mark_feature[]`, `regions[]`, `size`, `page` |
| `register_enumerate` | Enumerate a named band to completion | the same query fields + `in_scope_classes[]` |
| `register_record_fetch` | Full detail record | `record_id`, `language` |
| `register_batch_screen` | Screen many candidates in ONE call | `uris[]`, `in_scope_classes[]` |
| `register_image_fetch` | Figurative-element metadata | `record_id` |
| `register_execute_plan` | Run the frozen plan for one axis | `plan_path`, `axis`, `output_path` |
| `register_propose_supplemental` | Judgment-addition queries | `axis`, `output_path`, `proposals[]` |

**`register_expand_phoneme` is ABSENT**, and so is phonetic search itself. There is no sound-alike
operator here: `=phonetic=`, `=fuzzy=` and RSQL's own `~=` all return HTTP 400. A phonetic slice is
stamped `unsupported` at plan time and disclosed as a deferred row. It is never answered by a contains.

Plugin source: `providers/euipo/src/core.js`. Capability contract: `providers/euipo/src/capabilities.js`.

Auth: `EUIPO_CLIENT_ID` + `EUIPO_CLIENT_SECRET` (OAuth2 client-credentials), plus `EUIPO_ENVIRONMENT`.
Never logged, never committed.

## `EUIPO_ENVIRONMENT` is not a preference

`sandbox` and `production` are **separate deployments holding different corpora**. A sandbox result is
not a thinner production result — it is a different register. `register_search` stamps `environment` on
every response for exactly this reason, and the DRIVER carries that word onto every receipt in
`_driver/receipts.json` — so the run's own machine record answers which corpus replied, and no reader
mistakes a test-environment answer for a live one. **Never tag it in the findings**: the source
tag is `EUIPO` and nothing more. An unknown value is refused rather than defaulted.

## Operator vocabulary

The query language is **RSQL** over `GET /trademarks`, with the whole expression in the query string.

| Match mode | Renders as | Notes |
|---|---|---|
| `exact` | `verbalElement=="TERM"` | full-string match |
| `default` | `verbalElement=="*TERM*"` | unanchored contains — the plan's default |
| `starts_with` | `verbalElement=="TERM*"` | |
| `ends_with` | `verbalElement=="*TERM"` | **native.** A leading wildcard matches here, which most registers cannot do — no reversed index, no verification pass, no gap |
| `owner` | `applicants.name=="*TERM*"` | always a contains; an exact match against a client's spelling of a company answers 0 with no error |

An internal wildcard (`NI*E`) is native and is passed through. Nice classes are one clause
(`niceClasses=in=(9,42)`), never a fan-out. Owner and mark-text clauses AND-compose, so the owner×term
intersection runs in **one call**.

## Four things that will cost you a wrong answer

**1. `and` binds tighter than `or`.** `A or B and niceClasses=in=(9,42)` returns 109 hits;
`(A or B) and niceClasses=in=(9,42)` returns 47. An unparenthesised OR-stack is a **different, wider
query that answers HTTP 200 with plausible rows**. The plugin parenthesises every group; if you ever
hand-write RSQL through the `rsql` escape hatch, do the same.

**2. `size` has a floor of 10.** Below it *every* request 400s, whatever the query — which reads
exactly like "the query is unsupported" — so a 400 here is ambiguous by construction. Keep a
known-good control query in any manual work and check it first, or you will read a floor violation as
an unsupported predicate.

**3. Two of the eighteen status tokens cannot be filtered on.** `APPEALABLE` and `ACCEPTANCE_PENDING`
return HTTP 400, and one bad token 400s the **whole** query. They can still come back *on* a row, and
the classifier knows them. The plugin drops an unqueryable token from the filter and names it.

**4. Proceedings live only on the detail record.** `oppositions[]`, `cancellations[]`, `appeals[]` and
`decisions[]` appear only on `register_record_fetch`, and are **omitted when empty**. So:

- on a **fetched record**, an empty list means *none are recorded* — a real answer, and this
  provider's edge over both paid vendors, which cannot answer the question at all;
- on a **search row**, the absence means *nothing whatsoever*. Never report it.

## Status vocabulary — what gets dropped, and what does not

DEAD is five terminal acts, and nothing else: `WITHDRAWN`, `REFUSED`, `CANCELLED`, `SURRENDERED`,
`REMOVED_FROM_REGISTER`.

Everything pending or contested is **LIVE** — including `OPPOSITION_PENDING` and
`CANCELLATION_PENDING` (the mark is on the register and enforceable *right now*; an action against it
is somebody else's problem, not evidence the right is gone) and `APPEALED` / `APPEALABLE` (a decision
whose outcome is undetermined is not a dead right).

**`EXPIRED` is neither.** EUTMR Art. 53(3) gives a six-month grace period in which renewal restores the
right *retroactively*, and EUIPO has no separate grace status. So it screens as `deepfetch:ambiguous` —
fetched and looked at, never batch-dropped. If you see a lot of them, that is the design working.

## Coverage and citations

`record_id` is `/mark/eu/<applicationNumber>` — 9 digits, or `W` + 8 digits for an IR designation.
Every record has a public page at `https://euipo.europa.eu/eSearch/#details/trademarks/<n>`, so a
finding can cite an address the reader can open.

**A `W`-numbered record is one territorial leg of an international registration**, and the EU leg is a
right in its own right. It is never merged with the same IR's designation in another territory: those
are two rights in two territories.

## Cost

Free to query, but not free of limits: a daily request allowance (25,000 on the subscription tier this adapter targets).
`register_batch_screen` resolves a whole candidate list in one call, and screening off the search row
costs nothing extra — the row already carries status, classes and applicants.

## Record base host

`https://euipo.europa.eu`

The composition rule is in [status-rules.md](../status-rules.md#record-url-contract): the full clickable
record URL is this host + the record's `uri` path. Example: the EUIPO public record page for the record's own id.

This host is a fact about THIS provider and it belongs here, not in `status-rules.md` — that file is
loaded on every register run whatever the provider, and it carried one vendor's host as the rule for all
of them. `parseFindingsJson` now refuses a record URL whose host is not the one the active
provider declares, so composing another register's host is a stage refusal, not a silent dead link.
