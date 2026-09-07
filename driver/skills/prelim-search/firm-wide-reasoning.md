<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright 2026 Cordillera Sàrl -->

# Firm-wide reasoning discipline

**This file is the ONE copy.** Every section here was MOVED out of `synthesis-rules.md` — not copied —
because more than one lane needs it and a second transcription is exactly the drift that let the
knockout lane rate under a retired rulebook while this discipline sat in a file it never read.

Read by the clearance lane (`synthesis`) and the knockout lane (`knockout-assess`). What belongs here is
reasoning that is true under EVERY framework and in every lane. What does not belong here is anything
that names an artifact only one lane produces — that stays in the lane's own doctrine. The heading in
`synthesis-rules.md` used to make the "applies under every framework" claim with nothing keeping the
clearance lane's own material out of it; the boundary has a file of its own now.

**This file names no tool.** A tool named in a shared skill document is ORDERED for every reader and
GRANTED to none, and the agreement guard then fires on whichever innocent stage also reads it. Tool
orders belong in a stage's own dispatch.

## Risk calibration adjustments (vs the v2 common-law-only framework)

The risk-framework calibration rules originated in a common-law-only context. With register evidence available, three rules need adjustment:

### RF-10 update (was: "pending register overlay")

**v2 (common-law only):** *"Frame all assessments as pending register overlay. Standard caveat: 'Ratings reflect our common law assessment. Register analysis may adjust ratings in either direction.'"*

**v3 (register included):** when register analysis ran AND surfaced live filings related to the finding, the assessment is no longer "pending overlay" — it's confirmed. Use the caveat only when:

1. Register skipped (e.g., provider failed mid-run) — in which case fall back to v2 wording: "Ratings reflect our common-law assessment only — register layer unavailable this run."
2. Register completed but no live filings surfaced for the finding's entity — note: "Register search returned no live filings for [entity] in target classes; rating reflects common-law evidence only." **Only sayable when that entity's material jurisdictions are `confirmed-clean` in the coverage ledger.**
3. Register completed and surfaced live filings — drop the caveat entirely. Synthesis cites the register evidence directly.
4. Register ran but the entity's material jurisdictions are `deferred` / `coverage-limited` in the ledger — do NOT say "no live filings." Caveat per the Coverage-honesty rule: "Register coverage for [entity] in [jurisdiction] was [deferred/limited] this run — not a clean negative" (the verdict carries it). doc-35: do NOT append "[scope] sweep recommended" — a search-reachable gap is closed or an internal note, never a client commission-a-sweep caveat.

### RF-15 update (was: "Register Risk Estimate")

**v2 (common-law only):** *"Register Risk Estimate (purple bullet, mandatory for Composite 2+). Estimate whether register filings are likely based on how common/commercial the phrase is."*

**v3 (register included):** estimation becomes confirmation when register actually ran. Replace the purple bullet with one of three states:

| State | Wording |
|---|---|
| Register ran, found filings | "Register search surfaced [N] live filings related to this entity (see Findings #X, #Y)." |
| Register ran, no filings (material jurisdictions `confirmed-clean`) | "Register search returned no live filings for [entity] in target classes — common-law-only basis." |
| Register ran, but material jurisdictions `deferred` / `coverage-limited` | "Register coverage for [entity] in [jurisdiction(s)] was [deferred/limited] — not confirmed clean" (the verdict carries it; no "sweep recommended" caveat — closed in the run or an internal note). |
| Register skipped | Original v2 estimation language: "Register filings likely based on commercial visibility — the staff lawyer to confirm." |

### Stealth-filer recalibration

When register surfaces a stealth-filing pattern (law firm as owner), the finding can be rated even without common-law marketplace evidence, because the stealth-filer pattern itself is a risk signal. Default calibration (reason it through the framework in force; the likelihood words drive the band):

- Stealth-filer in target classes + inside the non-use grace period = a real, enforceable register conflict — the prior owner is plausibly **more likely than not to win** on the paper while the grace period runs → typically the framework's **middle band**.
- Stealth-filer in target classes + outside non-use grace = revocation-vulnerable; absent additional evidence the client has the better of it with material risk remaining → typically the framework's **lowest band**.

Confirm during historical-case review with the staff lawyer.

## Revocability — mandatory assessment for register findings above the lowest band

For every register hit rated above the framework's lowest band, assess whether the registration is vulnerable to revocation for non-use in the relevant goods/services and document this in Key Factors. This is a standard step for every such hit — not triggered only by unusually broad G&S specifications.

The staff lawyer's rule: "It is always considered as a risk mitigating factor where a registration is vulnerable to revocation for non-use."

**Standard Key Factors statement:** "Registration covers [G&S text]. Owner's identifiable commercial use is [description / not found]. Registration [is / does not appear to be] vulnerable to partial revocation in [specific classes/goods] on non-use grounds."

Note: revocability does NOT automatically change the band. It is a mitigating factor for the staff lawyer to weigh alongside actual use evidence (see Filed-vs-used rule above). The combination of no identifiable use AND revocability vulnerability is the strongest basis for a mitigation argument. A recent renewal does NOT cure non-use vulnerability and is not evidence of use (see "Administrative liveness is not market use" above) — do not let a renewal date remove the vulnerability assessment.

**Canadian official marks exception:** Non-use revocation does not apply to Canadian official marks under s. 9 of the Canadian Trademarks Act. See *Canadian official marks* under Firm-wide reasoning discipline below.

## Volume is not a risk multiplier

Total worldwide filing count is NOT a risk factor. Risk is assessed per owner/mark combination, not aggregated across all filings.

If 27 identical filings exist across 27 unrelated owners, each is assessed independently — the count does not raise the composite. Document the volume as context in the narrative methodology note: "[N] exact-match filings found across [M] unique owners — each assessed independently; volume not used as a risk multiplier."

High filing volume in a field is evidence of crowding (see *Crowded field analysis* under Firm-wide reasoning discipline below), which if anything reduces the enforcement power of any individual holder — it is a neutral-to-mitigating signal, not an elevation signal.

### When the crowded-field frame is available as a mitigant (gating precondition)

Crowding is neutral-to-mitigating, but it does not become an active **mitigant** automatically — applying the dilution frame requires earning it. **Durable principle: a saturated element raises the search bar BEFORE it can lower the risk** — you may not invoke "crowded field → dilution → lower risk" until the crowd has been *enumerated*, filtered by goods, worldwide. The crowded-field / dilution frame is available to mitigate a finding **ONLY when all three of the following are surfaced in that finding's Key Factors**:

1. **The crowded-field count** — the actual volume **in THAT conflict's jurisdiction × goods lane** (dilution is earned per conflict: volume in another jurisdiction, or an adjacent goods lane, earns nothing against this right), taken from the `saturation-probe` axis (the macro count), a band block's `total_hits` (an `incomplete` crowd descriptor's `total_hits` **IS the counted field** — spec-49: a crowd over the enumerate ceiling is *definitionally* un-enumerable, that is why it is a descriptor; enumeration is NOT required to earn the dilution frame), or the register findings' `## Summary`. Not "the field feels crowded" — the number. A paginated top-N **sample with no total** is still not a count ("top-50, total unknown" earns nothing); a descriptor carrying the worldwide `total_hits` does. Whether an un-enumerable dominant-element crowd is MATERIAL is your `coverage_judgment` call (per-mark reasoning), never an automatic block. (In the report, write "crowded field" / "many similar marks", never "saturation" — rule 8.)
2. **The named narrowing mechanism** — the specific G&S or jurisdiction filter that makes the field *tractable in this lane* (e.g. "545 live JELLY filings worldwide, but only 6 in Class 9 gaming software in the target markets"). Volume in an adjacent lane does not dilute the lane the conflict actually sits in.
3. **The named live conflicts that survive that narrowing** — the on-point in-class hits that remain after the narrowing filter, named. **Crowding cannot mitigate away a surviving on-point in-class conflict:** a heavily-diluted element caps how high any *individual* holder rates, but it does not erase an identical / near-identical in-class mark from the findings (that is the dominant-element spine, rule 2 above). The frame mitigates the *weight* of a surviving conflict; it never deletes it.

**Absent any one of the three, the frame is unavailable and volume is neutral context only** — documented in the methodology note (per the count-across-owners rule above), never invoked to soften a finding's risk. A bare "the field is crowded so this is lower risk" with no count, no named narrowing, and no surviving-conflict list is exactly the F-4 failure: dilution asserted as a conclusion instead of earned from the evidence. This gates against waving away a real in-class conflict on unquantified crowding.

The calibration of *how much* a properly-earned crowded field caps risk lives in *Crowded field analysis* (under **Firm-wide reasoning discipline**, this file) — the cap is a **ceiling, not a floor**: a crowded field caps any individual holder at the framework's **middle band** *maximum* — it does not amplify, and it does not auto-downgrade on volume alone — **but** a diluted element whose holder is also distinguishable from our use **on its registered scope** (the mark and G&S as registered — never its current presentation) reasons *below* the middle band to the framework's **lowest band**; "caps at the middle band" means "no higher", never "no lower"; and an **active same-field brand in our core classes is not diluted away** — the crowd caps it at the middle band but does not drop it lower. This section gates **whether** the frame applies at all; that section calibrates **how much** once it does.

**Reconcile the population against what you carried (recall honesty).** The `saturation-probe` reports *how many* live marks share the element (the population); the findings carry the *on-point* subset. When the population is large but the carried on-point set is small, **state the gap explicitly** rather than letting the small carried count read as a thin field — e.g. "N live in the element space; M carried as on-point in the applicant's goods — recall here is by field-relevance (closeness to the applicant's goods), not by enumerating the diluted element." Closeness to the applicant's goods decides what is *recorded*; crowding decides only how much *weight* each carries (rule 2, the dominant-element spine). A large population with a small carry is the *expected* shape of a saturated field — but it must be **stated**, never silent, so a reader cannot mistake a recall decision for an empty field, and so an identical-name / identical-goods hit that the population contained but the carry dropped is impossible to hide.

## Firm-wide reasoning discipline (applies under every framework)

*(Migrated from the retired firm-neutral framework file (doc 50): the framework files now carry each
customer's deck ONLY; the firm's how-to-reason discipline lives here and applies whichever framework is in
force. Band references below use positional language — "the lowest band", "the middle band", "the top
bands" — because the words differ per framework; the framework in force supplies the words.)*

### The consumer confusion test — the governing gate (apply FIRST)

The likelihood-of-confusion test is **the threshold and the ranking key for legal risk**, applied
*before* practical factors — not an after-the-fact checklist. The staff lawyer's governing rule: *"Would a
consumer be confused, given a comparison of the marks AND a comparison of the goods and services? That
comparison governs the legal risk; practical factors are secondary — they adjust it up or down, but the
legal comparison comes first."*

**Step 1 — centre on the proposed mark's DOMINANT element.** Strip descriptive / non-distinctive elements
before comparing (the staff lawyer: *"a descriptive prefix is not something anyone can monopolise"* — so a mark of the
shape "PROJECT X" compares on **X**). The comparison and the whole search centre on the dominant element;
the variant manifest already flags the distinctive anchor, and **synthesis must rank by it.**

**Step 2 — compare marks as WHOLES, and rank by shared-dominant-element × G&S proximity:**

| Conflict shape | Confusion risk |
|---|---|
| Shares the dominant element, **no distinguishing affix**, same/related G&S | **Highest** — the bare dominant element in the field |
| Shares the dominant element but **adds its own distinctive matter** (a house mark or distinctive prefix — matter in the conflicting mark **as registered / as used as a mark**, never its packaging context) | **Lower** — the added element distinguishes the marks as wholes |
| Shares the element but G&S is **unrelated** | **Below threshold → not a legal finding** (see "Findings in unrelated fields") |

**Factors within the comparison:**
- Similarity of the marks **as wholes** (identical / near-identical / shares dominant element only / distinguished by added matter)
- Similarity of the goods/services — the co-equal half; unrelated G&S fails the threshold
- Channels of trade (same stores, same audience?)
- Strength of the *senior* mark **and** crowded-field dilution of the shared element (a heavily-diluted element caps every individual holder — see *Crowded field analysis*)
- Evidence of actual confusion
- Geographic overlap

Reason this comparison to a calibrated conclusion the way the worked-examples deliverables do. **The
goods-half of this comparison is whether OUR actual use meets the SENIOR RIGHT in the real market** —
manner of use, commercial field, channel and customer overlap — **judged against the senior right's own
scope**: a **registered** senior meets us on the mark and G&S **as registered** (read the specification and
quote it when it decides the point — the owner's *current presentation / trade dress* never reads the
registration down; that belongs to Stage-2 enforcement reality); a **common-law** senior meets us on its
**actual trade**. That is part of the **Stage-1 merits read and it SETS the legal read**: where our use is
a descriptive / in-product label and theirs is a standalone source-brand, or the two genuinely operate in
different commercial fields, confusion may not reach better-than-even and the read is the client-favoured
one **even on a near-identical word in a shared Nice class** — calibrated by the worked *goods-meet →
middle band* vs *manner-of-use-distinguishes → lowest band* pair (it is the move, not a "different use →
drop a band" rule). **The keep is explicit:** a genuinely different lane WITHIN a class — a different
shelf, channel, consumer or purpose, read from the **registered specification** — remains a full Stage-1
defence carrying the read to the lowest band or out of the rated set; the class number decides nothing in
either direction. **Only after** the merits comparison (marks-as-wholes × goods / use-meets-use, net of
merits defences) sets the legal read do the **Stage-2 practical factors — enforcement appetite,
revocation-vulnerability, will-the-owner-actually-act** (NOT commercial overlap, which is Stage-1) — feed
the framework's practical input, and the framework's method then yields the band (Reasoning posture 4).
Optics — owner size, fame, partnership — never move the legal read.

**Priority / timing.** The confusion comparison assumes the proposed mark is the later-in-time *junior*
mark. Flag where this doesn't hold: relative priority is **unclear**, a conflicting application is
**co-pending** (filed around the same time, not yet registered — neither is clearly senior), or the
applicant has **its own prior use** of the mark. Co-pending / unclear priority changes who is junior and is
a staff-lawyer-to-confirm item; the applicant's prior use may itself be a defence (weighed on the **business** read,
not the legal read — see the *client prior-use rule* below).

### Whole-mark comparison, not element-matching (the dominant-element rule)

Rank a conflict by the *whole-mark* confusion test centred on the proposed mark's dominant element — never
escalate on shared-element + class + audience overlap alone.
- A conflict sharing only the **weak/crowded** dominant element but carrying its **own distinctive element**
  (a house mark or distinctive prefix — matter in its mark **as registered / as used as a mark**) is **lower**
  risk; the added element distinguishes the marks. Treat it
  as the framework's **lowest band** for commercial awareness; do not headline it.
- **Mirror for the client side.** When the proposed mark will be marketed with the client's own house mark or
  distinctive prefix as part of the trade-dress presentation — confirmed via the request-form Manner of Use
  field (e.g. "[HOUSE-MARK] [MARK]", "[CLIENT] presents [MARK]") — the client's house-mark affix distinguishes
  the proposed use from bare-dominant-element third-party holders. Document in Key Factors: "Proposed mark
  travels as '[HOUSE-MARK] [MARK]' per Manner of Use; the affix distinguishes the client's use from
  bare-dominant-element third-party holders." Do NOT apply when manner-of-use indicates the mark travels
  standalone.
- **Containment bound (on both distinguishing moves above).** When the **entire senior mark** is contained
  in the proposed mark as an independent element — especially the **leading** element — confront its
  **independent distinctive role** inside our composite before applying either move: our added matter, even
  where it is the more distinctive element, does **not** by itself distinguish us from the very mark we
  contain — the contained senior can keep its own source-identifying role inside the composite. The
  added-matter / affix reads apply where the shared element is weak, crowded or descriptive — not where it
  is the senior's **whole registered mark** carrying independent distinctiveness. And the mirror is
  asymmetric by design: the **junior** side is judged on its **actual/intended use** (per the request
  form); the **senior** side on its **registered right** — never read the senior's registration down to its
  current presentation.
- The **highest** legal risk is the **bare dominant element in the same field** — it shares the distinctive
  element with no distinguishing prefix. Surface and rank these first, even if individually mitigated by
  non-use (see "never drop an identical-mark hit").
- **The framework's top bands require genuine whole-mark similarity + a famous / actively-asserted mark +
  likely actual confusion.** Sector/audience overlap, or a shared crowded element, never reaches them.
- **Guardrail — the distinguished read is the ceiling against ALL escalation theories.** Once the whole-mark
  comparison finds a third-party mark distinguished by its own distinctive matter, that read sets the legal
  read. No secondary theory — optics, partner-sensitivity, PR, audience overlap, owner size — may push the
  read above it; those are surfaced as annotations outside the rating (see *PR / reputational risk*). If you
  find yourself escalating a distinguished mark, **name the theory doing the work and confirm it is a
  consumer-confusion theory** (e.g. evidence of actual confusion); if it is not, the escalation is invalid and
  the distinguished read stands. Before *any* fact moves the rating, state in one line what it proves about
  **this** mark against **this** owner's rights on the element in dispute; a fact that does not bear on this
  confusion — a win on a different element, a default against an obvious copycat, or fame / size / partnership
  alone — is annotation, never a band-mover.

### Elevation factors (increase risk)

- Similar technology company / same industry
- Unsophisticated business (more likely to litigate than negotiate)
- Known aggressive enforcer **on the element in dispute** — a win on a *different* element of the owner's mark, or a default judgment against an obvious copycat, does not by itself make the owner an aggressive enforcer against a good-faith adoption that merely shares a crowded or descriptive element; enforcement counts as an uplift only where the owner has asserted *this* element (or one materially like it) in a *comparable* situation
- Highly distinctive mark (stronger protection)
- Suspicious proprietor / trademark squatter
- High usage metrics (downloads, revenue, market presence)
- Same channels of trade (the same marketplaces / retail channels — e.g. the same app stores for software, or the same retail shelves / e-commerce marketplaces for physical goods; same audience)
- **A descriptive/generic-looking element that is also a famous brand** — the everyday meaning can mask the trademark risk on a first-pass read; check whether the element doubles as a known mark
- **Owner active in a field adjacent to the proposed use** — cross-over activity (collaborations, branded products) raises real-world proximity; weigh it inside the goods/channels comparison, not as an automatic uplift

### Mitigation factors (decrease risk)

- Different industry / different technology
- Different channels of trade
- Low distinctiveness / descriptive mark
- Crowded field (many similar marks coexist)
- Geographic separation
- Different consumer demographic
- Low enforcement history / no IP disputes on record
- Non-use revocation vulnerability (dormant registrations may lower real-world risk) — note: a renewal / re-registration is registry upkeep, not market use, and does not cure this vulnerability (see "Administrative liveness is not market use")
  — **but (spec-48 C5): non-use is a REVOCATION defence, never an injunction shield.** A registered right can support an injunction without the owner's own use (country-dependent; grace periods run ~5 years) — "the owner doesn't use it → procedural risk only / no injunction exposure" is a forbidden inference. Non-use lowers the Stage-2 practical read; it does not neutralise the enforceable registration today.
- Credible distinguishing arguments available

### Factors that cut either way

- Extent of use (large = stronger rights but also more visible / more enforcement resources)
- Existing business relationship with the client
- Mark registration status (registered = presumption of validity; unregistered = may still have strong common law rights)

**Elevate / mitigate considerations move the framework's INPUTS — the legal read or the practical read —
never the output band directly** (Reasoning posture 4). A "confirmed aggressive enforcer", owner size, PR
sensitivity, or a commercial partnership cannot lift a finding past what the framework's method yields:
they only change *whether they'd win* or the *character* of the dispute, and the framework then produces
the band.

### Enforcer profiling — mandatory for findings above the lowest band

Assess: Is this a portfolio brand? TTAB/UDRP history? Institutional vs individual filer? "No large brands
or assertive enforcers" is a practical factor the staff lawyer weights heavily. *(`courtlistener__search` covers US
federal courts incl. CAFC trademark-appeal opinions — NOT raw TTAB proceedings. For TTAB direct
(oppositions, cancellations, ex parte), source is TTABVUE — separate integration, not yet wired.)*

Profiling informs the **business / practical read only — it never raises the legal read** (the read is the
confusion comparison; see *The consumer confusion test*). When the signals cut both ways — a broad
portfolio but no assertion on *this* element, an enforcer that is also a commercial partner — **reconcile
them in one line and state how they net**, rather than stacking the up-signals while footnoting the
down-signals.

### A "clean" read is only as good as the search behind it

A commercially plausible everyday phrase almost certainly has register filings somewhere; if the register
layer hasn't actually confirmed it, say so (coverage honesty) rather than reasoning to "clean" by
assumption. Ask: *did we search where this would plausibly be filed?* — don't assign or withhold a read by
default; reason it from what was, and wasn't, searched.

### The client prior-use rule

The applicant's own prior use can be a defence — **surface it, weigh it, don't compute it.** If the
applicant used the mark before the conflicting rights arose, ask what right that creates and how far it
reaches: strongest for the *same* goods (a continued-use right in that product line), weaker as the goods
get more distant, context-only for a merely-adjacent industry. Reason the practical effect on the business
read from those facts — do **not** apply a fixed "drop one band." Document the prior use and its scope in
Key Factors, and headline it in the narrative when it is same- or adjacent-goods. (Read the request-form
"Manner of Use" / "Additional Information" fields for this.)

### Language discipline

- **No dramatic language.** No "extremely difficult", "most dangerous", "massive", "enormous". The band
  communicates urgency — analysis text stays calm, precise, professional.
- **No specific quantitative claims from Perplexity.** No stream counts, sales figures, or volume metrics.
  Describe nature and reach instead: "major streaming hit" not "294M streams".
- **Flag institutional knowledge gaps.** Purple note: "Staff lawyer — please check for firm-specific history on
  [MARK]" when complex enforcement history or settlement patterns may exist.

### Common-law strength — observe, do not judge

When evaluating a common-law hit, **report the observable strength signals** rather than making a judgment
call on whether the use is "real enough" to count as risk. Signals to capture (when available):

- Marketplace / store reviews (count and rating) — Steam or an app store for software; Amazon / GNC / iHerb / a retailer for physical goods
- Installs, downloads, subscriber counts; units sold / retail distribution breadth for physical goods
- Time on market, last-update date
- Brand owner size (independent dev vs major publisher)
- Channels of trade and audience overlap with the proposed use
- Prominence in industry press or community discussion

Report the signals plainly in Key Factors. The staff lawyer weights them — the skill does not.

**Hard rule: never drop or dismiss an identical-mark hit regardless of how thin the apparent use is.** A
title with a single review, or a lone small-filer registration, still gets a Findings row — apparent
thinness is a Stage-2 mitigant, never a reason to omit it. The staff lawyer decides whether it matters.

### Player-created content — surface as commercial context

Player-created content on platforms like Fortnite Creative, Roblox experiences, Minecraft user-made worlds,
etc. is **almost never a legal blocker** (the platform terms typically vest no commercial rights in the
creator for the named experience). It is still **useful commercial context** — surface it in the Findings
sheet and the narrative, but mark it Low priority / Of Interest. Do not omit it.

### Common law risk can outrank filing risk

When a mark is in active, extensive use without a trademark filing (high download counts, large user base,
established reputation), it can generate stronger common law rights than formal registrations.

**Amplifiers even without a filing:**
- Very high usage metrics (50M+ downloads, prominent reviews/ratings)
- The mark used in the same or adjacent industry/genre as the proposed mark
- Use in jurisdictions that recognise passing off or unfair competition based on unregistered rights (UK, Australia, common law countries, EU)

**Reducers on practical risk from common law use:**
- Apparent low enforcement appetite (a prolific producer with no trademark filings of its own and no IP disputes on record — e.g. a prolific game publisher with no game-title filings, or a beverage/supplement maker with no marks filed and no enforcement history)
- Different channels of trade (e.g. app-store games vs. platform-native experiences; or a DTC supplement on Amazon vs. a mass-retail canned beverage)
- Different product category / theme within the field (e.g. puzzle vs. racing game; or pre-workout powder vs. ready-to-drink energy can)
- Credible distinguishing arguments available

Always evaluate both uplift and mitigation factors. Document both. **Significant common-law use even
without registered rights is a genuine middle-band conflict** under the framework in force — the prior
user's claim can be more likely than not to prevail where the uses genuinely meet.

### Scale-of-use context

When evaluating common-law use of a term, consider the **scale and commercialisation** of that use:

| Scale | Weight | Example |
|-------|--------|---------|
| In-game item name (small scale, not externally marketed) | Low | WoW's "Lamellar Sabatons" — item in game database |
| Product name used in marketing, monetised DLC, or promotional material | Medium | Named DLC pack with its own store listing |
| Brand name used in standalone products, licensing, or cross-promotional campaigns | High | Cross-promotional collab, dedicated game tie-in |

The same word can carry very different risk depending on HOW it's used commercially.

### PR / reputational risk — separate category, always include

PR and reputational risks are NOT trademark risks but **must be surfaced whenever the matter carries any
rated conflict**. The staff lawyer wants visibility on these — do not omit them.

They must be:
- Flagged in a separate section of the narrative (don't bury inside a trademark-risk paragraph)
- NOT rated on the framework's bands
- Labeled as "PR / Reputational risk" clearly
- Documented even if clean: "No negative connotations identified" is a useful data point

The scope is the run's OWN dictated meaning sweep — the fixed query shapes plus the matter frame's derived
`Meaning angles:` (cultural origin and communities the word evokes, charged history of the term or its
imagery, category-specific controversy for these goods), as recorded and disposed of in the common-law
findings' PR section. Never a generic sensitivities checklist: report what THIS mark's sweep surfaced (or
its disposed clean receipts), not a tour of categories no query asked about.

### Crowded field analysis

If there are many similar marks in the space (e.g., 700+ "Dungeon *" game titles on Steam, or 545 live
"JELLY" beverage/supplement filings worldwide), this is **supportive evidence** — it suggests another name
in the pattern can coexist, and it dilutes the enforcement power of any individual rights holder. **Always
note it in the narrative** — there is no numeric cutoff; the staff lawyer weights it case-by-case. Document:
- The volume (approximate count)
- The pattern (what naming convention is crowded)
- How this affects confusion risk (dilutes distinctiveness of any single mark)
- Calibration — **the cap is a CEILING, not a FLOOR.** A crowded field caps how high any individual holder
  can rate: many small, non-enforcing players cannot make a prior owner *likely to win*, so a crowd-capped
  holder tops out at the framework's **middle band**. It **never sets a minimum.** Where the shared element
  is genuinely diluted **and** the holder's mark is distinguishable from ours **on its registered scope**
  (added matter in the mark as registered, a different manner of use, or no real commercial overlap against
  the G&S as registered), the confusion read reasons *below* the cap to the
  framework's **lowest band** — "capped" means "no higher", it never means "no lower". Do not pull an
  over-threshold mark down to the cap and then stop there when the same reasoning that diluted it carries it
  lower. Never auto-downgrade on crowd volume alone; the crowd is dilution *evidence* for the judgment,
  never a machine rule.
  - **Guard (so the ceiling doesn't become a free downgrade):** a crowd does **not** dilute away an *active
    same-field brand operating in the applicant's core classes* — that holder's own use actually meets ours,
    so the crowd caps it at the middle band but does **not** drop it lower. An active in-field competitor is
    a real middle-band conflict, not washed out by volume. The crowd lowers a holder only when that holder's
    *own* use is also weak / distinguishable — judged on its **registered scope** (mark and G&S as
    registered), never on its current presentation / trade dress. And the crowd itself is counted **in that
    conflict's jurisdiction × goods lane** (the three-part precondition above): volume in another
    jurisdiction, or an adjacent goods lane, earns nothing against this right.

*(Whether the dilution frame is available at all is gated by the three-part precondition in "Volume is not
a risk multiplier" above — count, named narrowing, named survivors.)*

### G&S specification discipline — read before assigning risk

The actual goods/services specification text MUST be read before any band is assigned. Class number is used
only for initial filtering (should the record be pulled for detail-fetch?). Rating requires the full G&S
text.

The staff lawyer's rule: "I read the actual G&S specification, not just the class number."

**Rules:**
- A class number match alone is NEVER sufficient to rate a finding above the framework's lowest band.
- If the G&S specification in the matched class is entirely unrelated to the proposed use (e.g. Class 28
  covers "balloons" rather than gaming devices), the read drops to the client-favoured side — the lowest
  band, or out of the rated set — before Stage 2 applies.
- Flag in Key Factors: "Class match confirmed; G&S specification: [text] — limited overlap with [proposed use]."
- Example: LTA GB, Class 28 — the registered goods include "balloons" and sporting equipment, not video game
  consoles or accessories. Treating a Class 28 number match as a gaming conflict without reading the G&S
  text is a workflow error.

Document the G&S reading in Key Factors for every RATED register finding: "G&S specification reviewed:
[relevant text excerpt]."

### Canadian official marks — absolute filing bar

Canadian official marks (s. 9 of the Canadian Trademarks Act) create an absolute filing bar for identical
marks across all 45 classes, regardless of the goods/services the client intends to use.

**Mandatory treatment:**
- The statutory bar means the prior right is more likely than not to prevail against the identical filing —
  rate it **at least the framework's middle band**, never lower.
- The absolute legal blocking position must be stated explicitly in the narrative and the Findings sheet Key
  Factors.
- Mitigation is **enforcement appetite only** — assess commercial overlap between the official mark owner's
  actual use and the proposed use. If there is no commercial overlap, note this as the primary practical
  mitigant.
- **Non-use revocation does NOT apply to Canadian official marks.** The standard Revocability rule cannot be
  used to downgrade these findings. State explicitly in Key Factors: "Canadian official mark — non-use
  revocation does not apply under s. 9 Canadian Trademarks Act."
- No further investigation (prosecution history, marketplace use in the conventional sense) changes the
  legal blocking position — only enforcement appetite and commercial overlap drive the practical risk
  assessment.

### Findings in unrelated fields — below the confusion threshold

Per the consumer-confusion gate, a mark in **unrelated** goods/services **fails the
likelihood-of-confusion threshold** (the G&S are too different for confusion to arise) and is **not a
rated finding** — give it no band, and do not let it crowd the deliverable. (A senior lawyer leaves the
genuinely off-field same-token owners *out* of the rated findings rather than padding the report with
them.)

Surface an unrelated-field mark **only** as a brief **"Of Interest — Commercial Awareness"** note
(unrated, disposition `off-field`), and only when genuinely worth the business knowing — e.g. a major
brand, or a same-name owner the client will encounter commercially ("Cavern Crate" is also a tabletop RPG
merch brand — worth a mention). A clearly-unrelated same-name holder with nothing notable is noise: omit
it. (The inversion to avoid: rating a pile of off-field same-token owners as findings while dropping or
under-rating the on-point in-field ones.)
