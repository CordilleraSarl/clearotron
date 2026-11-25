---
name: clearance-register
description: Register-side execution for the trademark search workflow. **Run by the driver** — do not call directly. Runs in one of two modes the driver selects: unit mode (`unit.md`) runs one search axis and hands up the complete named band; digest mode (`digest.md`) judges the merged band and hands back the register findings. This spine holds what both modes share.
---

## Spawned session

The driver dispatches you in one of two modes, named in your opening message. Your mode's own file holds what that mode does.

Reads (both modes): the variant manifest at `studio/clearance-search/<slug>/<date>/variant-manifest.md` (archetype + risk
theory), the `matter-context.md` at `studio/clearance-search/<slug>/<date>/matter-context.md` (Phase 0 strategic anchor — names materially-matters jurisdictions, watchlist-owner seeds, off-field sectors), the request context, the active **provider**. The **watchlist-owner seeds are enrichment / additive-surfacing context, not a search or priority filter** — an in-class identical/near-identical incumbent surfaces on field-relevance alone whether or not its owner is named (see `digest.md` Step 5).

Returns to the driver: your **final session message** — a 2–3 line summary of counts. Keep raw character-noise records out of the message and out of any
upward summary; keep clearance verdicts out of the unit message (verdicts are Layer B's).

Companion files:
- [register-recipes.md](register-recipes.md) — archetype playbooks (one per archetype + modifier patterns)
- [status-rules.md](status-rules.md) — live-status keep-list, Madrid handling, Chinese-status normalisation
- [stealth-filer-indicators.md](stealth-filer-indicators.md) — law-firm / stealth-filer owner detection
- [providers/corsearch.md](providers/corsearch.md) — Corsearch-specific operator vocabulary
- [providers/clarivate.md](providers/clarivate.md) — Clarivate-specific operator vocabulary + its capability gaps

## Model

Set by the driver per mode:

- Unit mode — `saturation-probe` uses `haiku`, with thinking off, for count-only work. `primary-sweep` uses `opus`, with adaptive thinking, to run the plan, read its answers, and decide which further searches could change the advice. `transliteration-numeric` and `incumbent-class` use `sonnet`, with adaptive thinking.
- **Digest mode** — The driver selects the model.

Register units execute searches and decide which further questions could change the advice. The primary sweep uses the judgment model for that decision. The digest assesses the evidence carried forward. The driver selects each stage's model; a unit does not choose its own replacement.

## Provider

Set by the driver via `provider` — **exactly one register per run**: Corsearch, Clarivate, Signa, or
EUIPO. Operator vocabulary and field names live in `providers/<name>.md`; the universal logic in THIS
SKILL.md applies whichever sits behind the neutral `register_*` tools. There is no second register and
no cross-check alongside it: where the active provider's coverage does not reach a territory, that is a
**deferred coverage row** you disclose, never a gap you fill from elsewhere.

**EUIPO covers the EU alone.** Running it makes every non-EU territory a deferred row — a known limit of that register, not a fault. Sandbox and production hold different corpora and must never be
mistaken — so the DRIVER records which answered, on every receipt in `_driver/receipts.json`.
Never tag it in the findings.

## At every step: look at what you have before you work on it

Fifty? Read them all. A few hundred? Sort by the client's goods and markets, read the near ones first, list
the rest. A thousand or more? The field is crowded: read the identical and live ones for the client's
goods, tell the client it is crowded, and do not write up the rest. Carry forward only what a lawyer would
raise with the client. Write down what you set aside and why. This applies to the register's answer, to the
list of records, to the placements, to the off-register sweep and to the write-up alike.

## Read the identical mark first. Look at the count before you read anything

On every matter the identical mark, in the instructed classes, is the first thing you read, and nothing
wider is asked until you have read it. The register tells you how many filings answer a question before it
hands you any. Take a look: how bad is it? If the list is one you can read record by record, read it in
full. If it is not, do not read it and do not leave it: narrow the same question, in this order, until it
is, then read that list in full and decide. Each step keeps the limits of the steps before it. Stop at the first
step that gives you a list you can read.

1. Ask again for the identical mark, in the instructed classes, limited to the client's goods words. Read
   that list.
2. Still a crowd? Ask again with the dominant goods word alone, then one class at a time, in the instructed
   classes. Read each list.
3. Still a crowd? Ask again one question per market, from the one list your opening message names. Read those
   lists.
4. Still a crowd after step 3? The narrowing ends. Record it with its count: the field is crowded there.

A list you have read answers the crowd it came from. Do not ask that crowd again without the limits that answered
it.

A small list for a longer mark or narrower goods does not establish that a distinct root or sound-alike family adds nothing. Judge what that family could add to the advice and record the reason. Where no count is held, do not describe the family as a measured crowd.

The same steps serve any other question that comes back as a crowd, when reading it would change what you tell the client. Before you narrow a wider crowd, write in the proposal what reading it would change. If you cannot, set it aside with its count and your reason. You need not take every step on every crowd. A wider crowd that the lists you have read already
answer is set aside with its count and your reason. That is finished work, not a gap. The countries the identical
mark's market step did not read stay on its coverage row with their count, as today.

Once the identical mark for the client's goods has been read, decide as a lawyer would whether you have enough. Would more searching change what you tell the client: who could object, how weak the word is in this market, or what the client should do? If it would, widen one step, read, and decide again. If it would not, you are done. Write in one line why more searching would not change the advice, record which questions you did not ask and why, and move on. That is complete work.

Every question you ask is recorded with its count. A narrowing replaces nothing silently: the crowd it
replaces stays on the record with its count. What was counted and not read is set aside with that count,
never marked clean.

The families you did not open are recorded `withheld-by-judgment`
with your reason — not `confirmed-clean`, which would claim a search nobody ran, and not
`coverage-limited`, which says the engine tried and could not finish. You chose where the work was best
spent; say so, and say which questions you did not ask.

When you narrow a crowded question, name the crowd it replaces: put its qid on the proposal as
`narrows`. The record then shows the crowd and the question that answered it side by side, each with
its own count. A narrowing that does not name what it replaced leaves the crowd looking unanswered.
