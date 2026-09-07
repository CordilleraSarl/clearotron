# Status rules — status classification, Madrid handling, non-Latin status strings

Cross-referenced from [prelim-register/SKILL.md](SKILL.md) — the canonical entry point. The provider files and stealth-filer indicators link here for the status-classification rules; the orchestrator never reads this file directly.

> **Funnel vs judgment (read this first).** Under the two-layer split, the **funnel (Layer A) does NOT drop
> records on status** — `register_enumerate` carries **every** record forward (live AND dead) **with its
> normalised status + dates**. This file is the **classification reference**: it says how to read a raw status
> string into live / dead / ambiguous and how to normalise non-Latin / Madrid statuses — all **mechanical reads
> off the record**, which the funnel keeps. Where this file historically said "drop dead" / "keep only if
> identical" / "keep within a ~5y window", that **keep/drop is now JUDGMENT's call (Layer B)**: the funnel
> surfaces the status + lapse date, and the lawyer decides whether a dead or recently-dead record matters
> (revival window, common-law rights, non-use vulnerability). The funnel applies **no status filter and no
> date cutoff.**

## Contents

- [Live-status classification](#live-status-classification)
- [Age-based staleness heuristic](#age-based-staleness-heuristic)
- [Dead-but-identical and recently-dead — a status surfaced to judgment](#dead-but-identical-and-recently-dead--a-status-surfaced-to-judgment-no-funnel-filter)
- [Chinese status strings](#chinese-status-strings)
- [Madrid Protocol designations](#madrid-protocol-designations)
- [Owner-extraction fallback chain](#owner-extraction-fallback-chain)
- [Status enum reference (full observed list)](#status-enum-reference-full-observed-list)
- [What we don't normalise](#what-we-dont-normalise)
- [Open question for the reviewing lawyer](#open-question-for-the-reviewing-lawyer)

## Live-status classification

Classify each record's `corsearchStatusCode` (or `corsearchEstimatedStatusCode` / `markCurrentStatusCode`
fallback) into **live / dead / ambiguous** — a **mechanical read off the record** that rides forward as the
record's `status`. **This is a label, not a funnel filter:** the funnel carries live, dead, and ambiguous
records alike (judgment weighs dead/recently-dead — see the note at the top of this file). `register_enumerate`
batch-screens this `status` for you; the classification here is the reference for reading it (and for the
ambiguous / non-Latin cases the screen flags).

### Live

| Status value | Meaning |
|---|---|
| `Registered` | Registered, active |
| `Valid` | Active (provider-specific synonym for Registered) |
| `Pending` | Pre-decision applications |
| `Application pending` | Provider variant |
| `Application published` | In opposition period — still LIVE |
| `Registration published` | Provider variant |
| `Live` | Provider variant |
| `Published` | Provider variant |
| `GracePeriod` | Post-expiry grace period — typically still enforceable |
| `Renewed` | Recently renewed |
| `Application accepted` | USPTO post-examination, pre-publication |
| `Notice of Allowance` | USPTO allowed but not yet registered |
| `Allowed` | Provider-specific synonym for Notice of Allowance |
| `Suspended` | Application suspended — still live (opposition / co-pending issues) |

### Dead (a status label — NOT a funnel drop; judgment decides if it matters)

| Status value | Meaning |
|---|---|
| `Expired` | Past expiry, no renewal |
| `Invalid` | Cancelled by office |
| `Application abandoned` | Applicant gave up |
| `Application withdrawn` | Applicant pulled the application |
| `Application refused` | Office refused registration |
| `Registration cancelled` | Post-registration cancellation |
| `Cancelled` | Provider variant |
| `Refused` | Provider variant |
| `Archived` | Provider variant (often indicates dead) |
| `Lapsed` | Provider variant |

### Ambiguous (flag for review)

- Anything not in either list above
- Anything in a non-Latin script the dictionary below doesn't cover
- Anything with conflicting status fields (e.g., `corsearchStatusCode: Expired` but `onomaticsJurisdictionsStatuses` shows `{"jp": "Valid"}`)

## Age-based staleness heuristic

Even if a status string is in the Live keep-list, flag a record for reviewer verification when its date pattern is suspicious:

- **`Application published` older than 10 years** — highly likely procedurally stale. South African and other registries occasionally leave applications in published state indefinitely. Non-use revocation often available. (Worked example: `/mark/za/1996-03757` and `/mark/za/1996-03758` are both "Application published" since 1996 — 30 years. The keep-list says live, but real enforcement risk is near-zero.)
- **`Pending` / `Application pending` older than 5 years** — unusual; verify.
- **`Application accepted` older than 3 years** — prolonged pre-publication state; check whether oppositions are pending.

These are flag-for-review heuristics, not auto-drop rules. The record stays in findings; the `Verify? ✅` column gets ticked.

## Dead-but-identical and recently-dead — a STATUS surfaced to judgment (no funnel filter)

> "For an identical Mark, I'll never ignore it because they could be using it. They could have rights without a registration." — reviewer walkthrough

The funnel carries **every** dead record forward with its status and dates; **whether a dead record matters is
JUDGMENT's call (Layer B)**, not a funnel keep/drop. This section is the **reference for the reads judgment
makes** — it no longer instructs the funnel to drop anything.

- **Dead-but-identical** — a record with a **dead status** whose mark text is an **identical match** to the
  input (case-insensitive, ignoring punctuation — the reference algorithm below). The reviewing lawyer never ignores an
  identical mark even when dead (possible common-law rights / re-file). The funnel surfaces it with its status;
  judgment flags it `dead-but-identical (possible common-law rights)`. The funnel does **not** need a
  class-agnostic re-search pass for this — `register_enumerate` already carries dead records in the named band
  with their status, so the identical-dead record is present for judgment to read. (`register_enumerate` is
  not active-only-filtered; there is no separate "dead-but-identical dual sweep" for the funnel to run.)
- **Recently-dead near-exact (the old "D4")** — a dead record in the dangerous near-exact-in-filed-class band
  whose lapse is *recent*. A recently-dead near-identical can still bite (revival / grace window, retained
  common-law rights, re-file). **The funnel applies NO date cutoff** — it carries the dead record forward with
  its **`markCurrentStatusDate`** (the lapse date), and **judgment decides** whether the recency/revival window
  makes it material. There is no ~5y funnel drop any more: surfacing the lapse date to the lawyer replaces the
  funnel-side date threshold (which was a funnel judgment the mandate relocates to Layer B). Judgment may flag a
  material recently-dead record `recently_dead` + `Verify? ✅`; the funnel just passes the fact.

The funnel does **not** drop older-dead records either — volume is handled by the completeness contract
(`register_enumerate` returns the dead-inclusive named slice `enumerated` if bounded, or `incomplete` if a
crowd — see `unit.md` step 6), not by a date filter. The lawyer reads the dead band with its dates and weighs it.

**Identical match test (reference algorithm — judgment uses this to flag dead-but-identical):**

```javascript
function isIdenticalMatch(markText, inputMark) {
  if (!markText) return false;
  const normalize = (s) =>
    s
      .toUpperCase()              // case-insensitive
      .replace(/[.:;,]+/g, " ")   // strip period, colon, semicolon, comma
      .replace(/\s+/g, " ")       // collapse whitespace
      .trim();                    // strip leading/trailing whitespace (AFTER collapse)
  return normalize(markText) === normalize(inputMark);
}
```

The order matters. Specifically:
1. `.trim()` MUST run AFTER `.replace(/\s+/g, " ")` — otherwise replacement of punctuation with spaces leaves trailing whitespace that survives the trim. ("LEVEL UP TOGETHER." → "LEVEL UP TOGETHER " trailing-space → fails to match "LEVEL UP TOGETHER".)
2. Apostrophes (`'`), hyphens (`-`), parentheses (`()`), and ampersand (`&`) are NOT stripped — they are part of the mark. "It's Your Play" and "In Your Play" are different marks.
3. Stylization (font, color, case in display) is irrelevant — case-insensitive equality is the rule.

**Reference test fixtures:**

| markText | inputMark | Expected |
|---|---|---|
| `"LEVEL UP TOGETHER"` | `"Level up together"` | true |
| `"LEVEL UP TOGETHER."` | `"Level up together"` | true |
| `"Level Up Together"` | `"Level up together"` | true |
| `"LEVEL UP TOGETHER,"` | `"Level up together"` | true |
| `"LEVEL UP THE GAME"` | `"Level up together"` | false |
| `"LEVEL UP GAMING"` | `"Level up together"` | false |
| `"PLAYVERSE LEVEL UP GAMING"` | `"Level up together"` | false |
| `"It's Your Play"` | `"In Your Play"` | false (apostrophe matters) |

These fixtures should be encoded in test cases for any agent or analyzer implementing the rule. Worked example for the "Dawn: Legends of Lumengarde" matter: "Dawn: Legends of Lumengarde" ≡ "DAWN LEGENDS OF LUMENGARDE" ≡ "dawn legends of lumengarde" — all identical. "Dawn of Lumengarde" or "Dawn: Legends" — NOT identical.

## Chinese status strings

Many CN provider records use Chinese-language status strings. These need normalisation. Two paths:

### Path A — Trust provider translation (verify what it covers)

If the provider exposes a translation flag on its record-fetch tool (e.g., `translate=true` on `<provider>_record_fetch`), trust it for the fields it covers. Each [providers/<name>.md](providers/) documents whether the flag exists and what fields it translates.

**For Corsearch**, `translate=true` translates some fields (notably `listOfGoodsAndServices` text in CN/JP records) but does **NOT** translate `corsearchStatusCode` strings — so status must be read from the code, never the translated text.

**Conclusion:** Path A is useful for goods-and-services translation but NOT for status normalisation. The Path B substring dictionary below is MANDATORY for CN status strings regardless of `translate=true`.

For other providers (Clarivate, Signa): check provider-specific docs in `providers/<name>.md` for translation behaviour.

### Path B — Substring dictionary

Normalise based on substring matches in the raw Chinese status. Order matters — earlier matches take precedence:

| Substring | Maps to | Notes |
|---|---|---|
| `驳回` | Application refused (DEAD) | Rejection notice |
| `撤回` | Application withdrawn (DEAD) | Withdrawn |
| `撤销` | Registration cancelled (DEAD) | Revoked / cancelled |
| `无效` | Invalid (DEAD) | Declared invalid |
| `失效` | Expired (DEAD) | Lapsed |
| `异议` | (review case-by-case) | Opposition pending — could be live |
| `续展` | Renewed (LIVE) | Especially when paired with 核准 |
| `核准` | Approved (LIVE) | When paired with 注册/续展 |
| `注册` | Registered (LIVE) | Registration successful |
| `初审公告` | Application published (LIVE) | Publication for opposition |

If multiple substrings match, dead-status substrings take precedence over live-status (conservative — better to flag a live record for manual review than to wrongly include a dead one in the deliverable).

Records with ambiguous Chinese statuses go into the "Ambiguous (flag for review)" bucket.

## Madrid Protocol designations

Marks registered through the Madrid Protocol (URIs like `/mark/int/<number>`) cover multiple designated jurisdictions. The detail record's `onomaticsJurisdictionsStatuses` field is a map from country code to status:

```
"onomaticsJurisdictionsStatuses": {
  "gb": "Valid",
  "ru": "Valid",
  "jp": "ApplicationRefused"
}
```

### Aggregation rule

A Madrid record gets ONE row in the findings file (not one row per designated country). The row includes:
- URI = `/mark/int/<number>`
- Country column = "INT (Madrid)"
- Notes column = "Designations: GB, RU. Refused: JP." — summarise the jurisdictions map

If the request scope is `worldwide`, include the Madrid record if ANY designation is live. If the scope is region-restricted, include only if a designation overlaps with the target region.

### Status field for Madrid records

For the row's `Status` column, use:
- The international registration's `corsearchStatusCode` (the registration status of the IR itself, separate from designations)
- If unclear, default to "Madrid IR: mixed designations" and surface details in the Notes column

## Owner-extraction fallback chain

The owner field is provider-specific and inconsistently populated. Per a stratified sample (n=29), only ~7% of records had `owners[0].organizationName` populated; the rest used `onomaticsName` or denormalised top-level fields.

Apply this fallback chain in order:

1. `owners[0].organizationName` — preferred (typical for EU records)
2. `owners[0].onomaticsName` — fallback (typical for non-EU records)
3. `onomaticsOwner` — top-level denormalised string
4. `owners[0].freeFormatNameLine` — last resort, may be raw unparsed text

For owner country:
1. `owners[0].addressCountry`
2. `owners[0].applicantIncorporationCountryCode`
3. `owners[0].applicantNationalityCode`
4. Default to country derived from URI prefix (`/mark/<country>/...`)

If after the full fallback chain the owner is still empty, set owner column to `(unknown — confirm)` and add to Open verification flags.

**Owner-identity conflict.** If two fields in the chain (or an EUIPO cross-check vs the vendor record) yield *materially different* owner names for the same URI, do NOT silently pick the first — record both candidate names in the owner field and set `Verify? ✅` with reason "owner-identity conflict — confirm before enforcement read." Likewise, when a portfolio-size signal (many filings clustering under one normalised owner) would change the enforcement-appetite read, surface it. Owner identity drives enforcer-profiling (`prelim-search/firm-wide-reasoning.md`, *Enforcer profiling*) — a wrong owner is a wrong risk read.

### USPTO extended country codes

USPTO records sometimes use country codes beyond ISO-3166:

| Code | Meaning |
|---|---|
| `USAM` | US + Military / APO / FPO address |
| `USAP` | US + Pacific territories |
| `USFD` | US + Federal address |
| `PRUS` | Puerto Rico (USPTO context) |

Normalise these to `US` for the Findings sheet's "Owner Country" column (add a note in Key Factors if relevant). Preserve the original code in the audit trail.

## Status enum reference (full observed list)

Empirically observed across the n=29 stratified sample and earlier probe rounds:

**Live (10 values):** Registered, Valid, Pending, Application pending, Application published, Registration published, Live, Published, GracePeriod, Renewed

**Dead (10 values):** Expired, Invalid, Application abandoned, Application withdrawn, Application refused, Registration cancelled, Cancelled, Refused, Archived, Lapsed

**Ambiguous (3 patterns):** Chinese strings (handled per dictionary above); records with conflicting status fields; records with provider-specific edge values not in either list

This list is NOT exhaustive — providers evolve their enum values. Treat any unknown status as ambiguous and flag for review.

## What we don't normalise

- **Goods-and-services text** — kept verbatim; not normalised, not translated unless provider supports it
- **Owner addresses** — kept verbatim for opposition-history captures; not normalised
- **Mark feature** (Figurative vs Verbal) — kept as-is
- **Provider-specific URIs** — kept as-is (these are the canonical record identifiers)

### Record-URL contract

The `uri` (a `/mark/<cc>/<number>` path = the Corsearch `record_id`) is the canonical record identity, but it
is a **relative path fragment** with no base address — it is **not clickable as-is**, and nothing downstream
composes it (the driver's `audit-from-spine.mjs` / `xlsx.mjs` / `render.mjs` pass the URL value through
verbatim; the delivery contract renders source chips with a placeholder `(#)` href). So:

- The **full clickable record URL** = **the active provider's record base host** + the `uri` path. The host
  is a provider fact and it lives in that provider's own doc: **`providers/<name>.md`, "Record base host"**.
  Read it there for the register you are actually searching. This file is loaded on every register run
  whatever the provider, so it states the CONTRACT and never a host.
- **Do NOT invent a new field** — compose the URL from `uri`. There is exactly one URL per record.
- The record-findings **URL column carries the COMPOSED full URL** (that provider's base host + `uri`), so
  the driver's verbatim pass-through renders a working link. Every downstream surface (Excel,
  narrative/report) MUST compose the **same** URL from the same `uri` — no per-surface link sets, no drift.
- **If the provider doc says it publishes no per-record page, compose nothing.** Leave the `uri` as it is
  and cite the office register in the text. A link to a register this run did not search is worse than no
  link: it is a dead link wearing a citation's clothes.
  - **THE FIELD AND THE VALUE, because "compose nothing" does not name either:**
    **`source.resolved_link` is `""`** — the empty string. NOT the `uri`, not a fragment, not another vendor's host. "Leave the `uri` as it is" means do not MODIFY the record's own `uri` field; it does NOT mean carry that path into the link field.
    Carrying `/mark/<cc>/<number>` into `resolved_link` is the reading that costs a whole synthesis
    attempt: the validator refuses it (`finding_record_url_not_a_link`) and the refusal is the only
    place this value was ever written down.

> **The host is NOT optional and NOT guessable.** `trademark.example.com` is the clearance-**page** pool
> URL, not a provider record host — do not reuse it here. Neither is another vendor's host: this rule read
> `https://tm.corsearch.com` for every provider, so a clarivate or signa run composed Corsearch
> links to records Corsearch was never asked about.
>
> **This is gated.** `parseFindingsJson` refuses a finding whose `registration.uri` or register
> `source.resolved_link` names a host the active provider does not declare
> (`finding_record_url_foreign_host`), and the reason names the host it wanted.

## Open question for the reviewing lawyer

Confirm during historical-case review:
- Is the invalid-but-keep-if-identical threshold right? Should it extend to "near-identical" (one-letter diff)?
- For Chinese statuses, do you want `translate=true` always (slower but cleaner) or only when ambiguous (faster but more flagging)?
- Are there Madrid-designation edge cases the aggregation rule misses?
