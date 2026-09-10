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
   that was live in the tree. JSX prose wraps, and one line of `NewClearance.tsx` read *"…yours to set — the
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
Home · Use your AI · People · New clearance · Clearances · Clearance · About
Profile · Projects · Custom searches
Admin settings · Global config · Your preferences
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
`composer-render-check.mjs` tested the heading text, and `portal-lifecycle-check.mjs` selects the note
field by `aria-label === 'Note about this …'` — an exact-match selector that would have found
nothing and failed downstream. All three are inside the guard's population now, so the next renamer is
told rather than finding out from a red build.

**One correction, recorded rather than quietly fixed.** The entry-fork heading landed for in
`d91dd13f` read *"Saved searches · start from one you built"* — the retired term. It was chosen because
the screen already said *"Saved searches"* twenty lines down and because its own title uses that
wording; neither is evidence about the product's canonical noun, and the wider measurement had not been
taken. Both headings now read **Custom searches**. That acceptance criterion was *"a tag, a label, or
its own group under its own heading"* — noun-agnostic — so this changes the word, not the fix.

### Company

The business whose names are being checked. Every clearance, report, project and custom search belongs
to exactly one.

| | |
|---|---|
| **Canonical** | **Company** / Companies |
| **Retired** | Brand owner / the client / this client / a client's |

**Ruled by the owner, 2026-09-09**, against mockups he approved — not measured into existence like the
Custom search row above. The evidence that made it a ruling rather than a preference: an outside user met
*brand owner*, did not know whether it meant him, and configured the product by hand instead. The term
means nothing outside trademark practice, and it is the first noun a stranger meets.

**Organisation is the other half of the same ruling** and is not a retirement, because the product had no
word for it at all. It names the firm or company running the installation, it appears in the top bar and
nowhere else, and it is deliberately NOT in the table above: there is no retired spelling to enforce, so
a row here would be a rule with nothing to catch.

Both words are on screen at once, which is exactly how a sweep gets one of them wrong. *Company* is what
you are looking at; *Organisation* is who you are.

**The code keeps its own names**, on the same rule the Custom search row states: `account`, `accounts`,
`?account=`, the `brand.*` screen ids and routes, the CSS classes
`owner-name` and `owner-count`, the `cordillera-clearances-group-by-owner` storage key, and
`demo-brand-owner` in the package manifest are untouched. 167 of the 428 raw `account` hits sit in
`contract/`, which is the wire; a sweep that took them would have rewritten the API and passed CI.

---
---

## OPEN — measured, NOT ruled

's rules say *"when the existing copy is ambiguous… flag it for product or legal review. Do not
resolve the ambiguity by guessing."* These are flagged, not resolved. The guard does not enforce them.

### Account · Client · Customer · Tenant — four words left, and only one has been ruled on

*Brand owner* left this table on 2026-09-09; it is settled above and the guard enforces it. What it
leaves behind is the half the ruling deliberately did not touch, re-measured here rather than carried
over — the old figures in this row were stale, and both strings it quoted as evidence are gone from the
tree.

Counts are over the extractor's corpus, taken 2026-09-09, with a direct source search where the
extractor is known to drop a string:

| term | count | what it appears to mean |
|---|---|---|
| **Company** | 36 | the canonical term, ruled — listed for scale, not as an open question |
| **Account** | 11 | the sign-in, enrolment and spend identity — *"this account has not been granted access"* |
| **Client** | 0 visible | RULED and gone from copy, and the access-role identifier went with it: the portal reads two permissions, `canRun` and `canManage` |
| **Customer** | 3 | the deployment's own operator language — *"a server setting on this deployment"* |
| **Tenant** | 1 | *"all of this tenant"*, one pill on People & access. The extractor drops it; a direct search finds it |
| **Organisation** | 1 | the top-bar label, ruled |

**Why three of these are still open, and why *Client* no longer is.** The earlier reasoning here was
that all four are the access model's own vocabulary and that model was parked pending a decision on one
privilege model. **That decision has been taken** — an owner design session replaced the two role words
with access points and two permissions — so the reason for parking *Client* has gone with it.

What was ruled is the NOUN a reader meets: the party a firm acts for is the **company**, and the phrases
that called it a client are retired above and enforced. The access-role identifier that stood beside
it is gone too: the portal decides nothing by a role word, and the wire carries two permissions.

*Account*, *Customer* and *Tenant* stay open for the reason below: they are single words and live
identifiers, and the ruling that replaces them is a change to the wire rather than to copy.

**Why *Account* is not in the Retired column, stated rather than left for the next reader to rediscover.**
The guard scans comment-stripped source, and that is only safe while every retired spelling contains a
space, because identifiers do not. *Account*, *Client*, *Customer* and *Tenant* are all single words and
all live identifiers — `me.accounts`, `?account=`, `person.tenant`. Retiring them here would flag
several hundred identifiers, and narrowing the guard to the extractor's corpus to compensate would trade
a real safety net for one that states its own inadequacy at the top of `uiStrings.ts`.

So the instrument is chosen per row rather than per table. Multi-word spellings are enforced by the guard
over the wide corpus. The one visible *Account* that was actually wrong — the top-bar label over a slot
that rendered the organisation for staff and the company for a client — was fixed under the same ruling
and is pinned by a named assertion in `test/shell.test.ts`, which exercises the derivation rather than
scanning for a word. A single-word retirement needs that kind of arm, not a row here.

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
| **Search type** | **0** — yet the *Labels* section recommends it as a label |
| **Result** | **0** — the screen file is `Result.tsx`; no user-visible string says the word |

Both need a ruling: adopt the term, or drop it from the list this map is checked against.

---

## Not yet mapped

The concepts below are on the minimum list and have not been measured. They belong to the per-screen
sweeps, which that issue says should be split by screen rather than attempted as one change:

Name · Mark · Project · Territory · Country · Region · Worldwide · Goods and services · Class ·
Marketplace · Common-law use · Trademark register · Filing count · Potential conflict · Report · Review ·
Turnaround · Deadline · Native-language search

Nothing here is claimed to be consistent. They are unmeasured, which is a different statement.
