---
name: prelim-variants
description: Shared strategy + variant generation for the v3 preliminary trademark search workflow. **Invoked exclusively by the `prelim-search` orchestrator** as the first stage of any v3 prelim run — do not call directly. Classifies the proposed mark into one of six analytical archetypes, derives a risk theory from that classification, then generates the variant set whose axes are shaped by the archetype. Emits a markdown variant manifest consumed by both common-law (`prelim-common-law`) and register (`prelim-register`) execution skills.
---

## Contents

- [Spawned session](#spawned-session)
- [Trigger](#trigger)
- [Model](#model)
- [Tool call budget](#tool-call-budget)
- [Core thesis — archetype-driven analysis](#core-thesis--archetype-driven-analysis)
- [The six archetypes](#the-six-archetypes)
- [Output — the variant manifest](#output--the-variant-manifest)
- [Process](#process) — Step 0 (archetype) → Step 1 (scope) → Step 2 (elements + famous-mark) → Step 3 (risk theory) → Step 4 (variants) → Step 5 (watchlists) → Step 6 (cross-mark)
- [Match-mode decision tree](#match-mode-decision-tree-guidance-for-downstream-skills)
- [Checklist before handing off](#checklist-before-handing-off)

## Spawned session

Invoked from `prelim-search` (orchestrator) as the first stage of any preliminary trademark review. Reads `task` containing: mark(s), class(es), jurisdiction scope, product description, optional industry context. Produces a single artifact — the **variant manifest** — written to the workspace for the downstream skills to consume.

No tool calls. Pure analytical work.

Companion files:
- [transliteration-scripts.md](transliteration-scripts.md) — non-Latin script reference (CJK + Arabic + Cyrillic + Devanagari + Thai + Greek)

## Trigger

Called by `prelim-search` at the start of any prelim run. Not invoked directly.

## Model

Always Opus. Variant generation is the highest-value AI step in the pipeline — the classification and risk theory here shape every downstream search.

## Tool call budget

Zero `perplexity_research`, zero plugin calls. Pure thinking. Output is the variant manifest only.

If an element triggers Step 2's famous-mark check, the manifest TAGS it for a famous-mark Perplexity call — the call itself happens in `prelim-common-law`.

## Core thesis — archetype-driven analysis

A paralegal looking at "CHART YOUR COURSE" doesn't run a checklist — they recognise the shape (slogan, weak, family is the risk) and search accordingly. This skill does the same.

Classify the mark archetype first. From the archetype, *derive* what matters for THIS mark. Specifics (CHART * COURSE family probes, leet for coined words, transliteration for global scope) are downstream consequences, not separately-mandated rules.

The manifest is therefore a **mark-search strategy document**, not a checklist output. Archetype + risk theory drive the variant generation; the variant table is the artefact, not the thinking.

## The six archetypes

These are starting points. A mark can fit a primary archetype and pick up one or more modifiers (typically `device-led` or `famous-element-masked`). Pick the strongest primary; layer modifiers on top.

| # | Archetype | Signature | Risk concentrates in |
|---|---|---|---|
| 1 | **Coined word** | Invented term, no real-world meaning (e.g., LUMENGARDE, XYRELL, KODAK) | Phonetic / visual variants; transliteration; leet substitution; coined-word collisions in unrelated industries; phoneme expansion |
| 2 | **Descriptive compound** | Multiple real words combining to describe goods/services (e.g., "Arcade Party", "Cavern Crates", "Jelly Royale") | Element-by-element analysis; semantic neighbours; common-combination saturation; crowded-field documentation |
| 3 | **Slogan** | Imperative or grammatically-complete phrase (e.g., "CHART YOUR COURSE", "RAISE YOUR PLAY", "JUST DO IT") | Family patterns (`X YOUR COURSE`, `CHART * COURSE`, `CHART YOUR *`); verb-swap variants; slang spellings; co-brand wildcards. Tiered: identical/near-identical → same-structure-close-concept → conceptual customisation |
| 4 | **Acronym / initialism** | Short letter strings (e.g., "RAIZ8", "CYC", "EA") | Letter-collision searches in target classes; expansion forms (what does it spell out?); ambiguity with stock acronyms |
| 5 | **Device-led** | Figurative/logo dominant, verbal element secondary or absent | Image searches; dominant verbal element (if any); design-code searches. Often layered as a modifier on top of a primary archetype |
| 6 | **Famous-element-masked** | Mark contains a real word that is ALSO a famous brand (e.g., "Bloodguard Sabatons" — Sabatons = Swedish metal band; "Twilight Saga" — Saga = published RPG game line) | Dedicated famous-mark search per masked element; dual-meaning analysis; sector-crossover check. Layered as a modifier on top of a primary archetype |

**Modifier semantics:**

- A mark is **device-led** when the visual/logo is doing most of the brand work. If a wordmark version exists too, the verbal-element analysis runs as the primary archetype with `device-led` as a modifier.
- A mark is **famous-element-masked** when any element matches a famous brand. The primary archetype reflects the mark's overall shape; the modifier triggers per-element famous-mark searches in `prelim-common-law`.

If a mark genuinely doesn't fit any archetype, document the reasoning and fall back to element decomposition + saturation analysis. Don't force-fit.

## Output — the variant manifest

A single file inside the active run-dir: `studio/prelim-search/<slug>/<date>/variant-manifest.md`. Slug and date are passed in by the orchestrator (see [prelim-search/SKILL.md → Phase 1](../prelim-search/SKILL.md#phase-1--template)). Markdown by design. Consumed by both downstream skills.

### Format

```markdown
# Variant manifest — Dawn: Legends of Lumengarde (2026-05-11)

## Request

- **Marks:** Dawn: Legends of Lumengarde
- **Classes:** 9, 28, 41, 42
- **Jurisdiction:** worldwide
- **Industry:** gaming
- **Product description:** fantasy co-op roguelike RPG
- **Manner of use:** game title in packaging, marketing, websites
- **Tier:** 1
- **Localised:** no

## Scope statement

Preliminary clearance for "Dawn: Legends of Lumengarde" as a game title, Classes 9/28/41/42, worldwide. Industry-incumbent parallel sweeps apply for LUMENGARDE (lighting electronics).

---

## Mark: Dawn: Legends of Lumengarde

### Archetype

- **Primary:** Descriptive compound (3-word title; LUMENGARDE distinctive, DAWN + LEGENDS common saturated commons in gaming)
- **Modifiers:** None
- **Boundary note:** LUMENGARDE alone would be a coined-word; the compound title shape places it under descriptive-compound. Coined-word axes (phonetic, transliteration, leet) still apply to LUMENGARDE element-solo.

### Distinctiveness & registrability (advisory — the staff lawyer to assess)

- **Dominant element:** LUMENGARDE (DAWN + LEGENDS are common/descriptive — stripped). Search + conflict-ranking centre here.
- **Spectrum:** distinctive (LUMENGARDE coined; the compound is arbitrary for gaming). No obvious absolute-grounds problem.
- **Flags:** none — not descriptive/generic/laudatory/geographic for the goods; not deceptive or offensive.

### Risk theory

LUMENGARDE is the distinctive anchor — risk concentrates on coined-word axes around that element (phonetic variants, leet, foreign transliteration) plus the Lumengarde Electronics lighting incumbent. DAWN and LEGENDS are saturated commons; risk there is the single-distinctive-word DAWN-alone or LEGENDS-alone filing in gaming, not crowded-field volume. Compound-phrase exact hit is low-probability but high-impact if it surfaces.

### Elements

| Element | Role | Saturation | Famous-mark | Notes |
|---|---|---|---|---|
| DAWN | common-word | high | no | Morning / new beginning; fantasy / adventure |
| LEGENDS | common-word | very-high | no | Myth / tale; epic / fantasy |
| LUMENGARDE | distinctive | low | no | Industry incumbent: **Lumengarde Electronics Co.** (lighting / LED / semiconductors, classes 9 + 11) — triggers parallel sweep |

### Variants

(Axes derived from archetype: descriptive-compound → element-solo + compound-phrase + element-specific axes for the distinctive anchor.)

**A variant VALUE is a mark term, never a note about one.** A parenthetical, sentence punctuation
(`—`, `;`) or a space-flanked slash makes it a label, and a label dispatched verbatim returns a
confident zero over marks that exist — a nil search that reads as a clean. Write `ZEPHYR`, not
`ZEPHYR (root)`; the rationale column is where the note belongs. The compiler refuses annotated values
whatever their length, so a two-word one is caught the same way a long one is.

**If a value genuinely IS a mark carrying that punctuation** — a device mark recorded with its Vienna
code, say — **it is not this stage's to certify, and there is nothing for you to do about it here.**
The refusal becomes a disclosed deferred coverage row, and the later judgment layer that reads that
row can re-propose the term as a literal. **That route is not reachable from this stage and there is no
call for you to make** — the manifest's *mark* is certified automatically because it is the matter's
ratified one, and a model-authored variant claiming the same standing is precisely the claim the lint
exists to check. Do not work around the refusal by stripping punctuation out of a real mark — that
silently narrows what was searched, and the deferred row is the honest outcome.

| Category | Value | Rationale | Verify? |
|---|---|---|---|
| exact-phrase | Dawn: Legends of Lumengarde | full mark | |
| exact-element | LUMENGARDE | distinctive anchor — primary register vector | |
| exact-element | DAWN | common element — single-word coverage hunt | |
| exact-element | LEGENDS | common element — single-word coverage hunt | |
| plural-root | LEGEND | tokeniser superset | |
| phonetic | EVERLITE | homophone, distinctive element | |
| phonetic | EVRLIGHT | vowel drop | |
| numeric-substitution | EV3RLIGHT | leet on distinctive element | |
| compound | Lumengarde | tokenisation split | |
| translit-jp-katakana | エバーライト | distinctive element in JP | ✅ |
| translit-zh-phonetic | 艾佛莱特 | sound-alike (Ài fó lái tè) | ✅ |
| translit-zh-meaning | 永光 · 长明 · 恒光 | meaning SET — everyday-first, then literal/adjacent (never one guess); derive the set per concept (not a fixed list), and keep the everyday member even when its count is saturated — cf. COLORA → 色彩 in *Meaning-translation rules* | ✅ |
| translit-kr | 에버라이트 | hangul phonetic | ✅ |
| translit-ar | إيفرلايت | phonetic abjad | ✅ |
| translit-cy | Эверлайт | phonetic Cyrillic | ✅ |

(✅ = requires human verification when this variant produces a hit — transliteration plausibility is the staff lawyer's call.)

### Scope ledger

(One row per variant / field / source you CONSIDERED — the variants-stage coverage statement the frame-diff and synthesis read. `Layer` is `variant` / `field` / `source`; `Status` is `applied` or `dropped`. **Defend your omissions:** every `dropped` row carries a `Reopen trigger` — the concrete observation that should put it back on the board. A dropped row with no reopen trigger is itself a coverage gap. numeric-substitution and foreign-transliteration are matter-profile-driven; this names the decision either way. The dropped set is exactly what an independent reviewer diffs against — so the plural-root / off-field / unsearched-channel rows are load-bearing, never inert.)

| Layer | Item | Status | Reason | Reopen trigger |
|---|---|---|---|---|
| variant | phonetic | applied | 2 variants — distinctive anchor LUMENGARDE carries the sound-alike axis | — |
| variant | foreign-transliteration | applied | 6 variants — worldwide scope, JP/ZH/KR/AR/CY scripts | — |
| variant | numeric-substitution | applied | 1 variant — leet on the coined anchor (EV3RLIGHT) | — |
| variant | visual-substitution | dropped | typographic-neighbour space yielded no real-word / famous look-alike worth a sweep | a look-alike of LUMENGARDE surfaces as a live mark in class 9/11 |
| variant | compound | applied | 1 variant — tokenisation split (Lumengarde) | — |
| variant | translation | applied | the everyday-first meaning SET on the `translit-zh-meaning` row (common word first, then technical/adjacent) — LUMENGARDE has clear semantic content; a saturated everyday word is narrowed downstream by class-scope, never dropped here | — |
| variant | plural-root | dropped | LUMENGARDE is not a plural; the singular root IS the mark | a shortened or plural root of the dominant element collides in class 9/11 |
| field | lighting / class-11 fixtures | applied | goods-overlap with the product's lighting use | — |
| field | telecoms / broadcast enforcers | dropped | off-field: no goods-overlap with the lighting/gaming use | an LUMENGARDE mark in the product's OWN goods held by a telecoms enforcer |
| source | register worldwide + class-11 incumbents | applied | the product's primary collision surface | — |
| source | consumer storefronts + general web | applied | the product reaches consumers there | — |

### Watchlists

- **Aggressive enforcers:** Nordwave, Aurora Interactive
- **Major brand owners:** Sony, Aureon, Nintendo, HP, Activision, Take-Two, EA
- **Competitors:** Epic Games, Valve, Unity, Riot Games

### Famous-mark Perplexity calls needed

None for this mark.

### Diligence notes

LUMENGARDE carries coined-word axes (phonetic + transliteration) despite the descriptive-compound primary archetype. Industry-incumbent alert triggers a parallel-class 11 sweep. DAWN and LEGENDS are saturated commons — still generated as single-word vectors; their saturation tells the downstream register search to **narrow** (class-scope the token and enumerate), it is never a reason to skip the vector here or to pre-judge the crowd clean.

---

## Cross-mark themes

N/A — single-mark request.
```

### Format notes for downstream skills

- **Archetype section** is the spine — both downstream skills read it first. `Primary` is one of the six; `Modifiers` is a comma-separated list or "None"; `Boundary note` is freeform explanation if relevant.
- **Risk theory** is 2–4 sentences in prose. Describes where conflicts concentrate. Downstream skills read this for relevance gating.
- **Distinctiveness & registrability** names the **dominant element** (the spine the register sweep + synthesis ranking centre on) plus the advisory spectrum read and any obvious flags. The orchestrator surfaces it as a "Proposed-mark assessment" line in the narrative + an Excel header block; the register/common-law layers centre their searches on the dominant element.
- **Element table** has stable columns. The contract is the header line.
- **Variant table** uses `Category | Value | Rationale | Verify?`. Variant categories are shaped by archetype — which categories fire is the archetype's call, but a fired category is never *silently* omitted: the `### Scope ledger` section below records every category's disposition.
- **The scope ledger** is MANDATORY and you send it as `scope_ledger` rows on the `record_prelim_variants` call — `{layer, item, status, reason, reopen_trigger}`. The driver renders the table (stable columns `Layer | Item | Status | Reason | Reopen trigger`) and writes `scope-ledger.json` from the same rows; you never lay out a table. It spans the FOUR scope layers an independent reviewer tests — `variant`, `field`, `source`, `jurisdiction` — so an omission in any of them is recorded, not just dropped variant categories. `Status` is exactly `applied` or `dropped`. Rows to include:
  - **variant** rows — one per variant category considered: `phonetic`, `foreign-transliteration`, `numeric-substitution`, `visual-substitution` (the space-split/join + typographic-neighbour mechanic; an upstream brief's "separator-spacing" maps here), `compound` (compound-token-split), `translation` (literal-meaning), and `plural-root` (the shortest morphological / drop-letter root of the dominant element — applied when the mark is a plural/compound, dropped with a reopen trigger when it is not). `numeric-substitution` and `foreign-transliteration` are matter-profile-driven; the row NAMES that decision either way.
  - **field** rows — each on-field boundary you keep (goods-overlap with the product) and each adjacent sector you push off-field, by goods-overlap reasoning (not class number alone).
  - **source** rows — each search channel you sweep and each you set aside (e.g. a developer ecosystem on a consumer-storefront sweep), by the product's real channel.
  - **jurisdiction** rows — carry the matter frame's *Scope jurisdictions* here: one `applied` row per in-scope territory (the instructed set + any `in-scope-by-reach`; the reason names the route — filed there / Madrid designation / EUTM reach / treaty), and one `dropped` row per territory considered and excluded (reason + a reopen trigger such as "a right effective in a named territory surfaces"). This is the authoritative scope the register sweep is bounded to and that `frame-diff` checks for over-reach / under-coverage. Use the codes the matter frame emitted (EU / US / CN …); never widen here.
  - Every `dropped` row carries a `Reopen trigger` — the concrete observation that should reopen it. **Defend your omissions:** a dropped row with no reopen trigger is itself a coverage gap — and the rule covers fields and sources, not just variants. This is the variants-stage coverage statement: a coverage record, not a checklist. The driver writes `scope-ledger.json` from the rows you send — it no longer recovers them by parsing a table back out of your prose; the frame-diff diffs it against an independent blind re-derivation, and synthesis consumes it directly — so the dropped set is load-bearing.
- **Watchlists, famous-mark calls, diligence notes** — unchanged from prior shape.

Downstream skills parse with normal markdown. Manual editing by the reviewing lawyers remains safe.

## Process

Six steps per mark plus one cross-mark step. Order matters — Step 0 (archetype) is the spine.

### Step 0 — Archetype classification (per mark, FIRST)

Read the mark. Read the product description. Classify against the [six archetypes table](#the-six-archetypes).

Pick one **primary** archetype. Pick zero or more **modifiers**. Write a one-line reasoning. If the mark is genuinely a boundary case, name both candidates and explain the choice.

**Worked examples:**

- "LUMENGARDE" (single mark) → Coined word. No modifier. Risk: phonetic, transliteration, leet, coined-word collisions.
- "Dawn: Legends of Lumengarde" → Descriptive compound (DAWN + LEGENDS commons, LUMENGARDE distinctive anchor). No modifier. Risk concentrates on LUMENGARDE element + compound-phrase hit.
- "CHART YOUR COURSE" → Slogan. No modifier. Risk: family patterns (CHART * COURSE, * YOUR COURSE, CHART YOUR *), verb swaps, slang.
- "Bloodguard Sabatons" → Descriptive compound + famous-element-masked (Sabatons = Swedish metal band). Risk: per-element famous-mark search on Sabatons; descriptive-compound axes on the rest.
- "RAIZ8" → Acronym/initialism (leet form of RAISE). Risk: letter-collision; expansion-form search on RAISE.
- A logo-led brand with a coined verbal element → Coined word + device-led. Risk: phonetic/transliteration + image search.

**Output:** archetype + modifiers + reasoning, written into the manifest's Archetype section.

### Step 1 — Scope & triage (once per request, NOT per mark)

Produce the scope statement that opens the deliverable narrative, plus per-mark diligence allocation.

1. **Classes:** start from the request form, then **reason about the goods**. Propose (advisory — the staff lawyer confirms scope) the **direct class of any collaborated / actual goods** beyond the filing classes. For a gaming **collaboration**, search the gaming classes (9/28/41/42) **plus the direct class of the collaborated goods** — e.g. Class 30 for a pizza tie-in, Class 32 for a drink — scoped to the specific goods in the brief (staff-lawyer redline, Project NOVA PULSE). The direct collab-class is the mandatory addition; wider belt-and-braces (e.g. 29/43 food, 35 retail, 39 delivery) is an optional case-by-case side-glance. Note what each class covers; flag class tensions. Emit the proposed class set in the manifest's Classes field, marking advisory additions.
2. **Context:** product/service, industry/market, target consumer, dual contexts if any.
3. **Graduated diligence:** how many marks? Are any obviously descriptive vs distinctive? Compound? Allocate effort accordingly.

**Output:** scope statement (2–4 sentences). Allocation notes per mark.

### Step 2 — Element decomposition + famous-mark check

**Decompose every mark into individual elements.** Each element gets independent evaluation. This catches risks where a single element is a famous brand masked by its descriptive/generic reading.

For EACH element:

1. Real word or term with its own meaning?
2. Also a well-known brand, band, celebrity, sports team, entertainment property, or cultural icon — especially in gaming, music, film, or entertainment?
3. Secondary meaning as a trademark beyond descriptive/generic?
4. Has the brand/entity expanded into gaming, software, or adjacent digital entertainment?

If ANY element triggers questions 2–4:

- Set `famous_mark_flag: true` on that element
- Add an entry to `famous_mark_calls_needed[]` so `prelim-common-law` fires a dedicated Perplexity query
- Set the **famous-element-masked modifier** on the mark's archetype

**Dual-meaning rule:** when a term is BOTH descriptive AND a famous mark, treat it as the famous mark for risk purposes. Worked example: "Bloodguard Sabatons" → Sabatons is real armor terminology AND a Swedish metal band with gaming collaborations. Famous-mark search required.

### Step 3 — Saturation signal per element + risk theory

For each element, classify volume baseline:

- **low** — distinctive, coined, unusual. Primary register vector.
- **borderline** — common English but not dominant. Primary register vector with stringent filters.
- **high** — common word, broad use. Demote to count-only macro probe; single-word coverage hunt only.
- **very-high** — saturated. Macro count + selective inspection only.

**Saturation narrows the search; it never drops a variant.** These ratings tell the downstream register search how to *probe* a token (class-scope the in-scope slice and enumerate it) — post-funnel the register layer enumerates the dangerous band for the **distinctive anchor** and its forms; a **common** component (a stripped common word, not the distinctive anchor) it **counts**, not enumerates, handing that count up as dilution (a hyper-common word is dilution the lawyer uses, never a coverage gap). A `high` / `very-high` rating is **never** grounds to omit the element from the manifest, to collapse or skip its meaning / transliteration set, or to pre-judge its crowd clean. (See the Step-4 generation boundary.)

**Industry-incumbent alert** (per element when applicable): non-target-industry incumbent owns the element. Capture owner pattern, primary industry, primary class set. Triggers parallel-class sweep in `prelim-register`.

**Dominant element + proposed-mark registrability read** (feeds the synthesis spine and the deliverable; the staff lawyer's "flag obvious issues"):

1. **Name the dominant (distinctive) element** — strip descriptive / non-distinctive elements (a descriptive prefix, generic category words). The whole search and the downstream conflict-ranking centre on it (the staff lawyer: *"a descriptive prefix is not something anyone can monopolise"* — so a mark of the shape "PROJECT X" centres on **X**). If the whole mark is the distinctive unit (a coined word), say so.
   - **Then name the FORMATIVE ROOT** — the shortest distinctive stem a *family* of marks would share, after stripping weak/separable affixes (a descriptive prefix like BIO-/VET-/NEURO-/PHARMA-, a plural/inflectional `-S`, a laudatory `-PRO`/`-PLUS`). For **BIOVELTRIN** the dominant element is **VELTRIN** but the formative root is **VELTRI** — and the conflicts are the VELTRI **family** (VELTRI DIAGNOSTICS, VELTRI GENETICS), which do **not** contain the full "VELTRIN". The root is what the register's exact-in-class-live floor searches as a *substring/contains* predicate, so a one-letter-off family member is never missed. **Emit it on its own line — `Formative root: <root>`** (the driver's coverage gate reads it; it CARRIES BOTH the root and the full element, so a conservative strip never loses coverage). When the dominant element is itself the irreducible root (XYRELL, THORNMANTLE), set `Formative root:` equal to it.
2. **Place the proposed mark on the distinctiveness spectrum** — Generic → Descriptive → Suggestive → Arbitrary → Fanciful — read **in each relevant market language** (a term arbitrary in English may be descriptive in French/German). Flag, advisory ("the staff lawyer to assess"), any **obvious** registrability problem: clearly **descriptive / generic / laudatory / geographic** for the goods (laudatory & geographic sit at the Descriptive end), and **always** flag if the mark is **deceptive or offensive** (offensive also feeds the PR/reputational section). Stay **silent** when the mark is plainly distinctive (coined / arbitrary) — this is a lightweight flag, not a full registrability opinion. **Descriptive is a flag, not a veto:** a descriptive mark can still register, and a prior descriptive mark stays protectable, where it has **acquired distinctiveness / secondary meaning** through use — so when you flag descriptiveness, also note whether there's evidence of acquired distinctiveness (long / well-known use; the common-law layer surfaces it). A descriptive mark with secondary meaning gets narrower-but-real protection — flag both sides for the staff lawyer.

**Now write the risk theory** (2–4 sentences). Where does risk concentrate for THIS mark, given archetype + saturation + incumbents + dual-meaning concerns? The risk theory is the bridge between archetype and variant generation — and the relevance signal the downstream register skill reads to gate candidates.

### Step 4 — Variant generation (axes derived from archetype)

The variant categories are shaped by the archetype. Don't generate every category for every mark. Generate the categories the archetype calls for.

**The generation boundary (read first — it governs every axis and every bound below).** This step's only question about any candidate form is: ***could a real conflict plausibly take this shape?*** Generate every form a real collision could take; the ONLY valid reason to drop a form is that a real conflict could **not** take it (ungrammatical, semantically broken, not market-realistic — a collision-plausibility call, which is yours to make). **Never drop a plausible form because the search would be crowded, saturated, or noisy, or because the term is common / descriptive / generic.** Noise is no longer yours to manage: the register funnel enumerates the dangerous band **class-scoped** and hands any residual crowd to judgment ([prelim-register register-recipes.md](../prelim-register/register-recipes.md)) — generating a noisy-but-plausible form is safe by construction. A *"would drown in noise" / "too saturated to be worth it" / "descriptive, so skip it"* reason on a **dropped** row is the boundary violation this step must never commit. Saturation is a signal to the downstream search to **narrow** (class-scope the token and enumerate); it is never a reason to drop a variant here.

**The FORM axis is now mechanically COMPLETE — you do not own form coverage.** The driver generates the *complete* form neighbourhood of the distinctive element(s) **deterministically, with no model in the loop** — every edit-1 spelling/sound/transposition, the phonetic-key vowel family (the SYRONA/SIRINA class), visual / homoglyph look-alikes, and cross-script transliterations — into `form-neighbourhood.json`, which the register funnel searches as the authoritative **form floor**. This exists because a *guessed* form set is never complete: for an anchor like `VELTRIS` a model thinks of `ZELTRIS` but not `MELTRIS` (the same single edit), and the vendor's own phonetic/fuzzy modes cannot reach a first-consonant swap either (live-verified on a production matter — the missed first-consonant-swap neighbour existed as 69 live records yet Corsearch's complete in-class phonetic band for the anchor excluded it). The machine closes that lottery. **So your FORM-axis job is JUDGMENT, not enumeration:**
1. **Name the distinctive element + formative root precisely** (Step 3) — this is the *one* input the mechanical band seeds from; get the token right and the complete neighbourhood follows.
2. **Flag the high-salience look-alikes** — a real word or a known/famous mark the anchor sits an edit or homophone away from (SONICA→SONIC) — for **risk RANKING**. The machine generates the *string*; it cannot know SONIC is Sega's. This is salience, not coverage.
3. **Own the meaning / translit axis** (below) — connotation and translation are *not* mechanically enumerable; they remain yours.

The `phonetic` / `visual-substitution` / `numeric-substitution` / typographic rows you still write are **illustrative salience + ranking hints** — they never *define* the form coverage (the machine does, completely) and you may never drop a form for being noisy, saturated, or "unlikely". Enumerating a complete form band is the machine's job, done; reasoning about which neighbours *bite* is yours.

**Universal categories (always generate):**

| Category | Notes |
|---|---|
| exact-phrase | The full mark — for register `match_mode: exact` |
| exact-element | Each element solo — register `match_mode: default` |
| plural-root | Shortest morphological root of each plural element |
| formative-family | The distinctive **root** as a *family of marks*: `<root>*` / `*<root>` (contains/prefix sweeps) **plus** `<root> + {field descriptors}` and `{descriptor} + <root>` (e.g. VELTRI DIAGNOSTICS, VELTRI GENETICS, VELTRI LABS). Dispatched `match_mode: default`/contains — **never exact-only**. See *Formative-family rules* |

**Archetype-driven categories:**

| Archetype | Core categories (in priority order) |
|---|---|
| Coined word | phonetic, visual-substitution [see *Visual / typographic-neighbour rules*], numeric-substitution (leet), foreign-transliteration (worldwide/multi-region scope), compound-token-split |
| Descriptive compound | element-solo + compound-phrase, stem-formative on each element, plural-root, semantic-neighbours of distinctive anchor |
| Slogan | family-patterns (`X * Y`, `* YOUR Y`, `X YOUR *`), verb-swap (replace lead verb with adjacent verbs in same semantic field), preposition swap (YOUR → THE/A/MY/OUR), slang spellings, co-brand wildcards (`* [SLOGAN]`, `[SLOGAN] *`), phrase-substitution (full morphological variants) |
| Acronym / initialism | letter-collision (the acronym itself), expansion-form (search the expanded phrase), ambiguity-check (other meanings of the same letters) |
| Device-led | dominant verbal-element variants (if any); image search handled separately in register via image fetch |
| Famous-element-masked | (modifier) per-element famous-mark Perplexity query; standard variants for the mark's primary archetype |

**Modifier categories** (when applicable):

| Category | Notes |
|---|---|
| foreign-transliteration | Always for worldwide/multi-region scope. Coined-word archetype: prioritise. Slogan archetype: skip unless mark targets a non-English market. Scripts per [transliteration-scripts.md](transliteration-scripts.md). |
| component-isolation | When `prelim-common-law` needs to isolate an element for platform-specific search. |
| competitor-intel | Driven by Watchlist, NOT by variant table — handled in `prelim-register` Step 8.5. |

**Phrase-substitution rules** (slogan archetype, primarily):

For multi-word marks where the structure carries meaning (slogans, descriptive compounds), substitute each stem-formative back into the phrase template:

- "RAISE YOUR PLAY" → "ELEVATING YOUR GAME", "RAISE THE PLAY", "RAISING YOUR PLAY", etc.
- "CHART YOUR COURSE" → "CHARTING YOUR COURSE", "CHART MY COURSE", "CHART THE COURSE", "PLOT YOUR COURSE" (verb swap)

Drop ungrammatical or semantically broken strings. Default: generate liberally; macro-count probes filter.

**Family-pattern wildcards** (slogan archetype, mandatory):

For any slogan, generate all reasonable wildcard patterns:

- `[WORD1] * [WORD3]` (one slot wild)
- `* [WORD2] [WORD3]` (left wild)
- `[WORD1] [WORD2] *` (right wild)
- For 3-word slogans, also: `* [WORD2] *` (two slots wild)

These probe the family of "same-structure-close-concept" filings — historically the dominant signal vector for slogan archetypes (e.g., Entain's "IT'S YOUR PLAY" 6-filing portfolio surfaced via wildcard-prefix during empirical testing).

**Formative-family rules** (distinctive-anchor / coined / portmanteau marks — the single-token analogue of the slogan family-patterns above; MANDATORY when a `Formative root` is named):

A distinctive root is rarely owned in isolation — it anchors a **family of marks** that incorporate it as a component (the family-of-marks doctrine: a shared distinctive formative drives confusion across the family). So search the root as a family, not just exact:

- **Contains / prefix sweeps:** `<root>*`, `*<root>`, and a `match_mode: default` (contains) sweep on `<root>` — these surface `VELTRI DIAGNOSTICS`, `BIOVELTRIN`, `AVELTRI` that an exact sweep on the full token misses.
- **Root + field-descriptor compounds:** `<root> + {descriptor}` and `{descriptor} + <root>`, where the descriptors are the matter's **industry's** common compounding words **derived from the matter frame** — pharma/biotech → DIAGNOSTICS, GENETICS, THERAPEUTICS, BIO, MED, LABS, SCIENTIFIC, PHARMA; gaming → STUDIO, WORLD, PLAY, GAMES; fintech → PAY, CAPITAL, BANK. **Never a fixed global list** — name the descriptor set from this matter's sector, the way a lawyer reasons about the formative's collision zone, so it generalises to any vertical.
- **The root strip applies to every variant you emit, not only to the dominant element.** A phonetic, transliteration or visual-substitution form is a mark-form in its own right, and *its* family members incorporate *its* root in the same way the dominant element's family incorporates the dominant root. **So the `Value` you write for a generated variant is that variant's root, not its full form** — same column, same strip, one branch over — and that row's `Rationale` names the full form it was stripped from. Continuing the example above: `BIOVELTRIN` → dominant element `VELTRIN` → root `VELTRI`, and `VELTRI` is the `Value` that row carries, not `VELTRIN`. Its phonetic form is `VELTRYN`, so that row's `Value` is `VELTRY` — a family member such as `VELTRYCA` contains `VELTRY` and does **not** contain `VELTRYN`, and the full form stays legible in the `Rationale`. **This adds no row and no sweep**: it shortens a `Value` you were already writing, so the only cost is a wider result set, never a second query. A shorter contains-string is strictly more inclusive than the longer one it replaces, so a mis-strip here cannot lose coverage — which is why the parallel full-form search the dominant element needs is not needed again here.
- Tag each `formative-family`; the rationale names the root. These ride the `primary-sweep` register unit (the exact-in-class-live floor enumerates the in-class-live survivors). A mis-strip of the root never loses coverage — the full dominant element is searched in parallel.

**Bounds:** as for the neighbour rules — generate liberally; drop only **implausible forms** (a string a real family member could not take), never a plausible form for being noisy or its root saturated. On a *saturated* root the downstream count-probe narrows before paging (Recipe 7) — the family is still generated.

**Visual / typographic-neighbour rules** (coined-word / distinctive-anchor marks only):

The phonetic axis catches *sound-alikes*. This axis catches *look-alikes* — and the highest-value look-alike is a **real word or a known/famous mark** the anchor sits one or two edits (or a homophone) away from, because a consumer or a court confuses them and a famous holder may own one.

**Ask the question first (this is the primary step, not a string generator):** *"What real words, names, or well-known/famous marks is this anchor about **one or two keystrokes (a diacritic counts as an edit), or a homophone,** away from?"* List them; then run each through the famous-mark lens below. (Worked: for anchor `SONICA`, the obvious neighbour is `SONIC` — Sega's famous mark, one letter off — plus `SONIKA` / `SONYKA`. A generator that only emits typo-strings misses SONIC; the question surfaces it. This is the whole point — reason like the lawyer who reaches for SONIC on sight, don't enumerate edits.) **Reach the second edit when it lands on a real word or a known mark** — an accented or vowel-swapped form a market actually uses (e.g. for an anchor like `SIRENA`, the real word `SIRÈNE`/`SIRENE` — "siren/mermaid", two edits off). A plausible real-word or known-mark neighbour is worth generating even at two edits; the bound drops only *implausible* strings, never a real word the eye or ear reads as the same name because it sits one keystroke further out.

**Then fill in the mechanical typographic neighbours** the eye reads as the same token (secondary to the question; schematic anchor `FENRIQ`):

- **space-split / join:** `FEN RIQ`, `FEN-RIQ`
- **one-letter substitution / addition / deletion:** `FENRIK`, `FENRIQE`, `FENIQ`
- **glyph swaps** (symbol-for-letter, distinct from sound-led leet): `FENR1Q`, `F3NRIQ`, `FENRI@`
- **adjacent-key transposition:** `FNERIQ`, `FENIRQ`

**Wire neighbours into the famous-mark check:** every neighbour that is a real word or a plausible brand goes into the per-element famous-mark Perplexity call (see *Famous-mark Perplexity calls needed*). If it resolves to a famous / in-field mark, carry it as a **must-search** variant with the `rationale` naming the owner (e.g. "SONIC — Sega's famous mark, one letter from the anchor").

**Bounds:** generate **liberally but capped at ~6–10 neighbour strings**, prioritised by "would a consumer or a squatter plausibly use this, or is it a known mark" — drop only **implausible strings** (not a form a real look-alike could take), never a plausible one for being noisy. **Distinctive-anchor marks only:** for a *saturated common-word* element the look-alike axis is low-value on **collision-plausibility** grounds — a look-alike of a common word is itself another common word with no distinctive owner to confuse (NOT because the result would be crowded) — so drop it on that ground and name it in the ledger; skip for slogans (the family-pattern wildcards already cover structural neighbours). These are `match_mode: default` register sweeps (and direct common-law searches); they ride the existing `primary-sweep` register unit, not a new axis.

**Meaning-translation rules** (any market where the mark carries real meaning — CJK especially):

A mark with semantic content collides in a non-Latin market through the **word a local company would actually use to name that thing** — not only the technical dictionary term. So ask the **market-realistic question** — *"in this market, what would a real business call a `<concept>` product?"* — and generate the small deterministic **equivalence SET**, **everyday-usage first**, then technical, then adjacent, tagging each member's register (`everyday | technical | adjacent`). The everyday word is exactly what a local registrant files and what the reviewing lawyer reaches for.

- **Never collapse the set to one technical guess** — one "precise/specific" rendering is the old single-guess miss. Generate the set.
- **Never drop the everyday member because its count looks saturated or "descriptive"** — that is the Step-4 generation boundary violation. Saturation is narrowed downstream by class-scoped enumeration in the register layer ([transliteration-scripts.md](transliteration-scripts.md) · [register-recipes.md](../prelim-register/register-recipes.md)), never by abandoning the word here.
- Tag CJK meaning rows `translit-zh-meaning` (the downstream class-scope gate keys on the `-meaning` sense); flag `Verify? ✅`.
- *Illustration of the principle (NOT a fixed list — derive the set from the concept):* COLORA → CN **色彩 / 颜色** (everyday "colour") → **色度** (technical "chromaticity") → **彩度 / 色相** (adjacent). What generalises is the market-realistic question above — to any market (a German `FARBE`-type everyday form; a "descriptive" compound the model would otherwise drop), not these characters. The full script reference is [transliteration-scripts.md](transliteration-scripts.md), now read alongside this skill.

**Rules:**

- Every variant gets `rationale` filled in.
- Every phonetic, transliteration and visual-substitution `Value` is that form's **root**, not the full form (*Formative-family rules* above). A row still carrying the full form has not had the strip applied — the core rows carrying the mark as filed are the exception, and they stay whole.
- Foreign transliterations get `Verify? ✅` — Claude generates them; the staff lawyer confirms plausibility on hit.
- For single-jurisdiction scopes (US-only, UK-only), skip transliteration unless the mark is itself non-Latin.

**Then send the scope-ledger rows (MANDATORY).** They record what you considered across the FOUR scope layers an independent reviewer tests — variant, field, source, jurisdiction — so an omission in any of them is a named decision, never a silent drop. One `{layer, item, status, reason, reopen_trigger}` per decision; `status` is `applied` or `dropped`. The driver renders them as the `### Scope ledger` table and writes the machine ledger from the same rows.

- **variant** rows — one per category: `phonetic`, `foreign-transliteration`, `numeric-substitution`, `visual-substitution` (the space-split/join + typographic-neighbour mechanic above; an upstream brief's "separator-spacing" maps here), `compound` (compound-token-split), `translation` (literal-meaning), and `plural-root` (the shortest morphological / drop-letter root of the dominant element — the both-directions neighbour; `applied` when the mark is a plural/compound, `dropped` with a reopen trigger when it is not — never an inert "N/A").
- **field** rows — each on-field boundary you keep and each adjacent sector you push off-field, by **goods-overlap with the actual product**, not class number alone. An off-fielded sector is `dropped` with the goods-overlap reason + the reopen trigger.
- **source** rows — each search channel you sweep and each you set aside (e.g. a developer ecosystem on a B2D product where you only swept consumer storefronts), by the product's **real channel**.

Every `dropped` row MUST carry its `Reopen trigger` — the concrete observation that should put it back on the board. **Defend your omissions:** a dropped row with no reopen trigger is itself a coverage gap, and the rule covers fields and sources, not just variants.

Make `numeric-substitution` and `foreign-transliteration` explicitly profile-aware: the matter profile drives them, and the row names the decision either way —

- **numeric-substitution (leet):** runs for coined-word / acronym anchors; drop for saturated common-word marks (no squatter incentive) — say which and why.
- **foreign-transliteration:** runs for worldwide / multi-region scope or a non-Latin mark; drop for single-jurisdiction Latin scopes (per the transliteration rule above) — name the jurisdiction read that decided it.

These rows ARE the variants-stage coverage statement — phrase each `reason` as a coverage record, not a tick. The driver writes `scope-ledger.json` from them directly; the blind frame-diff diffs it against an independent re-derivation; synthesis (in `prelim-search`) consumes it as the variants-stage coverage input.

### Step 5 — Watchlists (per-matter, configurable)

Per request, populate three lists:

- **aggressive_enforcers** — entities known to oppose or litigate broadly. **No roster ships here.** Take them from the run manifest's own list, from matter-frame's watchlist reference (a deployment replaces it with its own), and from the requesting lawyer.
- **major_brand_owners** — context-relevant brand giants for the matter's sector, from those same three sources. A roster held in doctrine goes stale and reaches deployments that never chose it.
- **competitors** — client's direct competitors in target industry.

**Mandatory client-exclusion rule:** if the request identifies a client, DROP that company's name from ALL three lists before emitting the manifest. The client's own marks must not auto-flag as conflicts.

Watchlists drive cross-pollination triggers and owner-bound register sweeps (Step 8.5 of [prelim-register/SKILL.md](../prelim-register/SKILL.md)).

**Structured sibling:** mirror the register-relevant watchlist into the structured model's
`watchlist_owners` key — `aggressive_enforcers` ∪ `competitors` ∪ the matter frame's watchlist-owner
seeds (NOT `major_brand_owners` — too broad), client-excluded, at most 24 entries, real register
owner names only (never a sector or a description). The driver compiles each seed into the frozen
plan's deterministic owner lane: owner×formative enumerate slices (the coverage — the owner's
portfolio intersected with the dangerous band, record-by-record) plus one bare-owner portfolio
count (crowd context whose `covered_by` points at the slices). Omit the key when Step 5 names none.

### Step 6 — Cross-mark themes (once, after all marks processed)

Multi-mark requests only. Surface shared themes:

- Shared elements
- Shared conceptual themes
- Shared industry-incumbent alerts

Used by `prelim-search` to flag cross-mark risks in synthesis.

## Match-mode decision tree (guidance for downstream skills)

| Variant category | Common-law execution | Register execution |
|---|---|---|
| exact-phrase | quoted search string | `match_mode: exact` |
| exact-element | quoted search string | `match_mode: default` |
| plural-root | element search | `match_mode: default` on root form |
| phonetic | Perplexity sound-alike search | `match_mode: phonetic` (+ `<provider>_expand_phoneme` if available) |
| numeric-substitution | direct platform search for substituted form | `match_mode: default` on substituted form |
| visual-substitution (typographic neighbour) | direct platform search for the neighbour string | `match_mode: default` on the neighbour string |
| foreign-transliteration | Perplexity search on transliterated form (platforms supporting non-Latin) | `match_mode: default` on transliterated form |
| compound | direct search variations | `match_mode: default` |
| family-pattern wildcard | not used | Lucene wildcards inside backticks |
| phrase-substitution | direct search of substituted phrase | `match_mode: default` (NOT `exact`) |
| competitor-intel / watchlist | focused web search | **Owner-bound search per Step 8.5 of [prelim-register/SKILL.md](../prelim-register/SKILL.md)** |

Downstream skills do NOT generate their own variants — the manifest is authoritative.

## Checklist before handing off

- [ ] **Archetype classified** (primary + modifiers + reasoning)
- [ ] **Dominant element named** + proposed-mark distinctiveness/registrability read (spectrum placement + obvious flags incl. deceptive/offensive, or "plainly distinctive — no flag")
- [ ] **Risk theory written** (2–4 sentences)
- [ ] Scope statement written, with **class scope reasoned** (collab direct-class / belt-and-braces proposed where applicable; advisory additions marked)
- [ ] Every element has a row: role, saturation, famous-mark flag, notes
- [ ] Industry-incumbent alerts captured where applicable
- [ ] Variants generated across archetype-appropriate axes
- [ ] **`scope_ledger` rows sent** — `{layer, item, status, reason, reopen_trigger}` across variant (incl. `plural-root`) + field (on/off-field by goods-overlap) + source (channels swept/set-aside) + jurisdiction (one `applied` row per in-scope territory, one `dropped` row per territory considered and excluded) layers; every `dropped` row carries its reopen trigger; numeric-substitution + transliteration decision named either way
- [ ] Foreign transliterations generated for worldwide/multi-region scope
- [ ] Verify? column ticked on transliteration rows
- [ ] Watchlists populated (with client-exclusion applied)
- [ ] Famous-mark Perplexity calls flagged (or "None")
- [ ] Cross-mark themes captured (multi-mark only)
- [ ] Manifest written to workspace
