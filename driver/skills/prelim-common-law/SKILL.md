---
name: prelim-common-law
description: Common-law / marketplace execution for the v3 preliminary trademark search workflow. **Invoked exclusively by the `prelim-search` orchestrator** — do not call directly. Reads the variant manifest produced by `prelim-variants` and runs structured Perplexity research across the DICTATED platform list (the task message's PLATFORMS block names the exact store domains for this customer; the gaming default is 6 stores) plus general web, social, e-commerce, and industry press. Produces a common-law findings file consumed by the orchestrator for synthesis and Excel assembly. Runs alongside `prelim-register`.
---

## Spawned session

Invoked from `prelim-search` (orchestrator) alongside `prelim-register`. Reads:
- The variant manifest at `studio/prelim-search/<slug>/<date>/variant-manifest.md` (produced by `prelim-variants`)
- The request context (classes, jurisdiction scope, industry, manner of use)

Writes:
- A common-law findings file at `studio/prelim-search/<slug>/<date>/common-law-findings.md`
- **The machine grid ledger** at `studio/prelim-search/<slug>/<date>/common-law-grid.json` — the grid
  call's stdout JSON saved **verbatim** (a single stdout object, or a JSON array of the per-batch
  stdout objects in batch order when the grid is batched). Copy it exactly as the tool returned it —
  no reformatting, no re-typing, no judging. **The driver validates grid completeness from this file**
  (exact join against the dictated grid keys), not from your markdown matrix; a missing or hand-retyped
  ledger fails the stage.

Returns to the orchestrator: your **final session message** MUST be a 2–3 line summary (call
count, platform coverage, whether the Negative results matrix is present, finding counts) plus
the **absolute path** to the findings file you wrote. **Write the findings file before you return — returning without it is a failure** (the deterministic driver gates on this file: if it is missing after your turn it fails/retries the stage under a fresh session key; a common-law findings file that never lands as a file is lost coverage). The orchestrator reads your completion payload to locate and synthesise from that file and
checks your coverage in its skeptic review. Keep raw Perplexity output in your own session — do
not paste it into the final message (that would defeat the isolation this worker exists for).

Companion files:
- [perplexity-prompts.md](perplexity-prompts.md) — prescriptive Perplexity prompt templates + worked example

## Trigger

Called by `prelim-search` after `prelim-variants` has produced the manifest. Runs alongside `prelim-register` against the same manifest. Not invoked directly by operators.

## Model

The model tier is set **by the deterministic driver** — `driver/stages.mjs` is the
source of truth (currently Haiku, low thinking). This worker is extraction, not open analysis: it
fills templated Perplexity prompts from the manifest and transcribes what Perplexity returns into
the fixed finding taxonomy. The creative variant/strategy work is already done upstream by
`prelim-variants` (Opus), and the cross-cutting risk synthesis is the orchestrator's (Opus). If the
orchestrator's skeptic review (prelim-search Step 2.6) finds this worker shortcut the manifest's
coverage, it is re-spawned escalated to Opus.

## Tool call budget

Per input mark:
- `perplexity_research` calls: **5** (1 search-as-code grid call + up to 3 targeted follow-ups + any
  famous-mark query flagged by the manifest)

Per workflow run total: **15** (covers multi-mark requests).

**Every call passes an explicit `depth`** — see the routing table at the top of
[perplexity-prompts.md](perplexity-prompts.md). *(Budget rationale: cost-based overflow protection
against a looping worker — a full grid call ≈ $0.06, follow-ups ≈ $0.01–0.15 each, measured
2026-06-10. The old "Perplexity Pro rate-limit headroom" rationale is obsolete: the plugin is
API-key billed.)*

Other tools (file read/write, memory write) are bounded by workflow steps — no cap needed. The audit
workbook is NOT one of them: the driver builds it in code at publish (`driver/publish/xlsx.mjs`) from
the artifacts this stage writes, so there is nothing here to call and nothing to format.

## Search approval (HITL exception)

The full HITL exception covering this workflow is declared **once** in the orchestrator at [prelim-search/SKILL.md](../prelim-search/SKILL.md#hitl-exception-shared-across-sub-skills). It is pre-approved at workflow trigger time when the requesting lawyer or a staff lawyer forwards the request email.

Operative rules for this sub-skill (Perplexity-side):
- **Include in queries:** mark name, product type, relevant industry context
- **Strip from queries:** client identity, reference numbers, internal contact names
- Mark names are public-bound (destined for trademark registries); who is asking is confidential.

See the orchestrator for the canonical policy text and rationale.

## Failure protocol — a dead marketplace layer FAILS the run, never ships

The common-law layer is a main source of the deliverable. A report must never go out without it,
so there is **no partial-delivery fallback**:

1. The `perplexity_research` tool retries transient failures internally (plugin-level backoff). If a
   call still errors, you may retry it **once** yourself.
2. If `perplexity_research` is genuinely unavailable (persistent errors / rate-limited) and you have
   **no usable results**: write **NO findings file at all**. Do not write a "partial results" or
   "could not be completed" file — a findings file is a claim that the layer ran. End your turn with
   a final message reporting the tool failure and the exact errors seen. The driver detects the
   missing file, re-runs the stage on a fresh session, and — if the layer still cannot run — fails
   the whole run and surfaces it. That is the correct outcome.
3. If Perplexity worked for some calls and the budget/coverage is merely incomplete: that is NOT a
   failure — write the real findings file with honest `coverage-limited` / `deferred` ledger rows
   for the parts that did not run.

## Scope

### In scope

- Internet-based marketplace searches (Google, Amazon, social media, industry platforms)
- **The dictated mandatory platforms** — your task message's PLATFORMS block names the exact store domains for this customer's profile; every one is mandatory for every variant (the receipts gate validates count AND identity against that list). A gaming profile is one example of such a list — Steam, Epic Games Store, Google Play, Apple App Store, Microsoft Store, itch.io — illustrative only; never substitute the example for the dictated list
- **Field-scoped general search** — when the matter goes outside the customer's core field (the profile's industry — e.g. a collaboration or goods outside it), a general internet search **scoped to the collaborated / actual goods** is also mandatory (e.g. a gaming × pizza collab → search the web generally for *pizza*). The dictated platform list is the floor; extend with field-scoped cells when the matter goes outside the customer's core field. Scope to the specific goods the brief instructs — not a fixed per-field platform list (staff-lawyer redline, Project NOVA PULSE)
- Domain name presence
- Social media presence and commercial use
- Industry press and trade publications
- Conceptual similarity analysis
- PR / reputational risk flagging (separate from trademark risk)
- Competitor intelligence (existing brand partnerships in the space)
- Flagging client's prior use when found (noted, not part of risk assessment)
- Enforcement history IF found organically (mention it, don't go looking)

### Out of scope (register-layer concerns)

- USPTO / WIPO / national trademark office database searches — handled by `prelim-register`
- Class-specific register queries
- Register statistics and filing volumes
- Stealth-filing pattern analysis
- Formal enforcement history analysis (organic mentions OK; targeted register-based enforcement search NOT)
- Prior-art register-based analysis

**Bleed rule:** if register information surfaces organically during a common-law search (e.g., a news article mentions a filing), note it briefly and flag it in the findings file's `Cross-checks suggested` section. Do not pursue it — the orchestrator hands such flags to `prelim-register` for cross-pollination.

## Output — common-law findings file

Markdown (consistent with the variant manifest and the register findings file). Robust to LLM-write mistakes; auditable; manually editable.

### Format

```markdown
# Common-law findings — Dawn: Legends of Thornmantle (2026-05-11)

## Summary

- Perplexity calls executed: 4 (1 grid + 1 famous-mark + 2 follow-ups)
- Mandatory platforms covered: [N]/[N] (every dictated platform)
- Findings surfaced: 12 risk-relevant + 3 competitor intel + 1 PR risk
- Open verification flags: 2

## Findings — Mark: Dawn: Legends of Thornmantle

### Consumer-confusion risks (gaming-industry overlap)

For game-title rows, the `developer_of_record` and `publisher_of_record` columns are MANDATORY (see Step 5b above). Use `not extracted` when the attribution cannot be confirmed from the Perplexity result or the platform metadata — never confabulate.

| Finding | Source / Platform | URL | developer_of_record | publisher_of_record | Type | Notes |
|---|---|---|---|---|---|---|
| "Chronicles of Ember" | Steam | https://... | Dreamatrix | Topware Interactive | Direct conflict — similar gaming title | "Mostly negative" reviews; commercially active 2013/2015 |
| "Thornmantle" | itch.io | https://... | Thornfall Games | not extracted | Direct conflict — identical game-title | Single-player adventure, "made for SAE Studio 2 Home Brief"; little online presence; not reviewed in 7 years |
| "Thornmantle: Of Magic and Power" | Moby Games | https://... | not extracted | not extracted | Direct conflict — historical gaming title | Released 2007; status unavailable; verify-publisher flag set |
| "Thornmantle" Astragate ARPG | News / web | https://... | Astragate | not extracted | Direct conflict — gaming title | Browser game; appears cancelled |
| "Ysolde the Thornmantle" | Pathfinder wiki | https://... | N/A | Grimtable Press | Conceptual — deity name in tabletop RPG | Tabletop, not video game; commercial risk in RPG space |

### Commercial awareness (identical/similar in unrelated fields)

| Finding | Source / Platform | URL | Notes |
|---|---|---|---|
| "Raising Your Play" | HP marketing | https://... | HP uses tagline for gaming hardware; no register protection found (flagged for prelim-register cross-check) |
| 1,600+ "Dawn" titles on Steam | Steam | https://... | Crowded field — supportive evidence |

### Competitor intelligence

| Finding | Source / Platform | URL | Notes |
|---|---|---|---|
| Sony "Pulse Elevate" portfolio | Sony products | https://... | Sony uses "Elevate" in audio products; flagged for prelim-register cross-check |
| Aurora "Borealis" console "Raise Your Play" tagline (prior usage) | Aurora Interactive marketing | https://... | Client's own prior use — note as supportive |

### PR / reputational risk

Covers the core element(s) **and their plausible near-forms** (the connotation hazard often rides a
near-form — `sureña` ("southerner") → `Sureño` = a gang term — not the literal mark). `(None identified)` may be written
**only when the searched social/subcultural web came back empty** — never on a dictionary gloss. "It just
means *southern*" is context, not a clearance: a connotation reads clean only when Urban-Dictionary / Wikipedia
/ news / forums were searched (on the near-forms too) and surfaced nothing.

**Surface what the meaning search actually returned — a receipt is not a read.** Even when your call is clean, do **not** collapse the meaning sweep to a bare `(None identified)`: for the mark **and each near-form**, name the actual readings the search surfaced and label each benign or loaded (e.g. `sureña → "southerner" (geographic, benign); Sureño → a Southern-California street gang (loaded)`). You are an extraction worker — lay out what the social/subcultural web actually returned per form; you do **not** make the final clearance call. The strong synthesis layer reads that material and decides whether a loaded secondary reading needs pulling. A row that only says "searched, nothing found" hands synthesis a verdict instead of the evidence it needs to look past the obvious gloss.

| Finding | Source | Notes |
|---|---|---|
| meaning readings surfaced | Urban Dictionary / Wikipedia / news / forums | per form, the readings the search returned + benign/loaded label — e.g. `ELEVATE → ordinary verb "raise" (benign)`; near-forms `RAIZE / RAYSE → no slang/gang/offensive reading`. Write `(None identified)` as the *bottom line* only after the readings are laid out and none is loaded. |

A clean PR/connotation row MUST cite its search — add a `**Connotation-search source:** <URL | "perplexity_research — no result">` line. The driver dictates the meaning sweep into the grid (the mark + near-forms × meaning shapes) and the plugin records every query into the ledger's `extras.pr_risk[]`; the `commonLaw` validator rejects a `(None identified)` claim with no recorded queries (`connotation_search_missing`). An empty-results search is a clean receipt; a *missing* search is not.

The dictated sweep has TWO halves, and this section's scope is exactly that sweep — never a generic
sensitivities checklist. Half one: the driver's fixed query shapes (mark + near-forms × meaning / slang /
gang / offensive / lookup shapes). Half two: the matter frame's per-matter derived angles (its
`Meaning angles:` line — the cultural origin and communities the word evokes, charged historical or
political associations of the term or its imagery, category-specific controversy for these goods). Derived
queries are floor-equal citizens: recorded into `extras.pr_risk[]` and policed by the same identity join —
weigh their results with the same seriousness as the fixed shapes'.

**Receipts disposition (machine-enforced). You send VALUES through a tool; you never write or edit a
file for this.** When the grid tool returns, its result lists every meaning obligation you owe — one row
per recorded meaning query that returned results: the query itself, and under it that query's own
candidate receipts, numbered. Record every ruling by calling `record_dispositions`, passing
`grid_spec_path` (the same driver-written spec path the grid tool was given — never a path you compose)
and `rows`, one entry per obligation:

- `row_index` — the NUMBER printed beside that obligation in the obligations block: 1 for the first,
  2 for the second, and so on. **Not an id, and not the query text.** The block prints no identifier for
  a row and never has; the number beside it is the address;
- `receipt_index` — the POSITION of the candidate you ruled on in that row's own list: 1 for the first,
  2 for the second, and so on. Not its id. **You never type an identifier here**, and you never retype a
  query, a title or a URL — the driver resolves the position to the id and records it for you. A row
  listed with exactly ONE receipt is already resolved: give it only your `ruling` and `note`;
- `ruling` — exactly one of `benign`, `off-topic`, `loaded`, `inconclusive`;
- `note` — one line: what the receipt says and why it reads that way. An `inconclusive` row's note owes
  something different — what you could not establish, and what a human should look at;
- `segment_index` and `fragment` — **both required on every row the tool's answer marks as owing them**,
  and only those. They are TWO SEPARATE JOBS and supplying one is not supplying the other:
  - `segment_index` says **which** passage. The receipt you ruled on carries its snippet split into
    numbered passages; give the number of the one you relied on. It is checked only for being in range,
    so there is always an answer.
  - `fragment` is **optional and never refused.** The driver copies the passage into the record from the
    number alone, so the number is the whole obligation. If a few characters of that passage come easily,
    send them and they are recorded as a check on transcription; if the script is one you cannot
    reproduce, omit it. **Do not translate** — a translation is not a copy, and an empty field is better
    than a wrong one.
  **It does not have to mention the mark.** The check is that the text you point at is really in that
  passage, not that the receipt is about the mark. A row owing these whose fragment does not occur in the
  passage it names is not counted as ruled, and the stage fails while any remain; if the material seems
  off-topic, point at it anyway and rule it `off-topic`.
- `obstacle` — **only when you cannot evidence a row at all**, and never instead of judging it. One line
  saying what stops you: the passages are elision markers with nothing quotable in them, the snippet is
  truncated mid-word, the text you need is not in any passage of the receipt you ruled on. Send it
  **alongside** your `ruling` and `note`, not in place of them. The row is then recorded as undecided,
  with your sentence shown to the reviewing lawyer in place of proof, and the stage completes instead of
  stalling on it.
  **Try first.** Pointing at a passage is checked only for being in range, and a fragment only for
  occurring in the passage you named — a few characters is enough and any passage with text in it will
  do. A row where some passage is quotable is a row you can discharge, and one production run spent 217
  calls on a receipt that was quotable seven different ways. `obstacle` is for the receipt that genuinely
  offers nothing, not for the one that is awkward.

Rows are validated as they arrive, per row: rows that validate are KEPT even when others in the same
call are refused, and the answer names each refusal, every obligation still outstanding, and which of
them owe a `segment_index` and `fragment`. Send up to the per-call limit and the rest in a further call — you never have to
guess whether you are finished, and you stop when the answer reports nothing outstanding.

**Two kinds of row.** Most are `kind: "query"` — one query, its candidates, and you choose which one
you ruled on. Some are `kind: "recurrence"`, and they differ in three ways:

- **`queries` is a LIST**, not one string: every distinct query that surfaced this same result. Four or
  more distinct queries promotes a result to load-bearing *by recurrence* — the sweep kept finding it,
  whatever any single query concluded — and this row forces that receipt onto the page.
- **The receipt is already chosen.** One candidate, resolved by the driver, and no `receipt_index` to
  give. You rule on a named result, you do not select one.
- **You still owe `ruling` and `note`.** The note says what the result is and why it reads that way
  across the queries that kept returning it.

**If the material does not support a confident ruling, say so — do not improvise, do not leave it
out.** `off-topic` only when it genuinely is. When it is on-topic but you cannot responsibly call it
`benign` or `loaded` from what the receipt shows — contested sources, material serious enough that a
guess is worse than a gap, a snippet too thin to judge — rule `inconclusive` and use the note to state
plainly what you could not establish and what a human should look at. `inconclusive` raises it to a
Finding exactly as `loaded` does, which is where an unresolved reputational question belongs. A confident
`benign` on material you could not assess is the one outcome no gate detects and no reader recovers from.
This is about the JUDGMENT, and it stays the answer for one you cannot make — `obstacle` above is a
different thing entirely, for a row you have judged and cannot prove you read.

**`loaded` and `inconclusive` are different answers, and the report prints them apart.** `loaded` is a
judgment you made — the reading is charged, and your note says what the material is and why it reads
that way. `inconclusive` is a judgment you declined to make — your note says what you could not
establish. Both reach the reader as a Finding; what changed is that the reader can now tell which one
you handed them. Do not reach for `inconclusive` to duck a call you can make: an open question a human
must chase costs more than a ruled row, and the value is worth having only while it means what it says.

Declining to improvise is correct, and the contract carries it: a seat that will not invent rulings on
gang names or abuse-ring material is doing the right thing.

**Your rulings accumulate across calls and across attempts:** the driver folds each accepted row into
its own record, so a row you have ruled on stays ruled and a corrective turn never re-earns work you
have already done. Nothing is transcribed anywhere: you never retype a query, a title or a URL, and you
never author, edit or save any dispositions file — the one route a ruling can take is the tool call.

The driver renders these into the canonical findings file as the PR / reputational disposition table, so
do **not** hand-write that table. This section still carries your own narrative, and a charged reading
still becomes a Finding — whether you ruled it `loaded` or declined it as `inconclusive`.

A query LIST without a ruling is not a disposition — a delivered run listed every query it ran and still
reported clean past a recorded cultural-appropriation article sitting in its own receipts. The validator
judges the recorded rulings against the same obligation list the tool computed, and rejects the turn
while **any** row is unruled, whatever this section concludes. Reporting a loaded reading does not
discharge the other queries; the two are different facts and only the second is what the gate
establishes. Queries whose recorded results are empty get no row at all — the empty receipt is itself
the clean evidence.

**Why a tool, and what the failure tokens mean.** A disposition used to name its receipt by retyping
text the validator matched back out — and on the measured evidence ten of fourteen refusals were a
correct ruling thrown away over the shape of its citation; later, one hand-typed 140 KB document lost 74
correct rulings to a single typographic quote. The typed call ends the class: the machine writes
everything that has to be exact, and you supply only the judgment. These tokens can reach you, and they
mean different things:

- `connotation_call_never_made` — rulings are owed and `record_dispositions` was never called this run.
  Rulings written into your findings prose are not read by this check. Call the tool.
- `connotation_call_partial` — rows landed and obligations remain. Everything recorded is KEPT; send
  only what the answer lists as outstanding.
- `connotation_call_truncated` — a call was killed in flight before its rows were recorded. The
  driver's fault, not yours: re-send that chunk as it was, and never re-derive your rulings.
- `connotation_call_schema_violation` — calls arrived and no row was accepted: the payload SHAPE is
  wrong. `rows` is an array of objects with integer `row_index`, `ruling`, `note`, integer
  `receipt_index`.
- `connotation_form_damaged` — a recorded row's receipt is no longer one of that row's own candidates
  (a ledger top-up can re-deal a row's candidates). Re-send only the named row(s) with
  `receipt_index` set to a position; never type an id.
- `connotation_quote_unbound` — **the row is ruled and accepted; only its evidence did not join.**
  Re-send only the named row(s) with the evidence corrected and nothing else changed. The tool's own
  answer names which of the two fields is wrong, and they have different remedies:
  - `segment_absent` / `segment_invalid` — no passage number, or a number that is not one of that
    receipt's passages. Give a number in the range the answer states.
  - `fragment_absent` / `fragment_too_short` — nothing copied out of the passage, or too few characters
    to show you read it. Copy a few more.
  - `fragment_unbound` — what you copied does not occur in the passage you named. **Do not rephrase and
    do not translate**: copy the characters out of THAT passage exactly as they are written.

A spot-checked row is where you show you read the receipt. Only a few rows per run carry it and the driver
picks which, so it is never a transcription tax on the whole sweep — and because the passage number does
the finding, the copied characters can be short in any script.

**One passage — never stitch two together.** Your `fragment` has to occur inside the ONE passage your
`segment_index` names, so characters taken from two adjacent passages with the numbering dropped between
them will not join, even though both halves are verbatim. This is what the numbering is for: `1. …。 2. …。`
is two passages, and you name one and copy from it. It used to be easiest to get wrong where the script has
no inter-word spaces, because a stitch reads as continuous there — that is now a number, not a judgement.

### Negative results (per-platform per-variant — the full grid accounting)

**One row for EVERY (variant × platform) grid cell**, each carrying its receipt. The three row
forms (and the gap form) — this is what the driver's receipt gate counts:

| Variant | Platform | Result |
|---|---|---|
| Dawn: Legends of Thornmantle | Steam | No results |
| Dawn: Legends of Thornmantle | Epic Games Store | No similar listings (6 candidates reviewed) |
| Dawn: Legends of Thornmantle | Google Play | No results |
| Dawn: Legends of Thornmantle | Apple App Store | No similar listings (3 candidates reviewed) |
| Dawn: Legends of Thornmantle | Microsoft Store | No results |
| Dawn: Legends of Thornmantle | itch.io | Similar listing(s) found — see Findings (2 candidates) |
| Dawn: Legends of Thornmantle | web | No similar listings (8 candidates reviewed) |
| RAIZ8 | Steam | No results |
| エバーライト | Steam | not executed — coverage-limited (see ledger) |
| (... full term × platform matrix ...) | | |

### Coverage ledger (feeds synthesis coverage-honesty + skeptic audit)

One row per planned coverage unit (each mandatory platform; the field-scoped general search; non-Latin / transliteration platform reach), with status + one-line reason. Same three statuses as the register side (see `prelim-register/SKILL.md` → *Coverage ledger*): `confirmed-clean` (ran to completion), `coverage-limited` (the search **ran and reached the platform** but could not be exhausted — thin data, non-Latin reach), `deferred` (planned but **not run, or the platform/tool could not be reached**). Per the keystone doctrine: a could-not-reach gap (a platform/tool that was unavailable) is `deferred`, never `coverage-limited` — the latter is a searched-but-unexhausted DATA limit. This is the structured form of the Open-verification-flags prose — a `coverage-limited` row is **not** a clean negative downstream.

| Coverage unit | Status | Reason |
|---|---|---|
| dictated platform grid | confirmed-clean | all dictated platforms searched, term-by-term |
| field-scoped general search (collab / non-gaming goods) | confirmed-clean | run per matter scope |
| non-Latin platform reach (translit variants) | coverage-limited | marketplace data thin for non-Latin scripts; absence not confirmed clean |

### Cross-checks suggested (handed to orchestrator for prelim-register dispatch)

| Trigger | Suggested cross-check |
|---|---|
| HP appears using "RAISING YOUR PLAY" | Check register: does HP have any elevate-related trademark in target classes? |
| Sony "Pulse Elevate" portfolio | Check register: any Sony elevate filings in target classes? |
| Thornfall Games "Thornmantle" (itch.io) | Check register: any Thornfall trademark protection? |

### Audit trail

| Call # | Type | Prompt summary | Results returned |
|---|---|---|---|
| 1 | Grid (sandbox) | Search-as-code grid: 9 variants × 7 platforms + extras | 63 cells, 0 gaps, 487 candidates recorded; 12 risk-relevant after judgment |
| 2 | Famous-mark | None flagged in manifest | (not run) |
| 3 | Follow-up | HP gaming portfolio + "raising your play" deeper trace | 3 additional findings |
| 4 | Follow-up | Sony pulse-elevate portfolio | 2 additional findings |

**Grid program receipt** — the executed sandbox program returned by the tool, verbatim:

```python
# (paste the SANDBOX PROGRAM block from the grid call's tool result here)
```

### Open verification flags

- Thornfall Games "Thornmantle" itch.io listing — URL needs re-verification (404'd during follow-up call)
- HP "Raising Your Play" marketing presence in EU — coverage was thin, may need a region-specific follow-up
```

## Process

Four steps per mark.

### Step 1 — Read variant manifest

Open `studio/prelim-search/<slug>/<date>/variant-manifest.md`. Parse:
- Request context: marks, classes, jurisdiction, industry, manner of use
- Per-mark variant tables — these become the search terms in the Perplexity prompt
- Watchlists — used for competitor intelligence framing
- Diligence notes — informs how aggressive to be on saturated common words
- `Famous-mark Perplexity calls needed` section — triggers Step 3

The variants table is the source of truth for what to search. The skill does NOT generate its own variants — manifest is authoritative.

**Transliteration variants** (rows tagged `translit-<script>` with `Verify? ✅`) get included in the grid call's SEARCH TERMS like every other variant (the program searches them on every platform), but findings on these get carried through with the `Verify?` flag to the findings file.

### Step 2 — Search-as-code marketplace grid (1 sandbox call per mark)

> **DETERMINISTIC GRID MODE (preferred — use whenever the task message gives you a `grid_spec_path`).**
> Call `perplexity_research` with `enable_sandbox: true` and `grid_spec_path: <the path from the task>`
> and nothing else for the grid. The tool runs EXACTLY the dictated term × platform grid and **writes
> `common-law-grid.json` itself** from the program's stdout. In this mode you do **NOT** author the
> program from the template below, you do **NOT** save `common-law-grid.json` (saving it yourself —
> re-emitting ~100 cells through your turn output — is exactly what truncated/dropped cells before), and
> you do **NOT** re-emit the grid JSON. The tool returns the candidate hits that need judgment.
> **This mode changes ONLY the Step-2 grid mechanics — nothing else about common-law.** You STILL run
> **Step 3 (famous-mark follow-ups)** and the **extras** (competitor-intel / PR-risk / crowded-field)
> exactly as normal, then judge all candidates into the taxonomy (Step 4) and write the COMPLETE findings
> file with every section (Findings, famous-mark, extras, Negative results matrix, Coverage ledger, Audit
> trail). Skipping Step 3 or the extras leaves the deliverable missing a core search layer and the
> pre-delivery lint will HOLD client export. The only things you skip are authoring the grid program and
> saving the grid ledger — the tool owns those. The program template and the verbatim-save step below are
> the **LEGACY path**, used only when the task gives no `grid_spec_path`.

**The marketplace sweep is ONE `perplexity_research` call with `enable_sandbox: true` and
`depth: "pro-search"`** — Perplexity's sandbox runs a *program* that executes a real search for
every (variant × platform) cell and returns per-cell receipts plus the executed code. Use the
**Search-as-code marketplace grid** template in [perplexity-prompts.md](perplexity-prompts.md),
filling in:

- ALL variants from the Variants table (the program's SEARCH TERMS array)
- Every store domain in the task message's PLATFORMS block + the general-web cell (never a remembered list)
- **Field-scoped general-web cells (mandatory when the matter goes outside the customer's core field):** one extra cell per term
  combining it with the collaborated / actual goods the brief instructs — e.g. for a gaming × pizza
  collab, `"<term> pizza"` cells. Scope to the specific goods, not a fixed per-field platform list
  (staff-lawyer redline, Project NOVA PULSE).
- The extras searches: competitor-intel probes from the manifest's watchlists, PR-risk probes per
  core element, crowded-field probes per pattern

The tool returns the program's stdout JSON (`cells` + `extras` + `gaps`) and the program code as an
audit receipt. **Trademark-register lookups stay out of scope** — the grid only searches
marketplaces/web (the register layer is `prelim-register`'s).

**LEGACY path only (no `grid_spec_path` given) — immediately after the grid call(s): save the stdout
JSON verbatim** to `studio/prelim-search/<slug>/<date>/common-law-grid.json` — one call → the stdout
object as-is; batched calls → a JSON array of the per-batch stdout objects, in batch order. This is a
copy operation, not a writing task: the bytes the tool returned, unmodified. The deterministic driver
validates the grid by exact join on this file (machine receipts) — the markdown Negative results
matrix remains your judged, human-readable view, but it is not what the gate counts.
*(In deterministic grid mode the tool already wrote this file — do not write it.)*

### Step 3 — Famous-mark follow-ups (1 per flagged element)

If the manifest's `Famous-mark Perplexity calls needed` section lists any elements, fire a lightweight fast query per element using the famous-mark template in [perplexity-prompts.md](perplexity-prompts.md). Budget: 1 fast call per flagged element, within the 4-per-mark cap.

If multiple elements need famous-mark checks, combine into one query: "Is X a brand name, band name, sports team...? Is Y? Is Z?"

### Step 4 — "What did I miss?" checklist + targeted follow-ups

After the grid call (and any famous-mark calls), run the gate:

1. Did I search every individual element of the mark independently (not just as a compound)?
2. Did I check whether any element is a famous brand in entertainment (music, film, gaming)?
3. Did I check for entertainment-to-gaming crossover partnerships involving any element?
4. Are there any dual-meaning terms where a descriptive reading may be masking a trademark?
5. For compound marks: would the average consumer recognise any element as a brand name?

If any answer is "no" or "unsure," fire a targeted `perplexity_research` follow-up (`depth: "pro-search"`) focused on the specific gap. Budget: up to 3 follow-up calls per mark (5 total per mark including the grid call + any famous-mark calls).

### Step 5 — Judge the grid output into structured tables

The grid call returns recorded candidates, not judged findings — **the legal filtering is yours.**
For every cell in the stdout JSON, review its candidates: identical / confusingly similar /
conceptually related listings become findings; plain noise (unrelated products that merely share a
common word) does not. Then categorise each finding into one of:

- **Consumer-confusion risks** — overlap in the product's field(s): gaming, **and the collaborated / non-gaming field for collab matters**; identical/similar mark in same product space; direct or near-direct competitors
- **Commercial awareness** — identical/similar in unrelated fields; crowded field evidence; competitor intelligence (existing brand partnerships)
- **Competitor intelligence** — watchlist matches; existing partnerships major brands have in the space
- **PR / reputational risk** — the meaning read of the mark AND its near-forms, scoped by the run's OWN dictated sweep: the fixed meaning / slang / gang / offensive / lookup shapes plus the matter frame's derived `Meaning angles:` queries (cultural origin/appropriation, charged history of the term or its imagery, category-specific controversy — as THIS matter's frame reasoned them). Never a generic sensitivities checklist — the scope IS the dictated sweep. NOT scored on legal-risk framework — separate category. **Every recorded query with results carries a ruling recorded through `record_dispositions`, whatever this section concludes** — reporting a loaded reading does not discharge the rest of the sweep (see the PR / reputational risk contract above). `None identified` is additionally a clean *receipt* ONLY when the meaning sweep ran — cite a `Connotation-search source:` line; the driver rejects an unsearched clean claim (`connotation_search_missing`) and refuses the turn while any ruling is unrecorded (the `connotation_call_*` family). A dictionary gloss is never a clearance.
- **Negative results** — **one row for EVERY variant × platform grid cell** (the full grid accounting the driver's receipt gate counts), **plus rows for the field-scoped cells** (collab / non-gaming goods) when run. **Each row carries its receipt:** `No results` (the search returned nothing), `No similar listings (N candidates reviewed)` (returned N candidates, none prima facie similar), `Similar listing(s) found — see Findings (N candidates)` (the cell produced findings), or `not executed — coverage-limited (see ledger)` (the cell is in the grid's `gaps` — never a clean negative).
- **Cross-checks suggested** — register-side checks the orchestrator should dispatch to `prelim-register` (every common-law owner found → ONE register check)

**100% URL coverage is mandatory.** Every finding row must have a clickable URL. If a finding cannot be verified with a URL, mark it as an Open verification flag and note the source.

**Citation quality:** prefer primary sources (Steam store page > news article; official company website > Wikipedia article; app store listing > review site).

### Step 5b — Extract developer_of_record / publisher_of_record on every game-title finding (MANDATORY)

For every Consumer-confusion-risks row that is a **game title** (Steam game, Microsoft Store game, App Store game, Google Play game, itch.io title, etc.), the row MUST include two extracted attribution fields: **`developer_of_record`** (the studio that built the game) and **`publisher_of_record`** (the entity that publishes / distributes it under its banner). Both fields are required columns in the Consumer-confusion-risks table.

**Extraction sources, in priority order:**
1. The Perplexity result's explicit "developed by X" / "published by Y" statement, when present
2. The platform store page's developer / publisher metadata (Steam, Microsoft Store, App Store all expose these as structured fields)
3. The game's Wikipedia article's infobox developer / publisher row, when the platform page is ambiguous

**When the attribution cannot be extracted:**
- Write **`not extracted`** as the field value
- Add the candidate to the Open verification flags section with the specific gap
- DO NOT GUESS by inferring from prior-frequent gaming companies (Bandai Namco, Tencent, Capcom, Behold Studios, etc.) — even when the title's genre or style suggests a likely publisher, leave the field as `not extracted` rather than confabulating

The downstream orchestrator's `placement-inquiry` (Phase 2 Step 2C) will place any game-title with `developer_of_record: not extracted` at **sheet-2** with a verify-publisher flag — never at headline-candidate. The `narrative-refutation` gate (Phase 2 Step 4.7) will BLOCK delivery if the orchestrator's narrative names a publisher / developer that doesn't trace back to one of these extracted fields.

This requirement applies even when the model running this skill is at the Haiku tier (per the live workflow config). Treat `developer_of_record` and `publisher_of_record` as required, unambiguous columns; mark them `not extracted` when uncertain rather than confabulating.

### Step 6 — Compile common-law findings file

Assemble `studio/prelim-search/<slug>/<date>/common-law-findings.md` per the format above. Sections (in order):

1. **Summary** — call counts, platform coverage, finding counts
2. **Consumer-confusion risks** — gaming-industry overlap
3. **Commercial awareness** — unrelated-field + crowded-field
4. **Competitor intelligence** — watchlist + partnerships
5. **PR / reputational risk** (or "None identified")
6. **Negative results** — full variant × platform matrix
7. **Coverage ledger** — one row per planned coverage unit (`confirmed-clean`/`coverage-limited`/`deferred`); the structured form of the open-verification prose, consumed by synthesis + the skeptic
8. **Cross-checks suggested** — the register-side hand-offs to the orchestrator
9. **Audit trail** — Perplexity call log
10. **Open verification flags** — URL-404s, thin-coverage regions, transliteration confirmations needed

## Checklist before handing off

- [ ] Variant manifest read; all marks accounted for
- [ ] Search-as-code grid call executed for every mark (sandbox program receipt captured in audit trail)
- [ ] **`common-law-grid.json` exists** — deterministic mode: the TOOL wrote it (you passed `grid_spec_path`, you did NOT save it). Legacy mode (no `grid_spec_path`): you saved the grid stdout JSON VERBATIM (single object, or JSON array per batch in order). Either way the driver's machine-receipts join validates THIS file
- [ ] Negative results matrix has one receipt-carrying row per (variant × platform) grid cell
- [ ] Every `perplexity_research` call passed an explicit `depth` (routing table in perplexity-prompts.md)
- [ ] Famous-mark calls executed for every manifest-flagged element (or "None" documented)
- [ ] Post-search 5-question checklist run; any "no/unsure" gaps closed via follow-up calls
- [ ] Every DICTATED platform appears in the audit trail (term-by-term — the list from your task message's PLATFORMS block)
- [ ] Field-scoped general search for collaborated / out-of-field goods logged (when the matter goes outside the customer's core field)
- [ ] Every finding has a URL (or is in Open verification flags)
- [ ] Findings categorised: consumer-confusion / commercial-awareness / competitor-intel / PR-risk
- [ ] **Every game-title finding in Consumer-confusion-risks has both `developer_of_record` and `publisher_of_record` columns populated** — with the extracted value when known, or the literal string `not extracted` when uncertain. Never confabulated.
- [ ] Negative results documented for every variant × platform combination
- [ ] Coverage ledger emitted — one row per planned coverage unit; non-Latin / thin-data reach logged `coverage-limited`, not silently clean
- [ ] Cross-checks suggested section populated
- [ ] Open verification flags listed (URL-404s, thin coverage, transliteration confirmations)
- [ ] Common-law findings file written to `studio/prelim-search/<slug>/<date>/common-law-findings.md`
- [ ] Perplexity budget under workflow cap (15 calls)
- [ ] No client identity, reference numbers, or contact names in any submitted Perplexity prompt
