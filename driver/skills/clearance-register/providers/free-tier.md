# Provider adapter — free tier (EUIPO + USPTO local index)

One register, two offices. Everything you do here is the same as on any other provider: one plan, one
band, one set of `register_*` tools. What differs is the coverage, and the fact that every capability is
the **weaker** of the two sources.

## Read this first: this register covers EU and US, and nothing else

Not "worldwide, thinner". Two offices:

- **EU** — the EU trade mark register: EUTMs and international registrations designating the EU.
- **US** — the USPTO register, from a local index built from the bulk product.

Everything else is a **deferred coverage row you disclose**. A matter naming Germany, Switzerland or
China is not searched here — and the EU register is **not** a substitute for the DPMA. An EU trade mark
covers Germany as a matter of law, but a German national registration is a different right on a
different register, and this source cannot see it.

There is exactly ONE register in this run. If its coverage does not reach a territory the matter needs,
that is a deferred row — never a gap you fill from somewhere else.

## Plugin reference

| tool | note |
|---|---|
| `register_search` | one page, merged across both offices |
| `register_enumerate` | pages a band to completion in **both** offices |
| `register_record_fetch` | routed by the office in the `record_id` |
| `register_batch_screen` | ids split by office, screened, merged |
| `register_image_fetch` | **EU records only** — see below |
| `register_execute_plan` | one `qid` per plan entry, spanning both offices |
| `register_propose_supplemental` | the supplemental lane, as everywhere |

`register_expand_phoneme` does not exist here. Neither source has a phonetic surface.

## Every capability is the WEAKER source's

This is the one thing to internalise, because it is where a wrong assumption costs a wrong answer.

| capability | value | why |
|---|---|---|
| OR-stack width | **25** | the US index's bound, not EUIPO's 50 |
| `phonetic` predicate | **absent** | neither source has one |
| oppositions | **not available** | EUIPO has them; the US index does not |
| native-script index | **undeclared** | EUIPO holds the characters; the US index is unprobed |
| count probe | one billable search | EUIPO's page-0 total is the costlier mode |

A capability one source lacks is not a capability of this register. Planning to the stronger source's
ability would emit a query the other rejects — and the answer would come back looking ordinary.

**Non-Latin terms defer here.** On EUIPO alone you would send the characters. Here you must not: the US
index has never been probed for native-script content, and an undeclared index may neither be searched
as though it held the characters nor silently romanised. State the gap.

## Four things that will cost you a wrong answer

1. **A total of `null` is not a total of `0`.** If either source cannot state how many records it holds,
   this register's total is **unknown**. It is never the sum of the source that did answer — that is a
   real number, smaller than the truth, and nothing downstream can tell it apart from a complete one.

2. **A band is "enumerated" only if BOTH offices were exhausted.** One incomplete source makes the whole
   band an incomplete crowd descriptor naming which source and why. A sweep that exhausted the EU and
   gave up on the US is not a clean US register.

3. **A source failure fails the slice, not half of it.** If one office errors, the slice is incomplete —
   the records already gathered are carried, but the slice is never reported as executed. A clean
   verdict may not rest on a half-searched band.

4. **`register_image_fetch` on a US record refuses, and the refusal is not "no image".** The local index
   holds no image data at all. "This source cannot show you an image" and "this mark has no image" are
   different facts; the tool says which one it means, and you must not report the first as the second.

## record_id grammar

`/mark/<office>/<id>` — `/mark/eu/018922211`, `/mark/us/86272665`. The office in the id is what routes a
fetch, so a record can never be pulled from the wrong source.

## Madrid: one base, two rights — never merged

A single WIPO international registration can appear here twice: as an EU designation and as a US §66(a)
extension. **Those are two rights and a clearance shows both.** Under the Madrid Protocol each
designation confers, in its own Contracting Party, protection equivalent to a national registration —
examined there, refusable there, opposable there, and independent of the basic mark after five years.

Do not treat them as duplicates of one another, and do not merge them into one position. They are not a
de-duplication case; they are two territories.

## Coverage and citations

Disclose the tier's shape plainly: this register reached the EU and US registers, and every other
territory in the matter is a deferred row. Never imply the sweep was worldwide.

Citations carry each record's own office. There is no single public origin for this register — the two
offices publish separately — so a link is built per record, never from a provider-wide prefix.

## Cost

One clearance costs both sources. EUIPO's count probe is a billable search against its daily request
allowance; the US index is a local file and costs only wall time. Where a count is available it spans
both offices and is reported as one number — or as `null` when one of them could not answer.

## Provenance

**Derived, not probed.** This adapter runs no transport of its own: every wire fact belongs to
`providers/euipo/src/capabilities.js` and `providers/uspto-local/src/capabilities.js`, both of which
carry their own probe evidence, and this contract is **computed** from them pointwise-weakest at module
load. Nothing here is hand-copied, so it cannot fall behind its members — the derivation is pinned by
`providers/free-tier/test/composite.test.mjs`.

What IS this adapter's own, and is tested rather than inherited:

- the routing (office → source, from the record id and from `regions[]`)
- the merge arithmetic — totals, `has_more`, band state, and the refusals above
- the requirement that **both** members be configured, enforced at preflight by name

**Not yet exercised end to end.** No complete matter has run through this register. Both members' seams
are verified — EUIPO live against production — but the local US index needs a built index, which needs a
USPTO API key. Until that exists, a free-tier run refuses at preflight naming `USPTO_LOCAL_DB`, and that
refusal is the correct behaviour rather than a half-tier sweep.

## Record base host

**Two, because this is two registers.** A record from the EU member carries the EUIPO host
(`https://euipo.europa.eu`); a record from the US member carries TSDR (`https://tsdr.uspto.gov`). There is
no single free-tier host and `driver.config.mjs` deliberately holds `publicRecordOrigin: null` here.

Compose each record's URL from **the host of the office that record came from**, per
[status-rules.md](../status-rules.md#record-url-contract) and the member's own doc — [euipo.md](euipo.md),
[uspto-local.md](uspto-local.md). Never stamp one office's host onto the other's record: on a two-office
register that is not a cosmetic slip, it is a citation pointing at a register that does not hold the mark.

The gate resolves a composite through its members (`recordOriginsFor` in `record-origins.mjs`), so both
hosts are legitimate here and a third is refused.
