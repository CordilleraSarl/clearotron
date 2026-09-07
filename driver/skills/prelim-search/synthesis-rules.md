# Synthesis rules — combining common-law and register findings

How the orchestrator turns two findings files (one per layer) into a single risk assessment per finding, with the `Source Layer` column on the unified Findings sheet driving the final read.

## Reasoning posture — default to senior-lawyer judgment as ground truth

Across the synthesis, two postures are load-bearing:

1. **If the orchestrator rates a candidate higher than the staff lawyer's calibration would** (e.g. promoting a sheet-2 candidate to client-facing headline), it MUST defend the promotion explicitly with reasoning rooted in `matter-context.md` and placement's own record — the structured `placements.json` (tier **and its stated reason**, per candidate) plus the rulings tail in `placement-recommendations.md`. A defence ENGAGES the reason placement gave: quote it and say why it does not hold. Divergences require defense, not assumption. The Touchpoint 3 (`narrative-refutation`) gate enforces this at delivery: a promotion above `placement-inquiry`'s placement without "promotion defended" reasoning is a BLOCKING flag.

2. **Carry forward matter-context and placement-recommendations.** Synthesis reads `matter-context.md` (the strategic anchor produced at Phase 0 by `matter-frame`) and `placement-recommendations.md` (the per-candidate placements produced at Phase 2 Step 2C by `placement-inquiry`). The off-field reasoning, the named jurisdictions, the watchlist seeds, and the per-candidate placements are inputs to synthesis — not optional context. Disagreements with either MUST be surfaced explicitly ("matter-context flagged X as off-field; this candidate may warrant re-evaluation because Y"), not silently reframed.

   **`placements.json` — the structured tier record (B2, 2026-07-31).** When it is on disk beside `placement-recommendations.md`, it is the **authoritative per-candidate tier record**: one entry per placed candidate, `{mark, owner, jurisdiction, records[], tier, reason}`, `tier` exactly one of `headline-candidate` / `sheet-2` / `watchlist-annex` / `out-of-scope-filtered`. `reason` is placement's own short paragraph — the candidate characterisation, the decisive placement ground, any Stage-2 mitigant flag. **Adopt or counter each placement BY ENGAGING ITS REASON**: an override quotes the reason it contradicts and says what is wrong with it (never a silent re-tier), and a kept tier may still tighten the label while reusing the reason. The md keeps the **rulings tail** (band reconciliation, disagreements, coverage rulings, open questions) as prose — it travels verbatim and is adjudicated the same way: adopt each ruling or counter-reason it, never silently drop one. A run minted before this contract has no `placements.json`; the md's tier sections are then the record, read the same way.

3. **Optics is annotation, not a rating.** Partner-relationship, channel-conflict, PR, and reputational concerns — however prominently `matter-context` or the manifest raise them — are surfaced as client-facing annotations (the separate PR / reputational section below; a "relationship-level heads-up"). PR is a separate category, **never rated on the framework's bands**, and an existing business relationship is an *either-way* practical factor, not a band multiplier. The rating answers what the framework in force asks — anchored in *if this party sued us, would they win?*, set by the consumer-confusion read (mark-as-whole × G&S). Never let optics/PR/partner/size move the band; annotate beside it.

4. **The framework in force rates the matter (doc 50).** Every run reads exactly one risk framework — **the customer's own framework if the profile has one on file, else the house default. Nothing in between.** That framework is the customer's own legal judgment written down: reason each conflict *with* it — its band definitions (Legal position × Practical position × Potential outcomes), or its matrix where it states one — and state the rating as **its band word, verbatim**. It is a reasoning authority, never a lookup table: no numeric thresholds, no score-to-band mapping, no vocabulary borrowed from another framework. **The band follows the words** — state the likelihood in plain words first (*"the prior owner is likely to win, though credible defences exist"*), then give the band those words require under the framework's own definitions; the prose read and the band are one judgment and may not disagree. Where the framework states **ceilings or matrix mappings, honour them exactly as written** — they are that framework's own anti-escalation mechanism, and no practical or optics factor lifts a rating past what its stated method yields. A conflict the client **clearly wins with no material risk is not a rated conflict at all** (most frameworks' lowest band still describes *real* residual risk — nuisance claims, weak strategic complaints, registration obstacles — never clear wins): surface it unrated as commercial awareness if worth knowing, else omit it. Voice the client side as the framework's **entity** names it (*"the company"*, *"Zephyr/Nimbus/Kestrel"*, *"Aurora Interactive"*). The three-question discipline stays: **legal risk** (*would they win?* — the confusion read net of merits defences), **practical risk** (*would they act?* — enforcement reality), and **impact** (*if they did, what follows?*). The framework's band definitions integrate the first two — reason both, in that order, through its own terms. **Impact stays client-surfaced, never rating-moving**: name the consequences for the client to weigh (we do not conclude acceptability), beside the band, exactly as before.

## Contents

- [Reasoning posture — default to senior-lawyer judgment as ground truth](#reasoning-posture--default-to-senior-lawyer-judgment-as-ground-truth)
- [Coverage honesty — a coverage-limited negative is not a clean negative](#coverage-honesty--a-coverage-limited-negative-is-not-a-clean-negative)
- [Three-way source classification](#three-way-source-classification)
- [Risk calibration adjustments (vs the v2 common-law-only framework)](#risk-calibration-adjustments-vs-the-v2-common-law-only-framework)
- [Cross-pollination synthesis rules](#cross-pollination-synthesis-rules)
- [Finding-type classification (extends v2 Type column)](#finding-type-classification-extends-v2-type-column)
- [Conflict ranking & selection — the dominant-element spine](#conflict-ranking--selection--the-dominant-element-spine)
- [Per-finding synthesis structure](#per-finding-synthesis-structure)
- [Cancelled / invalid marks — include if exact, no commentary](#cancelled--invalid-marks--include-if-exact-no-commentary)
- [The mark itself — standing assessment (every run)](#the-mark-itself--standing-assessment-every-run)
- [Filed-vs-used check — mandatory for findings above the lowest band](#filed-vs-used-check--mandatory-for-findings-above-the-lowest-band)
- [Prosecution history — mandatory for identical-mark hits in relevant classes](#prosecution-history--mandatory-for-identical-mark-hits-in-relevant-classes)
- [Revocability — mandatory assessment for register findings above the lowest band](#revocability--mandatory-assessment-for-register-findings-above-the-lowest-band)
- [Verify-or-defer — procedure, deadlines, registry statistics](#verify-or-defer--procedure-deadlines-registry-statistics)
- [Volume is not a risk multiplier](#volume-is-not-a-risk-multiplier)
- [Common-law scope — narrow](#common-law-scope--narrow)
- [Watchlist findings — automatic inclusion](#watchlist-findings--automatic-inclusion)
- [Game-title attribution — never confabulate publishers](#game-title-attribution--never-confabulate-publishers)
- [Firm-wide reasoning discipline (applies under every framework)](#firm-wide-reasoning-discipline-applies-under-every-framework)
- [Synthesis output](#synthesis-output)

Cross-references in this file:
- the framework in force (`risk-framework.md` house default, or the profile-selected `risk-framework-<customer>.md`) — THE rating authority: its band definitions rate every conflict
- [worked-examples.md](worked-examples.md) — the spine + per-finding reasoning depth (per-customer variants calibrate under that customer's framework)
- [report-prose.md](report-prose.md) — the report prose standard: what a good finding READS like. The general rules (fact · assessment · prescription; hedge the assessment never the fact; numbers over adjectives; say it once; concision never trades away a fact; the controlled assessment vocabulary) are stated there ONCE and are not repeated here. This file carries only the forms synthesis itself writes — the finding sentence and the grouped reasoned negative, below.

## Coverage honesty — a coverage-limited negative is not a clean negative

A negative is only as good as the search behind it. **Before writing any "clean" / "no findings" /
"no live filings" / "nothing surfaced in [X]" statement, read all three coverage inputs:**

1. **the register coverage ledger — as DATA in your dispatch, not from the prose.** The driver composes the machine ledger (`register-coverage-ledger.json`) and the plan-execution receipt (`_driver/plan-execution.json`) into tables in the dispatch message itself: every axis, unit, status and reason, plus every dictated query that produced no band block. Those tables are the register answer — do **not** reconstruct the ledger by reading the `## Coverage ledger` prose in `register-findings.md`, and do not re-type their numbers into yours. (The same reconstruction one stage upstream burned 28,592 thinking tokens, 95% of that stage's emission, and still got the answer wrong.) The files are named in the dispatch and remain yours to read directly; the prose ledger is a rendering of the same data, and where they differ the machine ledger governs. **If the dispatch says no register record was composed this run, there is no table and the register layer has no driver-computed record at all — that is the absence of a record, never a clean register.**
2. the `## Coverage ledger` section in `common-law-findings.md` (common-law platforms). **This one is read in ONE direction only.** That file is the common-law stage's own narrative, so nothing in it is proof a check ran: its ledger CONSTRAINS you — a unit recorded `coverage-limited` or `deferred` can never be written as a clean negative — and it LICENSES nothing, because a `confirmed-clean` row there is that stage's word about its own work. A clean common-law statement still needs a source you read and can cite, exactly like every other off-register fact.
3. the variant manifest's **`### Scope ledger`** section (the variants-stage coverage statement, spanning the variant / field / source layers — see [prelim-variants/SKILL.md](../prelim-variants/SKILL.md#scope-ledger)).

The first two inputs cover the register axes and the common-law platforms; the **`### Scope ledger`** section is the **third coverage input** and covers the **variants stage** across all three frame layers. A row recorded there as `dropped` is a **recall limitation** — the search never generated that axis / never searched that field or channel, so its absence of findings cannot be read as clean for it. The verdict MUST carry it the same way it carries a `coverage-limited` / `deferred` ledger row: a `dropped` `numeric-substitution` or `foreign-transliteration` variant means leet / cross-script conflicts in that lane are **unassessed**; a `dropped` field means an off-fielded sector's collisions are unassessed; a `dropped` source means that channel is unsearched — not absent.

A negative may be rendered as clean **only when the relevant coverage unit is `confirmed-clean`.** Where
the coverage unit is `coverage-limited` or `deferred`, the narrative MUST carry the limitation — never
erase it. Honest phrasings:

- **`deferred`** — *"[jurisdiction/axis] was identified as material but not fully cleared this run — a coverage gap, not a clean result"* (the verdict carries it as CONDITIONAL). doc-35: state it as a risk-read limitation; do NOT append a "[scope] sweep recommended / is the next step" caveat — a search-reachable gap is closed in the run or an internal note, never a client commission-a-sweep item.
- **`coverage-limited`** — *"[scope] coverage was limited ([reason]); the absence of findings there is not confirmed clearance."*

This binds the RF-10 / RF-15 register-state rules below: a statement like "register returned no live
filings for [entity]" is only sayable when the jurisdictions where that entity would plausibly file are
`confirmed-clean`. A `deferred` row on a material jurisdiction means you cannot call that jurisdiction
clean for anyone.

**Hard rule (integrity, not judgment):** a lawyer never implies a search they did not run. What status
a search earns, and how to phrase the caveat, is judgment — but a `deferred`/`coverage-limited` negative
rendered as clean is a delivery failure the `narrative-refutation` skeptic blocks (`coverage-overclaim`).

**Say which negative you hold — and say it once (P6).** The two readings are different facts and must never
both attach to the same source in one report: *"searched — none found"* for a source this run actually
queried, *"not searched this run"* / *"could not be searched — <reason>"* for one it did not reach. (The
delivered TIKI report said both about TTAB decisions, which **are** searchable — the reader could not tell
which had happened.) Coverage prose is also the **longest-running prose in the report** — two of its four
longest sentences were coverage/gap prose — so it is held to the house budgets like everything else:
~20–25 words a sentence, each coverage fact stated **once**, in one place (an area's state in its
`coverage[]` row, the sufficiency read in `coverage_judgment.reason`, neither re-narrated in the other).
And **the numbers are code's**: the reader-facing register coverage line is computed from the run record
(`scope-facts.mjs`) and stamped as `coverage_line:` front-matter, which sits **outside** the prose scan —
so a count re-typed into prose is caught by nothing and drifts from the record on the next republish. Carry
the substance, drop the number.

**The same rule covers the FACT, not only the number.** The coverage line already states which forms were
not reached and why — in the reader's words, computed from the record. Do not write a second sentence
saying it. *"The joined-script forms could not be put to the register provider this run"* is engine
vocabulary, and redundant twice over, because the coverage line states the gap and the action list two
paragraphs above already tells the reader to instruct local counsel for those exact forms.
Never name the provider, the dispatch or the run in a coverage aside. **If an action already tells the
reader what to do about a gap, the gap needs no aside — keep the action, cut the aside.**

Finally, cut the filler this lane attracts: *"session-wide notice
coverage"* and its relatives state nothing a reader can use.

**Durable principle — search depth is set by the cost of a miss, never by the posture on the result.**
A low-priority *advice* posture ("we won't block filing on the US") governs the **recommendation**, never
**how hard you look**: it is not a licence to thin the search of a high-cost-of-miss jurisdiction or
element and then call it clean. If a market or element is searched shallowly, its negative is
`coverage-limited`, not `confirmed-clean` — regardless of how lightly the advice weights it. (This is the
VELTRIPHEN US-thinning failure: the US was searched less hard *because* the advice would not block on it,
then rendered as confirmed-clean. Depth follows the cost of a miss; posture follows separately.)

## Three-way source classification

Every row in the unified Findings sheet gets a `Source Layer` value:

| Source Layer | Meaning |
|---|---|
| **Common-law** | Surfaced by `prelim-common-law` only. Marketplace presence, no register evidence. |
| **Register** | Surfaced by `prelim-register` only. Filed protection, no visible marketplace use yet (or no marketplace evidence captured). |
| **Both** | Same entity / mark / owner surfaced on BOTH sides. Strongest evidence type. |
| **Cross-pollination** | Surfaced by a deterministic cross-check (Option D Triggers 1-4) — not in either layer's primary first-pass. Audit-trail proof-of-work. |

`Both` rows get cluster-aggregated during synthesis: one row per matched entity, with both layers' evidence merged in the Description column.

## Risk calibration adjustments (vs the v2 common-law-only framework)

> **Moved.** This section is now in [`firm-wide-reasoning.md`](firm-wide-reasoning.md), which this lane reads alongside this file. It moved because the knockout lane needs it too and one copy is the only way it cannot drift.

## Cross-pollination synthesis rules

Cross-pollination rows (Source Layer = "Cross-pollination") follow special rules:

1. **Negative cross-check (checked, found nothing)** — does NOT generate a Findings row. Goes only into the Audit Trail. Why: a "we checked HP register and they have nothing" result is proof-of-work, not a risk finding.
2. **Positive cross-check (found something)** — generates a Findings row AND merges with any existing row for the same entity (becomes Source Layer = "Both" if the same entity was already surfaced by both first-pass layers).
3. **Cross-check evidence weight** — same weight as first-pass evidence; do NOT down-weight just because it came from a cross-check trigger. The trigger fired because the rule said it should.

## Finding-type classification (extends v2 Type column)

v2 Type values: Direct Conflict / Crowded Field / Of Interest / Competitor Intelligence / PR Risk / Supportive

v3 adds two register-specific values:

| Type | When to use |
|---|---|
| **Register-blocker** | Live register filing in target classes by an entity in the target industry, sufficient to plausibly block use |
| **Register-context** | Live register filing in adjacent classes or by an entity outside the target industry — incumbent context, not a direct blocker |

When the same entity surfaces with both register-side and common-law evidence, use the stronger Type label. E.g., HP marketplace + HP register = "Direct Conflict" (not "Register-context").

## Conflict ranking & selection — the dominant-element spine

> **Internal-reasoning vocabulary — never surface (rule 8).** The shorthand in this file is for the analyst's
> reasoning, NOT for the report, the email, or the HTML report the reviewer reads. Never echo it into output;
> translate to plain words: "dominant-element spine" → "we ranked by the dominant element"; "saturation" /
> "saturated" → "crowded field" / "many similar marks"; "apex" → "the single highest-risk conflict";
> "[mark]-formative" → "marks built on / containing [mark]"; "incumbents" → "other / existing owners". A smart
> non-lawyer must be able to follow every finding line without a glossary.
>
> **The substitutions are illustration; the rule is the test.** They are examples of one failure, not its
> boundary, and a list cannot be the boundary: this list says translate *"saturation"*, and a delivered
> report wrote *"a diluted concern"* and *"reduce the concentration of beverage-facing wording"* — the same
> engine idea in words the list never anticipated. Ask the question of every noun (*does the reader already
> own this word?*), never only of the words below.

Before rating individual findings, **rank and select them by the consumer-confusion gate** (see
*The consumer confusion test — the governing gate* below), centred on the proposed mark's
**dominant element** (from the variant manifest). This is what turns a pile of hits into the staff lawyer's analysis:

1. **Centre on the dominant element.** Rank by: shares the dominant element (no distinguishing affix) ×
   same/related G&S. Bare-dominant-element-in-field = top; dominant-element-plus-distinctive-matter
   (a third-party house mark in front of the shared element) = lower; unrelated-G&S = excluded as a legal
   finding (commercial awareness only).
2. **Never drop an on-point identical / near-identical mark in the relevant class** — even if it looks
   revocable or shelved. The staff lawyer: *"until it has actually been revoked it remains a live legal
   risk."* Surface it, rank it high, flag the non-use vulnerability as a Stage-2 mitigation. **Non-use is
   a revocation DEFENCE, never an injunction shield (spec-48 C5): a registered right can support an
   injunction without the owner's own use (country-dependent; grace periods run ~5 years). Never reason
   "no use → procedural risk only / no injunction exposure" — the registration is enforceable today;
   non-use only shapes the Stage-2 practical read and a possible counterclaim.** (This is also
   why the file-truth precondition matters: a prior run found an identical-mark registration but dropped
   it from the deliverable because the register-findings file never reached the orchestrator.)
   **This holds regardless of filer profile.** A tail-market individual or single-class small-entity
   filer of an in-class identical / near-identical mark is a real paper conflict — surface it,
   characterise the owner (individual / tail-market / small entity), and apply revocation-vulnerability
   and enforcement-appetite as Stage-2 mitigants that may land it in the framework's **lowest band**
   (the client more likely than not prevails, though material risk remains). "Small individual filer"
   is a reason a conflict may settle cheaply or prove revocable —
   **not** a reason it never appears in the findings.
   **This holds regardless of word frequency, too (the COLORA→色彩 everyday-word case).** A live, in-scope-class
   registration covering the matter goods is cited at its **goods-proximity** risk REGARDLESS of how common /
   saturated / everyday the word is — the word being a frequent dictionary term (an everyday-word meaning
   translation, e.g. CN 色彩 "colour") is **never** a reason to drop or down-rate a live in-class hit behind it.
   Word genericness becomes a **weak-distinctiveness / revocability note** — the negotiation / coexistence angle:
   a weak, descriptive senior mark is a **weaker claim** (a Stage-1 merits defence — descriptiveness / weak
   distinctiveness of the senior mark, priced into the legal read by the per-finding structure) and more
   vulnerable to revocation (a Stage-2 business-read mitigant) — but this is worked through the normal merits +
   practical machinery, **not** as a drop or down-rate of the finding before it is rated. The
   `translit-too-generic` flag (from the saturation probe) caps only **how many** of a crowd are cited (the
   cite-cap — see *Volume is not a risk multiplier*); it never screens out or down-rates a live in-class
   registration covering the matter goods.
3. **Headline the right finding.** Overall risk is driven by the highest-ranked on-point conflicts — not
   by a high-visibility-but-distinguished mark (a house-mark-prefixed incumbent) or by volume of unrelated-field noise.

The [`worked-examples.md`](worked-examples.md) deliverables demonstrate this ranking and the per-finding
reasoning depth — read them as the standard before writing the synthesis.

## Per-finding synthesis structure

For each material finding, document (in the Findings sheet's Key Factors column):

1. **Factual basis:** what was found, on which layer(s), how significant
2. **The LEGAL read — the claim's strength net of credible merits defences.** It answers one question — *if this party sued us, would they win?* — so it is the probability the claim **prevails**, assessed **net of the client's credible merits defences** and stated **with its bounds**. **State that probability in plain words, in the vocabulary THE FRAMEWORK IN FORCE uses** — read its Legal position definitions and answer in their terms, whether that is a likelihood-of-winning ladder, a probability band or a lettered level. These words are what that framework's band definitions key on, and the read and the band are one judgment that may not disagree (Reasoning posture 4: *the band follows the words*). If your reasoning reaches "better-than-even is not reached" / "distinguishable as wholes" / "confusion is unlikely", the read is the client-favoured one — and a crowded field is a ceiling that lets you reach it, never a floor that parks you above it. Start from the whole-mark confusion read (marks compared *as wholes*, centred on the dominant element, × G&S proximity — see *The consumer confusion test* below); element-overlap alone is not a legal read. Then **price in, by name, the merits defences that bear on whether the claim prevails** — descriptiveness / weak distinctiveness of the senior mark, the opponent's own undermining conduct (their own descriptive or off-field use of the term — from the Step 3.6 workup), **no real commercial / manner-of-use overlap between our actual use and theirs** (judged against the senior right's own scope — a registered senior meets us on its mark and G&S **as registered**, a common-law senior on its **actual trade**: our use is an in-product / descriptive label vs their standalone brand, or the two sit in genuinely different commercial fields — the goods-half of the confusion test, so it lowers the read; the senior's *current presentation / trade dress* never narrows its registered scope — that is Stage-2 enforcement reality), the client's descriptive / fair-use defence, and relative priority. The **gross identity read** ("identical mark, identical class, prior filing — direct identity on the register") is stated *inside* the finding as the starting observation; it is **not** the headline read. The headline carries the **net** strength **plus its bounds** — the jurisdiction and time it holds in, and the named triggers that would move it (e.g. "more likely than not to prevail — Germany only, only while the application remains live; rises if [named trigger]"). This **replaces** a gross-identity assignment — it does not footnote the defences under a maximal headline. **Practical** factors (actual use, revocability, enforcement appetite, coexistence, the senior's own market presentation / trade dress) are *not* merits — they sit in the business read (item 4) and enter the band through the framework's own **Practical position** definitions (or its matrix inputs where it states one); they never move the legal read directly. **Name the theory setting the read.** If the mark is distinguished by its own distinctive matter (a house mark or distinctive prefix), that distinguished read is the ceiling — any escalation above it must be a named consumer-confusion theory (e.g. evidence of actual confusion). Optics, PR, partner-sensitivity, audience overlap, and owner size are **not** confusion theories: they annotate (Reasoning posture 3), they never raise the read.
3. **Business / practical read (separate from the legal read):** actual use, revocation-vulnerability, owner enforcement appetite, coexistence likelihood, channels, commercial-relationship / partnership context — the practical exposure stated *beside* the legal read, never folded into it. **For high-risk findings, this read must carry a practical-likelihood statement — how likely this owner is to actually create a problem — grounded in the Step 3.6 owner workup (their own use of the term, portfolio under owner-name variants, enforcement posture), not inferred from the register row alone.**
4. **The BAND — reasoned through the framework in force.** Take the legal read (item 2) and the practical read (item 3) through the framework's own band definitions — its Legal position / Practical position / Potential outcomes per band, or its Level × Dispute Type matrix where it states one — and state the band **word**, verbatim from that framework. The two reads move the framework's *inputs*; its stated method yields the band, honouring any ceilings it states — a practical or optics factor never lifts the band past what the framework's method produces. A clear win with no material risk yields **no band** (not a rated conflict — Reasoning posture 4).
5. **Elevation / mitigation factors observed** (if any) — tag each as bearing on the legal read or the business read (the factor lists live under *Firm-wide reasoning discipline* below).
6. **Source-layer note:** which layer(s) surfaced this; whether cross-pollination ran for it
7. **Client prior-use adjacency check:** examine the request form's "Manner of Use" and "Additional Information" fields for evidence of prior use of the proposed mark by the client. If found, apply the *client prior-use rule* (under Firm-wide reasoning discipline below; adjacency tiers — same/adjacent-goods/adjacent-industry/none) to weigh the applicant's prior-use defence on the **business** read. When same-goods or adjacent-goods prior use exists, headline-frame it in the narrative summary's scope statement (not just in the per-finding Key Factors). Example framing: "the applicant may own common-law rights in the mark for [its prior goods], or at least a right to continued use for those goods and highly similar ones." **When a senior conflict makes priority live, resolve the *filing* branch instead of punting it:** consume the applicant own-rights sweep (`prelim-register/digest.md` Step 4 — rows tagged `applicant_own_rights`) and state the client's own filing/footprint position as a **separate "client's own prior rights" note** (e.g. "no prior client filing predating [conflict] was found" or "the client holds earlier filing [X] covering [Y]"). This note is **never a conflict / Findings-sheet row, never gates or down-rates the conflict sweep, and never feeds the rating** — it surfaces as an own-rights note / `# Actions` line (per `delivery-contract.md`). The *internal / undocumented-use* branch is invisible to any external search, so leave it as a one-line client question, framed as such ("confirm any unregistered prior use of the mark by the client").
8. **Impact / consequences (surfaced for the client to weigh — never moves the rating):** for each material finding, name the practical consequences *if* the rights-holder enforced — injunction scope, damages / account of profits, reputational harm, legal costs — and tie them to the client's actual use as the matter states it (a brand printed on physical stock already shipping vs. a removable app listing; the scale and reversibility of the use). State these as **information for the client's own risk-acceptance decision, not a conclusion we draw**: we often lack the client's internal exposure data, so name the *kind* of exposure honestly rather than quantifying what we cannot see. Impact is **client-specific** and **must never move the band** — the band is what the framework in force's method yields; it is surfaced *beside* the rating, in the narrative and the report, the way the PR / reputational note is (see Reasoning posture 4 and *PR / reputational risk* below). Where the matter gives no usable signal on the client's exposure, say so in one line rather than inventing it.

Every assessment must be labeled:

> **Advisory — preliminary assessment for the reviewing lawyer's review.**

## Content model — the typed fields the report renders from (P5, 2026-07-31)

The per-finding structure above (items 2 and 3) has a **structured mirror** in `findings.json`, and four
rules govern it:

- **`borderline_between` — declare a band the framework does not decide.** Where the framework's **own**
  criteria do not cleanly settle which of two of its bands a conflict belongs in — where a competent
  lawyer reasoning through the *same* framework on the *same* record could land on either — say so: add
  `"borderline_between": ["<band A>", "<band B>"]` to that finding, naming exactly those two of the
  framework's band words. You **still** give `band` your best answer, and it must be one of the two you
  named: the declaration records that the criteria left the question open, never that you declined to
  answer it. **Declaring one is a correct professional outcome**; what is a failure is a confident band
  on a record the framework does not decide. Omit the key entirely when the criteria *do* decide — the
  ordinary case. It is **internal** routing and audit data between stages and runs, exactly like
  placement's `borderline`: it never travels into the client's report as hedge language, and it never
  softens the prose. **This is a declaration, not a criterion.** Nothing here tells you how to choose
  between two bands — that is the framework's own doctrine and it stays the framework's; a rule of ours
  that decided one band from another would be our doctrine wearing the customer's vocabulary.
- **`legal_position` / `practical_position` — the split, on every finding a reader sees.** `legal_position` is
  item 2 compressed to one-two sentences (the legal read alone — similarity × goods proximity × the
  senior right's scope under the framework's own definitions; high similarity + high goods proximity is
  a HIGH legal read whatever the owner's posture). `practical_position` is item 3 compressed the same
  way (owner posture and capability, marketplace presence, coexistence history, a delisted retailer /
  no visible revenue). They are stated **apart, never averaged**: "high similarity but the owner looks
  dormant, so call it low" is the blur this split forbids — the framework's own stated method takes
  both positions and yields the band.

  **NO DISPOSITION IS STRUCTURALLY EXEMPT, and the parser enforces it.** Both positions are required on
  **`adversarial`, `coexistence-partner`, `distinguished` AND `off-field`** — four of the five. An
  `off-field` item carries no band, but it is still a reasoned negative about a real proprietor, and a
  negative with no structured position is silence with a label. Two exemptions, both narrow:
  **`withdrawn`** (a finding the corrective pass killed; it renders nowhere and already carries a
  mandatory `withdrawn_reason`) and **`ruled_out: true`** (its ground is `ruled_out_reason`, and it
  renders in the quiet "Also considered" list, not as a reasoned negative). Outside those two, a missing
  position REJECTS the file — the run gets a corrective pass, not a delivery with a gap in it.
- **`net` — required on exactly the same set, with the same two exemptions.** Since the separately
  authored card summaries were retired it is the **only** per-finding summary the report has: the card
  leads with it, the grouped-negative line states it, the client brief lists the finding by it. A
  finding with no `net` reaches the reader with a risk chip and no sentence, so the parser refuses it.
  Its **shape** is the finding sentence, below.
- **`off_field_ground` — every `off-field` finding declares which ground it rests on.** Exactly one bare
  token of **`different-field` | `no-material-risk`**, mandatory on `off-field` and forbidden on every
  other disposition. `different-field` is a claim **about the goods** — the goods genuinely do not meet
  — and the parser checks it against your own meters: a `different-field` finding whose
  `goods_proximity` does not read `low` is rejected, because one record cannot say "a different
  commercial field" and "the goods are proximate" at once. `no-material-risk` is doc-50's clear win: a
  conflict the client plainly wins, worth the client knowing, carrying **no field claim at all**.
  **The label follows the argument.** If what separates you from the mark is the MARK — sound, rhythm,
  syllable count, orthography, connotation — the disposition is `distinguished` and it carries a band,
  whatever the two businesses look like. A mark argument wearing a sector label tells the reader a
  proprietor is not in our field while the goods wording covers ours: the right conclusion with the
  wrong reason attached.
- **`manageable` — category + reason on every notable-but-manageable finding** (dispositions
  `coexistence-partner` / `distinguished`): `{"category": large-competitor | commercial-partner |
  troll | well-known-enforcer, "reason": "<why manageable for THIS client>"}`. **Promote-or-omit**: a
  finding that fits none of the four categories is either relevant enough to drive the read (make it
  `adversarial`) or not worth the lawyer's line (omit it) — there is no category-less parking spot.
- **Commercial awareness is majors only** (`off-field` items): a major brand, an active dispute or
  proceeding, or a well-known enforcer — an off-field name that is none of these is omitted, never
  listed for completeness.
- **Common-law parity**: a common-law / marketplace finding rides the SAME rating machinery — the
  framework's band by the same method, the same meters, the same `legal_position`/`practical_position`
  split, `manageable` where it applies. The report keeps common-law in its own section (a different
  legal basis), but the section split is presentation — never a softer scale.

**Crowding is per-market only.** Every crowd / dilution statement — narrative, per-finding reasoning,
`legal_position`, coverage prose — names the jurisdiction × goods lane it was counted in ("the US
class-32 register carries ~N live TIKI-formative marks"). That lane is the only one where the dilution
is earned (see *Volume is not a risk multiplier* and the use-meets-use rule); a global crowd sentence
("the field is crowded", "diluted worldwide") is forbidden on every surface.

### The finding sentence — the shape of the typed `net`

**One sentence. A conclusion, not a chain.** It answers the single question a lawyer asks of this
finding: *is this a problem for me?*

Worked example:

> Veltra Labs' registered VELTRA is more likely than not to prevail against VELTRA PHARMA in the
> United States.

**THE RULE, AND THE THREE MARKS IT FORBIDS.** No semicolon-chain. No `→`. No consequence clause
tacked on the end. If the sentence needs a semicolon or an arrow to hold itself together, it is
reasoning, and reasoning belongs in `legal_position` / `practical_position` — which the reader opens
the moment this sentence says yes. **The parser rejects a `net` carrying either mark**
(`findings_net_chained`), and so does the pre-delivery lint (`net-conclusion-form`). Neither checks
length: there is no cap here and none is coming.

**THE REASONING MOVES; IT NEVER DISAPPEARS.** This is a relocation, not a compression. Every clause
the old chain carried — the territories, the goods paraphrased to the worst overlap, the owner's
actual business, the status and use history, the revocation exposure — is still owed, in full, in the
positions below. A `net` that got shorter because the reasoning got thinner is the one rewrite this
ruling rejects. Write the conclusion here; write everything that earns it there.

**DO NOT RESTATE THE BAND.** The band word is the verdict and it renders as the card's own chip, next
to this sentence. "A Medium-risk conflict" spends the sentence saying what the reader already sees.
Say what is true of the world instead: who prevails against whom, where, and on what.

**WHAT A CONCLUSION LOOKS LIKE.** Name the parties and the territory, and state the outcome as a
likelihood. *"Veltra Labs' registered VELTRA is more likely than not to prevail against VELTRA PHARMA
in the United States."* *"Nothing on the German register reaches the applicant's class-9 goods."*
*"Norvell Instruments — a laboratory-equipment maker — could oppose in the EU but has never asserted
against a software filer."* Each stands alone, and each is falsifiable.

**WHAT IS NOT A CONCLUSION.** *"The legal risk is that a junior composite adding only a descriptive
format word to a registered senior bare-word mark is unlikely to escape confusion"* — that is the
reasoning, opening on a hedge and never reaching an answer. Neither is *"not relevant"*, *"different
field"*, *"no overlap"*: those name nothing that was checked.

**Goods are paraphrased to the worst overlap, never quoted whole** — wherever they appear, here or in
the positions. A specification runs to 200 words and one phrase of it decides the conflict; name that
phrase. Where the specification is broad and you have paraphrased to its sharpest edge, the
scope-limiter is **`(among broad goods)`** — it tells the reader you narrowed and that the rest is
wider.

**Still no length cap.** A conclusion is short because it is a conclusion, not because it was
trimmed. Never drop a fact to fit; move it below.

### The grouped reasoned negative

Negatives render **grouped by the ground they share** — the group heading and its parenthetical ground
are supplied by code from the typed `disposition` / `off_field_ground` / `manageable.category`, and the
member line's jurisdictions and classes are read off the record. **The shared ground is therefore stated
once, by the renderer, and your `net` must not restate it.** Eight cards each re-deriving the same
clearing argument is exactly the shape this grouping replaced.

Each member line carries **only what is its own**: the goods paraphrase and the **specific** reason this
mark is not a conflict. Where the reason genuinely repeats across the group, **three words** — *"same
ground, pharmaceuticals"* — never a re-derivation. Where it does not repeat, that difference is the
whole value of the line: say it.

A negative is a reasoned negative or it is not in the report. *"Not relevant"*, *"different field"*,
*"no overlap"* name nothing that was checked.

### Section ordering

**Verdict first**, then **what was looked for and not found**, then **what was found**. A reader who
stops after the first paragraph should have the answer; a reader who stops after the second should know
the answer's coverage.

**The driver renders this order and you do not compose it.** You hand the sections back as values —
verdict, coverage, spine, calibration, the answers to the requester's instructions — and the driver
lays the document out in the order above. Your own stage dictation names the call that takes them; this
file does not, deliberately, because it is read by more than one seat and a tool named in shared
doctrine is ordered for every reader and granted to none.

This rule stays here because it is a rule about **what the reader needs**, and knowing it is what makes
each section the right length and the right thing: a verdict written as though the reader has already
read the spine is wrong even when the driver puts it first. What you no longer do is arrange them.

**Findings group by why they matter — never by jurisdiction or class.** Jurisdiction is the one thing
about a negative a reader does not need repeated, and a class number is a filing convention, not a
reason. Group by the ground: the conflicts that drive the verdict, the ones argued apart, the ones a
coexistence covers, the ones in another field.

**The four answers** (`four_answers`, top level): strength of third-party rights · likelihood of
objection · registrability · the client's own enforceability — each `{read, token, basis, ordinals}`,
tokens lawyer-authored with their basis, never a computed score. Emit what the run's material grounds;
**omit what it cannot** (the narrative carries the honest prose instead — an omitted answer is honest,
a faked token is a defect). The answers decompose the same judgment the verdict states — they must
agree with the findings and bands they cite, and they never mint a second risk statement.

## Grounding — a register finding cites its record (#8)

A finding sourced from a register (`source_type` = `register-vendor` / `register-euipo`) MUST carry at least
one grounding `owner.registrations[]` entry with a real record URI — it is the record the conflict rests on. A
mark known only from general knowledge — a famous one-keystroke neighbour with **no** fetched register record —
is **never** emitted as a register finding (an empty/fabricated registration is rejected by the findings
contract); it travels as a typed `context_notes[]` entry (`famous-neighbour-ungrounded`), exactly as
`prelim-register/digest.md` (A1) dictates. A register finding with no grounding registration is an **orphan** —
the driver's grading tripwire flags it; the cure is to ground it in the fetched record or move it to a context
note, never to ship it ungrounded.

## The record URL, and what to write when there is none

The record-URL contract lives in `prelim-register/status-rules.md`. **The half you need is here** because
you are the seat the validator refuses, and you do not open that file.

- Where the provider publishes a per-record page, `source.resolved_link` carries the **full composed
  URL** — that provider's record base host plus the record's `uri`.
- Where it publishes none — `clarivate`, `signa` — compose nothing and cite the office register in the
  text. **And "nothing" has a spelling:**

  **`source.resolved_link` is `""`** — the empty string. NOT the `uri`, not a fragment, not another vendor's host. "Leave the `uri` as it is" means do not MODIFY the record's own `uri` field; it does NOT mean carry that path into the link field.

Carrying `/mark/<cc>/<number>` into `resolved_link` is refused by `parseFindingsJson`
(`finding_record_url_not_a_link`), and that refusal has been the only place this value was written down.
A synthesis attempt that gets it wrong costs the run the whole attempt.

## Cancelled / invalid marks — include if exact, no commentary

Cancelled, expired, or otherwise invalid register hits are **included on the Findings sheet only when the mark text is an exact match to the proposed mark.** Treatment:

- Put them on the Findings sheet with the status accurately reflected (Cancelled / Expired / Abandoned).
- **Do not write them up in the narrative summary** unless the staff lawyer's upfront instructions say otherwise.
- They serve as historical context — the staff lawyer wants to see them but they don't drive risk for this clearance.
- Class / field is irrelevant for this rule — an exact-match cancelled mark in an unrelated class (e.g. adult products, Class 10) still goes on the sheet without narrative commentary; the PR / brand-safety angle is handled separately under `firm-wide-reasoning.md` (*PR / reputational risk*).

Non-exact-match cancelled hits are excluded from the Findings sheet entirely.

## Connotation / meaning-search — every recorded receipt is disposed of, and a clean claim also cites its source

The common-law layer runs a CONNOTATION / meaning search — the mark **and its near-forms** on the social/subcultural web (Urban Dictionary, Wikipedia, news, forums) for gang / slang / offensive / cultural meaning, **distinct from the marketplace grid** (the grid asks "who *sells* this name?"; this asks "what does this name *mean*, and to whom?"). In deterministic-grid mode the driver DICTATES these queries into the grid (`grid-spec.connotation`) and the `perplexity_research` plugin records each into the ledger's `extras.pr_risk[]`. **Every recorded query with results MUST be ruled on in the driver-written disposition form — a ruling and a note per row — whatever the section concludes.** That obligation comes from the receipts existing, not from what the section says: reporting a loaded reading discharges that reading, not the rest of the sweep, and a section carrying no clean claim is policed exactly the same. The validator rejects any unruled row (`connotation_no_ruling`) and any row naming a receipt that is not one of its own candidates (`connotation_form_damaged`). A section that ADDITIONALLY asserts a CLEAN result (`None identified` / "no gang/offensive association" / "affirmative sweep") must carry a `- **Connotation-search source:** <URL | "perplexity_research — no result">` line — the driver's `commonLaw` validator rejects the findings file otherwise (`connotation_search_missing`). A clean connotation is sayable **only** when the meaning search ran; a benign dictionary gloss is NEVER a clearance (a mark can read as a benign old given name yet sit one letter off `Sureño`, a street-gang label — a benign primary meaning does not clear an offensive secondary one). An empty-results search is a clean receipt; a missing search is not.

**Read it, don't just receipt it — the search running is not the work being done.** The receipt proves the meaning search *ran*; it does not mean anyone *read* it. Do not accept the common-law layer's bottom-line `clean` / `None identified` at face value — read the actual readings it surfaced for the mark **and each near-form** like a skeptical lawyer: **is the obvious meaning the whole story, or is there an odd, loaded, or unresolved secondary reading the tidy gloss skipped past?** (`sureña` = "southerner" is the tidy gloss; `Sureño` is the street gang the same word carries — the geographic reading does not clear it.) This is a **general habit, not a meaning-only checklist**: wherever a result resolves to a tidy answer, the question is whether one cheap thread is worth pulling before you accept it — meaning is simply where it bites first.

**Pull the thread in-run; don't defer what one search would settle.** When a secondary reading looks loaded or unresolved and a single check would settle it, run **one scoped `perplexity_research` query** now (the same tool you already use for the actual-use check) and record it inline as `- **Meaning-pull:** <query> → <result | "no result">`. This is judgment-gated, **not** a new per-run requirement — pull only the one thread that is both *worth it* and *checkable*. If it resolves, say so; if it surfaces something real, carry it. This settle-don't-defer rule is **general**: a live question a single cheap search would close is closed in this run, not written down as homework. The honest *"a human should look"* outcome (a staff-lawyer purple bullet / `coverage_judgment.sufficient:false`) is reserved for a question **genuinely unanswerable now** — never for one a single search would have closed.

## The mark itself — standing assessment (every run)

Every run carries a standing assessment of the APPLICANT'S OWN mark — whether or not the brief asks for it
— emitted as the typed `mark_assessment` top-level field in findings.json (`{"distinctiveness","connotation"}`;
the report renders it as "The mark itself" at the top of both report variants). It is **advisory** (for the
reviewing lawyer to assess), frames the report, and **never moves any band**.

- **Distinctiveness** — the spectrum read (coined / arbitrary / suggestive / descriptive) in the applicant's
  field, the dominant element, any obvious registrability flag — and the **per-market read of the
  translated/transliterated forms** from the variant manifest's *Distinctiveness & registrability* section
  ("descriptive once translated in <market>" is exactly the kind of point this block exists to carry).
- **Connotation & meaning** — what the mark reads as, **English AND non-English** (the meaning sweep incl.
  the non-Latin/translated bucket): a loaded / subcultural / offensive secondary reading surfaced honestly —
  or the clean result stated as a **data point** ("no adverse readings across <the languages/scripts
  searched>"), never an unsearched assertion. **Lead with the flagged reading.** Where something surfaced, it
  is the first thing the field says. Where the sweep genuinely came back clean, say so once and stop —
  **never open with an inventory of what the mark is NOT** ("no offensive reading, no gang association, no
  adverse political connotation…"). A list of absent problems is the most recognisable machine tell there is,
  and it buries the one reading that matters on the runs that have one.
- **Own-assessment voice, not a sweep dump** — **one or two sentences each**, plain client English ("coined
  and strong"). This block ran 854 words on a delivered report; its job is two short reads. Per-class,
  per-market and counter-registration detail goes into the **typed rows** of the structured form
  (`per_class` / `per_market` / `counter_registrations`), which the report collapses behind toggles — never
  into a longer paragraph. Real PR / reputational **hits** still live in the PR / reputational section (see
  above); this block is the standing read, not the incident report.

## Filed-vs-used check — mandatory for findings above the lowest band

For every register finding advisory-rated ABOVE the framework's lowest band, synthesis runs an actual-use marketplace check via `perplexity_research` (see `phase2-execution.md` Step 3.5), scoped to owner + mark + the goods/field, and **records the result inline**. Any finding whose mitigant turns on the *absence* of use (non-use revocation/cancellation, "not in actual use", "no marketplace use found", "owner's use unknown") MUST carry a `- **Use-check source:** <URL | "perplexity_research — no result">` line — the driver's `narrative` validator rejects the narrative otherwise (spec 11). A use-negative is sayable **only** when a search produced it; an inference from the owner's profile ("a music act → probably no game use") is **not** a searched result and must be either run or labelled an inference, never dressed as a clean negative.

## Own-rights evidence — mandatory when reasoning relies on the client's house mark (spec-v3 A4)

The same enforced contract applies to the client's OWN rights: if a finding's clearance reasoning relies on the client's house mark or franchise root ("the prefix is the client's own registered mark"), synthesis runs ONE own-portfolio check over the run's FROZEN register material — `band_lookup` with `owner:<the applicant/house-mark owner>` (plus `band_record` for any registration cited) — and the finding MUST end with a `- **Own-rights source:** <record URI(s) | "no applicant-owned registrations in the searched register material">` line — the driver's `narrative` validator rejects the narrative otherwise. **Know what the negative means:** the frozen material covers only this matter's dispatched slices (its classes, its mark texts), so an empty owner lookup is NEVER evidence the client's registrations do not exist — a house mark's registrations usually live in the client's home classes under mark text no slice covers. Never write "no registrations found" or any portfolio-wide register-negative: state the honest scoped negative, let the reasoning stand or fall without the crutch, and record the un-run owner query (owner + house root + its home classes/key jurisdictions) as an open Coverage/open-item row so the escalation lane can propose it through the supplemental mint — the same treatment as any instructed check the frozen material cannot answer. The affiliate-exclusion mandate governs *conflicts* (never flag the client against itself); it does **not** suppress this *supporting-evidence* check — those are different things.

**The staff lawyer's rule:** Any use of a registered trademark that poses medium risk or higher (any band above the framework's lowest) is relevant. The actual-use check applies **after** the preliminary legal read is made — not before. The correct sequence is:

1. **Stage 1 — Legal claim strength, net of merits defences:** Make the legal read as the probability the claim prevails, stated in plain likelihood words — the whole-mark confusion read, **net of the credible merits defences** named in the per-finding structure (descriptiveness / weak senior mark, the opponent's own undermining conduct, the client's fair-use defence, priority). Whether **our actual use meets theirs in the market** (real commercial / manner-of-use / channel overlap) IS part of this Stage-1 read — it is the goods-half of likelihood-of-confusion and it sets the read: our use being a descriptive / in-product label vs their standalone source-brand, or the two sitting in a genuinely different commercial field, is a merits reason the claim may not prevail → the **client-favoured read**. **The basis for "theirs" splits by right type:** a **registered** senior meets us on the mark and G&S **as registered** (read the specification; quote it when it decides the point) — never on the owner's current presentation; a **common-law** senior meets us on its **actual trade**. OUR side of the meeting stays our own actual/intended manner of use (per the request form) — that lever is untouched. What stays in Stage 2 is the *senior's enforcement reality* — is the mark actually used, revocable for non-use, will the owner bother, how the owner currently dresses or positions it in the market — **NOT** whether the uses meet. (Merits defences are claim-strength, not practical mitigation; they belong in the legal read.)
2. **Stage 2 — Practical risk mitigation:** For every hit whose legal read reaches "more likely than not they'd win" or worse, apply the practical mitigants — actual use, revocation-vulnerability, owner enforcement appetite, coexistence. These are the **business read**. **Response availability is Stage 2 at most:** that a route exists — coexistence, consent, rebrand, a cancellation lever — never enters the Stage-1 Legal position; mitigation-availability speaks only through the framework's own **Practical position** words for the band it belongs to.
3. **Stage 3 — the band:** reason the two reads through the **framework in force's own method** — its per-band Legal position / Practical position / Potential outcomes definitions, or its Level × Dispute Type matrix where it states one — and state the band **word**, verbatim from that framework. The band is never chosen freely or hand-adjusted: the reads move the framework's *inputs*, its stated method yields the band, and any **ceilings it states are honoured as written** — a practical or optics factor never lifts the band past what the method produces. This is how "nothing from the business read may move the legal read" is enforced. What can shape the practical input is **enforcement appetite assessed from the owner's own track record** (known C&D practice, litigation history, public enforcement campaigns — NOT inferred from owner size, brand fame, or client-relationship / partnership context); those are optics (Reasoning posture 3) — they annotate the business read and **never move the band**.

**Administrative liveness is not market use.** A renewal, re-registration, Madrid re-designation,
assignment, or a status of "Registered" / "Renewed" shows the registration is *administratively alive*
— it is **not** evidence the mark is *used in the market*, and it does not answer the Stage-2 "is it in
use?" question. Non-use revocation vulnerability turns on actual use in the relevant goods/services, not
on registry upkeep. Do **not** cite a renewal (or any administrative event) as defeating a non-use /
revocation-vulnerability mitigant. (Schematic: a product cancelled before launch and never sold, whose
mark is later renewed, remains fully non-use-vulnerable — the renewal is upkeep, not use.)

**Actual-use assessment results:**
- **Use confirmed in the searched field** — risk weight stands; cite the marketplace evidence in Key Factors.
- **Use not found in the searched field** — **do NOT automatically downgrade.** Assess whether the registration is also vulnerable to non-use revocation (see Revocability rule below). If vulnerable, note the combination as a mitigating factor in Key Factors. If not yet vulnerable (registration is within the non-use grace period), note the lack of use as context only — the registration is still legally enforceable. The staff lawyer's rule: "Lack of use does not always downgrade the risk, as the registration may not yet be vulnerable to revocation. Always assess the use for 3+ marks and comment on the use (or lack thereof), but do not automatically downgrade for lack of use."
- **Use unclear / ambiguous** — note in Key Factors and flag for the staff lawyer with a purple bullet: "Staff lawyer — confirm whether [owner] actually uses [mark] for [field]."

**Rule on downgrade quantum:** There is no automatic downgrade rule. Use is one factor among several in Stage 2. A registration with no identifiable marketplace use may still carry full legal risk if the registration is not yet vulnerable to revocation (e.g. within the 5-year non-use window in many jurisdictions). Document the use assessment and revocability status together in Key Factors; let the staff lawyer weigh the combination.

## Prosecution history — mandatory for identical-mark hits in relevant classes

For all identical-mark hits covering identical or similar goods/services, check prosecution history as a standard step — not only when a flag is raised. The staff lawyer's rule: "I would check prosecution history for all identical marks covering identical/similar goods and services, especially (but not exclusively) where there is a global portfolio of marks."

**How to apply:**
- If the owner has filed the mark in multiple jurisdictions, check whether any related filings (same mark, related owner entities) have been abandoned or lapsed.
- If an abandonment/lapse pattern is found, treat it as an enforcement appetite signal — document in Key Factors.
- This check does NOT require a separate tool call in most cases: it is visible in the register-layer findings (Corsearch/Clarivate record detail fields show prosecution status, related applications, abandonment dates). The discipline is in reading it, not in adding a new search step.
- The check is NOT global-portfolio-triggered — it applies to every identical-mark hit in relevant classes.

Document in Key Factors: "Prosecution history checked — [finding]." If abandonment/lapse found: "Prosecution signal: [owner] let the [jurisdiction] application lapse on [date] / cascaded IR cancellations in [countries] — enforcement appetite assessed as [low/moderate]." If no lapse found: "No abandonment pattern identified — prosecution history consistent with active enforcement."

## Revocability — mandatory assessment for register findings above the lowest band

> **Moved.** This section is now in [`firm-wide-reasoning.md`](firm-wide-reasoning.md), which this lane reads alongside this file. It moved because the knockout lane needs it too and one copy is the only way it cannot drift.

## Verify-or-defer — procedure, deadlines, registry statistics

Assert a procedural route, a deadline, or a registry statistic **only with a verification basis**; never
attach time-critical urgency to a mechanism you have not verified. Both verification channels are available
to the skill — use them:

- **Procedural / process knowledge is web-checkable.** Where a route or deadline informs the read, verify it
  (freely available legal process knowledge) rather than asserting from recall. If you cannot verify it this
  run, state the **objective** ("challenge on absolute grounds") and leave the **instrument unnamed** — do
  not name a route or a deadline you have not confirmed exists, and do not invent an instrument the
  jurisdiction lacks. **In prose the limit is a fact, stated once** ("the instrument turns on local
  examination practice this run could not reach"); the referral itself is a **typed action**
  (`counsel-opinion-required`) in the `actions` register, which code renders. A prose referral —
  "(local advice needed)", "defer to local counsel" — is a prescription and never reaches a reader
  ([report-prose.md](report-prose.md) → *Fact · assessment · prescription*).
- **Registry base rates are a mechanical query.** Where a base rate informs the read (e.g. how often marks in
  this class/office register vs. refuse in a window), run the provider's date-range / status filter and report
  the counts — *give the numbers, not an adjective*.

This is the analytical counterpart to the rendering rules already in `delivery-contract.md` ("never assert
foreign procedure as fact" + base-rate counts + bounded ratings)
(no unverified metrics): here you *do the verification or defer*; there you *phrase* it. The
`narrative-refutation` skeptic blocks urgency asserted on an unverified mechanism.

**A time-critical deadline is an ACTION, not a footnote (#6).** When — on the SAME verify-or-defer basis above —
you confirm a conflict imposes a date the CLIENT must act on (an **opposition window**, a **statement-of-use**
deadline, a **renewal** the client must contest/file), it cannot live only inside the risk narrative where it can
be missed until it lapses. Do two things: (1) carry it as the STRUCTURED `deadline: { kind, date }` on that
finding in `findings.json` (`kind` = opposition / statement-of-use / renewal / …; `date` = the ISO date the
action is due) so the driver surfaces it as a time-critical alert; and (2) state it as a near-term ACTION in the
deliverable's **Actions** section (the time-critical bucket per `delivery-contract.md`), not buried mid-letter. Only attach `deadline` to a date you VERIFIED (or expressly
defer the instrument per the rule above) — never an asserted-from-recall window. A finding with a near-term
`deadline` the deliverable does not surface as an action is flagged by the driver's grading tripwire.

## Volume is not a risk multiplier

> **Moved.** This section is now in [`firm-wide-reasoning.md`](firm-wide-reasoning.md), which this lane reads alongside this file. It moved because the knockout lane needs it too and one copy is the only way it cannot drift.

## Common-law scope — narrow

The common-law layer searches narrowly: identical or near-identical mark in identical or adjacent fields (most often gaming, but field follows the clearance target). It does **not** sweep for conceptual similarity — that is the register layer's job.

When judging which common-law hits to include in the Findings sheet:

- Include: identical mark in the same field, near-identical mark (one-word swap, plural variation, phonetic equivalent) in the same field, identical mark in a directly-adjacent field with channel overlap.
- Exclude: conceptually similar but lexically different marks (e.g. "Chart My Course" surfacing for a "Chart Your Course" clearance is borderline — include only with very-similar / same-field overlap).
- Document the scope decision in the narrative's Methodology note so the staff lawyer can see what was and wasn't searched.

## Watchlist findings — automatic inclusion

Watchlist matches (aggressive enforcers / major brand owners / competitors) are flagged in the variant manifest. When such an owner appears in ANY layer's findings, the finding is included in the deliverable regardless of legal-test result. Per the staff lawyer: "I'll absolutely include that in the analysis."

Type column for watchlist-only findings (where legal-test doesn't independently elevate):

- **Aggressive enforcer match** → Type = "Of Interest" + Notes: "Watchlist — aggressive enforcer"
- **Major brand owner match** → Type = "Of Interest" + Notes: "Watchlist — major brand owner; business-relevant context"
- **Competitor match** → Type = "Competitor Intelligence" + Notes: "Watchlist — competitor"

If the finding ALSO independently triggers risk-framework elevation (e.g., legal-test scores it Level B), use the stronger Type and add the watchlist note.

## Common-law source attribution — never confabulate the owner/seller

This discipline is **vertical-agnostic**: it covers ANY common-law finding's source — a game title's developer/publisher, a retail/marketplace listing's seller or brand owner (Amazon, GNC, iHerb, Walmart), a social/web brand's operator. The attribution MUST come from the extracted record, never inferred from prior-frequent names in the field. Gaming is the worked example below because that is where the failure mode was first caught; apply the same rule to a beverage marketplace seller or any other source.

For every common-law game-title finding (Steam title, Microsoft Store title, App Store title, itch.io title), the developer / publisher attribution in the narrative MUST come from the `developer_of_record` / `publisher_of_record` fields in `common-law-findings.md`.

**Do NOT confabulate.** Inferring publishers from prior-frequent gaming companies (Bandai Namco, Tencent, Capcom, etc.) is exactly the failure mode the `developer_of_record` schema exists to prevent. If the common-law worker did not extract the attribution, the field will say `not extracted` or be empty.

**When the attribution is missing:**
- Narrative: write "(developer unverified)" or "(publisher unverified)" inline, rather than guessing
- Excel Findings sheet: leave the Owner column blank or write "Unverified" — never populate with an inferred name
- `placement-inquiry` will have placed any unverified-publisher game-title at sheet-2 with a verify-publisher flag; synthesis carries that forward, never promotes to headline without attribution

The `narrative-refutation` gate (Phase 2 Step 4.7) blocks delivery if the narrative contains a named publisher / developer not traceable to `common-law-findings.md`'s extraction.

## Registration metadata — copy, never restate

Same anti-laundering discipline as common-law attribution above, applied to **register records**: a registration fact is **copied verbatim from the fetched record, never restated from memory.** This covers the **registration number, application/serial number, filing date, registration date, expiry date, Nice classes, and live/dead status.**

For every register finding, these fields MUST come from the fetched record as captured in `register-findings.md` (the normalised record fields the register layer extracted). **Do NOT generate, paraphrase, infer, or "round" them.** Re-typing a reg number, nudging a filing year, or assuming a 10-year expiry cycle is exactly the failure the `registry-record-match` guard catches — and on a verifiable numeric field the driver will now **overwrite your value with the record's true value and log the correction**, so a restated figure is both wrong and visibly so.

**When the record does not carry a field:** mark it **`(unverified)`** inline — never fill it in. The record is the *only* permitted source for a registry identifier; if a card cites a record URI the run never fetched, its registry values are unverified by construction.

The principle is the famous-mark URI guard at the metadata level: **no registry fact without a record behind it.**

## Firm-wide reasoning discipline (applies under every framework)

> **Moved.** This section is now in [`firm-wide-reasoning.md`](firm-wide-reasoning.md), which this lane reads alongside this file. It moved because the knockout lane needs it too and one copy is the only way it cannot drift.

## Synthesis output

### Distil for the reviewing lawyer — one reader, read in order of what she needs

The report has a single audience: the reviewing lawyer. Optimise for a fast, high-trust review (the `delivery-contract.md` shape encodes the layout — set it, don't re-explain it):
- **Bottom line first** — `overall_caption` is ≤3 sentences of plain legal English, ~20–25 words each: risk level + the one finding that drives it + **the fact that conditions reliance**. **Never the recommended action** (ruled 2026-07-30 — facts, evidence, assessment, weakest point, deadlines and process facts; no mitigation advice, no disclaimers): the forward asks are typed into the `actions` register and rendered by code, and a caption restating one as an instruction is a delivery defect. No engineering register ("Composite N" / "Level C" codes from the retired scale, "axes", "Option D", query/fetch counts) — the overall risk is stated in the framework in force’s band words.
- **Open external actions promoted** — the registry/renewal/owner-identity checks are typed into the `actions` register (the report's forward-ask section is code-built from it), never buried in coverage prose. Write each one in **lawyer English**, as something a lawyer would say aloud to a client — *"Investigate whether the owner is using the mark in Germany"*, never *"test for non-use"*, and never an engine mechanism as the ask (*"rerun the owner-by-owner screen"*, *"close the script gaps by the transliteration index route"*, *"read the unread registry documents"*). Reading this run's own records is the engine's job, owed before delivery — it is never printed as something the reader must do.
- **Plain legal English in the cards** — `label`/`one` carry the legal substance and the `::p::` internal notes; they are not engineering headlines.
- **Telemetry + debug out of the body** — run counts, axis mechanics, and any internal calibration note (e.g. an A–E framing correction) live in the run-dir / audit; Methodology is a short note that renders collapsed.

Distillation is *removal and relocation*, not added prose.

### House prose contract (P6 — spec §7 + the lawyer walk-through, 2026-07-30)

Guidance, deliberately **not** a lint — a code gate on prose adds redelivery cycles and removes the
flexibility the judgment needs. The stage message carries this contract verbatim; the two levels must never
teach different rules.

**This section is the PROHIBITIONS.** What a good finding positively reads like is
[report-prose.md](report-prose.md), which every prose stage reads: fact · assessment · prescription;
hedge the assessment, never the fact; numbers do the work adjectives would; say it once; concision never
trades away a fact; the controlled assessment vocabulary. Read both — a report that breaks none of the
rules below can still be unreadable.

- **Word budgets.** ~20–25 words a sentence, ~80 a paragraph. Where code folds at a hard cap (3-sentence
  caption, 2-sentence read), the cap is the **fold point, not the target** — three 60-word sentences obey it
  and defeat it.
- **Each fact once, at its rank.** A finding is stated in its own row; the caption names the decisive one and
  no other; a later section **cross-references by ordinal**, never retells. One delivered report told a
  single mark in six of nine sections — repetition, not sentence length, is what made it undigestible.
- **No prescriptions (ruled).** Facts, evidence, assessment, the weakest point, deadlines and process facts.
  No *"we recommend / advise / suggest"*, no *"you should"*, no *"the practical path is"*. Forward steps are
  typed into the `actions` register and rendered by code — nowhere else.
- **No disclaimers (ruled).** A real limit is a **fact**, stated once, in consequence terms.
- **One reader, one posture.** Every surface is written for the reviewing lawyer, in the calibrated register
  of an advisory preliminary assessment. Never hedge *more* on one surface than another, and never flatten
  one to bald assertion — the hedge is calibration, never a stand-in for a fact the run holds.
- **The reader owns every noun.** Every noun on a reader surface is a word the reader already holds — from
  their business, their market, or the law said plainly. Where the run has no reader-facing word for a
  thing, **describe** it rather than name it: *"the full variant band enumerated to zero"* → *"we searched
  every spelling of the name and found no live rights"*. The bar is one pass — a smart reader who is not a
  lawyer takes the meaning the first time. Judge the sentence, never the word: a mark genuinely called AXIS
  or BAND is written exactly as it is named. The positive standard is
  [report-prose.md](report-prose.md) → *The reader owns every noun*.
- **Say the level, not its neighbours.** *"a manageable risk"*, never *"sits below that level"*.
- **Name third-party rights as rights.** *"<MARK>-formative rights"*, *"rights that contain <MARK>"* — never
  *"<MARK>-branded"*, which mis-attributes the right to the client.
- **Never assert a fact about the client.** *"Consent is not in hand"* claims something about the client's own
  file that no search reached; write *"no consent appears on the record searched"*.
- **A private act's absence proves nothing.** C&D letters, settlements, licences and consents are unreachable
  by any search — *"no enforcement history surfaced"* is never written, or positioned, as *"the owner does
  not enforce"*.
- **Name the legal test in plain words.** *"applying the well-accepted framework for confusion — the marks as
  wholes against the goods and services"*; never a court's factor template recited as the structure of the
  analysis, and never a decision this run did not fetch.
- **Cut filler.** *"session-wide notice coverage"*, *"it is worth noting that"*, and any sentence whose
  deletion loses nothing.

The narrative summary (email body) is the human-readable distillation. The Findings sheet is the structured manifest. Both must be consistent — every narrative bullet about a finding traces to a Findings row, and every RATED finding gets at least a mention in the narrative.

When the narrative says "[owner] uses [mark] in the market but has no register protection — Level B," there must be:
- A Findings row for that marketplace use (Source Layer = "Common-law")
- A Cross-pollination row in Audit Trail showing the register check that confirmed no protection
- Or, if the cross-check found protection, a separate Findings row for the register filing (Source Layer = "Register" or "Both")

Inconsistency between narrative and Findings sheet is a delivery failure — checklist gates for both.

### Consistency contract — one record, one composed URL, everywhere

Every owner/mark mention in the deliverable that corresponds to a **register finding** MUST resolve to the **same register record** as that finding's row in the structured deliverable — the narrative bullet, the Findings-sheet row, and any other surface all point at one record, never at divergent ones. The single shared link target is the **composed record URL** from the **record-URL contract** (see [prelim-register/status-rules.md → Record-URL contract](../prelim-register/status-rules.md#record-url-contract) and the digest's findings format): the configured provider record **base-host** + the record's `uri` (`/mark/<cc>/<number>`) path. There is **exactly one URL per record**, composed from `uri` — no separately-maintained link sets, no per-surface URL variants, and no URL drift between the narrative and the sheet. If the narrative names a register conflict, the URL behind that name is the same composed URL carried in that conflict's findings row; a mismatch is a consistency failure the `narrative-refutation` gate flags.
