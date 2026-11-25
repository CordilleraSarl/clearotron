---
name: clearance-common-law
description: Common-law / marketplace execution for the trademark search workflow. **Run by the driver** — do not call directly. Reads the variant manifest produced by `clearance-variants` and runs structured Perplexity research in two parts: the marketplace grid across the DICTATED platform list plus general web, social, e-commerce and industry press (`grid.md`), and the meaning sweep (`meaning.md`). Produces a common-law findings file that synthesis reads. Runs alongside `clearance-register`.
---

## Spawned session

Run by the driver alongside `clearance-register`. Reads:
- The variant manifest at the path your task message names (produced by `clearance-variants`)
- The request context (classes, jurisdiction scope, industry, manner of use)

Writes:
- A common-law findings file at the path your task message names
- The grid ledger common-law-grid.json is written by the tool. Do not write it.

Returns to the driver: your **final session message** MUST be a 2–3 line summary (call
count, platform coverage, whether the Negative results matrix is present, finding counts) plus
the **absolute path** to the findings file you wrote. **Write the findings file before you return — returning without it is a failure** (the deterministic driver gates on this file: if it is missing after your turn it fails/retries the stage under a fresh session key; a common-law findings file that never lands as a file is lost coverage). Synthesis reads that file, and the skeptic review
checks your coverage. Keep raw Perplexity output in your own session — do
not paste it into the final message (that would defeat the isolation this worker exists for).

Companion files:
- [perplexity-prompts.md](perplexity-prompts.md) — prescriptive Perplexity prompt templates + worked example

## Trigger

Called by `clearance-search` after `clearance-variants` has produced the manifest. Runs alongside `clearance-register` against the same manifest. Not invoked directly by operators.

## Model

The model tier is set **by the deterministic driver** — `driver/stages.mjs` is the
source of truth (currently Haiku, low thinking). This worker is extraction, not open analysis: it
fills templated Perplexity prompts from the manifest and transcribes what Perplexity returns into
the fixed finding taxonomy. The creative variant/strategy work is already done upstream by
`clearance-variants`. Synthesis assesses risk across the search.

## Search approval (HITL exception)

This workflow's searches are pre-approved at workflow trigger time, when the requesting lawyer or a staff lawyer forwards the request email.

Operative rules for this sub-skill (Perplexity-side):
- **Include in queries:** mark name, product type, relevant industry context
- **Strip from queries:** client identity, reference numbers, internal contact names
- Mark names are public-bound (destined for trademark registries); who is asking is confidential.


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
3. If Perplexity worked for some calls and coverage is merely incomplete: that is NOT a
   failure — write the real findings file with honest `coverage-limited` / `deferred` ledger rows
   for the parts that did not run.

## At every step: look at what you have before you work on it

Fifty? Read them all. A few hundred? Sort by the client's goods and markets, read the near ones first, list
the rest. A thousand or more? The field is crowded: read the identical and live ones for the client's
goods, tell the client it is crowded, and do not write up the rest. Carry forward only what a lawyer would
raise with the client. Write down what you set aside and why. This applies to the register's answer, to the
list of records, to the placements, to the off-register sweep and to the write-up alike.
