# prelim-register — MODE A (UNIT)

> Read `SKILL.md` first (the shared spine: Spawned session, Model, Provider, Tool call budget, the band-block coverage model, Failure fallback). This file is the UNIT-mode procedure only. **Do NOT read `digest.md`** — that is digest-mode judgment a unit must never run.

# MODE A — UNIT (run one axis → ENUMERATE the named band, OR report honest incompleteness)

> **PLAN MODE — the supplemental_lane contract.** When your spawn task says the frozen plan
> carries the `supplemental_lane` contract (every fresh run; the task message states your exact tool
> calls), **no band block is ever hand-authored**:
> - **Dictated entries** → ONE `register_execute_plan` call (the task message gives the exact args). The
>   tool runs every entry itself and writes the band, qids stamped.
> - **Judgment additions** (anything the manifest/frame warrants beyond the dictated set — the WHAT is
>   still fully yours) → `register_propose_supplemental`. The tool mints each proposal as a qid'd plan
>   entry, executes it through the same deterministic executor (count-first per-term truth on OR-stacks,
>   the enumerate ceiling, honest error stamping), MERGES its block into the band itself, and returns the
>   results read back from the band — counts, `term_counts`, record previews. Iterate freely: propose →
>   read → propose narrower.
> - You **never** run register coverage via `register_enumerate` and **never** write or edit band
>   blocks — a hand-authored (qid-less) block fails the stage (`band_block_unplanned`). Why this exists:
>   a SIGKILLed pass's hand-written 0/clean blocks have shipped a false clean on a delivered run;
>   the transcription lane is closed at the source, for dictated entries as well as judgment additions.
> - The per-query doctrine below (class scope, crowd handling, dead-with-status, no self-acceptance)
>   still governs WHAT you propose; steps 3–7's hand-write-the-band mechanics apply only to LEGACY
>   (no-plan / pre-contract) runs.

You are the **FUNNEL** — Layer A, the search machine. You decide **nothing** about relevance, risk,
sufficiency, or prioritisation. Your one job: for every query you run, either **ENUMERATE it to completion**
(page to `has_more:false`, hand up every record) **or** report **HONEST INCOMPLETENESS** (count + sample +
why). There is **no third "good enough" state** — no sampling, no top-N, no "narrow to tractable and call it
clean", no "coverage-limited and move on". The lawyer (Layer B — the digest / synthesis stages downstream)
reads your **complete named band** and decides what is relevant, whether the search is sufficient, what to
prioritise, what to re-command, and whether to halt. **You never decide you searched enough; that is
judgment's call.**

You were spawned to run exactly ONE axis named in your task. Read the manifest + the `matter-context.md` from Phase 0 + the relevant
`register-recipes.md` axis + `status-rules.md` + `providers/<name>.md`. Then:

1. **Confirm applicability.** If your axis has no work in this manifest (see per-axis triggers below), write a one-line "not applicable" band block (see *Named-band artifact* below) and return. Otherwise continue.
2. **Choose the queries (breadth = judgment, taken from the manifest).** Your axis owns a set of variant queries — the exact mark + each manifest variant (phonetic / visual / meaning / family-pattern), in the in-scope classes, per material+major jurisdiction (per-axis specifics below). **Breadth stays with you/the manifest** — pick the variant, scope, class, match-mode. You do **not** decide whether you have searched *enough* breadth; you run every query the manifest's variants and the scope demand. Search **bounded to the matter's in-scope jurisdictions** (the matter frame's *Scope jurisdictions*: the instructed territories + rights effective in them). A hit is **in scope iff a right is legally effective in a scope jurisdiction by any route** (filed there / a Madrid (international) registration designating it / an EUTM covering an instructed EU member / a treaty or priority effect) — `register_enumerate` carries it forward tagged with its route; a hit effective ONLY outside the scope set is out-of-scope. When in doubt whether a right reaches an instructed territory, KEEP it — reach is a legal judgement for Layer B, not a funnel guess. **CLASS SCOPE IS NOT A BREADTH DIAL.** The matter's in-scope Nice classes are FIXED by the matter frame (your spawn task hands you the exact array, e.g. `[9,28,41,42]`) and they pin **every** `register_enumerate` call — your breadth dials are region / variant / match-mode, **never** widening to all-class. (Verified failure: an unscoped all-class sweep on a saturated mark returned a 10,102-record flood and TIMED OUT the stage.)

   **The FORM band is MACHINE-DEFINED — search `form-neighbourhood.json`, not a model guess.** The driver writes the *complete* mechanical form neighbourhood of the distinctive element(s) — every edit-1 spelling/sound/transposition, the phonetic-family skeleton, visual / homoglyph look-alikes, and cross-script transliterations — to `form-neighbourhood.json` (`elements[].band`). **For the form axis your query set IS that file**, searched exhaustively, never a subset:
   - **`band.exactQueries`** — OR-STACK them as `names: [...]` (implicit OR within the name field), ≤80 names per call (the executor's chunk bound — the plan compiler splits at the same width). **Count-first is CODE now, not your protocol**: whenever a multi-name stack crowds over the ceiling, the tool itself counts every term (`limit:1`, `fields:["uri"]`), individually enumerates each populated tractable term, and returns `term_counts` (verified-zero | enumerated | crowd | unenumerated | error) with the carried records — **a populated near-form can never read as 0 inside a saturated pile** (the FROSTBERRY drop). Your job is to READ `term_counts` honestly: a `crowd`/`unenumerated`/`error` disposition is an open question for judgment, never a clean. In plan mode the form band is a dictated plan entry — the executor runs it; you never hand-stack it.
   - **`band.wildcardPatterns`** — run the consonant-skeleton wildcard (e.g. `s?r?n?`) to retrieve the vowel family (SYRONA/SIRINA-class) the exact OR-stack can't.
   - Class-scope and per-jurisdiction rules apply unchanged (every call carries `nice_classes`/`in_scope_classes`). The manifest's model-authored `phonetic`/`visual`/`numeric` rows are **supplementary salience hints**, never the form definition; the `translit-*`/`meaning` rows (the non-mechanical axis) are still searched. If `form-neighbourhood.json` is absent (legacy run), fall back to the manifest variants — never worse than before.
3. **ENUMERATE the dangerous NAMED band with `register_enumerate` — class-scoped, never manual paginate-then-sample.** For each named query (the exact mark + each specific variant × in-scope class × material/major jurisdiction), call **`register_enumerate`** with the query (`name`/`names`/`match_mode`/`nice_classes`/`regions`/`owner_country`/`in_scope_classes` + the usual `register_search` fields). **MANDATORY: every `register_enumerate` call MUST carry `nice_classes`=<the matter's in-scope Nice set> AND `in_scope_classes`=<the same set>.** An enumerate with `nice_classes` OMITTED runs an all-45-class crowd (the `default` / `starts_with` / `ends_with` / `phonetic` / `fuzzy` modes are unbounded unscoped) — it floods the band and TIMES OUT the stage, and it is **FORBIDDEN**: scope-by-class is breadth the matter instructed, not a "good enough" call. The **only** all-class exception is the exact-IDENTICAL cross-class merch check (`match_mode:exact`, `nice_classes:[25]`). `fuzzy` is **never** an enumerate mode. **The tool owns the page loop and CANNOT return a partial list** — you cannot get a partial result and call it done, and there is no top-N mode. It returns exactly **one of two states**:
   - **`{state:"enumerated", total_hits, count, records:[…]}`** — it paged to `has_more:false`; every named record is carried forward, already batch-screened (each record carries `record_id`, `mark_text`, `classes`, `status`, `owner_name`, `owner_country`, `application_date`, `registration_date`, `expiry_date`, `jurisdictions`, `screen_verdict`). Write this verbatim as an `enumerated` band block.
   - **`{state:"incomplete", total_hits, fetched, sample, reason}`** — it could **not** page to completion (the band is a genuine CROWD over the resource ceiling, the provider 5000-record window was hit, or a provider error occurred). Write this verbatim as an `incomplete` band block. **This is a SIGNAL to judgment, never a clean negative and never something you self-accept.** You do **not** "narrow to tractable and call it clean" — an incomplete result crosses the firewall as an incomplete block; judgment decides whether to command a narrower enumeration or halt.
   - **Write each call's result as one block in `register-units/<axis>-band.json`** (the named-band array — see *Named-band artifact* below). One block per `register_enumerate` / count-probe call. An `enumerated` block carries its records; an `incomplete` block is carried forward **verbatim — never dropped, never "accepted", never silently re-narrowed-then-cleaned**.
   - **The completeness contract is UNIFORM — it applies to the named band too.** "The exact mark, in-class, every major+material jurisdiction" is *usually* small and `enumerated` — but that is **not load-bearing**. If it ever runs to a few hundred and `register_enumerate` returns `incomplete`, it stays `incomplete` and crosses to judgment, exactly like the wider crowd. There is exactly **one** way to be done with a search: `enumerated`. Everything else is `incomplete` and the lawyer reads it. **Never self-accept "good enough" anywhere — not even the named band.**
4. **For a SATURATION CROWD (a genuinely unbounded `contains` / character-indexed pile), write a COUNT-ONLY descriptor — do NOT enumerate it.** A saturated element solo (e.g. the everyday-word meaning token alone, the bare common element) is not a named band — it is noise the lawyer needs *described*, not *piled in*. Run `register_search` with `limit:1` (count-only, capturing `total_hits`) and write the result as an `{state:"incomplete", query, total_hits, fetched:0, sample:[], reason:"crowd descriptor — …"}` block. **Do NOT call `register_enumerate` on a saturation crowd, and do NOT call it clean.** The descriptor (count + why) is what crosses the firewall; the raw character-noise pile does not. Judgment reads the count and decides whether to command a narrower named enumeration inside it.
5. **Mechanical facts only — read off the record, decide nothing.** `register_enumerate` returns each record already batch-screened: class membership, live/dead `status`, owner, dates, `jurisdictions`, and a closed-set `screen_verdict`. Those are **mechanical reads off the record** — keep them. You do **NOT**:
   - **off-field-drop on goods** — brand-json has no goods/services text; an in-scope-class live record is carried forward and the lawyer decides on its actual goods/services. (`screen_verdict` is enrichment for judgment, not a funnel drop authority.)
   - **sample or self-accept** — no top-N, no "narrow to tractable and stop", no per-jurisdiction 3-fetch ceiling, no switch-to-exact-standalone-as-enumeration. Those were funnel sufficiency calls; they are **deleted**. The tool enumerates or reports incomplete — there is no in-between for you to author.
6. **Surface dead records WITH their status — no funnel date-cutoff.** Carry every record `register_enumerate` returns **with its `status`** (live / lapsed / expired / lapse-date in the record's dates). You do **NOT** apply a recency/date threshold and you do **NOT** drop dead-except-identical. **`recently-dead` is a STATUS for judgment**, not a funnel filter: whether a recently-lapsed near-identical matters (revival window, field history, non-use vulnerability) is the lawyer's call (Layer B), made on the status + lapse date you passed through. Volume is handled by the completeness contract (step 3): if the dead-inclusive named band is bounded, `register_enumerate` returns it `enumerated`; if it is a crowd, it returns `incomplete` → descriptor. You pass the fact; judgment weighs it. (The old D4 ≤5y date-cutoff drop is **removed** — it was a funnel-side judgment.)
7. **Write the band artifact, then return.** Write `register-units/<axis>-band.json` (the named-band array, schema below) to `studio/prelim-search/<slug>/<date>/register-units/<axis>-band.json`, **before you return — returning without it is a failure** (the deterministic driver gates on this file: if it is missing after your turn it fails the stage and retries it under a fresh session key; a band that never lands as a file is lost work). Then **file your audit note by calling `record_unit_note`** — you do not write it, and the dispatch hands you no path for it: the driver renders it from your call. **The counts are not yours to type.** Queries enumerated, incomplete blocks and records carried forward are taken from the band you just wrote, so the note and the band cannot disagree; a note filed before the band exists is refused by name, because an account of a sweep that has not happened is not a short note but a wrong one. What you send is the half the band cannot say: `null_result` if this axis genuinely found nothing (refused against a band that carries records), and `note` — one short observation an auditor would want, in a lawyer's words. **The raw character-noise pile stays in this session** — what crosses the firewall is the **complete named band + crowd descriptors** (the `<axis>-band.json` array), NOT the raw rows. Do **not** apply a relevance gate, do **not** aggregate owners, do **not** decide sufficiency — those are judgment's job (Layer B).

## What else your grant carries, and why you do not call it

**Your dispatch names them, for the provider this deployment actually mounts.** Which register tools your
key carries beyond the ones this file orders is a fact about the active provider, not about the method —
one deployment serves all of them and another serves one — so the sentence is composed where the provider
is known rather than stated here, where it would be true for one deployment and false for the next.

What does not change: you do not call them, and that is a routing fact rather than a prohibition to work
around. Every record `register_enumerate` returns is already batch-screened and already whole — class
membership, live/dead `status`, owner, dates, `jurisdictions` and a closed-set `screen_verdict` come back
on the record itself (step 5) — and the frozen plan's entries are fetched by the executor. Reaching for
one of them means the query is wrong, not that a capability is missing: go back to the enumerate call and
fix its scope. Operator vocabulary for the provider-specific forms stays in `providers/<name>.md`.

## Named-band artifact — `register-units/<axis>-band.json`

The funnel's **only** structured output (it replaces the old prose-digest-as-clearance): a JSON **ARRAY of
blocks**, one block per `register_enumerate` / count-probe call. `parseNamedBand` / `bandRecords` /
`bandCrowds` / `mergeNamedBands` (in the driver's `named-band.mjs`) consume it. This is **exactly what crosses
the lifted firewall** — the complete named band + crowd descriptors — so the lawyer reads the real material,
not a pre-pruned digest.

Two block shapes (no third):

```json
[
  { "state":"enumerated", "query":"<what was searched: variant + class + region + match_mode>",
    "total_hits": 12,
    "records": [
      { "record_id":"/mark/eu/018…", "mark_text":"…", "classes":[9,41], "status":"Registered",
        "owner_name":"…", "owner_country":"DE", "application_date":"…", "registration_date":"…",
        "expiry_date":"…", "jurisdictions":["eu"], "screen_verdict":"surface:in-scope-live" }
    ] },
  { "state":"incomplete", "query":"<what was searched>", "total_hits": 2416, "fetched": 1,
    "sample":[ … ], "reason":"crowd descriptor — saturated everyday-word token, count-only" }
]
```

- **`enumerated` block** = `register_enumerate` returned `state:"enumerated"` (paged to `has_more:false`).
  Carry its `records` array **verbatim** (each record keeps the screening fields `register_enumerate`
  computed). This is a **complete** named slice — every record, none sampled away.
- **`incomplete` block** = either `register_enumerate` returned `state:"incomplete"` (crowd / window-cap /
  provider error) **or** a count-only saturation probe (step 4). Carry `total_hits` + `fetched` + `sample`
  (whatever was fetched, possibly empty) + a `reason` naming why it is incomplete (e.g. `"crowd descriptor —
  saturated token"`, `"provider 5000-record window hit"`, `"provider error after N pages"`). **An incomplete
  block is a DESCRIPTOR for judgment — never a clean negative, never dropped, never re-narrowed into a clean.**
- **"not applicable"** (axis triggers absent) = write a single block
  `{"state":"incomplete","query":"<axis> not applicable","total_hits":0,"fetched":0,"sample":[],"reason":"not
  applicable — <why>"}` so the file always lands and the driver's gate is satisfied.

The funnel ALSO writes `register-units/<axis>.md`, the prose audit note (search count, queries run). **It is
not optional**: it is this stage's declared output, the driver fails the pass outright when it is absent, and
the digest worker reads it. What it is not is EVIDENCE — the band JSON is the load-bearing artifact, and the
prose carries no clearance verdict and no sufficiency claim. A note narrating a completed sweep while the
band its plan entries call for is missing is refused as `named_band_missing`.

### Per-axis specifics

- **`saturation-probe`** — fires when any element is flagged `saturation: high`/`very-high`, plus a partial-phrase structural-prefix probe for slogan/descriptive-compound multi-word marks. Run count-only probes (`limit:1, fields:["uri"]`) capturing `total_hits`, and write **one `incomplete` crowd-descriptor block per probed element** (`fetched:0`, `reason:"crowd descriptor — saturated element <X>, count-only"`). It measures how crowded an element is — it **enumerates nothing and clears nothing**. Skip (not applicable) if all elements are distinctive/low-saturation. **A meaning-translation variant (`translit-*-meaning`) is NOT special-cased into a drop:** an everyday-word-scale count is just a crowd descriptor; whether the field-scoped named slice inside it matters is judgment's call — the funnel surfaces the count, and the **primary-sweep** axis runs the field-scoped named enumeration (below). Record `translit-too-generic` in the descriptor `reason` as a context note (NOT a drop / re-narrow / swap-to-phonetic signal). An implausibly LOW count on a translation that ought to have peers is the separate `translit-underretrieved` context note — also recorded in the descriptor `reason`, never acted on as a drop. Both are signals the lawyer reads.
- **`primary-sweep`** — always applicable. Run the playbook's named variant queries: the exact mark + each `phrase-substitution`, `visual-substitution`, family-pattern wildcard, and slang variant the manifest lists, **each via `register_enumerate`** (the tool guarantees the page loop). Owns the family-pattern / phrase-substitution / slang / visual-substitution variant queries. **Owns the dead-inclusive named enumeration** (its `register_enumerate` calls carry live AND dead records forward with their status — see step 6; there is no separate "dead-but-identical" or "D4" pass, because the funnel no longer filters dead records). **On a saturated unit, owns the [named-band enumeration of the dangerous category](#exact-in-class-live-floor-primary-sweep-unit-owns-it)** (the exact mark + the **distinctive** formative root / dominant token as the substring-in-scope-class-live named slice, per major+material jurisdiction, plus the phonetic fringe) — enumerated, not sampled. **The named enumeration covers a saturated `translit-*-meaning` meaning token too** (scoped to the filed in-scope Nice classes as the `nice_classes` × `regions` filter on the `register_enumerate` call, NOT goods-words ANDed into the search text) — not only the Latin dominant element / formative root. **But a COMMON component that is NOT the distinctive anchor** (a "stripped" common word the manifest marks common/descriptive — DAWN / LEGENDS / GREAT / OUTDOORS) **is count-only, owned by `saturation-probe`, and is NOT enumerated here**: `saturation-probe` already counts it and hands that count up; primary-sweep does **not** run the substring / per-major / phonetic enumeration on it and does **not** author a second crowd block for it (see the linked section — wholesale-enumerating a common component per-jurisdiction is the mega-crowd grind that SIGKILLs the stage).
- **`transliteration-numeric`** — fires when the manifest has `translit-*` variants or numeric-substitution variants. For each foreign-transliteration variant `register_enumerate` the transliterated form; for each numeric-substitution variant enumerate its query. Owns the foreign-transliteration + numeric-substitution variant queries. Skip if the manifest classifies the mark English-only / single-language. (Multi-script accumulation is no longer a window risk for the unit — `register_enumerate` owns the page loop and a crowd returns `incomplete`, so the unit does not deep-page raw rows itself.)
- **`incumbent-class`** — fires when the manifest has an `industry_incumbent_alert`. `register_enumerate` the named band scoped to the **UNION of the incumbent's primary classes AND the matter's in-scope Nice set** (pass that union as `nice_classes`) — **never an all-class incumbent sweep** (that is the unscoped crowd that timed this very axis out live). **Beyond the NAMED watchlist incumbents, the named enumeration is an UNNAMED-OWNER exact-in-class-live enumeration in those classes** — the watchlist seeds prioritise *attention* (judgment's use), they do **not** bound the funnel's enumeration. Every exact-token-in-class-live record crosses the firewall whether or not its owner was pre-listed; the watchlist is provably incomplete, so it never decides what the funnel enumerates. Skip only if there is no incumbent alert AND the frozen plan carries no entries on this axis — a watchlist-owners-only manifest has no incumbent alert yet its owner lane lives HERE, and the plan is the search authority. **This axis also carries the plan-dictated OWNER LANE** when the manifest seeds `watchlist_owners`: per owner, owner×formative enumerate slices (qids `…+owner-<owner>` — the owner's portfolio intersected with the dangerous band, THE coverage) plus one bare-owner count descriptor (qid `…+watch`, `covered_by` naming the slice qids — crowd context, never coverage). The executor runs these like every dictated entry; a wide-class owner slice that crowds is per-class rescued in the tool (`class_counts` on the block). You never re-run them by hand, and a bare-owner count is never written up as a reviewed portfolio or as "portfolio too large, noted".

### Exact-in-class-live floor — RENAMED to: the dangerous-category named enumeration (primary-sweep unit owns it) {#exact-in-class-live-floor-primary-sweep-unit-owns-it}

On a saturated field the worldwide ranker buries the dangerous named category — the exact mark and the
formative root / dominant token as a **substring in an in-scope class with live (or dead-with-status) status**
— past the detail-fetch cliff, in the majors (US/EU/UK/CN/JP) exactly as it buries the tail. The funnel's job
on a saturated unit is to **enumerate that named category to completion with `register_enumerate`**, not to
sample it. This is **not** a sufficiency floor any more (no "fetch 3 representatives", no "confirmed-clean
when N==M"): it is the same completeness contract applied to the dangerous slice.

**The bound — attempt once, keep if tractable, COUNT a crowd (never grind it). The class-scoped RESULT is the
discriminator, not the label.** Every substring slice here — the dominant token / formative root as a *contains*
predicate, and each per-major and phonetic slice built on it — is **attempted once, class-scoped, and gated on
its own result**. If it returns `enumerated` (tractable — a real named band: e.g. ≈257 exact-in-class-live; the phrase
"WIDE OPEN" ≈ 99), keep it and run its per-major / phonetic passes. If it returns `incomplete` because the
slice is **itself a crowd over the ceiling** (a hyper-common word — GREAT ≈ 28k, OUTDOORS ≈ 2.7k), that token
line is **TERMINAL**: STOP — do **not** fan it out per-major and do **not** run the phonetic fringe on it (those
are the same crowd re-issued; wholesale-enumerating a crowd across the majors + phonetic is the grind that
double-SIGKILLed **The Wide Open**). Gate on the *result*, never the label: a token the manifest calls
"dominant" is enumerated only if class-scoping makes it tractable (the colour-word mark COLORA→色彩), and a hyper-common word is
counted whether or not it is the dominant unit. **On a crowd slice, what you WRITE depends on which slice it is:**
- **the DISTINCTIVE anchor / the exact-or-near-identical named category** (the highest-relevance slice) → write
  the `incomplete` block verbatim; it crosses as a *material* could-not-finish for judgment to weigh (the
  COLORA→色彩 case — `digest.md`).
- **a COMMON component** the manifest strips as common/descriptive (GREAT / OUTDOORS — *not* the distinctive
  anchor) → do **not** write a second crowd block: `saturation-probe` already counted it and that count
  (immaterial off-field dilution) is the sole signal — a duplicate *primary-sweep* crowd risks mis-reading as a
  material in-class gap.
**For an all-common-words phrase / descriptive-compound mark ("The Wide Open" — dominant unit = the phrase,
no distinctive single-token root), the exact phrase + its near-neighbours IS the dangerous named band** (trivially
enumerable, ≈ 99); the common-word components are dilution the lawyer USES (a weak, diluted, common mark), never a
wall to grind. This is a **removal** of the mega-crowd grind, gated on the class-scoped result the tool already
returns — no per-word list, no new keep/stop rule.

- **Named slice — `register_enumerate` the substring band.** For the **formative root** (the variant
  manifest's `Formative root` — the distinctive stem the family shares, e.g. **VELTRI** for
  BIOVELTRIN/VELTRIN; **fall back to the `Dominant element`** when no separate root is named), call
  `register_enumerate` with the root as a *contains* predicate (`match_mode:default`, NOT exact-only),
  scoped to the matter's **in-scope classes** (the full Nice set — goods **AND** services, e.g. cl. 42/44;
  **never** a goods-only 1/5 subset — the VELTRI DIAGNOSTICS / VELTRI GENETICS conflicts hid in the services
  classes). The tool pages to `has_more:false` and returns `enumerated` (every record carried forward) **or**
  `incomplete` (the substring is itself a crowd over the ceiling). On `enumerated`, keep it verbatim (never
  sampled / truncated / cleaned) and run its per-major / phonetic passes. On `incomplete` the **bound above**
  governs: STOP the per-major / phonetic fan-out for this token, and write the `incomplete` block only when this
  is the **distinctive anchor / dominant category** (it crosses as a material could-not-finish) — for a stripped
  **common** component, `saturation-probe`'s count is the sole signal, so write no second block. (Goods-relevance is judged by Layer B
  after it reads the in-class band — never as a search-time text filter, so do **NOT** AND the matter's
  goods-vocabulary words into the search text.)
- **Per major jurisdiction, not only worldwide.** The worldwide pass does **not** discharge the majors. For
  **each** in-scope major (US/EU/UK/CN/JP), call `register_enumerate` `region`-scoped on the same
  substring × in-scope-class × status predicate. This is bounded and cheap (region + filed class +
  exact-substring narrows the crowd to a handful, often ~10 in EU). Each call writes its own band block —
  `enumerated` or `incomplete`. The funnel does not decide a major was "covered enough" by the worldwide
  pass; it runs the per-major enumeration and lets the block state speak. **Per the bound: run per-major only
  when the worldwide slice was tractable, or (for a distinctive root whose worldwide slice hit the provider
  window — Recipe 1 §2b) when each per-major slice is itself a handful; a per-major slice that returns a crowd
  is terminal — stop, do not narrow it further, and for a common component write no block.**
- **The exact name-list is the cheapest slice and always enumerates.** The exact mark token × in-scope
  class × per major+material jurisdiction (`match_mode:exact`) is small and cheap by construction — call
  `register_enumerate` on it; it returns `enumerated` (every exact-in-class record carried forward,
  live and dead with status). If it ever returns `incomplete`, that block crosses to judgment too — but the
  funnel never sub-samples the exact name-list and never rolls it into a count.
- **Phonetic fringe (tractable distinctive token only).** Run the provider phonetic capability on a **tractable
  distinctive** dominant token for the matter languages (`register_expand_phoneme` then `register_enumerate`
  `match_mode:phonetic` with the variants), scoped to the in-scope classes. **`register_expand_phoneme` is
  not offered by every provider** — where the active provider's doc says the variant PREVIEW is unavailable
  (its phonetic surface is server-side and opaque), skip that call and run `register_enumerate`
  `match_mode:phonetic` directly on the token; never substitute a literal search for the phonetic band, and
  say in the block that the variant list could not be previewed. Phonetic sets can be large;
  `register_enumerate` returns `enumerated` if bounded or `incomplete` if a crowd — a crowd block is terminal
  per the bound (no further narrow). **Skip the phonetic fringe for a hyper-common component** (GREAT / OUTDOORS):
  phonetic-expanding a saturated everyday word is pure crowd-grind and its `saturation-probe` count stands. Do
  **not** name any phonetic algorithm.
- **Meaning token — same enumeration.** When the saturation probe flagged a `translit-*-meaning` variant,
  run the substring named enumeration on the **field-scoped meaning token** — the everyday-word token scoped
  to the filed in-scope Nice classes (the `nice_classes` × `regions` filter on `register_enumerate`),
  exactly as for the Latin root, the token kept as a contiguous substring predicate. Same completeness
  contract: `enumerated` or `incomplete`, written verbatim, never sampled, never self-cleaned. **Do NOT**
  switch to exact-standalone mode as the enumeration instrument and **do NOT** AND goods-vocabulary words into
  the text — both over-narrow the named band; the lawyer reads the in-class band and judges goods-relevance.

Tag each record's source block via its `query` field (which variant / class / region / match-mode surfaced
it) so judgment sees provenance without the funnel pre-grouping. See
[register-recipes.md](register-recipes.md#recipe-7--exact-in-class-live-floor-saturated-near-exact-band) for the
executable `register_enumerate` recipe. **There is no per-class `confirmed-clean` row to author — the funnel
emits no clearance verdict.** Each block's `enumerated` / `incomplete` state IS the receipt; the lawyer reads
the band and decides sufficiency, commands a narrower enumeration on an `incomplete` it deems material, or
halts.

## Checklist before handing off — unit mode

- [ ] Axis applicability confirmed (or "not applicable" band block written so the file lands)
- [ ] Every named query (exact mark + each manifest variant × in-scope class × material/major jurisdiction) run via **`register_enumerate`** — never manual paginate-then-sample
- [ ] **On a saturated unit (primary-sweep):** the dangerous-category named enumeration run via `register_enumerate` for the **distinctive anchor** — the exact name-list, the distinctive formative-root/dominant-token substring band, and the anchor's field-scoped meaning token (if flagged), **per in-scope major jurisdiction (US/EU/UK/CN/JP) region-scoped, not only worldwide**; the phonetic fringe enumerated. **A COMMON component that is not the anchor (a stripped common word — GREAT / OUTDOORS) is count-only via `saturation-probe`, NOT enumerated or ground here; an all-common-words phrase mark is searched as the exact phrase + near-neighbours.** No sampling, no top-N, no per-class clean verdict — each call's `enumerated`/`incomplete` block written verbatim.
- [ ] Saturation crowds written as **count-only `incomplete` descriptor blocks** (`register_search limit:1`) — NOT enumerated, NOT called clean
- [ ] Every `incomplete` result (crowd / window-cap / provider error) carried forward **verbatim** as an `incomplete` block (count + sample + reason) — never dropped, never re-narrowed-into-clean, never self-accepted
- [ ] Dead records carried forward **with their status** (no date-cutoff drop, no dead-except-identical filter) — `recently-dead` is a status for judgment
- [ ] Mechanical facts only (live/dead status, class membership read off the record) applied; **no** off-field goods drop, **no** relevance/sufficiency/prioritisation call
- [ ] `register-units/<axis>-band.json` written (the named-band array) before return; raw character-noise pile kept in-session
- [ ] Final message = queries-enumerated count + incomplete-block count + records-carried-forward count + band path (no raw records, no clearance verdict)
