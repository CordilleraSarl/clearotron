---
name: matter-frame
description: Pre-flight reasoning step for trademark searches. Produces a structured matter-context.md naming the client + sector + customer base + channels of trade + materially-matters jurisdictions + off-field sectors + watchlist-owner seeds — before any search runs. Invoke at Phase 0 of prelim-search or a full clearance-search. The downstream workflow consumes this artifact at every step (variants generation, register sweep, placement inquiry, narrative refutation) so the matter's commercial context stops being implicit and starts being load-bearing.
---

## Purpose

You are doing what a senior trademark lawyer does before any searching: reading the brief and writing a one-page note about what this matter actually means in commercial terms. The downstream workflow can then reason against THIS matter's specifics, not against a generic "trademark clearance" template.

This is structured inquiry, not rule application. You are reasoning, not classifying.

## When invoked

Phase 0 of any trademark search workflow, after the request has been parsed (mark, classes, manner of use, client, requester) and before variants generation. One Opus inline call, no tool budget, no spawned workers.

Invoked from `prelim-search` (orchestrator) at Phase 0, before `prelim-variants`. Reusable by a future clearance-search at the equivalent step.

## Model

Inherits the orchestrator's tier when invoked inline. No `sessions_spawn` — this is a templated reasoning step the orchestrator performs itself.

## Inputs you receive

From the orchestrator's spawn task / Phase 0 context:

- Mark name(s)
- Proposed Nice classes
- Manner of use (codename / product branding / advertising / etc.)
- Campaign shape, when stated ("Stated campaign shape: …") — the client's own facts about how the mark will
  be deployed: standalone brand vs flavour/sub-brand under a named house mark, seasonal/limited vs permanent,
  launch scale
- Additional info (tier, localisation, geography, deadline)
- Client identity (typically from forwarded-email metadata)
- Requester (who sent the request — may differ from end client)
- Any client-supplied context

Also **read [watchlist-reference.md](watchlist-reference.md)** before writing the Watchlist-owner seeds section — a standing, sector-grouped crib of owners worth remembering. It is enrichment, not authority (see that section).

## Output

You do not write a file. Hand the frame back by calling `record_matter_frame`; the driver renders `matter-context.md` from what you send. Your `prose_body` is ~500-1000 words and carries these sections, in this order:

### Client and sector
- Client legal name
- Client's actual business (one short paragraph)
- Sector classification (specific, not generic — "console gaming hardware/software development tools" beats "tech company")
- **Applicant's own & affiliated marks — exclude from conflicts (mandatory).** Name the applicant and its affiliates / subsidiaries. The applicant's own marks, and its affiliates', are **never conflicts** — drop them from every watchlist; they must never surface as a finding against the applicant. State this explicitly so downstream never flags the client against itself. (A **commercial partner** is *not* the applicant — name partners separately under Watchlist with the partnership context; a partner's mark is a coexistence/business question handled on the business read, not auto-excluded.)

### Product description
- What the mark is for, in plain language
- Internal codename vs public-facing
- B2B / B2C / B2D (developers)
- **Campaign shape — stated facts win; an inference must say it is one.** When the request carries a stated
  campaign shape ("Stated campaign shape: …"), quote it VERBATIM as fact and reason from it. When it does
  not, you may still reason about the likely launch shape — but any claim of house-brand attachment
  ("applied to a house mark X"), seasonality/duration ("a seasonal flavour"), or launch scale MUST be
  written on a line that names itself as inference, e.g. `Campaign shape (inferred — not stated in the
  request): …`, never asserted as a matter fact. Downstream surfaces repeat what this section says; an
  unlabelled guess here ships as a fact in the report.

### Customer base
- Who actually uses or buys this product
- Decision-makers vs end-users if different
- How customers discover this product
- **Degree of care / sophistication** of the relevant consumer — mass-market impulse buyer vs high-attention professional (e.g. a licensed developer or enterprise buyer). A sophisticated, narrow audience is confused less easily; the confusion test consumes this, so state it.

### Channels of trade
- Where the product is sold or distributed
- Online platforms / retail / direct sales / partner programmes / developer portals
- Geographic distribution patterns

### Class scope & adjacency
- The proposed Nice classes, and — by **reasoning**, not lookup — which *adjacent* classes to search. The test: *"would a consumer encountering both products assume they come from the same or an economically-linked undertaking?"* If yes, that adjacent class is in scope.
- Name the classes scoped IN (with a one-line reason each) and any deliberately scoped OUT. Wrong class scope produces a false-clean, so be deliberate — this is a recall lever, not a formality.

### Scope jurisdictions — search wide, cite narrow (instructed scope honored; worldwide / brand-signalled scope leans wide + discloses)

Two scopes live here, and the doctrine is **narrow at citation, never silently at search**: the **search scope** (where the register sweep looks) must be wide enough to catch the conflict; the **citation scope** (what the report flags and ranks) is where rights legally matter. The failure to avoid is the PETCARY miss — *silently* pinning a globally-signalling brand to one country, so the real EU/UK/US conflict is never even searched. Derive both from THIS matter; a customer profile selects the **risk framework** only — it never sets territory.

- **Instructed scope is honored (narrow or wide).** When the client names territories — a list, or "X only" — that is the scope for BOTH search and citation; do not override a client who genuinely wants a narrow scope (a sweep of a country with no instructed interest and no reach is wasted). The profile's `defaultJurisdictions`, when present, is the *customer's own standing instruction* — treat it like an instructed set.
- **Worldwide, or the brand's own signals point broader → the SEARCH widens (it never silently narrows).** When the instruction is worldwide, OR the brand signals broader use — a global gTLD (a `.io`/`.com` launch), an investor / expansion announcement, stated target markets, a genuinely global customer base — the **search set includes the major markets (US / EU / UK / CN / JP) plus the signalled markets**. Decide which to actually cite and rank at **selection** (where rights matter), and **disclose** any material market you could not fully cover (a `coverage-limited` row — never a silent clean). The one move forbidden: quietly pinning an unpinned, globally-signalling brand to a single country (the PETCARY miss). **The cost guard stays:** an abstract *"the sector tends to be global"* is **not, by itself, the widener** — the widener is a CONCRETE signal (a worldwide instruction, or the brand's own global footprint), so a deliberately local matter stays local.
- **Genuinely unpinned, no global signal → reason the likely scope, LABEL it inferred, and DISCLOSE it.** Read the product / customer base / channels and scope to where the brand plausibly operates; never silently default to the requester's home country (that is the PETCARY mechanism). Where reach is plausibly broad, lean wide; where clearly local, scope local — either way set `Scope basis: inferred` and record a one-line `Scope assumption:` so a narrowing is visible and the coverage gate can clamp + disclose it.
- **In scope by reach.** A territory also counts when a right is **legally effective in an instructed territory by any route** — filed there; an international (Madrid) registration **designating** it; a regional/supranational right covering it (an EUTM covers every EU member; an instructed EU member is covered by an EUTM); a treaty / priority effect. Tag such a territory `in-scope-by-reach` and name the route. Reason the route from the right — never assume it.
- **Excluded.** Territories you considered and set aside — neither instructed, nor brand-signalled, nor a major on a worldwide matter — name each, the reason, and a **reopen trigger** (a right or signal pointing there surfaces). A hit effective ONLY outside the scope set is out of *citation* scope (drop it from findings); but a market the brand actually signals belongs in the SEARCH set, not here.
- **Primary vs only.** If the instruction names territories of "primary" / "first" interest WITHOUT "only", treat the named ones as the citation core but **let the search lean wide** to the majors / brand-signalled markets (the "primary" wording signals more may matter), and **record the assumption** — a one-line `Scope assumption: <text>`. (A single clarifying question is acceptable instead; the recorded default never blocks the run.)
- **Send the structured scope as FIELDS** (the downstream sweep + `frame-diff` consume it): `scope_jurisdictions` — the SEARCH set as short codes (EU / US / CN / CH …), including the majors / signalled markets when leaning wide and any `in-scope-by-reach` ones; `excluded_jurisdictions` when any were set aside; and `scope_basis` as `instructed | worldwide | inferred`, so synthesis knows whether a narrowing was disclosed. The driver renders the lines.
- This set drives the per-jurisdiction sub-queries AND the major-jurisdiction floor in `prelim-register`; `frame-diff` checks it both ways (a citation outside the scope set = over-reach; a material market in the set left unsearched = under-coverage — disclosed + clamped, never a silent clean).

*Worked illustrations:*
*— Instructed "Switzerland and the EU, only" → search CH + the EUTM/EU layer (+ any Madrid designation reaching them); majors beyond (CN/JP/US/UK) are out of scope — an honored narrow instruction (`Scope basis: instructed`).*
*— A brand on a `.io` domain with an investor deck naming a US/EU launch and no explicit territory list → lean wide: search US/EU/UK/CN/JP + the named launch markets; cite where rights matter; disclose any gap (`Scope basis: inferred`). This is the PETCARY fix — do not pin it to CH.*
*— A local artisan, national-only product, no global signal → scope the home market, `Scope basis: inferred`, `Scope assumption:` recorded — narrow but disclosed, never silent.*

### Off-field sectors
- Sectors that look class-adjacent (Nice class overlap) but are commercially unrelated
- For each: brief reason it's off-field for THIS client
- **For tech / developer-tooling / dev-platform / SaaS marks specifically, AI / vector-database / ML-infrastructure / LLM-tooling / music-AI / pharma-AI / blockchain-platform companies sharing the same token are common false-friend categories** — they share Nice Classes 9 / 42 with many client marks but serve fundamentally different customer bases (ML engineers, drug researchers, blockchain developers). Pre-flag a sector as a likely false friend only when the client's own customer base (per Customer base above) does NOT overlap with that sector's customers. When the proposed mark IS itself an AI / ML / LLM / blockchain product (e.g. an AI assistant, an ML platform, a SaaS infrastructure SKU), do NOT pre-flag — these sectors are on-field competition for that matter and `placement-inquiry` must inquire per candidate without the off-field shortcut. The named list is a checklist of common false-friend categories; the off-field call is always per-matter.
- Example for a tech-codename matter: "AI vector-database / LLM-embedding SaaS — Class 9 + 42 overlap, but vector-DB customer base is ML/backend engineers, not the client's customers; channels of trade (pip install / SaaS console) don't intersect with the client's distribution"
- This list informs `placement-inquiry` placement decisions downstream; concrete reasoning beats taxonomies

### Watchlist-owner seeds
- 3-7 named owners worth particular attention
- Obvious major competitors in the sector
- Partner-ecosystem owners (e.g. if MS is client and Nordwave is a Windows-Dynamic-Lighting partner, name Nordwave with the partnership context)
- Aggressive enforcers on the dominant token
- Prior incumbents whose marks may be vulnerable to revocation
- **Enrichment from [watchlist-reference.md](watchlist-reference.md), not authority.** Surface the reference entries RELEVANT TO THIS MATTER's customer / sector as enrichment — you still name the seeds you judge relevant for this matter with your own reasoning; reference entries that do not fit this matter are not surfaced, and (per the applicant-exclusion posture) any reference entry that IS the applicant or an affiliate is dropped.
- **Downstream treats this list as enrichment / priority-decoration, not the universe of owners to surface.** In-class incumbents surface independently of whether they are named here — the seeds prioritise attention, they do not bound it.
- **A seed is a hypothesis to test, not a conclusion to confirm.** Naming an owner here means "look here first" — never "this is the headline". Emit each seed as facts and context only: **no risk grade, no Composite / Level, no "headline" claim, no "must not be softened".** Severity and the headline are set once, later, at synthesis, by comparing every candidate on the same footing — so a seed must stay open to being outranked, or dropped, by what the search actually returns.

### Sector-convergence flags
- Sectors off-field today where commercial trajectories may bring them adjacent
- Brief reason
- Example: "Aurora Interactive's broader AI / cloud AI narrative could theoretically bring vector-DBs adjacent to game-dev tooling, but Aurora dev kit is specifically game-tooling not LLM-tooling; convergence path exists but weak"

### Machine lines the task message dictates

The machine-readable parts of the frame are TYPED FIELDS on the `record_matter_frame` call, not line
shapes for you to hit: `scope_jurisdictions`, `excluded_jurisdictions`, `scope_basis`, `search_channels`,
`meaning_angles` (or `meaning_angles_none`), and `intake_asks`. The driver renders every one of them into
the file, and the `## Instructed scope` section is stamped by the driver from its own intake record — you
are not asked to quote the request back. Two rules for `meaning_angles` specifically — it feeds the meaning/connotation web sweep VERBATIM, beside the
driver's fixed query shapes:

- Derive the angles from THIS mark's semantic field × THIS matter's market/industry — the cultural origin
  and communities the word evokes (appropriation/criticism debates), charged historical or political
  associations of the term or its imagery, category-specific controversy for these goods. Never reproduce a
  generic sensitivities checklist; an angle that could be written for any mark is not an angle.
- Every entry must be a real, runnable web-search query (each is executed and receipted — an unrunnable
  entry burns a dictated query). `Meaning angles: none` is the only valid empty form, reserved for a coined
  term with no real-word semantic field.

## Reasoning posture

- When in doubt about an **off-field / adjacency** decision, INCLUDE rather than exclude — matter-frame should not silently filter a *field*; downstream review (`placement-inquiry`) can deprioritise later with reasoning. **Jurisdiction scope follows its own rule (see *Scope jurisdictions*): search wide, cite narrow.** An instructed-narrow scope is honored; a worldwide or brand-signalled scope widens the SEARCH to the majors + signalled markets; an inferred scope is labelled and disclosed. Do not silently pin a globally-signalling brand to one country (the PETCARY miss), and do not widen a deliberately-local matter on abstract "the sector is global" reasoning (a wasted sweep).
- Be concrete about WHY for each item. A senior lawyer reading matter-context.md should be able to disagree with specific items and see exactly where your reasoning broke — not just see a conclusion.
- If you find yourself rating something as in-lane that a senior lawyer would obviously drop, surface the tension rather than smoothing it.

## What NOT to do

- **Don't search.** matter-frame uses only the request and your trained knowledge. Searching is for the workers downstream.
- **Don't rate risk.** Risk-rating happens later, against this context.
- **Don't predict outcomes.** matter-frame is descriptive (what this matter IS), not predictive (what we'll find).
- **Don't be exhaustive on watchlist owners.** 3-7 named seeds is the right density.
- **Don't blur the off-field list with the risk list.** Off-field sectors are categorically excluded from headline risk; risky-but-on-field findings go through `placement-inquiry`.

## Length target

500-1000 words. Long enough to be useful; short enough that the orchestrator can re-read it at every downstream step without context bloat.

## Failure fallback

If the request is too thin to produce a meaningful matter-context (e.g. only a mark name, no client / classes / context), write a minimal matter-context.md that names the explicit ambiguities ("client inferred as X — confirm before downstream reasoning relies on it"; "classes not specified — defaulting to <inferred classes> per the product description") and proceeds. The downstream skeptic (Step 2.6) will flag any over-inferences.
