# Portal terminology map

*One approved term per concept, and the evidence for it..*

This is the map that issue asks for, and it exists because a sweep that shortens strings without settling
the vocabulary leaves the product saying two words for one thing and the next sweep starts over.

**It is enforced.** `test/terminology.test.ts` reads the RETIRED column below and fails when a retired
spelling appears in `portal-ui/src`. Editing this file changes what the suite enforces, so the map cannot
quietly go stale — which is the failure mode predicts for it.

---

## How the figures here were measured

Counts are over **user-visible strings**, not source tokens, because `name` matches `Icon name=`,
`markName` and a dozen props, and a map built on that would be measuring the codebase rather than the
product. The extractor is `test/uiStrings.ts`:

1. comments stripped — a comment explaining a term is not the product saying it;
2. JSX text nodes whose opening `>` is not part of `=>`, carrying no code punctuation;
3. quoted literals containing a space and a lowercase letter, minus SVG path data and CSS class lists.

It walks **every** `.ts`/`.tsx` under `src/`. That walk matters:
scopes this work as *"twelve screens; `AppShell.tsx` and the components"*, which **misses
`nav/nav.config.ts`**, where the navigation labels actually live, and the `contract/` modules where field
hints and lever descriptions are authored centrally. Hand-listing the population is how a sweep misses
the most-read strings in the product.

**The extractor deliberately undercounts.** It drops any string containing code punctuation, so
`` Saved searches{' '} `` and `` `…${label}…` `` do not appear in its corpus at all. It would rather
miss a string than count a token: an overcount publishes a confident wrong figure, an undercount is
visible and stated. Where a count below drives a decision, it was re-taken with a direct search over the
source — and those two figures differ, which is the point of saying so.

**The guard does not use the extractor.** It matches retired spellings over comment-stripped source
instead, precisely because the extractor is too narrow to be a safety net. Every retired spelling below
contains a space, and identifiers do not (`savedSearch`, `SavedSearchRow`, `api.savedSearches`), so the
wider corpus costs no false positives and catches the sites the extractor drops.

**The guard was too narrow twice before it was right**, and both are recorded because the defect class
is the one this repo keeps re-finding — right about the rule, narrow about the population:

1. **Casing.** The row first read *"Saved search / saved searches"* — a capitalised singular beside a
   lowercase plural, matched literally. It never matched a lowercase singular, so `Retire this saved
   search` and six others walked through: **5 sites found of the 12 a direct search showed.** Fixed by
   matching the column case-insensitively and carrying one spelling per row.
2. **Line wrapping.** With casing fixed it found all 12 and reported green — over a **thirteenth** site
   that was live in the tree. JSX prose wraps, and `NewClearance.tsx:1051` read *"…yours to set — the
   saved"* / *"search does not fix it"* across two source lines. No single line held the phrase, so a
   line-by-line matcher saw nothing. **It was found by an unrelated test failing on the same rename, not
   by the guard.** Fixed by matching whole-file with `\s+` between the words.

The second one is the instructive one: a guard that reports clean is not evidence, and this one reported
clean over a real instance until something else tripped over it.

---

## The product's own spine: the navigation labels

The strongest evidence for a canonical term is what a user clicks to reach the thing. `nav/nav.config.ts`
carries thirteen labels, and they are treated here as settled by the product:

```
Home · Clearances · Use your AI · New clearance · Clearance · About
Brand profile · Brand projects · Custom searches
Admin settings · People & access · Global config · Your preferences
```

---

## SETTLED — enforced by the guard

### Custom search

The saved set-up of levers that a brand owner builds and re-runs.

| | |
|---|---|
| **Canonical** | **Custom search** / Custom searches |
| **Retired** | Saved search |

**Why this way round, and it is not a preference.** The product already answers this everywhere a user
navigates or acts:

```
nav/nav.config.ts        label: 'Custom searches'      <- the navigation item
SavedSearches.tsx        "Custom searches"             <- the screen title and its eyebrow
SavedSearches.tsx        "New custom search"           <- the button
SavedSearches.tsx        "No custom searches yet"      <- the empty state
SavedSearches.tsx        "Custom search"               <- the table header
NewClearance.tsx         "Back to Custom searches"     <- both return links
```

Measured over the extractor's corpus: **18 strings say *custom search*, 8 say *saved search*** — and
both screens use both. *Saved search* is residue, not a second concept.

That corpus figure of 8 is the conservative undercount at work: a direct search over the source found
**13** user-visible sites, because `` Saved searches{' '} ``, `` `…${label}…` `` and a phrase wrapped
across two lines all carry punctuation or breaks the extractor drops. All 13 were renamed. Where a
number here drives a decision, the direct figure is the one to trust — which is why both are printed.

**The code keeps its own names.** `savedSearch`, `SavedSearchRow`, `api.savedSearches`,
`contract/savedSearches.ts` and the `?search=` route are untouched. This map governs what the product
says, not what it is called internally; renaming a wire field to satisfy a copy rule would be a much
larger change with none of the benefit.

**`saved-search`, hyphenated, is a live wire value and is deliberately out of scope.**
`driver/enqueue-schema.mjs` freezes it in `GEOGRAPHY_ORIGINS` and `driver/pipeline.mjs` writes it into a
job's `geography.origin`. So the guard's separator is `\s+` and never `[\s-]+`: a guard matching
hyphenated forms would sit one population-widening away from demanding a protocol change to satisfy a
copy rule, which is not a trade a terminology map is entitled to make.

**Three CI browser gates assert on this copy**, and the rename went through all three:
`composer-render-check.mjs` tested the heading text, and `portal-lifecycle-check.mjs:354` selects the
note field by `aria-label === 'Note about this …'` — an exact-match selector that would have found
nothing and failed downstream. All three are inside the guard's population now, so the next renamer is
told rather than finding out from a red build.

**One correction, recorded rather than quietly fixed.** The entry-fork heading landed for in
`d91dd13f` read *"Saved searches · start from one you built"* — the retired term. It was chosen because
the screen already said *"Saved searches"* twenty lines down and because 's own title uses that
wording; neither is evidence about the product's canonical noun, and the wider measurement had not been
taken. Both headings now read **Custom searches**. 's acceptance criterion was *"a tag, a label, or
its own group under its own heading"* — noun-agnostic — so this changes the word, not the fix.

---

## OPEN — measured, NOT ruled

's rules say *"when the existing copy is ambiguous… flag it for product or legal review. Do not
resolve the ambiguity by guessing."* These are flagged, not resolved. The guard does not enforce them.

### Brand owner · Account · Client — three terms, and they are genuinely three things

Not a collision. `UseYourAI.tsx` uses two of them in one breath, as different things:

> *"Access over MCP is scoped to your own account and brand owners."*

| term | count | what it appears to mean |
|---|---|---|
| **Brand owner** | 38 | the organisation whose marks are being cleared |
| **Account** | 12 | the sign-in, enrolment and spend identity — *"enrolled for any account"*, *"spends against your account"*, *"Account menu"* |
| **Client** | 3 | a person who is not staff — an access role. `PeopleAccess.tsx` only |
| **Customer** | 1 | *"balance customer use and quality with cost"*, in the beta notice |

**The finding is not that they conflict — it is that the distinction is never stated.** requires
*"if two terms refer to genuinely different things, make the distinction explicit at their first
meaningful use."* Nothing in the UI tells a reader that their account is not their brand owner, and the
sidebar carries **both** as labels on two different controls. Needs a ruling on where that sentence goes
before any screen is swept.

*Customer* (1 use) names nothing the other three do not; it looks like a stray rather than a fourth
concept, but it sits in a commercial statement about beta pricing, so it is flagged rather than swept.

### Clearance · Search — 48 and 58, both load-bearing

Both are heavily used and they do appear to be different things: a **clearance** is the engagement
(*Clearances*, *New clearance*, *Clearance* are three of the thirteen nav labels), a **search** is the
product that runs inside one. But `NewClearance.tsx` alone says *search* 40 times, and the entry fork
offers *"one of the four searches"* while the screen is called *New clearance*. Whether a customer is
meant to read those as one thing or two is a product question, not a copy question.

### Two terms asks us to standardise that the product does not use at all

An absence, reported as one rather than read as "already consistent":

| term | occurrences in the UI |
|---|---|
| **Search type** | **0** — yet 's *Labels* section recommends it as a label |
| **Result** | **0** — the screen file is `Result.tsx`; no user-visible string says the word |

Both need a ruling: adopt the term, or drop it from the list this map is checked against.

---

## Not yet mapped

The concepts below are on 's minimum list and have not been measured. They belong to the per-screen
sweeps, which that issue says should be split by screen rather than attempted as one change:

Name · Mark · Project · Territory · Country · Region · Worldwide · Goods and services · Class ·
Marketplace · Common-law use · Trademark register · Filing count · Potential conflict · Report · Review ·
Turnaround · Deadline · Native-language search

Nothing here is claimed to be consistent. They are unmeasured, which is a different statement.
