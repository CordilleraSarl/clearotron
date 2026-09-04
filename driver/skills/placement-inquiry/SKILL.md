---
name: placement-inquiry
description: Per-candidate structured inquiry that consumes matter-context.md and the COMPLETE NAMED BAND (read through the band tools — band_shape / band_lookup / band_record over the funnel's full enumerated records + crowd descriptors), and produces placement recommendations for each register or common-law finding before tiering. Produces placement-recommendations.md naming each candidate's placement (headline-candidate / sheet-2 / watchlist-annex / out-of-scope-filtered) with written reasoning per the inquiry framework, PLUS the structured mirror placements.json (one {mark, owner, jurisdiction, records, tier, reason} entry per candidate, plus the optional borderline declaration — the reason is the stated reasoning downstream argues with), PLUS a per-crowd-descriptor materiality call (cleared / material-gap → CONDITIONAL) that feeds the synthesis coverage_judgment contract. Catches commercial-relevance failures before rating logic runs, so candidates with class-match but no customer overlap get placed correctly rather than mechanically tiered. Invoke after register-unit and common-law workers return, before the digest worker spawns.
---

## Purpose

You are doing what a senior trademark lawyer does between collecting findings and tiering risk: applying commercial-relevance judgment to each candidate, deciding where it belongs in the deliverable structure, and writing the reasoning down so a human can audit or disagree.

This is structured inquiry per candidate. Not classification by rule. Not numeric rating. Placement with written reasoning.

## Two layers — you are JUDGMENT, the funnel is the machine

You read the **complete named band** the funnel handed up; the funnel decided *nothing* about relevance, sufficiency, or materiality. That is your job, and it now runs over **everything that was found**, not a pre-pruned digest. The hard boundary cuts both ways:

- **The funnel never self-accepted a search as "good enough."** Every search it ran resolved to exactly one of two states: `enumerated` (paged to completion — every named record is in front of you) or `incomplete` (a crowd / unreachable slice it could not exhaust — handed to you as a **descriptor**: count + sample + reason, never a clean negative). There is no third "coverage-limited and move on" state anywhere upstream.
- **So sufficiency is now yours alone.** You decide whether you have seen enough of the dangerous category to sign. The funnel never self-accepted a `coverage-limited` clean and you must never re-invent one. An incomplete search you deem material is a **material gap** you name specifically — the run ships **CONDITIONAL** with that gap as an explicit open item, never a clean with fine print.
- **Do not push relevance or sufficiency back into the funnel.** The unit hands you the complete band; you judge it. You never tell it to sample, narrow-for-tractability, or top-N.

## When invoked

After register-unit workers and common-law workers have returned their findings (Phase 2 Step 2B end), BEFORE the digest worker (`prelim-register` MODE B) spawns to tier candidates. One Opus call (inline by the orchestrator), reads matter-context.md + the complete named band (through the band tools) + the common-law findings.

## Model

Inherits the orchestrator's tier when invoked inline. No `sessions_spawn` — this is a templated reasoning step the orchestrator performs itself between Step 2B end and the digest spawn.

## Inputs you receive

- `matter-context.md` from `matter-frame` at `studio/prelim-search/<slug>/<date>/matter-context.md` (the strategic foundation — read it once, reference it throughout)
- **The complete named band** — read through the **band tools** (every call lands in the run's reading audit; never slice band files with shell). `band_shape` first: the deterministic shape of the complete merged band — totals, mechanical similarity tiers, **THE FLOORS** (every live in-class identical/near-identical record, listed individually and unconditionally — **every floor row must come back on your form, by record id.** Either you place it, or you select it with `tier: "out-of-scope-filtered"` and one line in `reason` saying why it is not a candidate. Discussing a floor in your prose is NOT accounting for it: the row is what the driver can check, and a floor you leave off the form is recorded as unanswered whatever the prose says. This is the one duty with no cap — see **Length target**, which bounds the general band and not this), census, owner concentrations, crowd descriptors, blind spots. A floors-heavy shape is served in PARTS (the response labels itself part N/M and names the next call) — read every part; a partial shape is never the shape. Then `band_lookup` / `band_record` for the records your inquiry needs. This is the funnel's real output, lifted across the firewall:
  - **enumerated records** — every named record the funnel paged to completion, each carrying `record_id, mark_text, classes, status, owner_name, owner_country, application_date, registration_date, expiry_date, jurisdictions, screen_verdict` (+ `_query` provenance). Apply the relevance / off-field gate over **this complete set** (work through the shape's totals slice by slice) — nothing was pre-sampled, so your gate is the *only* gate.
  - **`incomplete` crowd descriptors** — a query the funnel could NOT enumerate (genuinely too large, provider cap, budget): `query, total_hits, fetched, reason`. These are NOT findings and NOT clean negatives — they are signals you must rule on (cleared / material-gap; see "Crowd-descriptor materiality" below). They ride along on matching lookups too, so a counted-only zone can never read as a clean.
  - The unit's compact prose digest (`register-units/<axis>.md`) still exists for the audit trail; the **band is the material you judge.** Where they disagree, the band wins — it is the complete record, the prose is a summary.
- The common-law-findings file at `studio/prelim-search/<slug>/<date>/common-law-findings.md` (common-law candidate inventory)
- Any prior `placement-recommendations.md` from earlier rounds (for re-runs after a skeptic-flagged re-spawn)

## Output

TWO files.

**1. The markdown file** `studio/prelim-search/<slug>/<date>/placement-recommendations.md`. Use these section headings, in this order: **Band reconciliation** (the expectation-vs-band check), the four placement tiers (**Headline candidates**, **Sheet 2 / register watch**, **Watchlist annex**, **Out-of-scope / filtered**), **Disagreements / flags surfaced to downstream**, **Coverage rulings & open questions** (the per-crowd-descriptor cleared/material-gap rulings that feed synthesis `coverage_judgment`), and **Open questions for the client / reviewer** (genuine open judgment that ships).

**2. The structured mirror** `studio/prelim-search/<slug>/<date>/placements.json` — the four tier sections as data: `{"schema_version":1,"placements":[...]}`, ONE object per placed candidate, keys EXACTLY `{"mark","owner","jurisdiction","records","tier","reason"}` plus the optional `"borderline"`:

- `mark` / `owner` — verbatim as in your md entry (downstream joins on mark + owner + jurisdiction)
- `jurisdiction` — the office/territory; `""` where none applies
- `records` — the record URIs your entry cites; `[]` for a common-law candidate
- `tier` — EXACTLY one of `headline-candidate` / `sheet-2` / `watchlist-annex` / `out-of-scope-filtered`
- `reason` — **the load-bearing field**: a SHORT PARAGRAPH carrying your STATED reasoning for the tier — the candidate characterisation (what the owner actually does, the customer/channel overlap read), the decisive placement ground, and any Stage-2 mitigant flag. On a headline-candidate or sheet-2 entry it carries your answer to the promotion question. It must be substantial enough that a downstream stage can quote it and argue with it (the digest corrects a placement by contradicting its reason, and keeps a tier by reusing it). NEVER a bare label, NEVER the full 7-point inquiry trace.
- `borderline` — the ONE optional key: `true` when your written answer to the promotion question could be argued either way on this record (see Reasoning posture → "Declare the borderline ones"). Omit it otherwise; absent means not borderline. Boolean only — the two readings and the one you took go in `reason`, which is the field downstream argues with.

The **rulings tail is prose, not data**: Band reconciliation, Disagreements / flags surfaced to downstream, Coverage rulings & open questions, and Open questions for the client / reviewer live ONLY in the md and travel verbatim — do not mirror them into the JSON.

The four placement-tier shapes:

### The promotion question — what separates headline from sheet 2

Both tiers below are answers to ONE question, and you answer it in writing on every candidate that reaches either:

> **Does this conflict change the advice, or only complete the record?**

Expanded, the way you would put it to yourself before signing: would the senior lawyer signing this clearance need to discuss **this** conflict with the client before the client acts — because this owner can and plausibly would block adoption, or because resolving it changes what the client should *do* (consent, scope-narrowing, a coexistence call, filing strategy)? Changes-the-advice → headline-candidate. Completes-the-record → sheet 2.

Two things the question deliberately is **not**. It is not "does this warrant the client narrative" — narrative-worthiness is relative to the rest of the band, so it moves whenever the band's composition moves, and the same record placed twice lands in two tiers. And it is not a risk tier: you are told below not to tier risk numerically, that is the digest's job, and a boundary you can only decide by computing the thing you are forbidden to compute is a boundary that falls back to feel. Ask what the conflict *does to the advice*, and write the answer down.

### Headline candidates

Candidates whose answer to the promotion question is **it changes the advice**. For each:
- **Identifier**: mark text + owner + jurisdiction + class/G&S
- **Why on-field for THIS client**: one-line link back to matter-context
- **What it changes**: the promotion question answered — who can block adoption, or what the client now has to decide because this record exists
- **Inquiry trace** (brief, see below)
- **Stage-2 mitigants** if any (revocation vulnerability, distinguishing prefix, partnership context, etc.)

### Sheet 2 / register watch

The same question, answered the other way: a real, on-field conflict that **only completes the record**. It belongs on the record — it is a genuine conflict and the audit trail is the point — but the advice reads the same with it or without it. Sheet 2 is not "smaller" or "less interesting than the narrative"; it is *the advice does not move.* For each:
- **Identifier**
- **Why this conflict does not change the advice**: what the client would have to do differently if it did, and why this record does not do that. Not "lower-tier" as a bare answer — state the ground.
- **Inquiry trace** (brief)

### Watchlist annex

Candidates with token-match but off-field commercial activity, where there IS a reason to keep monitoring (active enforcer, pending registration with potential G&S creep, sector-convergence risk per matter-context). For each:
- **Identifier**
- **Off-field reasoning + reason to monitor**: what change in registration / G&S / activity should trigger re-evaluation

### Out-of-scope / filtered

Candidates the matter-context already classified off-field (or that the inquiry confirms off-field). For each:
- **Identifier**
- **Off-field category** from matter-context (e.g. "AI / vector-DB / LLM-SaaS — false-friend per matter-context off-field flag")
- **Inquiry trace confirming**: customer-base divergence, channel-of-trade divergence

### Disagreements / flags surfaced to downstream

When your placement deviates from a strict reading of the candidate's class-match or differs from matter-context's framing, surface the deviation explicitly in this section with the reasoning. The digest worker and `narrative-refutation` can override with informed counter-reasoning if appropriate.

### Band reconciliation — form the expectation for THIS mark, then check the complete band against it

Before placing individual candidates, step back and reason about the band **as a whole**, the way a senior lawyer reads a search result before drafting. Write a short reconciliation (3-8 lines) at the top of the file:

- **What did I expect to see for THIS mark?** Given the archetype + risk theory (from `matter-context` / the manifest): a coined word in an empty class should return little; a saturated everyday word in a crowded class should return a wall of names; a famous-element-masked mark should surface the famous owner.
- **Does the complete band match that expectation?** Reconcile, and name the mismatches explicitly. The traps to catch (these are reasoning prompts, not a checklist to mechanise):
  - **A saturated field with zero named exact-owner records is not a clearance** — it is a search that hasn't reached the dangerous category yet. If the band shows a high-count crowd descriptor on the dominant element but *no* `enumerated` block for the exact-in-class-live name-list, that exact slice is **unsearched, not clean** — rule it a **material gap** (see below) → the run ships CONDITIONAL, never a clean negative.
  - **Is anything famous missing?** If the mark is one keystroke / a homophone from a famous mark that covers the target goods or an adjacent field and that owner does **not** appear in the band, that is a recall gap — name it a material gap (famous owner / exact neighbour, in-scope classes, not enumerated) rather than concluding it isn't there.
  - **My headline candidate is a commercial partner.** If the highest-risk record by class/proximity is a known partner / licensor / the applicant's own group, that cannot be the top risk *by default* — partner-relationship is optics, an either-way practical factor, not a legal-risk multiplier (see synthesis "Optics is annotation"). Flag it here so the digest/synthesis does not lead the report with the partner; the legal read on the partner's mark still stands, the **prioritisation** does not.
- **Where the band contradicts the expectation in a way you cannot resolve by reading it** (the exact slice is a crowd, the famous owner is absent), that is a **coverage** problem, not a placement problem — route it to the crowd-descriptor materiality section (a material gap → CONDITIONAL), not the per-candidate tiers.

### Crowd-descriptor materiality — cleared / material-gap (feeds synthesis coverage_judgment)

For **each** `incomplete` crowd descriptor in the band (the shape's `crowds` list), and for each expectation-mismatch the reconciliation surfaced, make one materiality call and write it in a dedicated `### Coverage rulings & open questions` section. This is the lawyer deciding "does this un-enumerated slice matter to whether I can sign?" — a judgment on the risk picture, never a count threshold. There is **no re-search re-loop and no halt**: a material gap ships as a **CONDITIONAL** with an honest flag, never a re-enumeration and never a no-deliver stop.

| Your call | When | What you write |
|---|---|---|
| **cleared** (immaterial) | The crowd is genuinely off-field / off-archetype noise (the 363 single-character hits, a substring pile in an unrelated class) — completing it would not change the risk read. This IS judgment-sufficiency: you are deciding it is enough. | A `cleared:` line naming the descriptor and the one-line why-immaterial. The digest writes it `confirmed-clean`. |
| **material gap** (a dangerous slice NOT fully cleared) | The slice is dangerous and was NOT enumerated to completion — the exact-in-class-live name-list of the dominant element, the famous-owner / exact-neighbour band, a missing per-jurisdiction exact slice. A saturated dominant element with no enumerated exact slice is the canonical material gap. | A `material-gap:` line: **the axis** (`primary-sweep` / `transliteration-numeric` / `incumbent-class` / `saturation-probe`) **and the slice** (name/match_mode/classes/region) that is un-cleared, with the count. The digest writes it `coverage-limited` and the run ships **CONDITIONAL**, surfacing the named gap in # Actions. |

Rules that hold this boundary:
- **Disclosure is the honest CONDITIONAL, not a buried caveat.** You may not write a vague "a higher-risk mark may sit in the unscreened set". A material gap is named SPECIFICALLY (which slice, what count) and the run ships CONDITIONAL with that gap as an explicit open item — never a clean with fine print.
- **An incomplete search is never a clean negative.** A crowd descriptor with no `cleared`/`material-gap` ruling is the miss — every descriptor gets exactly one.
- **recently-dead is a status you weigh, not a date-cutoff the funnel applied.** Lapsed / lapse-date / revival-window records are in the band with their status; whether a recently-lapsed near-identical matters (revival risk, non-use vulnerability) is your call — surface it, don't drop it on age.

### Open judgment — surfaced reasoning that SHIPS (not a coverage gap)

Distinct from an incomplete search: a **genuine open judgment** is where the search IS complete and the legal/commercial answer honestly admits more than one defensible call. This is the lawyer's product and it **ships** — it is NOT a coverage gap. Put it in an `### Open questions for the client / reviewer` section. Examples that must ship:
- *"Coexistence with [partner] is a commercial call for you"* — the legal risk on the partner's mark is assessed; whether to coexist is the client's business.
- *"I'd get a second opinion on the EU class-25 angle"* — the search is complete; the doctrine is genuinely arguable.
- A finding's explicit dispute-type / confidence where the law is unsettled.

The test: **"is the uncertainty about whether I LOOKED, or about what the COMPLETE picture MEANS?"** Whether-I-looked → a material gap (CONDITIONAL). What-it-means → open judgment, ships. Do not throw the second out with the first.

## Structured inquiry per candidate

For each candidate you are placing (work through the shape's totals via `band_lookup` — **floors first, and every floor accounted for**), answer briefly:

1. **What does the applicant actually do?** Concrete business activity, not just Nice class summary.
2. **Who is their customer?** End-users; decision-makers if distinct.
3. **Where do they sell?** Channels of trade.
4. **Does the customer base overlap with our client's market** (per matter-context.md)? Yes / partial / no — with one-line reasoning.
5. **Is there a sector-convergence path?** Reference matter-context's convergence flags if relevant. Weak / moderate / strong.
6. **Is the owner enforcement-aggressive?** Evidence from the band record + matter-context watchlists: prior oppositions, C&Ds, settlement patterns, brand-watch behavior. None visible = "no record."
7. **Registration status?** Live registered / NOA / pending / opposed / cancelled / not registered (common-law only).

The placement follows from the answers, not from a rule table — and between headline-candidate and sheet-2 it follows from the promotion question — these seven answers are what you argue that question from.

## Placement patterns — sanity-check, not lookup table

The inquiry above is primary. The patterns below describe how the inquiry's answers usually map to placements — read them as a sanity check after you've done the inquiry, not as a decision table to consult first. If the inquiry's net answer conflicts with the pattern, follow the inquiry and write the reasoning. Where a pattern names **two** tiers it is not offering you a choice: the promotion question chooses, and your entry states the answer.

- Class match + customer-base overlap + active owner + live registration → typically **headline-candidate**
- Class match + customer-base overlap + non-use vulnerable or distinguishing prefix → typically **headline-candidate** with Stage-2 mitigant flagged
- Class match + no customer overlap + matter-context off-field flag → typically **out-of-scope-filtered**
- Class match + no customer overlap + pending registration OR active enforcer history → typically **watchlist-annex**
- Class match + partial customer overlap → typically **sheet-2**
- Phonetic / visual variant + class match + on-field → **headline-candidate** or **sheet-2** as the promotion question answers it (does the variant change the advice, or only complete the record?), never on phonetic distance as such — **and** an *active same-field brand in the core classes* is not down-placed below the headline tier on phonetic distance alone (see Reasoning posture → "Active same-field brand"); phonetic distance is a rating-step input, not a placement demotion for a live in-class competitor
- In-class identical / near-identical mark on the dominant element + on-field + **small / individual / tail-market filer** → **headline-candidate** or **sheet-2** (NOT out-of-scope), the promotion question deciding which, with revocation-vulnerability / low-enforcement-appetite flagged as a Stage-2 mitigant. Filer size affects the *Stage-2 read*, never the *placement*.
- Common-law gaming title on a direct client-distribution channel (Steam / Microsoft Store / Xbox / App Store equivalents) → typically **headline-candidate**

**Hard rule, not a pattern:** common-law gaming title without confirmed `developer_of_record` / `publisher_of_record` → **sheet-2** with verify-publisher flag. This is anti-confabulation discipline, not a default to override; see Reasoning posture below.

## Reasoning posture

- **Declare the borderline ones.** If your written answer to the promotion question could be argued either way by two competent lawyers on this record, **say so**: set `"borderline": true` on that entry in `placements.json`, and let the `reason` state both readings and which one you took. Declaring a borderline is a correct professional outcome, never a failure — what is a failure is a confident tier on a record the question does not decide. The digest is told to expect your declarations and to resolve each one either way in writing, so a declaration costs the run nothing and gives the disagreement somewhere auditable to happen. It is an **internal** adjudication flag between stages: it never travels into the client's report as hedge language.
- **If you'd promote a candidate to a tier higher than a senior lawyer would, write the reasoning that defends the promotion explicitly. If you cannot defend it, demote.** This is the tie-break AFTER the promotion question, never instead of it: answer the question first, in writing; demote-on-undefendable settles what the answer leaves standing.
- **Nothing is silently filtered.** Every out-of-scope candidate has a one-line reasoning trace. Audit trail must show *why*, not just *what*.
- **Owner attribution gaps stop promotion.** If a candidate is a common-law game title without a confirmed `developer_of_record` / `publisher_of_record` field in common-law-findings, place at sheet-2 with a verify-flag. Do NOT confabulate publishers by inferring from prior-frequent gaming companies (Bandai Namco, Tencent, etc.).
- **Don't down-place an on-field in-class identical mark on filer-size or apparent-dormancy grounds.** A small / individual / tail-market filer of an in-class identical mark is a real paper conflict — place it at headline-candidate or sheet-2 (never out-of-scope), the promotion question deciding which, and leave the filer-size / revocation-vulnerability read for the digest/synthesis Stage-2. Those are mitigants to weigh, not reasons to keep a real conflict out of the report.
- **Famous-mark neighbours cross fields — don't off-field-filter them.** A famous mark that is a visual / phonetic neighbour of the proposed mark (one keystroke or a homophone away) and that covers the target goods or an adjacent field is placed **headline-candidate or sheet-2** (the promotion question deciding which), never watchlist-annex or out-of-scope — *regardless of field-divergence*, and even if matter-context flags the owner's core business as off-field. The famous owner's cross-sector reach and enforcement posture make it a real candidate; field-divergence (e.g. "their main product is a browser, ours is a dev-kit") is a Stage-2 mitigant the digest/synthesis weighs, not a reason to demote it here. What matters at placement is that the famous neighbour *covers the target goods*.
- **Active same-field brand in the core classes — don't down-place on mark-shape alone.** An owner running an *active* brand (current marketplace presence — a live product / app / site under the mark) that is a near-identical neighbour in the applicant's *core* classes is a real same-field conflict: place it **headline-candidate or sheet-2 — the promotion question deciding which — and carry an explicit `active same-field` flag**, never demoted out of the headline tier on a mark-shape distinction (an onset-letter difference, a one-keystroke swap) *alone*. Onset / phonetic distance is a Stage-2 confusion-read input the digest/synthesis weighs — it is **not** a placement-demotion ground for an active in-class competitor whose own use meets the client's. What matters at placement is *active + same-field + core class*; whether the word-shape ultimately distinguishes is the rating step's call, made with the conflict in front of it, not foreclosed by a quiet demotion to sheet-2. (Symmetric to the famous-neighbour rule above: a demotion needs a real, surfaced reason, never a silent drop on shape.)
- **Don't dump a look-alike or shared-meaning family when one member is in our field.** When a cluster of related forms (a look-alike or shared-meaning family — e.g. `SIREN` / `SIRENE` / `SIRÈNE` / the *mermaid/siren* sense) is being off-fielded as "unrelated," check **each member against the target goods before dropping the cluster**: if *any single member* is in our field (e.g. a niche or academic registration for the applicant's own goods — say social-networking software), carry that member at **headline-candidate or sheet-2** — the promotion question deciding which — and keep the family as context. Never drop the whole family wholesale because its dominant association sits off-field — a family is dropped member-by-member with a reason, never as a cluster on its headline meaning. (Same discipline as the famous-neighbour and active-same-field rules above: a drop needs a real, surfaced, per-member reason.)
- **Don't re-derive matter-context.** matter-frame did the strategic framing; you apply it. Disagreements with matter-context are surfaced explicitly ("matter-context flagged X as off-field; this candidate may warrant re-evaluation because Y"), not smoothed or reframed.

## What NOT to do

- **Don't tier risk numerically.** Tiering is the digest's job. You decide which findings go where in the report — headline, sheet-2, watchlist, or out-of-scope — with reasoning per item. The headline / sheet-2 line is drawn by the promotion question (*does this conflict change the advice, or only complete the record?*), never by a risk tier you would have to compute in order to answer it.
- **Don't confabulate facts.** If you don't know the applicant's business or owner identity, place at sheet-2 with a verify-flag.
- **Don't blur out-of-scope with sheet-2.** Out-of-scope has explicit off-field reasoning rooted in customer / channel / sector. Sheet-2 is on-field and real — its answer to the promotion question is that the advice does not move, which is a written answer, not a lower rank.
- **Don't promote without attribution.** No common-law title goes to headline without a confirmed developer/publisher.
- **Don't accept an incomplete search as a clean field.** A crowd descriptor is never a placement — it is a coverage call (cleared / material-gap). A saturated dominant element with no enumerated exact-in-class-live slice is an unsearched dangerous category, not a clearance.
- **Don't bury a material gap as fine print, and don't suppress a genuine open judgment.** Incomplete-and-material → a named material gap (→ CONDITIONAL); the search-is-complete-but-arguable → surfaced open question that ships. Keep them apart.
- **Don't push relevance or sufficiency back into the funnel.** No "sample this", "narrow to tractable", "top-N". The unit hands you the complete band; you judge it.

## Length target

Per-candidate entry: 4-8 lines. Total file: scales with candidate count. For a typical Tier-1 worldwide matter with 15-25 candidates, expect ~1500-3000 words.

## Failure fallback

If `matter-context.md` is missing or empty (matter-frame failed or was skipped), produce a minimal `placement-recommendations.md` that names the gap ("matter-context absent — placements made on candidate class-match alone with low confidence") and proceeds with whatever signal the band carries. Surface the gap to the digest worker so synthesis can decide whether to re-spawn matter-frame.

If a band artifact is **missing or unreadable** (the shape reports an axis absent, or the band tools error because the band was never merged), that axis's complete band did not reach you — treat it as a **coverage failure, not an empty result**: write a `material-gap:` line in `### Coverage rulings & open questions` naming the absent axis ("named band for <axis> absent — search output did not cross; cannot judge this axis") → the run ships CONDITIONAL. Do NOT place candidates from that axis on the prose digest alone and do NOT call the axis clean; an absent band is the firewall failing, which is exactly the miss this design removes. (The driver's fresh-run fan-in gate also hard-fails a missing band, so this is the belt-and-braces read.)
