---
name: prelim-search
description: Orchestrator for preliminary trademark search requests with register coverage. Invoke when a forwarded email asks for a preliminary trademark search (common-law and register layers, run in parallel). Coordinates `prelim-variants` → `prelim-common-law` + `prelim-register`, then synthesises into client-ready HTML email drafts plus unified audit-trail Excel deliverables for the reviewing lawyer to evaluate. The paid register vendor is whichever sits in the runtime tool surface (the neutral `register_*` surface — one vendor at a time, selected by REGISTER_PROVIDER); free EUIPO (`euipo_*`) and the case-law citation tools (`courtlistener__*` / `legaldatahunter__*`) sit alongside it for EU cross-checks and precedent grounding.
---

## Contents

- [Spawned session](#spawned-session)
- [Trigger](#trigger)
- [Register sources — the vendor is the source of truth; EUIPO is a free EU cross-check](#register-sources--the-vendor-is-the-source-of-truth-euipo-is-a-free-eu-cross-check)
- [Model](#model)
- [Upfront instructions (per-mark guidance from the reviewing lawyer)](#upfront-instructions-per-mark-guidance-from-the-reviewing-lawyer)
- [Scope discipline — "stop if manageable"](#scope-discipline--stop-if-manageable)
- [Process overview](#process-overview)
- [Tool call budget](#tool-call-budget)
- [HITL exception (shared across sub-skills)](#hitl-exception-shared-across-sub-skills)
- [Failure fallbacks](#failure-fallbacks)
- [Phase 0 — Workspace hygiene + matter-frame + template selection (run-start)](#phase-0--workspace-hygiene--matter-frame--template-selection-run-start)
- [Phase 1 — Template](#phase-1--template)
- [Phase 2 — Research and synthesis](#phase-2--research-and-synthesis) → detail in [phase2-execution.md](phase2-execution.md)
- [Phase 3 — Delivery](#phase-3--delivery)
- [Delivery & handoff](#delivery--handoff)
- [Reply rules](#reply-rules)
- [Checklist — before sending](#checklist--before-sending)
- [Workflow Audit Summary — emit in final session message](#workflow-audit-summary--emit-in-final-session-message)

## Spawned session

This file is the **driver's compute orchestration spec** — it lives in `driver/skills/` (co-located with the driver) and is read by the pipeline stages, NOT by the integrator agent. The integrator's prelim role is only **intake** (recognise the request, resolve the client, submit the job — `../../docs/INTAKE.md`) and **delivery** (courier the outbox packets — `../../docs/DELIVERY.md`); everything between is the driver's.

This workflow is run by the **deterministic driver** (`driver/`): an intake path (the `enqueue` CLI or the ops-MCP `start_run` tool) enqueues a job and the driver invokes each stage as a standalone compute turn (the `anthropic-agent` engine — a headless `claude -p` process off the gateway; sequencing, fan-in, gating, retries all in code). The judgment content + companion files below are what the stages read; the driver passes each stage its run-dir paths + the job context (email message id, forwarder, instructions, mark names).

Companion files (this skill):
- [phase2-execution.md](phase2-execution.md) — Phase 2 methodology (variants → gather → Touchpoint 2 placement → digest → skeptic review → cross-pollination → synthesis → Touchpoint 3 narrative refutation → case-law grounding)
- [template-formatting.md](template-formatting.md) — HTML/CSS spec for the report
- [risk-framework.md](risk-framework.md) — the house-default band ladder (Very High · High · Moderate · Manageable), each band stated as Legal position, Practical position and Potential consequences
- [synthesis-rules.md](synthesis-rules.md) — how to combine common-law + register findings into a single risk assessment (carries the default-to-senior-lawyer-judgment posture)
- [worked-examples.md](worked-examples.md) — the analytical depth target
- [templates/email/](templates/email/) — a RECORD of the retired per-customer email bodies (`generic.md`), kept for history. Nothing selects one and no seat writes from one: `composeEmailHtml` composes the single cover note in code. Do not draft against it

Top-level reusable judgment skills (the three new "touchpoints" — see Phase 2 below):
- `matter-frame` — runs **inline** at Phase 0: produces `matter-context.md` naming client + sector + customer base + materially-matters jurisdictions + off-field sectors + watchlist-owner seeds. Strategic foundation the rest of the workflow reasons against. Reusable by `knockout-searches` and future clearance-search.
- `placement-inquiry` — runs at Phase 2 (after the gather stages, before the register digest): per-candidate structured inquiry producing placement recommendations (`headline-candidate` / `sheet-2` / `watchlist-annex` / `out-of-scope-filtered`) with written reasoning. Reusable.
- `narrative-refutation` — runs as a **spawned isolated worker** at Phase 2 (between Step 4 synthesis and Phase 3): refutes the narrative against the underlying files; produces `senior-eye-review.md`. Its verdict drives the corrective pass before Phase 3. Reusable.

Sub-skills used during the workflow:
- `prelim-variants` — runs **inline** in this orchestrator session: shared strategy + variant
  generation (produces the variant manifest, consumes `matter-context.md`). Cheap, no bulk payloads — stays in context.
- `prelim-common-law` — runs as a **spawned isolated worker** (Phase 2 Step 2): Perplexity
  execution against the manifest (produces the common-law findings file with `developer_of_record` / `publisher_of_record` extracted per game-title finding).
- `prelim-register` — runs as a **spawned isolated worker** (Phase 2 Step 2): register-search
  execution against the manifest; consumes `matter-context.md` for materially-matters jurisdictions in per-jurisdiction sub-queries; consumes `placement-recommendations.md` (MODE B digest) for per-candidate placements.

The two gather workers run in their **own isolated sessions** so their raw search payloads
(Perplexity results, register records) never enter this orchestrator's context. The orchestrator
reads only their compact findings files. This is the workflow's primary cost control — see
`## Model` and Phase 2 Step 2.

## Trigger

The requesting or reviewing lawyer forwards an email containing a **Trademark Search Request Form** to the intake mailbox. The forwarded email is typically structured as a request form ("Worldwide preliminary trademark search — TMP<n>", "Please run this through a preliminary search", or similar). When the request is recognisable as a prelim search ask, this skill invokes.

## Register sources — the vendor is the source of truth; EUIPO is a free EU cross-check

Your tool surface binds **one paid register vendor** plus free / citation tools — use each for its purpose:

- **Paid vendor = the register source of truth** (global coverage, phonetic). The tools are always `register_*`; the vendor behind them is whichever REGISTER_PROVIDER selects — **one vendor at a time** (gated via `agents.list[].tools.allow`, swapped by the operator). Record which one in the audit trail + the scope statement.
- **EUIPO is one of the four register providers, not a cross-check alongside one.** When it is active
  it IS the register, covering the EU alone; every other territory is a disclosed deferred gap.
  `prelim-register/providers/euipo.md` carries the detail.
- **Case-law tools (`courtlistener__*` / `legaldatahunter__*`) are a separate layer** — precedent grounding via the `case-law-citation` skill at Step 4.5, **not** register search.
  *(Tool-naming note: the double-underscore prefix is the MCP-bridge naming convention (`<server>__<tool>`) — see `providers/oauth-mcp-bridge/bridge.mjs`. Keep the names exactly as written; bare names without the prefix would not resolve at the tool layer.)*

The old "exactly one register provider; you will never see both" referred to the two *paid vendors* — it does **not** mean EUIPO or the case-law tools are absent. **Attribute every finding to its true source** in the Findings sheet's Source/Platform column (vendor record vs. EUIPO record vs. case-law authority).

## Model

Model tiers are set **per stage by the deterministic driver** — `driver/stages.mjs` is the
source of truth. Current tiers: register sweep axes (`primary-sweep` / `transliteration-numeric` /
`incumbent-class`) = `sonnet` / adaptive; `saturation-probe` = `haiku` / off; `prelim-common-law` = `haiku` /
low; register digest + `matter-frame` / `prelim-variants` / `placement-inquiry` / synthesis = `opus`; Step-2.6
skeptic = `sonnet`; `narrative-refutation` = `opus`. Every stage runs under the
**forwarding identity** (derived from the queue location); delivery is not an agent capability — it is
the driver's outbox contract (`../../docs/DELIVERY.md`).


## Upfront instructions (per-mark guidance from the reviewing lawyer)

Before Phase 1, scan the forwarded email body for **per-mark guidance** from the reviewing lawyer. They may flag things like:

- "Treat ROYALE as non-distinctive in this gaming context."
- "Don't bother with transliteration sweeps — English-only product."
- "Watch for [specific competitor] — they are aggressive in this space."
- "This mark is coined / highly distinctive — light funnel only."

**Rules:**

1. If upfront instructions are present, treat them as overriding defaults for this run — not suggestions. Apply them in Phase 1 (template), Phase 2 (variant manifest + search execution + synthesis), and Phase 3 (narrative framing).
2. Log every upfront instruction in the Audit Trail with the action taken (e.g. "Reviewer: 'ROYALE non-distinctive' → downgraded weighting on ROYALE-element findings; no Composite 3+ rating assigned on ROYALE alone").
3. If an upfront instruction conflicts with the skill's default rules in `risk-framework.md` or `synthesis-rules.md`, **the reviewing lawyer's instruction wins.** Note the conflict in the Audit Trail.
4. If there are no upfront instructions, run defaults.

This hook exists because some judgment calls (mark-element distinctiveness, industry-specific enforcement patterns) require the reviewing lawyer's institutional knowledge and cannot be reliably inferred from the search itself.

## Scope discipline — "stop if manageable"

When the request form lists multiple proposed names and includes language like *"preferred name — please stop review here if manageable"*, the skill MUST honour it:

1. Run the full Phase 2 workflow on the **preferred (first) name only**.
2. Synthesise its risk verdict.
3. **If the preferred name is rated Composite 1 or 2 (Manageable / Low Risk),** stop. Do not run the alternates. Deliver Phase 1 + the preferred name's Phase 2 + 3 output. Note in the narrative: "Per request form, review stopped at [preferred name] as risk was assessed manageable. Alternates not searched."
4. **If the preferred name is rated Composite 3+,** continue to the alternates so the reviewing lawyer has the full picture for selecting a fallback.
5. The reviewing lawyer is the final arbiter — if their upfront instructions say otherwise (e.g. "run all three regardless"), follow those instructions.

This prevents producing noise findings on names that the client never intended to evaluate.

## Process overview

Three phases, all complete before a single reply is sent to the forwarder.

**Phase 1 — Template:**
1. Extract all fields from the forwarded search request form
2. Mark the email as read immediately (prevents duplicate processing if a heartbeat picks up the same unread email)
3. Derive the run slug and open the run-dir from those fields — Phase 1 authors NO client prose. The report is written in Phase 2 synthesis (per [delivery-contract.md](delivery-contract.md)) and the client email is composed in CODE at Phase 3 (`composeEmailHtml`)

**Phase 2 — Research and synthesis** (run by the deterministic driver; methodology in [phase2-execution.md](phase2-execution.md)):
1. **Variants** — `prelim-variants` produces the variant manifest (consumes `matter-context.md` from Phase 0)
2. **Gather** — common-law + the applicable register units run as batched stages against the manifest
3. **Touchpoint 2: placement-inquiry** — structured inquiry per candidate; produces `placement-recommendations.md` (each candidate placed headline / sheet-2 / watchlist / out-of-scope with reasoning)
4. **Register digest** — combines the unit digests into `register-findings.md`; consumes `placement-recommendations.md`
5. **Skeptic review** — coverage check against floors; a flagged thin unit is re-run escalated to opus
6. **Cross-pollination** — Option D deterministic cross-checks (cap N=10) using both layers' findings
7. **Synthesis** — joint risk analysis using [risk-framework.md](risk-framework.md) and [synthesis-rules.md](synthesis-rules.md)
8. **Touchpoint 3: narrative-refutation** — refutes the narrative against the source files; produces `senior-eye-review.md` (verdict CLEAR / CONDITIONAL / BLOCKING; delivery is gated on it)
9. **Case-law grounding** — ground watchlist / enforcer findings in cited precedent
10. **Cross-mark references** — once, after all marks complete (multi-mark requests only)

**Phase 3 — Delivery:**
- Compile narrative summary + Excel workbook using the per-customer templates selected at Phase 0
- Phase 3 gated on `senior-eye-review.md` verdict (BLOCKING halts; CONDITIONAL applies the suggested corrections; CLEAR proceeds)
- Reply to forwarder
- Cross-person deadline flag
- Mark as read, log handoff, done message
- Archive the run dir (move `studio/prelim-search/<slug>/<date>/` → `studio/prelim-search/archive/<YYYY-MM>/<slug>/<date>/`)

## Tool call budget

The orchestrator itself makes few direct tool calls. Most calls happen inside sub-skills under their own budgets:

- `prelim-common-law`: **15** `perplexity_research` per workflow
  *(rationale: cost-based overflow protection against a looping worker — the API is usage-billed; a search-as-code grid call ≈ $0.06, prose follow-ups ≈ $0.01–0.15 each (measured 2026-06-10). Typical workflow uses 2–6 calls/mark; 15 leaves headroom for thinness re-spawns)*
- `prelim-register`: **150** provider calls per workflow, across all marks
  *(rationale: Corsearch billing-tier ceiling; calibrated against May runs which used 80–110 calls each. The per-mark hard constraints are tighter — see `prelim-register/SKILL.md` "Per-mark ceilings": 20 search / 40 detail-fetch / 5 phoneme / 10 image)*
- This skill: file read/write and memory write — bounded by workflow steps. It builds no workbook and sends no mail: the driver does both at publish, in code.

Cross-pollination dispatches add at most **10** calls split across the two sub-skills (Option D cap).
*(rationale: cost ceiling on dispatched cross-checks — each is one Perplexity or one provider call. Calibrated against May runs where 4–8 triggers fired naturally; 10 catches over-firing without truncating below the typical fire-count)*

## HITL exception (shared across sub-skills)

Trademark research queries within this workflow are **pre-approved** for `perplexity_research` (used by `prelim-common-law`) and the configured register provider plugin (used by `prelim-register`) provided they are properly sanitized:
- **Include:** mark name, product type, relevant industry context
- **Strip:** client identity, reference numbers, internal contact names
- Mark names are not confidential (they are proposed marks, destined for public registries). Who is asking is confidential.

**Declared exception to the standard confidential-triage HITL gate** (see `skills/confidential-triage/SKILL.md`). The user approves the entire workflow at trigger time by forwarding the request email with instructions; per-query approval is not needed. Client identity must still be stripped from every query inside every sub-skill.

## Failure fallbacks

**Both research layers are main sources of the deliverable: if either genuinely fails, the RUN
fails** — the driver retries the stage, then surfaces a failed run. A report is never delivered
with a main layer missing (no "flagged gap" partial delivery).

- **prelim-variants fails or returns empty manifest** → halt; cannot proceed without variants. Surface to user with diagnostic.
- **prelim-common-law fails** (Perplexity unavailable after plugin retries + one worker retry, zero usable results) → the worker writes **no findings file** and reports the tool failure (see `prelim-common-law/SKILL.md` → *Failure protocol*). The driver re-runs the stage, then fails the run and surfaces it. Incomplete-but-ran coverage is NOT failure — that is honest `coverage-limited` / `deferred` ledger rows in a real findings file.
- **prelim-register fails** → "fails" here means the register layer made **zero** successful provider tool calls (`register_search` / `register_record_fetch`) in your session. Verify by inspecting your own tool-use history before declaring this. If even ONE provider call returned a non-error result, the register layer DID execute and you MUST write a real `register-findings-<slug>-<date>.md` containing the hits you collected — even if coverage is incomplete relative to the variant manifest. Document the coverage gap inline (e.g. "12 of 25 planned sweeps executed; remaining skipped because <reason>") rather than declaring the entire layer "not executed". In the genuine zero-calls case: write **no findings file** and report the tool failure — the driver re-runs the stage, then fails the run and surfaces it.
- **Both fail** → same as either: failed run, surfaced — never a template-only delivery.
- **Stage re-run** (any stage; triggered by a missing/invalid output file, a non-`ok` result, or a detected embedded-fallback) → the driver re-runs that stage under a fresh session key (bounded retries), then writes a `.failed` sentinel and surfaces it if it still cannot produce a valid output. The failure taxonomy + file-truth gating live in `driver/gateway.mjs`.

## Phase 0 — Workspace hygiene + matter-frame + template selection (run-start)

The orchestrator works inside a **unique codenamed run-dir under the per-skill `studio/` tree** in the
forwarding identity's workspace:
`<workspacePrefix><agent>/studio/prelim-search/<slug>/<date>-<codename>/`, where `<codename>` is a random
`<adjective>-<noun>` you generate fresh for this run — pick both words freely, lowercase, one hyphen.
The codename guarantees a **unique** dir even for repeated same-matter, same-day runs,
so a prior run's files can never land in — or be mistaken for — this run's, and there is never any need
to inspect or clean up a prior dir. (Slug derivation: see Phase 1.)

> **Run-dir token.** The run-dir is written `studio/prelim-search/<slug>/<date>/…` throughout this skill
> and in worker tasks; in that **run-dir path**, the `<date>` segment is your codenamed leaf
> `<YYYY-MM-DD>-<codename>` (the matching archive path `archive/<YYYY-MM>/<slug>/<date>/` carries the same
> codenamed leaf). Substitute it consistently in every run-dir path you write or hand to a worker.
> **Exception:** the daily `memory/<date>.md` breadcrumb and any date embedded in a *filename* use the
> plain calendar date `<YYYY-MM-DD>`, not the codename.

On every invocation, before Phase 1:

1. **Generate the run codename** — a random `<adjective>-<noun>` (lowercase, single hyphen; pick freshly, never reuse a prior run's). This fixes your run-dir leaf `<date>-<codename>` for the entire run.
2. **Create the run-dir by WRITING into it.** The `write` tool creates parent dirs automatically, so your first write (the matter-context.md in step 3, then `register-units/<axis>.md` files as Phase 2 needs them) creates `studio/prelim-search/<slug>/<date>/`. The unique codename already guarantees a clean, collision-free dir, so there is **nothing to inspect** — do not `read` or list a directory to check or create it; track every file by its known path.
3. **Run `matter-frame` inline** to produce `studio/prelim-search/<slug>/<date>/matter-context.md`. This is the strategic foundation — it names client + sector + customer base + materially-matters jurisdictions + off-field sectors + watchlist-owner seeds. Downstream (Phase 1 variants, Phase 2 register-unit per-jurisdiction sub-queries, Touchpoint 2 placement, Touchpoint 3 refutation) all consume this artifact. Read [matter-frame/SKILL.md](../matter-frame/SKILL.md) and execute it inline; it makes no tool calls and stays cheaply in context.
4. **Per-customer delivery is driven by the RESOLVED CUSTOMER PROFILE, not the sender domain.** The intake
   AI resolves which customer this is for and stamps `profileKey` on the job (email-loop §B3.2a); the driver
   freezes that profile into `_driver/profile.json`, and the deterministic publish code reads its `delivery`
   descriptor — which today carries only the P&C header flag. `email` no longer selects a body: every
   customer gets the same cover note (`{ email: "summary" }`), and a stored `"table"` folds to it.
   There is no per-customer body left to select and no template to pick: one file remains
   ([templates/email/generic.md](templates/email/generic.md)) and it is a RECORD of the retired
   per-customer body, not an instruction. What the profile still decides is the P&C flag, and it
   decides it through the bound profile, never `*@domain`.
5. **Phase 3 archives this run** on successful delivery: the dated subdir is moved to `studio/prelim-search/archive/<YYYY-MM>/<slug>/<date>/`. A run that delivered but failed to archive is a workflow violation — Phase 3 (see [Phase 3](#phase-3--delivery--must-pattern)) handles the move.

## Phase 1 — Template

Extract the fields from the Trademark Search Request Form and derive the slug. **Phase 1 produces no client-facing prose** — it is field extraction and run-dir setup, and nothing else.

The report body is authored in Phase 2 synthesis against [delivery-contract.md](delivery-contract.md); the email that carries it is composed in CODE at Phase 3 (`composeEmailHtml`), one cover note for every customer. A body drafted here reaches no reader — the notify seat is a courier that sends the driver's file verbatim. ([template-formatting.md](template-formatting.md) survives as the KNOCKOUT RENDERER'S formatting reference — see its header; it is not a drafting instruction to this seat.)

**Slug derivation.** The slug for the run-dir is `tmp<n>-<kebab-mark-name>` — e.g. `tmp2201-project-novapulse`, `tmp8642-solstrike`. The TMP number from the request form's *Reference No.* field is the firm's unique identifier and guarantees uniqueness; the kebab mark name keeps the slug human-readable. Lowercase, ASCII letters / digits / hyphens only. Multi-mark requests: use one slug for the request (typically the first mark); if per-mark separation is needed inside the run, use a `marks/<mark-kebab>/` subdir within the dated dir.

(Marking the source email read happens at INTAKE, integrator-side — see `../../docs/INTAKE.md`; the driver's dedup gate additionally parks duplicate submissions of the same matter.)

## Phase 2 — Research and synthesis

Phase 2 is **sequenced by the deterministic driver** (`driver/`); the step-by-step
**methodology** lives in [phase2-execution.md](phase2-execution.md). It covers:
- **Step 1** — variants (`prelim-variants` writes the variant manifest)
- **Step 2** — gather (common-law + the applicable register units) → Touchpoint 2 placement-inquiry → register digest
- **Step 2.6** — skeptic review (fresh-eyes audit before trust)
- **Step 3** — cross-pollination (Option D, cap N=10)
- **Step 3.5** — actual-use check (mandatory for Composite 3+ register hits)
- **Step 4** — joint synthesis (dominant-element spine, file-truth precondition)
- **Step 4.5** — case-law grounding via the `case-law-citation` skill
- **Step 4.7** — narrative-refutation (verdict gates Phase 3)
- **Step 5** — cross-mark references (multi-mark only)

## Phase 3 — Delivery — MUST PATTERN

**Phase 3 is mandatory on every run that reaches it.** It produces the **email reply with the Excel attached** — *that* is the deliverable, not the Excel file alone. Partial *coverage* (honest `coverage-limited` / `deferred` ledger rows) still delivers, with documented gaps — but a missing main research layer is a **failed run**, not a deliverable (see [Failure fallbacks](#failure-fallbacks)).

The driver runs the delivery stage on **every** completed run — the search is a defended **draft for the reviewing lawyer**, never withheld. The `narrative-refutation` verdict drives a corrective re-synthesis (CONDITIONAL / BLOCKING feed the reviewer's flags back into one rewrite pass), but it does **not** block delivery: if the reviewer still has unresolved concerns after the corrective pass, the report is delivered with those concerns surfaced to the reviewing lawyer as a prominent **"Reviewer's open questions"** section at the top of the body (the driver passes them in). The reviewing lawyer is the consumer and the backstop.

**Delivery is deterministic — code, not an agent turn (`../../docs/DELIVERY.md`). On every completed run the driver:**
1. Composes the HTML email body in CODE: the cover note per Deliverable 1 spec below + the published report/audit links. One shape for every customer — no per-customer review table rides the mail.
2. Builds the audit workbook in CODE (`driver/publish/xlsx.mjs`, from the artifacts this workflow wrote) and publishes report + audit into the pool. Its sheets and columns are the code's, not a template's, and nothing here assembles or formats a workbook.
3. Writes the self-contained delivery packet `_driver/delivery.json` (forwarder route, subject, original message id for reply threading, the full email HTML, optional WhatsApp line) + the outbox `delivered` event, and sets `status.sendPending`.
4. The **integrator's courier** sends the packet **VERBATIM** (email threaded on the packet's `msgId`; WhatsApp ping only if the packet carries a binding) and confirms with the ops-MCP `mark_sent` — which writes the `.sent` guard and clears `sendPending`. The courier composes nothing and never invents a recipient.
5. The **driver** archives the run-dir (`studio/prelim-search/<slug>/<date>/` → `archive/<YYYY-MM>/<slug>/<date>/`) and records the delivery. `senior-eye-review.md` travels in the published audit set, so the reviewing lawyer sees the refutation verdict regardless of CLEAR/CONDITIONAL.

**Why the verdict always surfaces:** the dangerous failure mode is a wrongly-cleared confabulation that ships unread. The reviewing lawyer always sees the review (CLEAR / CONDITIONAL / BLOCKING) — on the audit notification, and, when concerns are unresolved, as the **Reviewer's open questions** section in the report itself — so the reviewer can decide whether the read was right. Never silently passed, never silently withheld.

**Filename pattern for the Excel**: `TMP<n>-<mark-slug>-V<v>-<Provider>-Findings-<YYYY-MM-DD>.xlsx`.

### Deliverable 1: Narrative summary (email body)

**No template is selected and no seat composes this.** `composeEmailHtml` builds the cover note in code from the structure below, one shape for every customer; the files under [templates/email/](templates/email/) are a record of the retired per-customer bodies, not a spec to draft against. The confidentiality marking is `confPosture` (`shared/brand.mjs`) — three-valued, stated there and nowhere else. What follows is the **content** the code renders, described so a reader can see what the mail carries.

**Game-title developer attribution MUST come from `common-law-findings.md`'s `developer_of_record` / `publisher_of_record` fields** — never confabulate publishers (Bandai Namco, Tencent, etc.) by inferring from prior-frequent gaming companies. If the field is `not extracted` or empty, write "(developer unverified)" rather than guessing.

**Methodology lives in the Excel Methodology tab, NOT in the email body.** Do not include paragraph-length descriptions of search approach, sub-skills invoked, variants generated, etc. in the client-facing email. That bloat is what the render-layer split fixes.

**The email is a COVER NOTE; the HTML report is the single master document (wp50).** The house default for every customer: the email carries only the headline risk tier, the report link, and any surviving scope/verdict/handling flags plus reviewer's open questions — no findings body, no client-voice prose, no hand-holding preamble. Client-voice findings live in the **HTML report** (the one surface the client reads). The last exception — Aurora's review-table overlay (`delivery.email:'table'`) — is DELETED as of 2026-07-28, along with the knob that asked for it: a second full findings surface in the mail was the seam that let per-conflict tiers diverge from the report, and on the knockout lane it shipped internal purple notes over the wire. A lawyer who needs a bespoke, forwardable client mail asks the assistant to draft one from the run's `report-data.json` — formatting is judgement, and it belongs where judgement lives, not in a profile enum. The operative delivery spec is [delivery-contract.md](delivery-contract.md) + the driver's `report-synthesis` stage. (The `client-summary` stage, which re-voiced the findings into a separate client-facing document, is RETIRED as of 2026-08-01 — the one report is the one surface.)

Structure (content shared across templates):

**0. Headline & recommendation** (executive-summary content)
- The overall **risk shape** — a crowded field of individually-manageable marks, or one real blocker? Reason it; do not manufacture a single high spike from a distinguished or off-field mark.
- A clear **recommendation**: proceed / proceed-with-modifications / proceed-in-some-markets / do-not-proceed-without-attorney-review — naming the one or two findings that drive it.
- For each real conflict, the **path**: blockable / coexistable / challengeable.
- Keep the **legal read and the business read distinct** in the headline (e.g. "legal risk is a manageable Level B; the live question is a commercial coexistence") — never let a business factor inflate the legal headline.

**1. Scope statement** (from variant manifest's scope_statement field)
> "We conducted common law and marketplace searches and trademark register searches for [N] proposed marks in the context of [product description], focusing on Classes [X, Y, Z]. Our common-law search covered the [N] mandatory marketplaces dictated for this customer (e.g., for gaming: Steam, Epic Games Store, Google Play, Apple App Store, Microsoft Store, itch.io), plus general web, e-commerce, social media and domain registries — and, for any collaborated / non-gaming goods, a general search scoped to those goods (e.g. [pizza]). Our register search ran via [vendor] (with EUIPO for EU/EUTM confirmation) across [N] jurisdictions with funnel narrowing and live-status filtering. Cross-pollination between layers applied per our standard methodology (see audit trail)."

**Coverage statement (mandatory, honest).** Right after the scope, state plainly what was and was not searched, from the `## Coverage ledger`: *"Searched to completion in [these jurisdictions / axes]; coverage was limited in [these]; not searched this run in [these] — risk in unsearched markets is **unassessed**, not clean."* A `deferred` / `coverage-limited` jurisdiction is **never** rendered as a clean negative; the reviewing lawyer must see exactly what they are signing off on. **A dropped variant / field / source is a coverage limitation too:** read the variant manifest's `### Scope ledger` section (the variants-stage coverage statement, spanning the variant / field / source layers) alongside the two findings-file ledgers, and surface any `dropped` row as a recall limitation in the same breath (e.g. *"transliteration sweeps were not run — conflicts under non-Latin scripts are unassessed"*; *"the developer ecosystem was not searched — collisions on that channel are unassessed"*) — a dropped variant axis, an off-fielded sector, or an unsearched channel is unsearched recall, never silent absence (see [synthesis-rules.md](synthesis-rules.md) → *Coverage honesty*).

**2. Per-mark findings** — for each mark, lead with the **proposed-mark assessment**, then the five finding categories:

- **Proposed-mark assessment** (registrability flag, advisory — *for the reviewing lawyer to assess*): the **dominant element** + where the mark sits on the distinctiveness spectrum, and any obvious registrability flag (descriptive / generic / laudatory / geographic, or deceptive / offensive) — or "plainly distinctive, no flag." Where descriptiveness is flagged, carry the **acquired-distinctiveness / secondary-meaning** note (descriptive is a flag, not a veto). Taken from the variant manifest's *Distinctiveness & registrability* section. Answers *"can we register / use this mark at all?"* — separate from the conflict findings below. **Standing on EVERY run, whether or not the brief asks** (WP-56): the same read — distinctiveness **plus connotation/meaning, English AND non-English** — is emitted as the typed `mark_assessment` field in findings.json and renders as "The mark itself" at the TOP of both report variants (see `synthesis-rules.md` → *The mark itself — standing assessment*). Own-assessment voice, never a sweep dump; a clean meaning result is a data point ("no adverse readings across the languages/scripts searched"); real PR/reputational hits stay in their own section.

- **Consumer-confusion risks:** findings that could cause confusion with the proposed mark in its intended product space. For each, state the **legal read** (the whole-mark confusion comparison → Legal Risk Level) and the **business / practical read** (use / enforcement / coexistence) **separately** — the business read sits beside the legal level and never moves it. Include the advisory composite and inline URL. Mix common-law and register-side findings if both apply.
- **Commercial awareness:** identical or similar names in unrelated fields, crowded-field evidence, anything the business should know about even if not a legal blocker.
- **Competitor intelligence:** existing brand partnerships in the space; watchlist hits; competitor portfolios in target classes. Mandatory category.
- **Register snapshot:** key register-layer evidence — primary blockers, opposition history, stealth-filing patterns, industry-incumbent context.
- **Negative connotations / PR risk:** any brand risk, offensive associations, controversial connections — or "None identified" if clean.

**3. Cross-mark references** (Step 5 output, if multi-mark request)

**4. Methodology note:** brief description of search approach — variants generated, sub-skills invoked, cross-pollination triggers fired (and any cap-overflows), gaps or limitations.

**5. Local-counsel / further-investigation flags:** where the position can't be closed remotely, say so and name the next step — e.g. *"a sense-check from Irish counsel is recommended"* or *"Chinese / Benelux investigations would be needed to confirm non-use."* This is the bridge to the eventual full per-market clearance; the reviewing lawyer includes it routinely. Tie each flag to the specific finding(s) it concerns.

**6. Clean searches:** when no material findings are identified for a mark, explicitly state this as a positive result. Document what was searched and the absence of findings — a clean search is a good result but the client needs to see the full analysis was done. (Only sayable for `confirmed-clean` coverage — see the Coverage statement.)

**7. Reviewer's open questions:** the judgment calls the run could not close on its own — the independent reviewer's unresolved concerns (surfaced prominently at the top when the verdict was still BLOCKING after the corrective pass), plus any deliberate "reviewer to confirm" items. This is the honest hand-off: the best draft we can produce, with its weak spots labelled for the reviewing lawyer's judgment. Never omit it to look more finished.

### Deliverable 2: Excel workbook

**One Excel workbook per request** (not per mark) — five sheets unified across both layers:
"Findings", "Negative Results", "Out-of-Scope / Filtered", "Audit Trail", "Methodology", built from the findings files + the touchpoint artifacts (`matter-context.md`, `placement-recommendations.md`, `senior-eye-review.md`) in Phase 3. The **Findings** sheet carries the **Legal Risk** and **Business / Practical Risk** as *separate* columns (never one blended score), plus the per-row coverage status.

The **workbook is the driver's, built in code at publish** (`driver/publish/xlsx.mjs`) from the findings files and touchpoint artifacts named above. Its sheets, columns and formatting are fixed there. Nothing in this workflow assembles, formats or routes a workbook — write the artifacts, and the sheets follow.

The **Out-of-Scope / Filtered** sheet is populated from `placement-recommendations.md`'s "Out-of-scope / filtered" section — every candidate `placement-inquiry` placed off-field appears here with its reasoning trace. Nothing disappears silently.

The **Methodology** sheet carries: matter-context summary, search approach, placement-inquiry summary by tier, narrative-refutation verdict, and open verification flags — **plus a coverage-ledger summary line** (`<N> confirmed-clean / <N> coverage-limited / <N> deferred`, with the deferred/limited scopes named) drawn from the findings files' `## Coverage ledger` sections, so the reviewing lawyer sees at a glance what was searched clean vs. what was a coverage gap. Methodology lives in the workbook, never in the client-facing email body.

**Detail-fetch coverage** (register search-depth floor — kept here, not in the Excel spec, because the Step 2.6 skeptic review depends on it) — rank the union of unique URIs returned across all register searches by signal strength, then detail-fetch as follows:

1. **Identical-mark hits** — fetch all, no cap.
2. **Near-exact (dominant-token-substring) in-class-live hits — fetch all, no cap (Slice A).** The mirror, at the orchestrator floor, of the unit-side [exact-in-class-live floor](../prelim-register/unit.md#exact-in-class-live-floor-primary-sweep-unit-owns-it). The **near-exact band** — where the **dominant element** (from the variant manifest) appears as a *substring* of `mark_text` (case-insensitive, after the `normalize()` strip in [status-rules.md](../prelim-register/status-rules.md), see the Identical-match normalisation shape) in a **filed target class** with **live** status, but is not an identical match (e.g. NORDWAVE NOVAPULSE, NOVAPULSE.com on dominant element NOVAPULSE) — is **enumerate-and-fetch, no top-N, no score gate**. This is the F-1/F-3 hole: the near-exact band otherwise falls into the Top-K sample (item 5) and a dangerous in-class-live conflict gets paged past the cliff. *Budget tie:* if the qualifying set exceeds the detail-fetch budget, the coverage unit is **`coverage-limited`** (reason: "exact-in-class-live substring set exceeded detail-fetch budget") — **never** silent truncation, **never** `confirmed-clean` (per B-1 / the Coverage-honesty rule). Slice A is **exhaustive** — distinct from the sample-with-disclosure Slice B below.
3. **Phonetic-equivalent fringe — floor, sample-with-disclosure (Slice B).** Run the provider phonetic capability on the dominant token for the matter languages (provider-agnostic: `<provider>_expand_phoneme` then `match_mode: phonetic`; Clarivate uses native `match_mode: phonetic`). It **is a floor** — it MUST run for the dominant token in the filed class — but phonetic sets are unbounded, so it is **sample-with-disclosure**: where it cannot be fully worked, the coverage unit is **`coverage-limited`** (reason: "phonetic fringe sampled, not enumerated"), never `confirmed-clean`. Keep Slice A (exhaustive) and Slice B (sampled) **structurally distinct** — they have different correctness properties.
4. **Watchlist-owner hits** — fetch all.
5. **Top-K by relevance** — sample from each match-mode (exact / phrase / default) and across regions to ensure representative coverage. If the worker stops detail-fetching before ~25 URIs across all match-modes, the worker MUST answer in its digest audit: did the result set genuinely run out, or is this the empirical execution-tier truncation pattern (~10 URIs, no explanation)? The 25 figure is a tripwire-with-question, not a target — the Step 2.6 skeptic reads the worker's answer and re-spawns escalated to Opus if the answer is missing or unconvincing.
   *(why the tripwire: the cheaper execution tier tends to silently truncate at ~10 URIs; 25 forces the worker to either reach past that cliff or explain why it didn't.)*
6. **Transliteration hits** — minimum **2** per non-zero transliteration search.
   *(rationale: transliteration searches typically return few hits in target classes; minimum-2 guarantees at least one identical-mark check + one near-match check per script (JP / ZH / KR / AR / Cyrillic). Below 2, the run can't distinguish "no hits in that language" from "hits but unsampled.")*

Items 1–3 are **floors with no cap on Slice A** (the dangerous in-class-live band is never sampled); items 5–6 are representative samples. The exact-in-class-live floor (Slice A + Slice B) is what makes the B-1 saturated-field `confirmed-clean` qualifier satisfiable — a saturated unit that ran neither cannot be called clean.

Every fetched URI is logged in the Audit Trail with its source query and ranking rationale. A run finishing with fewer than **20** detail-fetches across all searches is a question the audit must answer ("only 7 unique URIs returned" / "worker truncated at 10 without exhausting the result set" / etc.) — not a quota to hit. The execution tier's truncation pattern is the failure mode being trapped; the audit answer is what catches it.

## Delivery details (the packet contract + integrator conventions)

**Routing is packet-bound.** The delivery packet names the forwarder route (`forwarder` /
`forwarderEmail`) and the original message id for reply threading; the courier routes to exactly that
and nothing else. Recipient conventions beyond the plain reply — e.g. "junior forwarded it → CC the
supervising lawyer", chat-channel announcements, or a cross-person deadline heads-up ("this request
carries batch deadlines that affect someone other than the forwarder") — are **integrator-side
conventions**, layered on at the integrator's send step, never composed by the engine and never added
by the courier on its own judgment.

**Courier log discipline** (reference integration): one line per routed event in the courier's own
log/memory — `delivered <runId> (<verdict>) → <forwarder>` — so a wedged or double-woken courier can
be audited without touching the engine.

## Reply rules

- Reply to the forwarder — the packet routes to whoever forwarded the request.
- **Do not contact the original sender** (client, paralegal, etc.) — ever. The courier never invents
  a recipient; a packet with no usable route is reported to the operator, not guessed.
- The email body is sent verbatim — no prose above the report, no "Here's the prefilled template..."
  intro, no reformatting.

## Checklist — before sending

- [ ] Phase 1 HTML template is complete and formatted per [template-formatting.md](template-formatting.md)
- [ ] Variant manifest produced by `prelim-variants` and validated
- [ ] `prelim-common-law` produced its findings file with every dictated platform covered
- [ ] `prelim-register` produced its findings file with funnel pattern executed
- [ ] Cross-pollination Option D triggers all evaluated; any executed cross-checks logged; cap-overflow noted if applicable
- [ ] Scope statement paragraph is present in narrative (from variant manifest)
- [ ] Every finding has a URL or register URI
- [ ] Every finding has an advisory risk assessment (or N/A with reason)
- [ ] **Dominant-element spine applied:** findings ranked by dominant element + whole-mark confusion; no on-point identical / near-identical-in-class hit dropped; headline driven by top on-point conflicts (not a distinguished mark or unrelated-field noise)
- [ ] **Proposed-mark registrability read present** (dominant element + spectrum + deceptive/offensive flag, or "plainly distinctive")
- [ ] **File-truth precondition met:** `register-findings.md` was written under the run-dir and synthesis read from it (not inline / announce text)
- [ ] **Delivery complete:** report + audit published to the pool; `_driver/delivery.json` + the outbox `delivered` event written (`sendPending` set — the courier sends verbatim and confirms via `mark_sent`); the driver archived the run-dir to `studio/prelim-search/archive/<YYYY-MM>/<slug>/<date>/` and recorded the delivery
- [ ] **matter-context.md produced at Phase 0** with materially-matters jurisdictions, off-field sectors, watchlist-owner seeds; downstream workers received it as input
- [ ] **placement-recommendations.md produced at Phase 2 Touchpoint 2** with every candidate placed at headline / sheet-2 / watchlist-annex / out-of-scope-filtered + written reasoning; consumed by digest worker
- [ ] **senior-eye-review.md produced at Phase 2 Touchpoint 3** with verdict CLEAR / CONDITIONAL / BLOCKING; corrections applied before Phase 3 if CONDITIONAL; halt + surface if BLOCKING twice
- [ ] **No confabulated game-publisher attributions** — every game-title finding's publisher / developer traces to `developer_of_record` / `publisher_of_record` in common-law-findings, or shows "(developer unverified)"
- [ ] Register findings include opposition history verbatim when present
- [ ] Negative results documented for all variant × platform combinations (common-law), the field-scoped general search for collaborated / non-gaming goods, and all variant × class queries that returned no live results (register)
- [ ] **Coverage ledger honoured:** both findings files carry a `## Coverage ledger`; every `matter-context` material jurisdiction has a row; the variant manifest's `### Scope ledger` section was read as the variants-stage coverage input and any `dropped` variant / field / source surfaced as a recall limitation; no `deferred` / `coverage-limited` ledger row and no `dropped` scope-ledger row is rendered as a clean negative in the narrative (the `narrative-refutation` coverage audit passed — `coverage-overclaim` / `missing-coverage-row` clear)
- [ ] Audit trail is complete across all layers (variants / common-law / register / cross-pollination)
- [ ] Cross-mark references identified (if multi-mark request)
- [ ] Competitor intelligence section present in narrative
- [ ] PR/reputational risks separated from trademark risks
- [ ] All risk assessments labeled "Advisory — preliminary assessment for the reviewing lawyer's review"
- [ ] Excel has 3 sheets: Findings, Negative Results, Audit Trail — UNIFIED across both layers
- [ ] Source Layer column populated in every row of Findings and Audit Trail
- [ ] Verify? column marked ✅ on transliteration hits and other open-verification rows
- [ ] Narrative includes inline URLs and advisory risk levels
- [ ] Clean searches explicitly documented as positive results
- [ ] No client identity or reference numbers in any sub-skill's tool calls

## Workflow Audit Summary — emit in final session message

Before completing the workflow, emit a structured audit summary as your **final session message** (plain text, not in the client email body). This is for the reviewing lawyer's instant visibility — it tells the reviewer at a glance whether the run was complete or short.

Format — one line per phase + each major search category, marked ✅ (done), ⏭ (explicitly skipped with reason), or ⚠ (under target). The final `attachments:` block is REQUIRED — the orchestrator that spawned you reads your final session message and forwards declared attachments to the end user. A missing or empty `attachments:` block means the xlsx never reaches the requester:

```
✅ PHASE 0 — MATTER FRAME + TEMPLATE SELECTION:
   matter-context.md produced; client + sector + customer base named
   Materially-matters jurisdictions: <list>
   Off-field sectors: <count> categories pre-flagged
   Customer template: <resolved template name> (email + Excel)
✅ PHASE 1 — TEMPLATE: HTML generated; email marked read
✅ PHASE 2 — RESEARCH:
   Variants: N variants in manifest from prelim-variants
   Common-law: X findings ([N]/[N] dictated platforms covered); developer_of_record on <N>/<M> game-titles
   Register: Y findings; Z detail-fetched from W total URIs
     Per-jurisdiction sub-queries: ✅ <count> on <named jurisdictions>
     Macro probes: ✅ <count>
     Compound-phrase 3-mode sweeps: ✅ exact/phrase/default OR ⏭ <reason>
     Single-word coverage: ✅ <count> OR ⏭ <reason>
     Wildcard reorders: ✅ <count> OR ⏭ <reason>
     Numeric-substitution: ✅ <count> OR ⏭ <reason>
     Transliteration: ✅ <count>/<expected> core scripts; ⏭ <skipped scripts> (<reason>)
     Detail-fetch: ✅ <count> URIs OR ⚠ under-25 (<reason>)
   Touchpoint 2 placement-inquiry: <N> headline / <N> sheet-2 / <N> watchlist-annex / <N> out-of-scope-filtered
   Cross-pollination: <count> executed, <count> cap-overflow flagged
   Synthesis: risk assessments on <count> findings
   Touchpoint 3 narrative-refutation: verdict <CLEAR|CONDITIONAL|BLOCKING>; <count> flags; <count> corrections applied
✅ PHASE 3 — DELIVERY (deterministic): checklist items completed
   Excel built ✓ at <archive-path>
   Published ✓ report + audit in the pool; delivery packet + outbox `delivered` event written (sendPending)
   Run-dir archived ✓ from studio/prelim-search/<slug>/<date>/ → studio/prelim-search/archive/<YYYY-MM>/<slug>/<date>/

key artifacts:
  - <absolute path to the xlsx produced in Phase 3> (the client deliverable)
  - <absolute path to senior-eye-review.md in its archive location> (internal audit — refutation review, [VERDICT])
```

Every ⏭ or ⚠ MUST have a stated reason. If any line shows ⏭ or ⚠ without a stated reason, re-run the missing step rather than send.

The key-artifacts list takes absolute paths only. Always include the xlsx (the client deliverable) AND `senior-eye-review.md` (the internal audit artifact the reviewing lawyer always sees regardless of verdict — see Phase 3 pre-gate). If Phase 3 did not produce an xlsx (which should not happen — see Phase 3 above), state that explicitly as a delivery failure rather than emitting an empty list.

This summary is for the run's session log and the internal audit trail — NOT for the client. The client gets the narrative + Excel only.
