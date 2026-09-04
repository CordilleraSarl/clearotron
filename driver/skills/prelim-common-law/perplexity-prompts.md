# Perplexity prompts

Templates for the `perplexity_research` calls in `prelim-common-law`. Prompts are **prescriptive, not exploratory** — they tell Perplexity exactly what to search for, where, and how to report.

## Depth routing (mandatory)

Every `perplexity_research` call in this skill MUST pass an explicit `depth`. Never rely on the
plugin's auto-detection (it guesses from prompt formatting and routes grid-shaped prompts to the most
expensive tier).

| Call | `depth` | Other params |
|---|---|---|
| Search-as-code marketplace grid (Step 2) | `pro-search` | `enable_sandbox: true` |
| Famous-mark query (Step 3) | `fast-search` | — |
| Targeted follow-ups (Step 4) | `pro-search` | — |

## Search-as-code marketplace grid (Step 2)

ONE call executes the whole variant × platform grid as a **program** in Perplexity's sandbox. The
program's stdout is the deliverable; the executed code comes back as an audit receipt. This is what
makes every "no results" row a *real executed search*, not a claim.

Call `perplexity_research` with `enable_sandbox: true`, `depth: "pro-search"`, and the task below.
Fill the bracketed sections from the variant manifest (every variant row, including transliteration
variants — tag their findings `Verify? ✅` downstream).

**Probe-validated constraints (2026-06-10 — do not loosen):**
- The SDK result object supports **iteration and attribute access only** — the pinned access idiom
  below is mandatory (slicing or `dict()` makes every cell silently fail into gaps).
- The program records **up to 8 candidates per cell without judging similarity** — filtering is YOUR
  job afterwards, with legal judgment, not the program's string logic.
- The model must **never re-emit the program output in its message** (re-transcription is lossy — a
  full term vanished in probe testing); the confirmation line is derived from parsed stdout.

### Task template

```
Write and run a sandbox program that executes a marketplace search grid for a proposed trademark.

SEARCH TERMS ([N]): [JSON array of every variant from the manifest's Variants table]

PLATFORMS ([M]): domain-restricted search for each store domain in YOUR TASK MESSAGE's
PLATFORMS block (dictated per customer — copy that list verbatim; a gaming profile is one example:
["store.steampowered.com", "store.epicgames.com", "play.google.com", "apps.apple.com",
"apps.microsoft.com", "itch.io"]), plus one unrestricted general-web search per term
(platform name "web").
[IF the matter goes outside the customer's core field — collab / out-of-field goods:]
Additionally, for each search term run one general-web search of the term combined with
"[COLLABORATED GOODS, e.g. pizza]" (platform name "web-field:[goods]").

For EVERY (term, platform) cell run a web search and record up to 8 returned candidate listings —
record what the search returns, do NOT filter or judge similarity in code.

Access the search results EXACTLY like this (the result object supports iteration and attribute
access only — no slicing, no dict()):

    hits = pplx_sdk.search.web(term, limit=10, domains=[platform])   # omit domains= for web cells
    results = []
    for h in hits:
        if len(results) >= 8: break
        results.append({"name": h.title or "", "url": h.url or ""})

status = "hit" if results else "no_hit". Wrap each cell in try/except; on exception append to gaps
the string "<term> | <platform> | <repr of the exception>". Do not skip any cell.

AFTER the grid, the same program runs the CONNOTATION searches (same access idiom, up to 8 results
each, recorded raw into extras.pr_risk — the ONLY extras key with a consumer; the old
competitor_intel / crowded_field extras are RETIRED: nothing ever read them):
- pr_risk: search offensive / subcultural / controversial associations on BOTH (a) each core element AND
  (b) its plausible NEAR-FORMS — the edit-1 / transliteration / homophone forms from `form-neighbourhood.json`
  (`elements[].band.exactQueries` + `.transliterations`) that read as a real word, name, or plausible term in
  any in-scope market language (e.g. `ZURENA` → `Sureño`). A near-form that is a real word/term in a market is
  a connotation candidate — search it; never pre-drop one as "unlikely" (connotation is not mechanically
  enumerable, so you search the candidates, you do not filter them). Per term run TWO queries: "[TERM]
  controversy offensive association" AND "[TERM] meaning slang". **Weight subcultural / social / community web
  — Urban Dictionary, Wikipedia, news, forums — NOT just dictionaries:** the hazard (e.g. "Sureño" = a
  Southern-California gang) lives on the social web, never in a lexical entry. **A dictionary gloss ("it just
  means southern") is context, NEVER a clearance** — a connotation reads CLEAN only when the searched social/web
  sources came back empty, never because a dictionary looked benign.
The program prints EXACTLY one JSON object to stdout:
{"cells": [{"term", "platform", "status", "results": [{"name", "url"}]}],
 "extras": {"pr_risk": [{"query", "results": [...]}]},
 "gaps": ["<term> | <platform> | <error>"]}

Your final message after the program runs must be ONLY one line, derived from the PARSED stdout:
"GRID: <len(cells)> cells, <len(gaps)> gaps" — do NOT repeat the JSON.
```

**Deterministic-grid mode (the default when the profile has platforms):** you do NOT author this program.
The driver writes `grid-spec.json` — including a `connotation.queries` list it dictates from the mark + its
near-forms — and the `perplexity_research` tool BUILDS and runs the program itself, recording the marketplace
cells AND the connotation/meaning queries into the ledger's `extras.pr_risk[]`. The template above governs only
the no-profile fallback path. Either way the connotation contract is identical: the meaning sweep RUNS and every
query is recorded, and a clean PR claim with no recorded search is rejected (`connotation_search_missing`).

### What comes back, and what you do with it

The tool returns: the stdout JSON (cells + extras + gaps) → the **SANDBOX PROGRAM audit receipt**
(the exact code that ran) → a metadata footer (tokens, cost). Then:

0. **Save the stdout JSON verbatim to `common-law-grid.json` first** (machine receipts — see the
   skill's Writes section): the object exactly as returned; batched grids → a JSON array of the
   batch objects in order. Do this BEFORE judging — it is the driver's validation substrate, and a
   re-typed/reformatted copy defeats it.
1. **Judge each cell's candidates yourself** — identical / confusingly similar / conceptually
   related vs. plain noise. The program recorded everything; the legal filtering is yours.
2. **Negative matrix rows carry the receipt**: a cell with `no_hit` → "No results"; a cell whose
   candidates are all noise → "No similar listings (N candidates reviewed)". Never an unexplained
   blank.
3. **Every `gaps` entry becomes a `coverage-limited` ledger row** (the cell did NOT run — that is
   unsearched, never clean).
4. **The program code goes in the audit trail** (fenced block or summarized reference with the cell
   count) — it is the proof of what executed.
5. If the tool returns `ERROR: sandbox was not used` or a stdout-parse error, retry the call once;
   if it persists, follow the skill's Failure protocol (no findings file, declare the failure).

## Famous-mark query (triggered by manifest's `Famous-mark Perplexity calls needed` section)

`depth: "fast-search"` — this is a knowledge lookup, not deep research. Escalate to `pro-search`
only if the fast answer is empty or ambiguous. Combine multiple flagged elements into one query.

```
"Is [ELEMENT] a brand name, band name, entertainment property, sports team,
or well-known cultural entity? Does [ELEMENT] have trademark filings or 
a trademark portfolio? Any connections to gaming, software, digital 
entertainment, or [SPECIFIC INDUSTRY CONTEXT]? Look for: trademark 
portfolios, gaming collaborations, brand licensing deals, entertainment 
crossovers, merchandise. Include any recent filings or expansion into 
computer game software (Class 9)."
```

## Follow-up calls

`depth: "pro-search"`. After the grid call, review results against the variant manifest:
- Did any cell land in `gaps` that a single targeted search could close?
- Does a headline-relevant game title need `developer_of_record` / `publisher_of_record`
  attribution that the candidate name+URL didn't carry? (e.g. "who develops and publishes
  [TITLE] ([URL])")
- Did an unexpected finding surface that warrants deeper investigation?

If gaps exist, fire a targeted `perplexity_research` call focused on the specific gap. Budget: up
to 3 follow-up calls per mark (5 total per mark including the grid call and any famous-mark call).

## Citation quality

Always prefer primary sources:
- Actual Steam store page > news article about the game
- Official company website > Wikipedia article about the company
- App store listing > review site mentioning the app
- Direct URL to the entity > secondary write-up

**100% URL coverage is required.** Every finding in the deliverable must have a clickable URL. If a finding cannot be verified with a URL, note the source and flag it as unverified.
