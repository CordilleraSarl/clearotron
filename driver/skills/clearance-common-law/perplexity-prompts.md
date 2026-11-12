# Perplexity prompts

Templates for the `perplexity_research` calls in `clearance-common-law`. Prompts are **prescriptive, not exploratory** — they tell Perplexity exactly what to search for, where, and how to report.

## Depth routing (mandatory)

Do not pass depth. The run's search setting decides the tier of every follow-up; the grid runs on its own tier.

## Search-as-code marketplace grid (Step 2)

ONE call executes the whole variant × platform grid as a **program** in Perplexity's sandbox. The
program's stdout is the deliverable; the executed code comes back as an audit receipt. This is what
makes every "no results" row a *real executed search*, not a claim.

**Deterministic-grid mode (the default when the profile has platforms):** you do NOT author this program.
The driver writes `grid-spec.json` — including a `connotation.queries` list: the matter frame's meaning
questions, as it wrote them — and the `perplexity_research` tool BUILDS and runs the program itself, recording the marketplace
cells AND the connotation/meaning queries into the ledger's `extras.pr_risk[]`.
In this mode the connotation contract is identical: the meaning sweep RUNS and every
query is recorded, and a clean PR claim with no recorded search is rejected (`connotation_search_missing`).

### What comes back, and what you do with it

The tool writes the grid ledger, then returns how many cells it holds and the candidates to judge. Then:

0. The grid ledger common-law-grid.json is written by the tool. Do not write it.
1. **Judge each cell's candidates yourself** — identical / confusingly similar / conceptually
   related vs. plain noise. The program recorded everything; the legal filtering is yours.
2. **Negative matrix rows carry the receipt**: a cell with `no_hit` → "No results"; a cell whose
   candidates are all noise → "No similar listings (N candidates reviewed)". Never an unexplained
   blank.
3. **Every `gaps` entry becomes a `coverage-limited` ledger row** (the cell did NOT run — that is
   unsearched, never clean).
4. If the tool returns `ERROR: sandbox was not used` or a stdout-parse error, retry the call once;
   if it persists, follow the skill's Failure protocol (no findings file, declare the failure).

## Follow-up calls

After the grid call, review results against the variant manifest:
- Did any cell land in `gaps` that a single targeted search could close?
- Does a headline-relevant game title need `developer_of_record` / `publisher_of_record`
  attribution that the candidate name+URL didn't carry? (e.g. "who develops and publishes
  [TITLE] ([URL])")
- Did an unexpected finding surface that warrants deeper investigation?

If gaps exist, fire a targeted `perplexity_research` call focused on the specific gap.

## Citation quality

Always prefer primary sources:
- Actual Steam store page > news article about the game
- Official company website > Wikipedia article about the company
- App store listing > review site mentioning the app
- Direct URL to the entity > secondary write-up

**100% URL coverage is required.** Every finding in the deliverable must have a clickable URL. If a finding cannot be verified with a URL, note the source and flag it as unverified.
