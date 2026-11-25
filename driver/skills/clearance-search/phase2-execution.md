# Phase 2 — methodology (the deterministic driver runs the orchestration)

> **The clearance-search pipeline is sequenced in code by the deterministic driver** (`driver/`,
> source of truth `stages.mjs`). This file is the per-step **methodology**: the judgment each
> stage applies. The synthesis stage is referred to Step 3.5. The skeptic stage reads its own manual, [skeptic/SKILL.md](../skeptic/SKILL.md). The other sections are reference. Model tiers live in `stages.mjs`,
> not here.

## Contents

- [Step 1 — Variants](#step-1--variants)
- [Step 2 — Gather (register units + common-law) → placement → digest](#step-2--gather-register-units--common-law--placement--digest)
  - [Step 2A — The applicable register units](#step-2a--the-applicable-register-units)
  - [Step 2C — Touchpoint 2: placement-inquiry](#step-2c--touchpoint-2-placement-inquiry)
  - [Variant execution strategy (register layer)](#variant-execution-strategy-register-layer)
- [Step 2.6 — Skeptic review](#step-26--skeptic-review-a-fresh-eyes-self-audit-before-you-trust-the-findings)
- [Step 3 — Cross-pollination (Option D — deterministic cross-checks, cap N=10)](#step-3--cross-pollination-option-d--deterministic-cross-checks-cap-n10)
- [Step 3.5 — Actual-use and enforcement check (mandatory for register hits rated medium risk or higher)](#step-35--actual-use-and-enforcement-check-mandatory-for-register-hits-rated-medium-risk-or-higher)
- [Step 3.6 — Owner workup (mandatory for high-risk findings)](#step-36--owner-workup-mandatory-for-high-risk-findings)
- [Step 4 — Joint synthesis](#step-4--joint-synthesis)
- [Step 4.5 — Case-law grounding](#step-45--case-law-grounding)
- [Step 4.7 — Touchpoint 3: narrative-refutation](#step-47--touchpoint-3-narrative-refutation)

## Step 1 — Variants

`clearance-variants` produces `variant-manifest.md` (Elements table, Variants table, Watchlists) from the marks,
classes, jurisdiction scope, product description, industry, and manner of use. The manifest must be well-formed
(Elements populated; Variants has rows; Watchlists present); if empty or malformed the run halts — there is no
usable strategy. The manifest drives the gather stage.

## Step 2 — Gather (register units + common-law) → placement → digest

The driver runs the register search-axis units and the common-law worker as a batched gather fan-out, then
placement-inquiry, then the register digest — each reading the shared manifest + `matter-context.md` from the
run-dir at `studio/clearance-search/<slug>/<date>/`.

### Step 2A — The applicable register units

Which register units apply, from the manifest (each unit also self-checks and writes a "not applicable" digest
if its axis is empty, so running a non-applicable one is harmless):
- `primary-sweep` — **always**.
- `saturation-probe` — if any element is `saturation: high`/`very-high` (or a multi-word slogan/descriptive-compound mark).
- `transliteration-numeric` — if the manifest has `translit-*` or numeric-substitution variants and the mark is not English-only.
- `incumbent-class` — if the manifest has an `industry_incumbent_alert`.

Each unit is given: the sub-skill + axis (`clearance-register` unit mode — see `clearance-register/unit.md`), the
variant manifest path, the request context, the **active register provider**
and its output path (`register-units/<axis>.md`). `clearance-common-law` runs
alongside the units against the same manifest.

### Step 2C — Touchpoint 2: placement-inquiry

After the gather units complete, run `placement-inquiry` (read [skills/placement-inquiry/SKILL.md](../placement-inquiry/SKILL.md)).

**Inputs**:
- `studio/clearance-search/<slug>/<date>/matter-context.md` (the strategic anchor from Phase 0)
- Each `studio/clearance-search/<slug>/<date>/register-units/<axis>.md` (raw candidate inventory per axis)
- `studio/clearance-search/<slug>/<date>/common-law-findings.md` (common-law candidate inventory)

**Output**: `studio/clearance-search/<slug>/<date>/placement-recommendations.md` with every surfaced candidate placed at `headline-candidate` / `sheet-2` / `watchlist-annex` / `out-of-scope-filtered`, each with the structured-inquiry trace and written reasoning. The "Disagreements / flags surfaced to downstream" section captures cases where the placement deviates from a strict reading of the candidate's class-match or differs from `matter-context`'s framing.

`placement-recommendations.md` feeds the digest — the digest consumes the placements as informed reasoning, can override with its own counter-reasoning, and carries the per-candidate placements through to `register-findings.md`. Overrides MUST be recorded in the digest's audit trail with the counter-reasoning.

*(Why this lives between gather and digest: the digest would otherwise tier candidates by class-match-as-proxy, surfacing class-overlapping but commercially-off-field candidates at the headline tier. The placement-inquiry inquiry — "what does the applicant actually do, who's their customer, do customer bases overlap" — is the commercial-relevance gate that prevents the class-match overreach. See [matter-frame/SKILL.md](../matter-frame/SKILL.md) for the matter-context's off-field framing.)*

### Variant execution strategy (register layer)

The register units follow clearance-register/unit.md: the identical mark first, a crowd narrowed by its steps, and a
wider question only where reading it would change what you tell the client. A family the reading turn did not ask is
recorded withheld-by-judgment with its reason; that is a documented decision, not a shortcut.

## Step 2.6 — Skeptic review (a fresh-eyes self-audit before you trust the findings)

The skeptic stage reads its own manual, [skeptic/SKILL.md](../skeptic/SKILL.md), which holds this step.

## Step 3 — Cross-pollination (Option D — deterministic cross-checks, cap N=10)

Read both findings files. Apply four explicit rules tied to the staff lawyer's stated practice:

| # | Trigger | Action | Owned by |
|---|---|---|---|
| 1 | Every common-law owner found | Check register for any trademark filings by that owner in target classes | **CODE:** the driver's cross-check dispatcher mints an `xcheck-owner-*` plan entry per extracted owner from the "Similar listing(s) found" receipts and executes it deterministically (`_driver/register-xcheck.json` is the receipt); verify the receipt in synthesis |
| 2 | Every register stealth-filer pattern (law firm as owner) | One common-law query for the underlying client's marketplace use | recorded by the digest; not run |
| 3 | Every watchlist-hit owner appearing in register but NOT in common-law | One common-law query for that owner's marketplace activity | recorded by the digest; not run |
| 4 | Every common-law finding without a register tie | One register query for the entity name | **CODE:** the same dispatcher mints an `xcheck-mark-*` contains entry per owner-less similar-listing mark; anything the receipts show over-cap or unparsed, dispatch via the register supplemental lane (`register_propose_supplemental`) |

**All four triggers fire deterministically when their condition is met.** Triggers 1/4 are now code-fired
(the dispatcher's cap + overflow log mirror the rules below; the `crosscheck-missing` tripwire flags any
owner-carrying hit demoted without an executed receipt). The cap N=10 is overflow protection, not a stop-early heuristic. If cap-overflow occurs, log the skipped cross-checks in the Audit Trail with the specific reason — do NOT silently skip lower-ranked triggers.

The driver ranks its cross-checks (a verified use with a URL, then an owner, then a bare term) and logs what exceeds the cap of 10.

Cap-overflow MUST be flagged in the deliverable audit trail with a specific reason ("would have triggered cross-check on owner X but cap reached after 10 — the reviewing lawyer to assess manually").

Every cross-check (including "checked, found nothing") logged in the unified audit trail as proof-of-work. The collaborator value-add (vs assistant) is in this section: synthesis can be decisive ("HP uses, does not register → a common-law conflict, banded in the framework's words") rather than tentative ("recommend the reviewing lawyer check HP register").

## Step 3.5 — Actual-use and enforcement check (mandatory for register hits rated medium risk or higher)

For **every register finding** advisory-rated on a rung **the framework rates medium risk or higher** (the stage message names those rungs; a rung below that is not checked, on any client's ladder), run a marketplace check via `perplexity_research` to determine whether the registered mark is **actually being used in the marketplace within the scope of the current search** (i.e. for the goods/services and field this clearance targets). **The same query also asks for the owner's enforcement record:** whether the owner has opposed, disputed or sued over this mark or a similar one.

Apply the existing triggers for actual-use, enforcement, and owner checks after the relevant legal assessment. First use a suitable answer already held by this run, including an earlier stage or attempt, where it answers the same owner, mark, goods, territory, and material time question. A source requirement is not a requirement for a new call. One answer may support several findings only where it answers each finding's question. Ask only what remains unanswered and record the result against every finding it supports.

**Mechanics:**

- Scope the marketplace query tightly to the search's field (gaming, fintech, whatever the clearance targets), not the owner's full portfolio.
- Record the check and its result in the Audit Trail with Source Layer = "Cross-pollination".
- If actual use in the relevant field is **confirmed,** the register finding's risk weight stands.
- If actual use in the relevant field is **not found** (despite the filing), do **NOT** automatically downgrade — weigh the lack of field use as a Stage-2 factor together with revocation-vulnerability (`synthesis-rules.md` → *Actual-use assessment results* / *Rule on downgrade quantum*), and note in `legal_position` and `practical_position`: "Register filing claims [field] but no marketplace use identified — filed-vs-used noted; weighed with revocability."
- This check measures *use in the field*, not registry status: a renewal / re-registration / "Registered" status is administrative upkeep, not marketplace use, and does not satisfy the actual-use check or defeat a non-use mitigant (see `synthesis-rules.md` → "Administrative liveness is not market use").
- Owner-portfolio-bound common-law checks already counted in this step count toward the Option D cap (Step 3).
- **Enforcement the query finds is a lead, not a verified authority** (the ENFORCEMENT AUTHORITY rule in the stage message): it informs the enforcer meter with basis `inferred-from-signal`, and its URL is cited inline in the finding's prose. If the query finds no enforcement record, the enforcer is `low` with basis `inferred-from-signal`, and the finding says the search found none. The enforcer stays `unknown`, and nothing is claimed, only when the query could not run.

**Output contract — ENFORCED by the driver, not optional.** For every finding, at any band, whose
mitigant or verdict turns on the **absence** of use (it says the mark is "not in actual use" / "unused" / has
"no marketplace use found", or names non-use revocation/cancellation as the mitigant), record its result in that finding's `use_check.source`: <result URL | "perplexity_research — no result">.

The driver checks the structured finding record. A required use-check source belongs in that record. An unknown use
status does not require an invented source. The reviewer checks whether the available evidence supports the claim.
The synthesis stage cannot ship an *inferred* "no use" — it must actually run the scoped query (owner + mark + goods/field), unless an answer this run already holds answers that question, and cite the result, or state the honest
"no result". Never dress an un-run check as a clean negative. Also mirror the result into the matching `# Actions`
item: "confirm the owner's actual use" becomes the stated result, not a task handed onward. A search that failed, was refused, was not asked, or has no
available saved answer supplies no search result. Use relevant evidence already held, and leave any remaining use or
enforcement question unknown. Never describe the unanswered question as a search that found no result, no use, or no
enforcement, and do not infer a low enforcement likelihood from that failure. Record no-result only when a completed
search actually returned no result. Preserve unaffected findings and complete the report from the evidence available.

This check applies on every rung the stage message names, and to any finding whose mitigant turns on the absence of use, at any band.

## Step 3.6 — Owner workup (mandatory for high-risk findings)

For every finding heading for the **high-risk** band — the provisional headline-driver the reviewing lawyer would
weigh a rename over — work up the **owner** before the rating is fixed, the way the staff lawyer does: *"if it's high
risk, find out everything you can about the owner to judge the **practical likelihood** they actually create
a problem for us."* Run it via `perplexity_research`, as in Step 3.5. It is
**triggered by risk level, never always-on**; one entity is a bounded target, so be exhaustive on that one
owner.

**The question to answer:** *how likely is this owner to actually enforce / create a problem?* The single
most decisive piece of evidence is **how the owner themselves uses the term** — an owner's own descriptive or
off-field use undermines their own claim and can invert what a register row seems to say (the benchmark
downgrade turned on exactly this). Their public site / products / profile / socials, their portfolio under
**owner-name variants**, and their enforcement posture (history, representation, standing) round out the same
picture — *illustrative of the inquiry, not a checklist to tick*; reach for whatever settles the
practical-likelihood question for this owner.

**Reuse the register half; add the marketplace half.** The owner's portfolio under owner-name variants and
the enforcement-appetite signals are already in hand from the register layer — owner aggregation across name
variants and the owner-bound sweep (`clearance-register/digest.md` Steps 3–4) plus the prosecution-history and
revocability reads (`synthesis-rules.md`). This step adds what the register layer cannot see: the
**marketplace** half — the owner's *own use of the term*, site, and socials.

**Two non-inheritances from Step 3.5** (so the two steps don't blur):
- Do **not** apply Step 3.5's tight "use in *our* field only" scoping — the owner workup is deliberately
  about the owner's *whole* posture and *their own* use of the term, not just the clearance field.
- Do **not** move the finding's band in this step. This step's output is a
  **practical-likelihood statement**, not a band move; it feeds the finding's business read and the net
  rating (Step 4 / `synthesis-rules.md`), where the weighing happens.

**Output:** a practical-likelihood statement in the finding's business read ("how likely is this owner to
actually create a problem"), feeding the net rating. **Non-attributable research practice:** view an owner's
profiles non-attributably, and when a finding rests on the owner's public social / web profiles, set the
deliverable's `handling_note` (see `clearance-search/delivery-contract.md`) so the reviewer opens those links
privately too.

## Step 4 — Joint synthesis

For **each finding** in the combined findings set (common-law + register, both layers' rows), provide an advisory risk assessment using [risk-framework.md](risk-framework.md) and [synthesis-rules.md](synthesis-rules.md).

**Rank and select before you rate.** Apply the dominant-element spine first — [synthesis-rules.md](synthesis-rules.md) → "Conflict ranking & selection" — centred on the proposed mark's **dominant element** and gated by the consumer-confusion test ([risk-framework.md](risk-framework.md) → "The consumer confusion test — the governing gate"). The headline/overall risk is driven by the highest-ranked **on-point** conflicts (bare dominant element in the target field), not by a distinguished mark (e.g. a house-mark-prefixed filing) or by unrelated-field noise. Never let an on-point identical / near-identical-in-class hit drop out.

**Source of truth (file-truth precondition).** Build every Findings row from `studio/clearance-search/<slug>/<date>/register-findings.md` and `studio/clearance-search/<slug>/<date>/common-law-findings.md`. Do **NOT** assemble the Findings sheet / Excel from inline digest output — if the register-findings file is not present the synthesis is not ready (the driver re-runs the digest). *(Prior-incident anchor: a run where the register layer found an identical-mark registration, but with no register-findings file written it never reached the deliverable — the deliverable is built from files, not inline payloads.)*


The reviewing lawyer makes the final determination. The skill's role is to surface the facts, apply the framework systematically, and flag what matters — not to make conclusive legal judgments.

Per-finding output is the band in the framework's words, with the legal and practical positions, which carry the elevation and mitigation factors observed.
- Cross-Mark Reference (if applicable)

## Step 4.5 — Case-law grounding

For the risk-relevant findings flagged in synthesis — **watchlist / aggressive-enforcer hits only** (the
enforcer-profiling step; light and targeted, typically ≤ a handful) — ground them in cited precedent via the
`case-law-citation` skill (fetch-before-cite is the citation-integrity mechanism, not model recall). Per finding
to ground, supply:

- the proposed mark and the conflicting mark / owner / entity
- the jurisdiction(s) and Nice class(es) in scope
- the specific question — e.g. *"is this owner a known aggressive enforcer? is there precedent on confusability of X vs Y for these goods?"*

The result is a **grounded profile** per finding (on-point authorities with court / date / one-line holding /
stable id, or an explicit "no on-point precedent found"), optionally written to
`studio/clearance-search/<slug>/<date>/case-law-findings.md`. Fold the grounded profiles into `legal_position` and `practical_position` + the
narrative. Do NOT ground every finding — it is cost-prohibitive and low-signal — but DO ground watchlist hits
unless the digest's own evidence already grounds them concretely (e.g. opposition data pulled directly).

**Integrity gate:** A citation not fetched this session is a defect; the driver's retrieval record is the check.

## Step 4.7 — Touchpoint 3: narrative-refutation

`narrative-refutation` runs beside case-law grounding, after synthesis. **Phase 3 reads
the verdict** (the driver decides this in code):

- **CLEAR** → proceed to delivery.
- **CONDITIONAL or BLOCKING** → the flags go to one targeted correction and one recheck. The report delivers either way, with unresolved points recorded for the reviewing lawyer.

*(Why this lives between synthesis and delivery: the agent that just composed the narrative cannot reliably refute its own work — tier inversions, confabulated attributions, and overconfident negatives slip through when the same agent both writes and reviews. A fresh-context refutation reading the narrative against the source files catches these before delivery.)*
