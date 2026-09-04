# Phase 2 — methodology (the deterministic driver runs the orchestration)

> **The prelim-search pipeline is sequenced in code by the deterministic driver** (`driver/`,
> source of truth `stages.mjs`). The old LLM-orchestrator's `sessions_spawn`/`sessions_yield`/Wait-state/
> `NO_REPLY` machinery has been removed — the driver runs each stage as one blocking engine turn and
> joins the fan-out in code, so it cannot park. This file is the per-step **methodology**: the judgment each
> stage applies. The driver's skeptic stage reads **Step 2.6**; the synthesis stage follows **Steps 3/3.5/3.6/4**;
> the case-law stage follows **Step 4.5**; the refutation gate uses **Step 4.7**. Model tiers live in `stages.mjs`,
> not here.

## Contents

- [Step 1 — Variants](#step-1--variants)
- [Step 2 — Gather (register units + common-law) → placement → digest](#step-2--gather-register-units--common-law--placement--digest)
  - [Step 2A — The applicable register units](#step-2a--the-applicable-register-units)
  - [Step 2C — Touchpoint 2: placement-inquiry](#step-2c--touchpoint-2-placement-inquiry)
  - [Variant execution strategy (register layer)](#variant-execution-strategy-register-layer)
- [Step 2.6 — Skeptic review](#step-26--skeptic-review-a-fresh-eyes-self-audit-before-you-trust-the-findings)
- [Step 3 — Cross-pollination (Option D — deterministic cross-checks, cap N=10)](#step-3--cross-pollination-option-d--deterministic-cross-checks-cap-n10)
- [Step 3.5 — Actual-use check (mandatory for Medium/High/Very High register hits)](#step-35--actual-use-check-mandatory-for-mediumhighvery-high-register-hits)
- [Step 3.6 — Owner workup (mandatory for high-risk findings)](#step-36--owner-workup-mandatory-for-high-risk-findings)
- [Step 4 — Joint synthesis](#step-4--joint-synthesis)
- [Step 4.5 — Case-law grounding](#step-45--case-law-grounding)
- [Step 4.7 — Touchpoint 3: narrative-refutation](#step-47--touchpoint-3-narrative-refutation)
- [Step 5 — Cross-mark references (multi-mark only)](#step-5--cross-mark-references-multi-mark-only)

## Step 1 — Variants

`prelim-variants` produces `variant-manifest.md` (Elements table, Variants table, Watchlists) from the marks,
classes, jurisdiction scope, product description, industry, and manner of use. The manifest must be well-formed
(Elements populated; Variants has rows; Watchlists present); if empty or malformed the run halts — there is no
usable strategy. The manifest drives the gather stage.

## Step 2 — Gather (register units + common-law) → placement → digest

The driver runs the register search-axis units and the common-law worker as a batched gather fan-out, then
placement-inquiry, then the register digest — each reading the shared manifest + `matter-context.md` from the
run-dir at `studio/prelim-search/<slug>/<date>/`.

### Step 2A — The applicable register units

Which register units apply, from the manifest (each unit also self-checks and writes a "not applicable" digest
if its axis is empty, so running a non-applicable one is harmless):
- `primary-sweep` — **always**.
- `saturation-probe` — if any element is `saturation: high`/`very-high` (or a multi-word slogan/descriptive-compound mark).
- `transliteration-numeric` — if the manifest has `translit-*` or numeric-substitution variants and the mark is not English-only.
- `incumbent-class` — if the manifest has an `industry_incumbent_alert`.

Each unit is given: the sub-skill + axis (`prelim-register` unit mode — see `prelim-register/unit.md`), the
variant manifest path, the request context, the **active register provider** (see
[SKILL.md → Register sources](SKILL.md#register-sources--the-vendor-is-the-source-of-truth-euipo-is-a-free-eu-cross-check)),
the sub-budget and its output path (`register-units/<axis>.md`). `prelim-common-law` runs
alongside the units against the same manifest.

### Step 2C — Touchpoint 2: placement-inquiry

After the gather units complete, run `placement-inquiry` (read [skills/placement-inquiry/SKILL.md](../placement-inquiry/SKILL.md)).

**Inputs**:
- `studio/prelim-search/<slug>/<date>/matter-context.md` (the strategic anchor from Phase 0)
- Each `studio/prelim-search/<slug>/<date>/register-units/<axis>.md` (raw candidate inventory per axis)
- `studio/prelim-search/<slug>/<date>/common-law-findings.md` (common-law candidate inventory)

**Output**: `studio/prelim-search/<slug>/<date>/placement-recommendations.md` with every surfaced candidate placed at `headline-candidate` / `sheet-2` / `watchlist-annex` / `out-of-scope-filtered`, each with the structured-inquiry trace and written reasoning. The "Disagreements / flags surfaced to downstream" section captures cases where the placement deviates from a strict reading of the candidate's class-match or differs from `matter-context`'s framing.

`placement-recommendations.md` feeds the digest — the digest consumes the placements as informed reasoning, can override with its own counter-reasoning, and carries the per-candidate placements through to `register-findings.md`. Overrides MUST be recorded in the digest's audit trail with the counter-reasoning.

*(Why this lives between gather and digest: the digest would otherwise tier candidates by class-match-as-proxy, surfacing class-overlapping but commercially-off-field candidates at the headline tier. The placement-inquiry inquiry — "what does the applicant actually do, who's their customer, do customer bases overlap" — is the commercial-relevance gate that prevents the class-match overreach. See [matter-frame/SKILL.md](../matter-frame/SKILL.md) for the matter-context's off-field framing.)*

### Variant execution strategy (register layer)

For a **saturated common-word phrase** (per the manifest's Diligence notes / Recipe classification),
the register units collectively must cover the **Compound-Phrase Funnel** below. Each step maps to a
unit (macro probes → `saturation-probe`; compound-phrase + single-word + wildcard → `primary-sweep`;
numeric/transliteration → `transliteration-numeric`). Each step has an explicit skip condition; a
skipped step must be logged with its reason in the unit's digest audit.

1. **Macro probes** — one search per element of the compound + one for the full compound phrase (limit=10 each), to establish saturation levels. Minimum 3 searches. SKIP only if all elements are non-common-words (rare).
2. **Compound-phrase sweeps** — the compound phrase across **three match-modes (exact, phrase, default)**, limit=100 per search. Minimum 3 searches. SKIP only if the phrase is a single word (then it's a single-word funnel, not compound).
3. **Single-word coverage hunts** — for each element marked "demote to filter" in the manifest, one search with product/industry filters applied (limit=50). Minimum 1 per such element.
4. **Wildcard reorders** — if the manifest lists word-order variants, at least one wildcard sweep per distinct ordering (e.g. `Elevate * game`, `game * Elevate`).
5. **Numeric-substitution and transliteration sweeps** — execute every sweep marked ✅ (requires verification) in the variant manifest, UNLESS the manifest classifies the mark as English-only (single-language Recipe 1 pattern). Skipping any ✅ requires a stated reason in the unit's digest audit.
6. **Material-jurisdiction sub-queries** — a **protected, non-yielding** line item, NOT folded into the sweep budget. Run one scoped sub-query per jurisdiction `matter-context` declares materially-matters (no top-N cap; the per-mark ceiling scales with the declared count — see `prelim-register/SKILL.md` → *Tool call budget* and Step 3). These outrank within-axis breadth: if budget is tight, an extra script group (step 5) yields and is logged `coverage-limited` — a material jurisdiction is never dropped to fund breadth, and a jurisdiction that genuinely can't run is logged `deferred`, never silent.

**Expected breadth for saturated common-word patterns: ~20–25 register searches per mark, plus the ring-fenced per-jurisdiction allowance** — a guideline, not a quota; coverage of the manifest's axes *and* the declared material jurisdictions is what matters, not the raw count. A run that is thin **and** left ✅ sweeps or material-jurisdiction sub-queries unexecuted with no documented skip reason is incomplete; the skeptic (Step 2.6) flags it. A run that executed every axis and validly found little is complete.

For non-saturated marks (highly distinctive coined terms), the funnel is lighter — but the same skip-with-reason discipline applies. Document the classification in the scope statement so the staff lawyer can challenge it.

## Step 2.6 — Skeptic review (a fresh-eyes self-audit before you trust the findings)

Before cross-pollination, get a **second opinion** on the findings — a fresh-eyes review by a reviewer that did
not write them (the tier is declared in `stages.mjs`), so it is a genuinely independent perspective rather than
the authoring stack auditing itself. It reads the two findings files + the manifest and hands its audit back by
calling the **`record_skeptic`** tool: `flags` — one entry per flag, one line each, citing the affected
worker/axis/finding — and `escalations` — one entry per register axis that has a **material, unresolved** gap a
re-run would actually fix, each with `axis` and a one-line `reason`.

**It writes no file.** The driver renders `skeptic-flags.md` from those values: the flag bullets, the
"no flags surfaced" sentinel when `flags` is empty, and the `## Escalation decisions` section. An EMPTY `flags`
array IS the clean answer and an EMPTY `escalations` array IS a decision — omitting either is not one.

Escalation is decided by the `escalations` field and by nothing else. Naming an axis in a flag does **not**
escalate it, and typing an `ESCALATE:` token inside a flag or a reason is REFUSED rather than parsed — so a
passing mention never triggers a paid re-run, and a real gap is never missed because the axis name happened to be
absent from prose.

**Coverage is DATA here, never a re-derivation.** The dispatch carries a driver-computed table built from
`register-coverage-ledger.json` (every axis/unit/status/reason row) and `_driver/plan-execution.json` (every
query the active provider refused, with the mechanical reason), plus the owner×element screen's receipt. Both
files are also named as inputs and can be read directly, but the escalation question is already answered in the
table — do **not** reconstruct the ledger by reading the findings prose. (On the 2026-07-30 run that
reconstruction burned 28,592 thinking tokens, 95% of the stage's emission, and still got the answer wrong.)

Two classes of gap are **not** escalation triggers:
- a gap the **Coverage ledger records as `coverage-limited`** — a documented/accepted structural limit a warm
  re-run cannot close (budget overrun, ring-fenced jurisdiction yield, phonetic-fringe sampled, count-only
  saturation);
- a **capability-gap deferral**, marked `NOT CLOSEABLE` in the table — the active provider cannot express those
  slices at all (a predicate it lacks, an office outside its coverage, a script its index cannot hold, an owner
  surface it does not have), so a re-run re-derives the identical refusal at full cost. **A capability-gap
  deferral is never closeable by time**, and the deadline envelope will not close it either. It stays an open,
  disclosed gap, and the coverage floor is right to refuse a clean verdict over it — if a findings surface reads
  such a slice as clean, that IS a flag; it is never an escalation.

Escalate only genuinely closeable gaps (a `deferred` row the table lists as CLOSEABLE, or a new concern on a
`confirmed-clean` row). The driver enforces both skips too, but keep the `ESCALATE:` list clean.

**A saturated everyday-word translation IS recoverable — narrow it to the field by class (replaces the old
re-run-the-specific-concept-rendering move).** When a unit digest records `translit-too-generic` (the
saturation probe read an everyday-word-scale count on a meaning-translation variant — see
[`prelim-register` unit.md](../prelim-register/unit.md)), that is a **cheap ∧ material ∧ recoverable** gap on a
*real* element, not a documented structural limit: a warm re-run that SCOPES the saturated meaning token to the
filed in-scope Nice classes (a structured `nice-class:` × `region:` filter — the token kept as the substring
predicate, **never** goods-vocabulary words ANDed into the search text) and enumerates it closes the gap. (This
is the carve-out from the rule just above: a meaning slice left `coverage-limited` **without the class-scoped
enumeration attempt** is NOT an accepted structural limit — it is exactly the closeable gap to escalate; only a
slice that WAS class-scoped and enumerated, then ran into a documented limit, is the accepted `coverage-limited`
that does not re-trigger.) Do **NOT** swap the everyday word for a narrower / more specific rendering. Emit
`ESCALATE: transliteration-numeric — risk: coverage-gap — saturated meaning token not class-scoped; re-run
class-scoped enumeration (token × in-scope nice-class × region)`.
`translit-underretrieved` (near-zero count) stays a separate escalation: re-render / re-check completeness. (Do
NOT escalate when a translation is genuinely distinctive and merely found little — that is a complete axis, not a
gap.)

**Posture: ask "what's wrong here?", not "is this right?" — dumb questions welcome.** The obvious question a
fresh outsider would ask ("why is the client's own partner the top conflict?", "you said worldwide but only N
jurisdictions ran — why is the rest clean?") is exactly the one to surface; consistency with an earlier step
is not a reason to skip it, and "the rule said so" is not an answer.

**The questions the skeptic answers**, in plain terms:

- Did the worker actually probe the variations the manifest called for — the phonetic / type /
  archetype-based / transliteration sweeps — or did it shortcut? Any ✅ manifest sweep skipped
  **without a documented reason**?
- Now that the full picture is in, does any finding look **over- or under-rated** for risk?
- Was it looked at **holistically** — cross-layer, and (for multi-mark runs) cross-mark?
- Are these the results expected for a mark like this — and if it's thin, is that because a
  sweep was missed, or because the field is genuinely clear?
- Register-specific: are the audit trail + negative-results matrix present, do the per-unit counts
  reconcile, **and did the register-findings file actually get written (file-truth precondition — synthesis must read the file,
  not inline output)?** Common-law-specific: are the mandatory platforms (the 6 gaming platforms when
  in scope) **plus the field-scoped general search for any collaborated / non-gaming goods** and any
  famous-mark flags covered, with a negative-results matrix?
- **Self-conflict / partner:** is any headline or high-rated conflict the applicant's **own** mark, an
  affiliate's, or a named **partner** in `matter-context`? A partner / own mark is a coexistence-or-business
  question, not an adversarial conflict — if one is driving the risk, flag it (the canonical "why is the
  client's own partner the #1 conflict?" miss). (Carve-out: a deliberate **"client's own prior rights"** note
  — the applicant's own filing/footprint stated when priority is live — is *expected*, not a self-conflict;
  flag only when the applicant's own / affiliate / partner mark is presented as an adversarial conflict or
  headline.)
- **Dominant-element spine / calibration:** is each finding ranked by the *dominant element* + whole-mark confusion
  test? Is a distinguished mark (house-mark-prefixed) **over-rated**, or a
  bare-dominant-element-in-field conflict **under-rated or dropped**? Did any **on-point identical /
  near-identical-in-class** hit fall out of the deliverable (it must not — even if revocable, and regardless
  of filer size)? Is any escalation of a distinguished mark resting on optics/PR/partner rather than a
  named confusion theory? Is the headline risk driven by the top on-point conflicts, not a distinguished
  mark or unrelated-field noise?
- **Coverage ledger:** does the `## Coverage ledger` in each findings file carry a row for **every**
  jurisdiction `matter-context` named materially-matters? Is any `deferred` / `coverage-limited` row being
  narrated (or about to be narrated) as a clean negative? A material jurisdiction with no row, or a
  deferred row treated as clean, is a recall gap — flag it.
- **Registrability flag:** did `prelim-variants` name the dominant element + give the proposed-mark
  distinctiveness read (spectrum + deceptive/offensive, or "plainly distinctive"), and is it carried
  into the deliverable?

The skeptic **surfaces flags only and recommends re-runs** via its `ESCALATE:` lines — it does not re-run anything
itself. **The driver decides** (in code) off those lines: a flag that a worker *shortcut the process* (missed an
axis with no reason, under-probed a high-value category, mis-calibrated risk) → the flagged unit **RESUMES its own
session** (the driver sends the skeptic's concerns as a follow-up under the unit's existing session key, on the
**same model** it ran on). The unit keeps its full prior context — its searches, coverage ledger, and fetched
records — and is asked to **defend its finding from that evidence or run only the narrow missing sub-query and
revise**, then re-emit its file. It does **not** redo the search from scratch, and it is **not** switched to a
fresh `opus` session (that would cold-cache the whole thread — cache is model-specific — for no quality gain over
arguing from the evidence already in hand; opus judgment happens once, at the re-digest). **A `deferred`
coverage-ledger row on a material jurisdiction is exactly this kind of documented-reason gap** — the owning unit
resumes and runs the missing per-jurisdiction sub-query (its ring-fenced budget makes room). This is the
recall-recovery loop: a *visible* deferral is recoverable; a silent one is not. **If a register unit is re-run,
the register digest is re-run** (also a resume of its own session) over the refreshed unit digests (the prior
digest consumed the stale set); if the flag is about the digest's own judgment, re-run the digest alone.

A worker that did the work properly and validly found little is **not** re-run — thinness alone is a question, not
a quota; never manufacture make-work to hit a number. At most one re-run per worker; if still short, proceed but
record the gap in the Audit Trail and narrative so the staff lawyer sees it. Log every skeptic flag + the decision + outcome
in the Audit Trail.

This review replaces the old single-session "Opus + max thinking does it all" guard — quality now
comes from a cheap fresh-eyes audit plus targeted Opus escalation, not from one giant session.

## Step 3 — Cross-pollination (Option D — deterministic cross-checks, cap N=10)

Read both findings files. Apply four explicit rules tied to the staff lawyer's stated practice:

| # | Trigger | Action | Owned by |
|---|---|---|---|
| 1 | Every common-law owner found | Check register for any trademark filings by that owner in target classes | **CODE (2026-07-10):** the driver's cross-check dispatcher mints an `xcheck-owner-*` plan entry per extracted owner from the "Similar listing(s) found" receipts and executes it deterministically (`_driver/register-xcheck.json` is the receipt); verify the receipt in synthesis |
| 2 | Every register stealth-filer pattern (law firm as owner) | One common-law query for the underlying client's marketplace use | Dispatch to `prelim-common-law` |
| 3 | Every watchlist-hit owner appearing in register but NOT in common-law | One common-law query for that owner's marketplace activity | Dispatch to `prelim-common-law` |
| 4 | Every common-law finding without a register tie | One register query for the entity name | **CODE (2026-07-10):** the same dispatcher mints an `xcheck-mark-*` contains entry per owner-less similar-listing mark; anything the receipts show over-cap or unparsed, dispatch via the register supplemental lane (`register_propose_supplemental`) |

**All four triggers fire deterministically when their condition is met.** Triggers 1/4 are now code-fired
(the dispatcher's cap + overflow log mirror the rules below; the `crosscheck-missing` tripwire flags any
owner-carrying hit demoted without an executed receipt). The cap N=10 is overflow protection, not a stop-early heuristic. If cap-overflow occurs, log the skipped cross-checks in the Audit Trail with the specific reason — do NOT silently skip lower-ranked triggers.

**Cap:** N=10 total cross-checks across all 4 triggers. Rank by signal strength when over-cap:
1. Watchlist hits (aggressive enforcers > competitors > major brand owners)
2. Commercial-use indicators (active marketplace use stronger signal than passing mention)
3. Stealth-filer patterns (law firm as owner is high-signal)
4. Everything else

Cap-overflow MUST be flagged in the deliverable audit trail with a specific reason ("would have triggered cross-check on owner X but cap reached after 10 — the staff lawyer to assess manually").

Every cross-check (including "checked, found nothing") logged in the unified audit trail as proof-of-work. The collaborator value-add (vs assistant) is in this section: synthesis can be decisive ("HP uses, does not register → Level 2 B") rather than tentative ("recommend the staff lawyer check HP register").

## Step 3.5 — Actual-use check (mandatory for register hits above the framework's lowest band)

Before synthesis, for **every register finding** advisory-rated **above the framework's lowest band**, run a marketplace check via `perplexity_research` to determine whether the registered mark is **actually being used in the marketplace within the scope of the current search** (i.e. for the goods/services and field this clearance targets).

Example: a JELLY register hit owned by Jellycat (a toy company) for Class 9 video game software — check whether Jellycat actually sells or markets video games under JELLY. If they don't (their commercial use is toys), note the filed-vs-used distinction in Key Factors and weigh it as a Stage-2 factor together with revocation-vulnerability — no automatic downgrade (see `synthesis-rules.md` → *Actual-use assessment results*).

**Mechanics:**

- Scope the marketplace query tightly to the search's field (gaming, fintech, whatever the clearance targets), not the owner's full portfolio.
- Record the check and its result in the Audit Trail with Source Layer = "Cross-pollination".
- If actual use in the relevant field is **confirmed,** the register finding's risk weight stands.
- If actual use in the relevant field is **not found** (despite the filing), do **NOT** automatically downgrade — weigh the lack of field use as a Stage-2 factor together with revocation-vulnerability (`synthesis-rules.md` → *Actual-use assessment results* / *Rule on downgrade quantum*), and note in Key Factors: "Register filing claims [field] but no marketplace use identified — filed-vs-used noted; weighed with revocability."
- This check measures *use in the field*, not registry status: a renewal / re-registration / "Registered" status is administrative upkeep, not marketplace use, and does not satisfy the actual-use check or defeat a non-use mitigant (see `synthesis-rules.md` → "Administrative liveness is not market use").
- Owner-portfolio-bound common-law checks already counted in this step count toward the Option D cap (Step 3).

**Output contract — ENFORCED by the driver (spec 11), not optional.** For every Composite 3+ finding whose
mitigant or verdict turns on the **absence** of use (it says the mark is "not in actual use" / "unused" / has
"no marketplace use found", or names non-use revocation/cancellation as the mitigant, or calls the owner's use
"unknown"), the finding's actual-use line MUST end with a literal source line:

> `- **Use-check source:** <the perplexity_research result URL> — <one-clause finding>`

If the marketplace query genuinely returned nothing, write the honest value verbatim:

> `- **Use-check source:** perplexity_research — no result`

The driver's `narrative` validator (`verify.mjs` → `findUseCheckViolations`) **rejects the whole narrative** if a
Composite 3+ use-negative finding lacks this line, so the synthesis stage cannot ship an *inferred* "no use" —
it must actually run the scoped query (owner + mark + goods/field) and cite the result, or state the honest
"no result". Never dress an un-run check as a clean negative. Also mirror the result into the matching `# Actions`
item: "confirm the owner's actual use" becomes the stated result, not a task handed onward (this is what fills
spec 09's "Checks we ran — what we found" bucket). On a perplexity outage the "no result" value is the accepted
satisfying answer — the run still delivers; only a *silent* un-searched no-use is forbidden.

This check is mandatory and applies to Composite 3+ register findings only — lower-rated register hits don't justify the cost.

## Step 3.6 — Owner workup (mandatory for high-risk findings)

For every finding heading for the **high-risk** band — the provisional headline-driver a senior lawyer would
weigh a rename over — work up the **owner** before the rating is fixed, the way the staff lawyer does: *"if it's high
risk, find out everything you can about the owner to judge the **practical likelihood** they actually create
a problem for us."* Run it via `perplexity_research` (the orchestrator's web access, same as Step 3.5). It is
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
variants and the owner-bound sweep (`prelim-register/digest.md` Steps 3–4) plus the prosecution-history and
revocability reads (`synthesis-rules.md`). This step adds what the register layer cannot see: the
**marketplace** half — the owner's *own use of the term*, site, and socials.

**Two non-inheritances from Step 3.5** (so the two steps don't blur):
- Do **not** apply Step 3.5's tight "use in *our* field only" scoping — the owner workup is deliberately
  about the owner's *whole* posture and *their own* use of the term, not just the clearance field.
- Do **not** apply Step 3.5's mechanical one-composite-level downgrade. This step's output is a
  **practical-likelihood statement**, not a score move; it feeds the finding's business read and the net
  rating (Step 4 / `synthesis-rules.md`), where the weighing happens.

**Output:** a practical-likelihood statement in the finding's business read ("how likely is this owner to
actually create a problem"), feeding the net rating. **Non-attributable research practice:** view an owner's
profiles non-attributably, and when a finding rests on the owner's public social / web profiles, set the
deliverable's `handling_note` (see `prelim-search/delivery-contract.md`) so the reviewer opens those links
privately too.

## Step 4 — Joint synthesis

For **each finding** in the combined findings set (common-law + register, both layers' rows), provide an advisory risk assessment using [risk-framework.md](risk-framework.md) and [synthesis-rules.md](synthesis-rules.md).

**Rank and select before you rate.** Apply the dominant-element spine first — [synthesis-rules.md](synthesis-rules.md) → "Conflict ranking & selection" — centred on the proposed mark's **dominant element** and gated by the consumer-confusion test ([risk-framework.md](risk-framework.md) → "The consumer confusion test — the governing gate"). The headline/overall risk is driven by the highest-ranked **on-point** conflicts (bare dominant element in the target field), not by a distinguished mark (e.g. a house-mark-prefixed filing) or by unrelated-field noise. Never let an on-point identical / near-identical-in-class hit drop out.

**Source of truth (file-truth precondition).** Build every Findings row from `studio/prelim-search/<slug>/<date>/register-findings.md` and `studio/prelim-search/<slug>/<date>/common-law-findings.md`. Do **NOT** assemble the Findings sheet / Excel from inline digest output — if the register-findings file is not present the synthesis is not ready (the driver re-runs the digest). *(Prior-incident anchor: a run where the register layer found an identical-mark registration, but with no register-findings file written it never reached the deliverable — the deliverable is built from files, not inline payloads.)*

Every assessment must be labeled: **Advisory — preliminary assessment for the reviewing lawyer.**

The staff lawyer makes the final determination. The skill's role is to surface the facts, apply the framework systematically, and flag what matters — not to make conclusive legal judgments.

Per-finding output (added to a unified row in the Findings sheet):
- Advisory Risk Level (A–E)
- Advisory Dispute Type (Classic / Horse Trade / Paper Conflict / Descriptive / Nuisance)
- Advisory Composite Score (1–5)
- Key Factors (elevation + mitigation factors observed)
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
`studio/prelim-search/<slug>/<date>/case-law-findings.md`. Fold the grounded profiles into Key Factors + the
narrative. Do NOT ground every finding — it is cost-prohibitive and low-signal — but DO ground watchlist hits
unless the digest's own evidence already grounds them concretely (e.g. opposition data pulled directly).

**Integrity gate:** case-law citation is the highest-stakes hallucination surface in the workflow. If a grounded
profile cites anything not fetched this session, or invents a holding, the run is treated as failed and the
grounding is re-run escalated to `opus`. (The `case-law-citation` skill's own evals — jurisdiction routing,
fetch-before-cite, refusal-to-fabricate — gate whether Sonnet is trusted here; see its SKILL.md.)

## Step 4.7 — Touchpoint 3: narrative-refutation

After synthesis composes the narrative and case-law grounding is folded in, `narrative-refutation` refutes the
narrative against the underlying source files and writes `senior-eye-review.md` with a verdict. **Phase 3 delivery
is gated on the verdict** (the driver enforces the gate in code):

- **CLEAR** → proceed to delivery.
- **CONDITIONAL** → apply the suggested narrative edits (each flag in `senior-eye-review.md` carries a minimum-change correction); record the corrections in the workflow audit summary; proceed to delivery.
- **BLOCKING** → re-do synthesis applying the refutation's corrections; re-run `narrative-refutation` once on the corrected narrative. If the second pass also returns BLOCKING, halt and surface to the requester with the review attached (documented delivery failure, never silent send).

*(Why this lives between synthesis and delivery: the agent that just composed the narrative cannot reliably refute its own work — tier inversions, confabulated attributions, and overconfident negatives slip through when the same agent both writes and reviews. A fresh-context refutation reading the narrative against the source files catches these before delivery.)*

## Step 5 — Cross-mark references (multi-mark only)

Runs **ONCE**, after all marks have completed Steps 2–4.5. Review findings across all marks and identify:

1. **Shared findings:** a single entity/finding relevant to more than one proposed mark (e.g., "Prize Crate Retail" is relevant to both "PRIZE CRATE" and "CAVERN CRATES")
2. **Pattern findings:** recurring themes across marks (e.g., "the 'loot' prefix is crowded across all gaming platforms")
3. **Compound risk:** where the combination of marks might amplify risk (e.g., using both "PRIZE CRATE" and "CAVERN CRATES" increases the chance of a dispute with Prize Crate Retail)

For each cross-reference: note which marks are affected, describe the connection, flag any compounding risk. Cross-references appear in the narrative summary and as a note in the Findings sheet.
