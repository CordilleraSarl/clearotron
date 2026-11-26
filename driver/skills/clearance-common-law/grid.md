# clearance-common-law — GRID

> Read `SKILL.md` first (the shared spine). This file is the marketplace grid: its call budget, its scope, the findings file and the steps that fill it.

## Tool call budget

One grid call per mark, as dictated. Ask a targeted follow-up when its answer could change what you tell the client.
The grid already searches each flagged element on the general web; judge its results.

Do not pass depth. The run's search setting decides the tier of every follow-up; the grid runs on its own tier.

Other tools (file read/write, memory write) are bounded by workflow steps — no cap needed. The audit
workbook is NOT one of them: the driver builds it in code at publish (`driver/publish/xlsx.mjs`) from
the artifacts this stage writes, so there is nothing here to call and nothing to format.

## Scope

### In scope

- Internet-based marketplace searches (Google, Amazon, social media, industry platforms)
- **The dictated platforms** — The grid spec names the stores; the tool runs them. Key rows by the term and platform on the candidates it returns. A gaming profile is one example of such a list — Steam, Epic Games Store, Google Play, Apple App Store, Microsoft Store, itch.io — illustrative only; never substitute the example for the dictated list
- **Field-scoped general search** — the grid has no cell for a field outside the customer's own (the profile's industry — e.g. a collaboration or goods outside it). A search scoped to those goods is made only as a targeted follow-up, under the rule above, when its answer could change what you tell the client. Scope to the specific goods the brief instructs — not a fixed per-field platform list (staff-lawyer redline, Project NOVA PULSE)
- Domain name presence
- Social media presence and commercial use
- Industry press and trade publications
- Conceptual similarity analysis
- PR / reputational risk flagging (separate from trademark risk). Write the PR and reputational section only when this session is assigned the meaning sweep.
- Competitor intelligence (existing brand partnerships in the space)
- Flagging client's prior use when found (noted, not part of risk assessment)
- Enforcement history IF found organically (mention it, don't go looking)

### Out of scope (register-layer concerns)

- USPTO / WIPO / national trademark office database searches — handled by `clearance-register`
- Class-specific register queries
- Register statistics and filing volumes
- Stealth-filing pattern analysis
- Formal enforcement history analysis (organic mentions OK; targeted register-based enforcement search NOT)
- Prior-art register-based analysis

**Bleed rule:** if register information surfaces organically during a common-law search (e.g., a news article mentions a filing), note it briefly. Record each on its own line as CROSS-CHECK REQUIRED: <what> — <why>, mark in capitals; the driver reads only that line. Do not pursue it. The driver records the requested check and its outcome when one is available.

## Output — common-law findings file

Markdown (consistent with the variant manifest and the register findings file). Robust to LLM-write mistakes; auditable; manually editable.

### Format

**Section anchors — copy them verbatim.** Four sections in the template below carry an HTML comment
directly under the heading:

    <!-- clearotron:section=findings -->
    <!-- clearotron:section=negative-results -->
    <!-- clearotron:section=coverage-ledger -->
    <!-- clearotron:section=audit-trail -->

Emit each one exactly as written, on its own line, under its heading. They are how the validator finds
these four sections, so a missing anchor makes it fall back to guessing your heading's wording — which
is how three runs were rejected for sections they had written correctly. They are HTML comments, so
they render as nothing: no reader ever sees them.

**Word the headings however reads best.** The anchor is the contract; the heading text is yours. You do
not need to match the template's wording, and you will not be failed for choosing different words.

```markdown
# Common-law findings — Dusk: Tales of Thornmantle (2026-05-11)

## Summary

- Perplexity calls executed: 3 (1 grid + 2 follow-ups)
- Mandatory platforms covered: [N]/[N] (every dictated platform)
- Findings surfaced: 12 risk-relevant + 3 competitor intel + 1 PR risk
- Open verification flags: 2

## Findings — Mark: Dusk: Tales of Thornmantle
<!-- clearotron:section=findings -->

### Consumer-confusion risks (gaming-industry overlap)

For game-title rows, the `developer_of_record` and `publisher_of_record` columns are MANDATORY (see Step 5b below). Use `not extracted` when the attribution cannot be confirmed from the Perplexity result or the platform metadata — never confabulate.

| Finding | Source / Platform | URL | developer_of_record | publisher_of_record | Type | Notes |
|---|---|---|---|---|---|---|
| "Tales of Dusk" | Steam | https://... | Glimmerhouse | Northgale Interactive | Direct conflict — similar gaming title | "Mostly negative" reviews; commercially active 2013/2015 |
| "Thornmantle" | itch.io | https://... | Thornfall Games | not extracted | Direct conflict — identical game-title | Single-player adventure made for a game-design course brief; little online presence; not reviewed in 7 years |
| "Thornmantle: Of Magic and Power" | Moby Games | https://... | not extracted | not extracted | Direct conflict — historical gaming title | Released 2007; status unavailable; verify-publisher flag set |
| "Thornmantle" Starhollow ARPG | News / web | https://... | Starhollow | not extracted | Direct conflict — gaming title | Browser game; appears cancelled |
| "Ysolde the Thornmantle" | tabletop RPG wiki | https://... | N/A | Grimtable Press | Conceptual — deity name in tabletop RPG | Tabletop, not video game; commercial risk in RPG space |

### Commercial awareness (identical/similar in unrelated fields)

| Finding | Source / Platform | URL | Notes |
|---|---|---|---|
| "Sharpening Your Aim" | Brightwick marketing | https://... | Brightwick uses tagline for gaming hardware; no register protection found (flagged for clearance-register cross-check) |
| 1,600+ "Dusk" titles on Steam | Steam | https://... | Crowded field — supportive evidence |

### Competitor intelligence

| Finding | Source / Platform | URL | Notes |
|---|---|---|---|
| Veltrona "Pulse Aim" portfolio | Veltrona products | https://... | Veltrona uses "Aim" in audio products; flagged for clearance-register cross-check |
| Foxglade "Borealis" console "Sharpen Your Aim" tagline (prior usage) | Foxglade Interactive marketing | https://... | Client's own prior use — note as supportive |

### Negative results
<!-- clearotron:section=negative-results -->

One row per cell, each with its receipt. The gate joins the tool's ledger and checks only that this section exists. The three row
forms (and the gap form):

| Variant | Platform | Result |
|---|---|---|
| Dusk: Tales of Thornmantle | Steam | No results |
| Dusk: Tales of Thornmantle | Epic Games Store | No similar listings (6 candidates reviewed) |
| Dusk: Tales of Thornmantle | Google Play | No results |
| Dusk: Tales of Thornmantle | Apple App Store | No similar listings (3 candidates reviewed) |
| Dusk: Tales of Thornmantle | Microsoft Store | No results |
| Dusk: Tales of Thornmantle | itch.io | Similar listing(s) found — see Findings (2 candidates) |
| Dusk: Tales of Thornmantle | web | No similar listings (8 candidates reviewed) |
| エバーライト | Steam | not executed — coverage-limited (see ledger) |

### Coverage ledger (feeds synthesis coverage-honesty + skeptic audit)
<!-- clearotron:section=coverage-ledger -->

One row per planned coverage unit (each dictated platform; non-Latin / transliteration platform reach), with status + one-line reason. Same three statuses as the register side (see `clearance-register/digest.md` → *Coverage ledger*): `confirmed-clean` (ran to completion), `coverage-limited` (the search **ran and reached the platform** but could not be exhausted — thin data, non-Latin reach), `deferred` (planned but **not run, or the platform/tool could not be reached**). Per the keystone doctrine: a could-not-reach gap (a platform/tool that was unavailable) is `deferred`, never `coverage-limited` — the latter is a searched-but-unexhausted DATA limit. This is the structured form of the Open-verification-flags prose — a `coverage-limited` row is **not** a clean negative downstream.

| Coverage unit | Status | Reason |
|---|---|---|
| dictated platform grid | confirmed-clean | all dictated platforms searched |
| non-Latin platform reach (translit variants) | coverage-limited | marketplace data thin for non-Latin scripts; absence not confirmed clean |

Record the same statuses by calling `record_coverage_status`, passing `grid_spec_path` (the same driver-written spec path the grid tool was given) and one entry per ledger row: its coverage unit, and its status, exactly `confirmed-clean`, `coverage-limited` or `deferred`.

### Register checks requested

Record each on its own line as CROSS-CHECK REQUIRED: <what> — <why>, mark in capitals; the driver reads only that line.

### Audit trail
<!-- clearotron:section=audit-trail -->

| Call # | Type | Prompt summary | Results returned |
|---|---|---|---|
| 1 | Grid (sandbox) | Search-as-code grid: 9 variants × 7 platforms + extras | 63 cells, 0 gaps, 487 candidates recorded; 12 risk-relevant after judgment |
| 2 | Follow-up | Brightwick gaming portfolio + "sharpening your aim" deeper trace | 3 additional findings |
| 3 | Follow-up | Veltrona pulse-aim portfolio | 2 additional findings |

### Open verification flags

- Thornfall Games "Thornmantle" itch.io listing — URL needs re-verification (404'd during follow-up call)
- Brightwick "Sharpening Your Aim" marketing presence in EU — coverage was thin, may need a region-specific follow-up
```

## Process

The steps below per mark.

### Step 1 — Read variant manifest

Open the variant manifest at the path your task message names. Parse:
- Read the matter frame for the request context.
- Per-mark variant tables — these become the search terms in the Perplexity prompt
- Watchlists — used for competitor intelligence framing
- The Elements table's `Famous-mark check` column — the elements Step 3 judges

The variants table is the source of truth for what to search. The skill does NOT generate its own variants — manifest is authoritative.

Transliteration variants are included in the instructed grid like every other variant. A hit on a transliteration needs human confirmation; carry that need in the finding.

### Step 2 — Search-as-code marketplace grid (1 sandbox call per mark)

> **DETERMINISTIC GRID MODE (preferred — use whenever the task message gives you a `grid_spec_path`).**
> Call `perplexity_research` with `grid_spec_path: <the path from the task>`
> and nothing else for the grid. The tool runs EXACTLY the dictated term × platform grid and **writes
> `common-law-grid.json` itself** from the program's stdout. In this mode you do **NOT** author the
> program, you do **NOT** save `common-law-grid.json` (saving it yourself —
> re-emitting ~100 cells through your turn output — is exactly what truncated/dropped cells before), and
> you do **NOT** re-emit the grid JSON. The tool returns the candidate hits that need judgment.
> **This mode changes ONLY the Step-2 grid mechanics — nothing else about common-law.** You STILL do **Step 3 (judge the flagged elements' grid results)**, then judge all candidates — the meaning questions' answers among them — into
> the taxonomy (Step 4) and write the COMPLETE findings file with every section (Findings, famous-mark, Negative
> results matrix, Coverage ledger, Audit trail). Skipping Step 3 leaves the famous-mark section unjudged. The only things you skip are authoring the grid program and
> saving the grid ledger — the tool owns those.

The tool writes the grid ledger and returns how many cells it holds and the candidates to judge. **Trademark-register lookups stay out of scope** — the grid only searches
marketplaces/web (the register layer is `clearance-register`'s).

### Step 3 — Famous-mark judgment, from the grid's results

The manifest's Elements table marks under `Famous-mark check` each element that may also be a well-known brand, band, celebrity, sports team, entertainment property or cultural icon. The grid searched each of them on the general web, so ask no separate question. For each flagged element whose general-web cell your grid ran, judge from its results whether it is a famous mark and whether its fame reaches the client's goods, and record that judgment in the famous-mark section with the results it rests on.

### Step 4 — "What did I miss?" checklist + targeted follow-ups

After the grid call, run the gate:

1. Did I search every individual element of the mark independently (not just as a compound)?
2. Did I check whether any element is a famous brand in entertainment (music, film, gaming)?
3. Did I check for entertainment-to-gaming crossover partnerships involving any element?
4. Are there any dual-meaning terms where a descriptive reading may be masking a trademark?
5. For compound marks: would the average consumer recognise any element as a brand name?

If an answer is "no" or "unsure" and closing it could change what you tell the client, fire a targeted `perplexity_research` follow-up focused on the specific gap.

### Step 5 — Judge the grid output into structured tables

The grid call returns recorded candidates, not judged findings — **the legal filtering is yours.**
For every cell in the candidate list the grid call returns, review its candidates: identical / confusingly similar /
conceptually related listings become findings; plain noise (unrelated products that merely share a
common word) does not. List each identifiable name found. Put summaries of searches that found no relevant name in the negative-results section, with their receipts. Then categorise each finding into one of:

- **Consumer-confusion risks** — overlap in the product's field(s): gaming, **and the collaborated / non-gaming field for collab matters**; identical/similar mark in same product space; direct or near-direct competitors
- **Commercial awareness** — identical/similar in unrelated fields; crowded field evidence; competitor intelligence (existing brand partnerships)
- **Competitor intelligence** — watchlist matches; existing partnerships major brands have in the space
- **PR / reputational risk** — the meaning read of the mark AND its near-forms, scoped by the run's OWN dictated sweep: the fixed meaning / slang / gang / offensive / lookup shapes plus the matter frame's derived `Meaning angles:` queries (cultural origin/appropriation, charged history of the term or its imagery, category-specific controversy — as THIS matter's frame reasoned them). Never a generic sensitivities checklist — the scope IS the dictated sweep. NOT scored on legal-risk framework — separate category. **Every recorded query with results carries a ruling recorded through `record_dispositions`, whatever this section concludes** — reporting a loaded reading does not discharge the rest of the sweep (see the PR / reputational risk contract in `meaning.md`). `None identified` is additionally a clean *receipt* ONLY when the meaning sweep ran — cite a `Connotation-search source:` line; the driver rejects an unsearched clean claim (`connotation_search_missing`) and refuses the turn while any ruling is unrecorded (the `connotation_call_*` family). A dictionary gloss is never a clearance. Write the PR and reputational section only when this session is assigned the meaning sweep.
- **Negative results** — **one row for EVERY grid cell**, **plus rows for the field-scoped cells** (collab / non-gaming goods) when run. **Each row carries its receipt:** `No results` (the search returned nothing), `No similar listings (N candidates reviewed)` (returned N candidates, none prima facie similar), `Similar listing(s) found — see Findings (N candidates)` (the cell produced findings), or `not executed — coverage-limited (see ledger)` (the cell is in the grid's `gaps` — never a clean negative).
- **Register checks requested** — Record the register checks this search calls for, in the format above (every common-law owner found → ONE register check)

**100% URL coverage is mandatory.** Every finding row must have a clickable URL. If a finding cannot be verified with a URL, mark it as an Open verification flag and note the source.

**Citation quality:** prefer primary sources (Steam store page > news article; official company website > Wikipedia article; app store listing > review site).

### Step 5b — Extract developer_of_record / publisher_of_record on every game-title finding (MANDATORY)

For every Consumer-confusion-risks row that is a **game title** (Steam game, Microsoft Store game, App Store game, Google Play game, itch.io title, etc.), the row MUST include two extracted attribution fields: **`developer_of_record`** (the studio that built the game) and **`publisher_of_record`** (the entity that publishes / distributes it under its banner). Both fields are required columns in the Consumer-confusion-risks table.

**Extraction sources, in priority order:**
1. The Perplexity result's explicit "developed by X" / "published by Y" statement, when present
2. **The platform's own record of the thing** — whatever that platform publishes about who made it, when it appeared and how large it is. A store's developer / publisher metadata is the familiar case (Steam, Microsoft Store and the app stores expose these as structured fields), and it is an EXAMPLE rather than the set: a platform that is not a store still keeps a record, in page metadata or on a public endpoint of its own, and it is read the same way. Open it before writing that the owner is unknown.
3. The game's Wikipedia article's infobox developer / publisher row, when the platform page is ambiguous

**"Not extracted" is written with the source OPEN and the field genuinely absent.** Record what you read, including the reading that came back empty; `not extracted` after a look is a finding, and `not extracted` instead of a look is a gap the reader has to close by hand.

**When the attribution cannot be extracted:**
- Write **`not extracted`** as the field value
- Add the candidate to the Open verification flags section with the specific gap
- DO NOT GUESS by inferring from prior-frequent gaming companies (Bandai Namco, Tencent, Capcom, Behold Studios, etc.) — even when the title's genre or style suggests a likely publisher, leave the field as `not extracted` rather than confabulating

The downstream `placement-inquiry` stage will place any game-title with `developer_of_record: not extracted` at **sheet-2** with a verify-publisher flag — never at headline-candidate. The `narrative-refutation` gate (Phase 2 Step 4.7) will flag in the audit workbook any case where the orchestrator's narrative names a publisher / developer that doesn't trace back to one of these extracted fields.

This requirement applies even when the model running this skill is at the Haiku tier (per the live workflow config). Treat `developer_of_record` and `publisher_of_record` as required, unambiguous columns; mark them `not extracted` when uncertain rather than confabulating.

### Step 6 — Compile common-law findings file

Assemble common-law-findings.md at the path your task message names, per the format above. Sections (in order):

1. **Summary** — call counts, platform coverage, finding counts
2. **Consumer-confusion risks** — gaming-industry overlap
3. **Commercial awareness** — unrelated-field + crowded-field
4. **Competitor intelligence** — watchlist + partnerships
5. **PR / reputational risk** (or "None identified"). Write the PR and reputational section only when this session is assigned the meaning sweep.
6. **Negative results** — one row per grid cell
7. **Coverage ledger** — one row per planned coverage unit (`confirmed-clean`/`coverage-limited`/`deferred`); the structured form of the open-verification prose, consumed by synthesis + the skeptic
8. **Register checks requested** — Record the register checks this search calls for, in the format above.
9. **Audit trail** — Perplexity call log
10. **Open verification flags** — URL-404s, thin-coverage regions, transliteration confirmations needed

## Checklist before handing off

- [ ] Variant manifest read; all marks accounted for
- [ ] Search-as-code grid call executed; the tool holds the receipt.
- [ ] The grid ledger common-law-grid.json is written by the tool. Do not write it.
- [ ] Negative results matrix has one receipt-carrying row per grid cell
- [ ] Do not pass depth. The run's search setting decides the tier of every follow-up; the grid runs on its own tier.
- [ ] Famous-mark check judged for every flagged element from its general-web results (or "None" documented)
- [ ] Post-search 5-question checklist run; any "no/unsure" gaps closed via follow-up calls
- [ ] Every DICTATED platform appears in the audit trail
- [ ] Every finding has a URL (or is in Open verification flags)
- [ ] Findings categorised: consumer-confusion / commercial-awareness / competitor-intel / PR-risk
- [ ] **Every game-title finding in Consumer-confusion-risks has both `developer_of_record` and `publisher_of_record` columns populated** — with the extracted value when known, or the literal string `not extracted` when uncertain. Never confabulated.
- [ ] Negative results documented for every grid cell
- [ ] Coverage ledger emitted — one row per planned coverage unit; non-Latin / thin-data reach logged `coverage-limited`, not silently clean
- [ ] Register checks requested section populated
- [ ] Open verification flags listed (URL-404s, thin coverage, transliteration confirmations)
- [ ] Common-law findings file written at the path your task message names
- [ ] No client identity, reference numbers, or contact names in any submitted Perplexity prompt
