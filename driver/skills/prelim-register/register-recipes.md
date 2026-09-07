# Register recipes — frozen query patterns

Seven common mark shapes; each has a frozen query pattern. Use these as templates when the variant manifest matches one of these shapes. For shapes outside this list, fall back to the general process in [SKILL.md](SKILL.md).

Recipes use the provider-agnostic `<provider>_search` placeholder — concrete syntax per provider lives in `providers/<name>.md`.

**Recipes give the QUERIES, not a stopping rule, and on a plan-mode run they do not give the ROUTE either.**
Every fresh run's frozen plan carries the `supplemental_lane` contract: `register_enumerate` is not in the
funnel's tool surface, one `register_execute_plan` call runs every dictated entry, judgment additions ride
`register_propose_supplemental`, and a hand-authored qid-less band block fails the stage
(`band_block_unplanned`). Read [unit.md](unit.md) → the plan-mode banner FIRST, and read the recipe below for
the SHAPE of the query it names, never as an instruction to type the call yourself. The funnel (Layer A) runs
each named query via
`register_enumerate` — the completeness primitive that owns the page loop and returns `enumerated` or
`incomplete`, never a partial list. **No recipe step narrows-for-tractability, samples a top-N, or decides it
searched enough** — those were funnel sufficiency calls and are deleted. A recipe step that says "macro probe"
is a **count-only crowd descriptor** (`limit:1`); a recipe step that names a variant query is an
**`register_enumerate` call**. The lawyer (Layer B) reads the complete band and decides relevance,
sufficiency, and prioritisation. See [unit.md](unit.md).

> **EVERY `register_enumerate` IN EVERY RECIPE MUST BE CLASS-SCOPED.** Pass `nice_classes`=<the matter's
> in-scope Nice set> (the spawn task hands you the array) on every enumerate call. **Before you run any
> `name:<x> match=default` (or `starts_with` / `ends_with` / `phonetic` / `fuzzy`) WITHOUT `nice_classes`, STOP**
> — that is an all-45-class crowd that floods the band and times the stage out, not breadth. The bare unscoped element is a **count-only descriptor**, never an enumerated slice.
> Class-scope is which Nice classes the matter instructed (BREADTH); the breadth you choose is region / variant /
> match-mode, never "all classes". The ONLY all-class enumerate is the exact-IDENTICAL cross-class merch check
> (`match_mode:exact`, `nice_classes:[25]`). `fuzzy` is never an enumerate mode.

**Execution note:** `prelim-register` now runs as a worker that decomposes these axes into isolated
search **units** (saturation-probe / primary-sweep / transliteration-numeric / incumbent-class /
merch-sweep), each executing one axis and writing its named-band array (`register-units/<axis>-band.json`).
If you are a unit, run only your assigned axis from the recipe below; the judgment worker (Layer B) performs
the cross-cutting relevance / sufficiency / owner-aggregation / prioritisation over the combined bands. See
[SKILL.md](SKILL.md).

## Contents

- [Recipe 1 — Compound tagline](#recipe-1--compound-tagline-multi-word-mark-with-distinctive-element)
- [Recipe 2 — Single distinctive word](#recipe-2--single-distinctive-word-coined--unusual)
- [Recipe 3 — Single descriptive word with crowded field](#recipe-3--single-descriptive-word-with-crowded-field)
- [Recipe 4 — Industry-incumbent shadow](#recipe-4--industry-incumbent-shadow)
- [Recipe 5 — Foreign-language transliteration](#recipe-5--foreign-language-transliteration-worldwide--multi-region-scope)
- [Recipe 6 — Multi-word descriptive tagline](#recipe-6--multi-word-descriptive-tagline-0-distinctive-elements)
- [Recipe 7 — Exact-in-class-live floor (saturated near-exact band)](#recipe-7--exact-in-class-live-floor-saturated-near-exact-band)
- [Funnel timing rules](#funnel-timing-rules-apply-across-all-recipes)
- [Decision tree — which recipe applies](#decision-tree--which-recipe-applies)

---

## Recipe 1 — Compound tagline (multi-word mark with distinctive element)

**When to use:** mark has 3+ words where 1 element is distinctive and the others are common (e.g., "Dawn: Legends of Lumengarde" — LUMENGARDE distinctive, DAWN + LEGENDS common).

**Pattern:**

```
1. Crowd descriptor — count-only probe each saturated common element (limit=1, fields=[uri])
   → name:DAWN classes 9,28,41,42 → write an `incomplete` crowd-descriptor block (count + reason)
   → name:LEGEND classes 9,28,41,42 → write an `incomplete` crowd-descriptor block
   (these enumerate nothing — they describe the crowd for judgment)

2. ENUMERATE the distinctive element (register_enumerate)
   → name:LUMENGARDE classes 9,28,41,42 → enumerated|incomplete block (every record carried forward)

3. ENUMERATE the incumbent classes if an industry-incumbent alert
   → name:LUMENGARDE classes 11 → captures lighting incumbent

4. ENUMERATE each common element as a named query in the in-scope classes
   → name:DAWN match=exact classes 9,28,41,42  → register_enumerate (exact-in-class name-list)
   → name:LEGEND match=exact classes 9,28,41,42 → register_enumerate

5. ENUMERATE the compound phrase
   → name:"Dawn: Legends of Lumengarde" match=phrase classes 9,28,41,42 → register_enumerate

6. ENUMERATE a cross-class merch query if any identical match
   → name:<exact mark> match=exact classes 25 → register_enumerate
```

**Why this order:** crowd descriptors first (cheap, informational — they describe the crowd, they do not clear it); then enumerate the distinctive element (highest-yield); then incumbent context; then each common element's exact-in-class name-list; then the compound phrase; then merch. Every numbered enumeration crosses the firewall as a band block — none is sampled.

**Expected output:** the complete enumerated band for the distinctive element + each named slice, plus crowd descriptors for the saturated common elements. Volume is judgment's to read, not the funnel's to prune.

---

## Recipe 2 — Single distinctive word (coined / unusual)

**When to use:** mark is one word, distinctive (coined, unusual, or low-frequency). Examples: LUMENGARDE (alone), XYRELL, ZURIQ.

**Pattern:**

```
1. Phoneme expansion (provider-specific — availability + tool name in providers/<name>.md)
   → <provider>_expand_phoneme(word=<mark>, language=en_US)
   → also _de_DE, _fr_FR, _it_IT, _es_ES if jurisdiction is multi-language

2. ENUMERATE the phonetic-mode named band (register_enumerate)
   → name:<mark> match=phonetic phonetic_variants=<aiVariants from step 1> classes <target>

3. ENUMERATE the default-mode named band (register_enumerate)
   → name:<mark> match=default classes <target>

4. ENUMERATE the incumbent classes if an industry-incumbent alert

5. ENUMERATE a cross-class merch query if identical match
```

**Why:** coined words rarely have crowded fields; phonetic expansion catches misspellings and stylisations the default mode misses. Multi-language phoneme expansion catches non-English-speaker filings. Each enumeration returns `enumerated` (the usual case — sparse, fully paged) or `incomplete` if a crowd; either way it crosses verbatim.

**Expected output:** sparse but high-signal, fully enumerated.

---

## Recipe 3 — Single descriptive word with crowded field

**When to use:** mark is one word, common English, descriptive of the product (e.g., "ELEVATE" for sports goods). High saturation expected.

**Pattern:**

```
1. Crowd descriptor (sat-signal) — count-only probe
   → name:<mark> classes <target> limit=1 → write an `incomplete` crowd-descriptor block (count + reason)

2. ENUMERATE the dangerous named slices (register_enumerate) — class + region scoped,
   the tool owns the page loop and returns enumerated|incomplete:
   → name:<mark> match=exact classes <target>                        → exact-in-class name-list
   → name:<mark> match=default classes <target>  (per major region)  → the substring band, per major
   (do NOT AND a product/industry term into the search text — that is a goods filter and drops
    in-class-live records on a goods guess; the lawyer judges goods at selection. Scope by CLASS
    and REGION only.)

3. ENUMERATE word-order / wildcard variant queries the manifest lists
   → name:"<mark> *" wildcard classes <target>  → register_enumerate
   → name:"* <mark>" wildcard classes <target>  → register_enumerate

4. ENUMERATE the incumbent classes if a famous-brand incumbent exists for the descriptive word

5. ENUMERATE a cross-class merch query if identical match
```

**Why:** descriptive crowded-field marks have many records. The funnel does **not** narrow-to-tractable-and-stop — it scopes each named slice by class and region (which is breadth, not sufficiency) and lets `register_enumerate` page it to completion or return `incomplete`. The crowd descriptor (step 1) tells the lawyer how crowded the field is; the lawyer decides relevance and sufficiency over the complete enumerated slices.

**Expected output:** complete enumerated band for each class/region-scoped named slice + a crowd descriptor for the bare element. The lawyer filters to relevance; the funnel does not.

---

## Recipe 4 — Industry-incumbent shadow

**When to use:** the mark's distinctive element is also a known incumbent in a non-target industry (e.g., LUMENGARDE → Lumengarde Electronics lighting). Triggered by `industry_incumbent_alert` field in the variant manifest.

**Pattern:**

```
1. ENUMERATE the primary named band on target classes (Recipe 1 or 2 above)

2. ENUMERATE the incumbent's classes (register_enumerate)
   → name:<element> classes <incumbent classes>
   → for LUMENGARDE/lighting: classes 9 (LEDs/sensors) + 11 (lighting fixtures)

3. ENUMERATE the owner-bound named band
   → owner:<incumbent name pattern> + classes <target>
   → surfaces whether the incumbent has filed in the target industry too

4. ENUMERATE the incumbent's portfolio for opposition context
   → enumerate the incumbent's marks; opposition data rides on each record
   → the lawyer reads onomaticsOppositions[] to gauge enforcement posture
```

**Why:** the incumbent's enforcement posture is highly relevant — but that is the lawyer's read. The funnel enumerates the incumbent's band; judgment interprets the opposition history. The watchlist seeds *attention*; they do not bound what is enumerated (the unnamed-owner exact-in-class-live band crosses regardless).

**Expected output:** the incumbent's enumerated band + opposition data per record for the lawyer to weigh.

---

## Recipe 5 — Foreign-language transliteration (worldwide / multi-region scope)

**When to use:** jurisdiction scope is worldwide or includes non-Latin markets. Triggered by `translit-<script>` variants in the manifest.

**Pattern:**

For each transliteration variant in the manifest:

```
1. ENUMERATE the transliteration (register_enumerate)
   → name:<transliteration> classes <target>
   → most providers store non-Latin marks in their native script
   → enumerated|incomplete block carried forward verbatim

2. The lawyer reads each transliteration hit:
   → status/owner ride on the enumerated record
   → transliteration plausibility is a verification flag for the lawyer (Verify? ✅)
```

**Important:** transliteration hits are NOT confirmed without senior-lawyer sign-off. Claude generates plausible transliterations but Korean/Arabic/etc native speakers must confirm. The `Verify? ✅` flag from `prelim-variants` carries through to the band so judgment surfaces it. The funnel does not decide a transliteration is wrong — it enumerates and passes the record with its flag.

**Breadth note (this recipe shares a unit with the per-jurisdiction named queries).** Both the script-group enumerations here and the material-jurisdiction named queries are owned by the `transliteration-numeric` unit, and **both are enumerated** — there is no "yield one to fund the other" sufficiency trade any more. `register_enumerate` owns each query's page loop; the unit runs every variant query the manifest declares. If a query genuinely cannot run (provider error), that surfaces as an `incomplete` block, not a silently-dropped sweep.

**Expected output:** the enumerated band per script group; sparse where domestic registrants dominate, high-signal where a pre-emptive filing appears. The lawyer reads it.

---

## Recipe 6 — Multi-word descriptive tagline (0 distinctive elements)

**When to use:** mark is 2+ words, ALL elements are common-words with high or very-high saturation, no distinctive anchor. Examples: "Raise Your Play", "Level Up Your Skills", "Step Into The Play".

**Pattern:**

```
1. Crowd descriptors — count-only probes on the saturated common elements (limit=1, fields=[uri])
   → name:ELEVATE classes 9/28/41/42 → `incomplete` crowd-descriptor block
   → name:GAME classes 9/28/41/42 → `incomplete` crowd-descriptor block

2. Crowd descriptor — partial-phrase prefix count (the narrative anchor)
   → phrase:"ELEVATE YOUR" classes <target> limit=1 → `incomplete` block ("234 live ELEVATE YOUR ___")

3. ENUMERATE the compound phrase, 3 match-modes (register_enumerate each)
   → exact:"RAISE YOUR PLAY" classes <target>   → identical-mark band
   → phrase:"RAISE YOUR PLAY" classes <target>  → embedded-in-compound band
   → default:"RAISE YOUR PLAY" classes <target> → tokenisation-split band

4. ENUMERATE phrase-substitution variant queries (per manifest)
   → name:"RAISING YOUR PLAY" match=default classes <target> → register_enumerate
   → name:"RAISE YOUR PLAYS" match=default classes <target>  → register_enumerate
   → name:"RAISE THE PLAY"   match=default classes <target>  → register_enumerate
   → ...

5. ENUMERATE wildcard variant queries (per manifest)
   → name:"Elevate * game" classes <target>     → register_enumerate
   → name:"Elevate your *"  classes <target>     → register_enumerate
   → name:"* your game"     classes <target>     → register_enumerate

6. ENUMERATE each common element's exact-in-class name-list (register_enumerate)
   → name:ELEVATE match=exact classes <target>  (scope by CLASS + REGION, not a product/goods term)

7. ENUMERATE owner-bound competitor queries
   → owner:<each competitor> classes <target>   → register_enumerate

8. ENUMERATE a cross-class merch query if identical match
```

**Why:** for 0-distinctive multi-word marks, the search vector IS the phrase + its morphological variations + competitor portfolio. The funnel enumerates each — it does **not** "narrow via phrase composition because element-level sweeps are too saturated" (that was a sufficiency call). The element-level crowd is *described* (steps 1–2) and the named slices are *enumerated* (steps 3–8). The lawyer reads the complete band + the crowd descriptors and decides sufficiency.

**Expected output:** the enumerated band for every named slice + crowd descriptors for the bare elements. The lawyer prioritises; the funnel surfaces everything.

---

## Recipe 7 — Exact-in-class-live floor (saturated near-exact band)

**When to use:** the manifest flags the **distinctive anchor** (`Formative root` / dominant element)
`saturation: high`/`very-high` and you are the `primary-sweep` unit. This is the executable form of the [dangerous-category named enumeration](unit.md#exact-in-class-live-floor-primary-sweep-unit-owns-it) — enumerating the **near-exact band** (the *distinctive* dominant token a *substring* but not identical) and the **phonetic fringe** that a saturated field otherwise buries past the ranker cliff. **Do NOT run this recipe on a COMMON component** (a stripped common word the manifest marks common/descriptive — GREAT / OUTDOORS): a common component is count-only via the `saturation-probe` axis (which already counted it), and wholesale-enumerating its substring per-jurisdiction is the mega-crowd grind that SIGKILLs the stage. Runs **alongside** the saturated recipe (Recipe 3 / Recipe 6), not instead of it. **It is no longer a sufficiency floor** (no "fetch 3 representatives", no per-class `confirmed-clean` verdict) — it is the completeness contract applied to the dangerous slice: enumerate it, or report it incomplete.

**Pattern:**

```
1. Crowd descriptor — count-only probe the FORMATIVE ROOT (manifest `Formative root`; else dominant
   element) per in-scope class (the root, NOT the full token, so VELTRI* is described)
   → name:<root> nice-class:<class N> limit=1 fields=[uri] → `incomplete` crowd-descriptor block
     (the count tells the lawyer how crowded; it clears nothing)

1b. CROWD STOP — the tractability gate (the removal). Step 1's count IS the gate. If the root's class-scoped
   count is over the resource ceiling (a crowd — GREAT≈28k, OUTDOORS≈2.7k), the Step-2 substring enumerate
   would return `incomplete`, and fanning it out per-major + phonetic is the grind that double-SIGKILLed the
   stage. STOP the fan-out: do NOT run Step 2b (per-major) or Step 3 (phonetic) on a crowd root; keep the exact
   name-list (Step 2c). Then WRITE depends on WHICH root it is:
     • the DISTINCTIVE dominant category (the highest-relevance slice) → write ONE `incomplete` block (a
       material could-not-finish for judgment — the COLORA→色彩 case);
     • a stripped COMMON component (NOT the distinctive anchor — GREAT/OUTDOORS) → write NO block; the
       `saturation-probe` count is the sole, immaterial signal (a duplicate primary-sweep crowd risks
       mis-reading as a material in-class gap).
   Run Steps 2–3 in full only when the root's class-scoped slice is TRACTABLE (a class-scoped band ≈257; a distinctive root
   that narrows per-region). For an all-common-words phrase mark, the exact phrase + near-neighbours is the
   dangerous band (Recipe 1), not the component substrings.

2. ENUMERATE the substring band (register_enumerate) — when the root is TRACTABLE (Step 1b did not fire);
   class + region scoped (breadth, not sufficiency)
   → register_enumerate name:<root> match=default nice_classes:<in-scope full Nice set, goods AND
     services 42/44 — never a goods-only 1/5 subset> regions:<in-scope>
   → the tool pages to has_more:false and returns:
        {state:"enumerated", records:[…every substring-in-in-scope-class record, live AND dead with status]}
        OR {state:"incomplete", total_hits, fetched, sample, reason}  ← a crowd over the resource ceiling
   → write the block verbatim. Do NOT sample, do NOT truncate, do NOT call it clean.
   → do NOT drop nice_classes and do NOT AND goods-vocabulary words into the text (goods is judged
     by the lawyer at selection, never as a search-time filter)

2b. SLICE the majors from Step 2 when Step 2 is COMPLETE — do not re-enumerate per major redundantly.
   → If Step 2 returned `{state:"enumerated"}` (it paged to has_more:false), every in-scope major's
     substring-in-class records are ALREADY in that complete set. Slice them machine-side by each record's
     `jurisdictions` (US/EU/UK/CN/JP …) for the per-major reconciliation — do NOT spend a redundant per-major
     `register_enumerate`. A COMPLETE region-scoped set provably contains every in-scope major's records, so
     the slice is EXACT, not a sufficiency guess. (This removes the per-jurisdiction redundancy + its call-count
     / timeout fragility; a complete Step 2 still individuates every major.)
   → Per-major enumerate ONLY for a major Step 2 left under-covered — i.e. Step 2 returned `{state:"incomplete"}`
     (the crowd was over the ceiling, so a major may sit in the un-paged remainder): THAT is the guarded
     crowd-narrow path. `register_enumerate name:<root> match=default nice_classes:<target> regions:[<major>]`
     — region + class + substring ≈ a handful; each writes its own enumerated|incomplete block.

2c. The exact name-list — slice it from the complete set, or enumerate per major when Step 2 is incomplete.
   → The exact-in-class records are a SUBSET of the substring band, so when Step 2 is `{state:"enumerated"}`
     they are already present: derive the exact name-list by slicing Step 2 for records whose name matches the
     dominant token EXACTLY (live + dead, with status) — the Larkmoor recall guarantee is preserved by the
     complete set, no separate exact call needed.
   → When Step 2 is `{state:"incomplete"}`, run the exact name-list per under-covered major (it is the cheapest,
     always-enumerable slice — the guaranteed floor when the substring crowd could not be fully paged):
     `register_enumerate name:<dominant token> match=exact nice_classes:<target> regions:[<major>]` → returns
     every exact-in-class record (live + dead with status). Never sub-sampled, never rolled into a count.

3. Slice B — phonetic-equivalent fringe (register_enumerate)
   → <provider>_expand_phoneme(word=<dominant>, language=<matter languages>)
   → register_enumerate name:<dominant> match=phonetic phonetic_variants=<…> nice_classes:<target>
   → enumerated if bounded, incomplete if a crowd. Do NOT name any phonetic algorithm.

4. Tag results
   → each record's source block `query` field names the slice (variant / class / region / match-mode)
     so judgment sees provenance; identical-text rows carry their status like any other record
```

**Why this order:** crowd descriptor first (cheap — tells the lawyer how crowded the band is); then enumerate the substring band class+region-scoped via `register_enumerate` (the tool owns the page loop — the funnel cannot stop early); then the majors region-scoped (the worldwide pass does not discharge them); then the exact name-list (cheapest, always enumerates); then the phonetic fringe. **The funnel emits no `confirmed-clean` verdict** — each block's `enumerated`/`incomplete` state is the receipt. The lawyer reads the complete band, decides relevance and sufficiency, commands a narrower enumeration on any `incomplete` it deems material, or halts. A sampled dangerous category is impossible here: the tool either enumerates or returns `incomplete`.

**Meaning-axis extension — a saturated everyday-word meaning token (COLORA→色彩) runs the same enumeration.** When
the saturation probe flags a `translit-*-meaning` variant, add **one `register_enumerate` step on the
field-scoped meaning token**: scope the everyday-word token to the **filed in-scope Nice classes (and region)**
— the `nice_classes` × `regions` filter on the `register_enumerate` call, **exactly as step 2 / 2b do for the
Latin root** — with the token kept as a contiguous *substring* predicate (`match_mode:default`). The tool pages
to `has_more:false` and returns `enumerated` or `incomplete`; write the block verbatim. Do **NOT** AND matter
goods-vocabulary terms into the search text (that drops in-class-live records on a goods guess — banned;
goods-relevance is judged by the lawyer at SELECTION, after reading the in-class band), and do **NOT** switch to
exact-standalone mode as the enumeration instrument (exact-standalone is *narrower* than the class-scoped
substring query and drops composite / word+device marks — e.g. a live CN Cl.9 "computer game programs" 色度 mark
that default mode surfaces but `match_mode:exact` 色度 misses; a narrower query's result can never override the
broader query's band). "Field-intersected" here means scoped to the goods/services **classes**, not text-filtered
by goods **words**. The everyday-word saturation is the trigger to **scope the named enumeration to the field (by
class)** — never to drop the token, re-narrow it to a more specific concept, or swap it for the phonetic form. The
saturated meaning token is enumerated like any other named slice; the lawyer reads it. (This is the register half
of the variant-stage everyday-word-first rule — see
[transliteration-scripts.md](../prelim-variants/transliteration-scripts.md): the everyday word is kept upstream,
class-scoped and enumerated here.) Reuse steps 1–2 above with the class-scoped meaning token as the `register_enumerate` predicate.

**Expected output:** on a saturated field, the complete enumerated near-exact in-class band (live + dead with status) the ranker's top-N paging would have buried, plus the phonetic-fringe band — each as an `enumerated` block, or an `incomplete` descriptor where a slice was a genuine crowd. On a non-saturated field this recipe does not fire.

---

## Funnel timing rules (apply across all recipes)

`register_enumerate` owns the page loop and the retry/backoff/cap handling internally — the funnel does not
hand-paginate. These rules describe what the primitive guarantees and how the funnel reads its result:

- **Inter-call delay** is handled inside the primitive (provider rate-limit safety).
- **Pagination** is internal — the primitive pages to `has_more:false` and returns `enumerated`, or returns
  `incomplete` when it cannot (the provider 5000-record window, the resource ceiling, or a provider error).
  The funnel **never** decides a page-through was "enough" — there is no top-N, no "stop at record N and call
  it clean". `enumerated` or `incomplete` are the only two outcomes, and both cross the firewall verbatim.
- **A crowd over the window/ceiling returns `incomplete`** (count + sample + reason) — **never a silent
  truncation and never a self-accepted limit.** That `incomplete` block is the signal to judgment; the lawyer
  decides whether to command a narrower named enumeration (which the funnel then runs) or halt. The funnel does
  not "narrow and re-probe until tractable, then call it clean" — it surfaces the descriptor and lets judgment
  command.
- **Retry / provider error** is handled inside the primitive; a persistent failure returns `incomplete` with
  the error in `reason` (a `deferred`-class gap for judgment), never a fabricated empty.

## Saturation crowds — describe, never enumerate, never narrow-to-clean

A genuinely unbounded crowd (a bare saturated element, a substring pile of individual-character hits) is **not
a named band** — it is noise the lawyer needs *described*. Use `register_search` `limit:1` (count-only,
capturing `total_hits`) and write an `incomplete` crowd-descriptor block: `{state:"incomplete", query,
total_hits, fetched:0, sample:[], reason:"crowd descriptor — <why>"}`. Then:

- **Do NOT `register_enumerate` a saturation crowd.** Enumerate only the **named** slices inside it (the
  exact mark, the formative-root substring band class+region-scoped, the phonetic fringe — Recipe 7). Those are
  bounded by construction; `register_enumerate` pages them.
- **Do NOT narrow the crowd, re-probe, and call the residual clean.** Scoping a named slice by class/region is
  *breadth* (which slice you search) — that is fine and is what the `register_enumerate` call does. Replacing
  a broad query's hits with a narrower query's lower count and declaring the field clean is the banned
  broad→narrow false-clean. The crowd is *described* (count) and the named slices are *enumerated*; nothing in
  between.
- **"Character-noise" is a judgment read, not a funnel call.** A high count is *passed to the lawyer as a
  descriptor*; the funnel does not dismiss it as individual-character indexing. The lawyer reads the count
  alongside the enumerated class-scoped band and decides.

## Decision tree — which recipe applies

Per mark, in the manifest:

1. Count `role: distinctive` elements.
2. Count `role: common-word` elements with `saturation_signal: high` or `very-high`.
3. Apply this lookup:

| Distinctive | Common (saturated) | Multi-word? | Recipe |
|---|---|---|---|
| 1 | 0 | No | Recipe 2 (single distinctive word) |
| 1 | 1+ | Yes | Recipe 1 (compound tagline) |
| 0 | 1+ | No | Recipe 3 (single descriptive word, crowded) |
| **0** | **2+** | **Yes** | **Recipe 6 (multi-word descriptive tagline)** |
| 0 | 0 | — | edge case — apply general 7-step from SKILL.md |
| Any | Any with industry_incumbent_alert | — | Add Recipe 4 alongside the primary recipe |
| Any | Any with translit-* variants | — | Add Recipe 5 alongside |
| Any | Any owned element `saturation: high`/`very-high` | — | Add Recipe 7 alongside (primary-sweep unit — the dangerous-category named enumeration) |

Recipes are composable. Most worldwide-scope gaming taglines run Recipe 1 + Recipe 4 + Recipe 5 (compound tagline + industry-incumbent shadow + transliteration sweep).
