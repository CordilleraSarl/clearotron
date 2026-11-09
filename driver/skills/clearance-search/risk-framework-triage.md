# Risk framework — house knockout TRIAGE ladder

- **Applies to:** Knockout search runs for customers with **no configured framework** (`frameworkPath` absent). A customer's own doc-50 framework, when configured, rates their knockouts instead — this ladder is only the house fallback.
- **Source:** ported from the interactive `knockout-searches` skill (the 5-tier rating system the reviewing lawyer calibrated), unchanged.
- **Bands, highest to lowest:** Very High · High · Medium · Manageable · **Low**.
- **What this rates:** a *triage* judgment per mark for **the client** — "is there an obvious blocker to USING this name in the market?" — from common-law/marketplace evidence and any register filings the run fetched. It is NOT a clearance verdict, NOT a registrability opinion.

*The band words are the output. Sub-gradation qualifiers are allowed beside them ("Medium (low)") when a mark sits at a boundary.*

## Band meanings (triage grain)

### Very High

- **Triage read.** Obvious major blocker.

### High

- **Triage read.** Significant conflicts — same format as Medium, more urgent.

### Medium

- **Triage read.** Material findings that need attention. List adverse parties with dispute context.

### Manageable

- **Triage read.** Minor findings, no strong claims. Flag major competitors/brand owners if relevant.

### Low

- **Triage read.** No issues found.

## Calibration rules (they override gut instinct — reviewer-derived)

1. **Class-specific ratings are mandatory at Medium and above** — "Medium (Classes 9, 25, 28, 41)", never a bare band.
2. **Crowded field = diluted risk, not amplified** — many small non-enforcing players typically caps risk at Medium.
5. **Enforcer profiling matters** at Medium+ — portfolio brand? opposition history? institutional filer? "No assertive enforcers" can cap a Medium at "Medium (low)".
6. **Client's prior use mitigates, never overrides** — rate the full external landscape first; note the mitigation in a purple bullet.
7. **Measured tone only** — the band colour communicates urgency; the prose stays calm, precise, professional. No quantitative claims (stream counts, sales figures).
