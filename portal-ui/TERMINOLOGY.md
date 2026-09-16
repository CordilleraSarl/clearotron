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
Home · Connect your AI · People · New clearance · Clearances · Clearance · About
Profile · Projects · Search templates
Admin settings · Installation settings · Your preferences
```

---

## SETTLED — enforced by the guard

### Search template

The saved set-up — which search, and how deep it goes — that a company builds once and re-runs.

| | |
|---|---|
| **Canonical** | **Search template** / Search templates |
| **Retired** | Saved search / Custom search |

**Ruled by the design of 2026-09-16**, and it supersedes the measured answer below rather than
contradicting it. The rebuilt New clearance screen names the thing where a reader meets it — a
*Search templates* dropdown with *Manage*, *Save as template* in the sticky bar, *Clear template* under
the search list — and the Company settings screens name the page *Search templates* with *New template*
as its action. One design, one noun, on every surface a reader crosses between the two.

**It moved everywhere at once, because half a rename is two words.** The composer is where a template is
applied and saved, and the page its *Manage* opens is where it is listed and retired. Renaming the
composer and leaving the rail, the page title and its empty state for later would have shipped a screen
that says *Search templates* and a page, one click away, that says *Custom searches* — the exact state
this map exists to end. So the navigation label, the page, the composer and the three browser checks
that assert on this copy changed together, and *Custom search* joined *Saved search* in the Retired column,
where the guard enforces it.

**What came before, and why it is kept.** *Custom search* was the canonical term by measurement, not by
ruling: the product's own navigation already said it. The measurement is recorded because the method
still holds — count what a reader is shown, and trust the direct search over the extractor where they
differ.

**Why it was Custom search then.** The product already answered it everywhere a user navigated or acted:

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

The business whose names are being checked. Every clearance, report, project and search template belongs
to exactly one.

| | |
|---|---|
| **Canonical** | **Company** / Companies |
| **Retired** | Brand owner / the client / this client / a client's |

**Ruled by the owner, 2026-09-09**, against mockups he approved — not measured into existence like the
Custom search row once was. The evidence that made it a ruling rather than a preference: an outside user met
*brand owner*, did not know whether it meant him, and configured the product by hand instead. The term
means nothing outside trademark practice, and it is the first noun a stranger meets.

**Organisation is the other half of the same ruling** and is not a retirement, because the product had no
word for it at all. It names the firm or company running the installation, it appears in the top bar and
nowhere else, and it is deliberately NOT in the table above: there is no retired spelling to enforce, so
a row here would be a rule with nothing to catch.

Both words are on screen at once, which is exactly how a sweep gets one of them wrong. *Company* is what
you are looking at; *Organisation* is who you are.

**The code keeps its own names**, on the same rule the Search template row states: `account`, `accounts`,
`?account=`, the `brand.*` screen ids and routes, the CSS classes
`owner-name` and `owner-count`, the `cordillera-clearances-group-by-owner` storage key, and
`demo-brand-owner` in the package manifest are untouched. 167 of the 428 raw `account` hits sit in
`contract/`, which is the wire; a sweep that took them would have rewritten the API and passed CI.

---
---

### Organisation · Company

The two words, and the only two. **Organisation** is who owns the installation or the account;
**Company** is whose names are cleared. Neither does the other's work.

| | |
|---|---|
| **Canonical** | **Organisation** (who owns the installation) / **Company** (whose names are cleared) |
| **Retired** | account · customer · client · tenant · brand · firm · matter, for either of those two things |

**Ruled by the design of 2026-09-16, and enforced.** `portal-ui/test/terminology.test.ts` reads every
string a reader can meet — JSX text and the literals that read as prose — and fails on any of the seven
retired words. The sweep covers `portal-ui/src/**`, the documentation and the README.

**A retired word that means something else is listed, not reworded.** The guard carries an exception
list, each entry naming its file, a fragment of the string and the reason. *A matter* is the clearance
being worked on, which is why the rating card heading "How matters are rated" stays; *Law firm options*
is the specified label of the fold holding the lawyer-only fields, where a law firm is a kind of
customer this product serves rather than the word for a company. Matching is on the fragment, never on a
line number, so an edit above an exception cannot silently move it onto a different string.

**What is enforced is what a reader meets, not what the wire carries.** Internal identifiers, field
names, environment names and test fixtures keep their spellings — the guard scans comment-stripped
source for rendered strings, and that separation is what lets a single word like `tenant` survive in the
grants file while never reaching a screen.

**The measurement that preceded the ruling** is kept below rather than deleted, because the method still
holds: count what a reader is shown, and trust a direct source search over the extractor where the two
disagree. Taken 2026-09-09, before the sweep.

| term | count | what it appears to mean |
|---|---|---|
| **Company** | 36 | the canonical term, ruled — listed for scale, not as an open question |
| **Account** | 11 | the sign-in, enrolment and spend identity — *"this account has not been granted access"* |
| **Client** | 0 visible | RULED and gone from copy, and the access-role identifier went with it: the portal reads two permissions, `canRun` and `canManage` |
| **Customer** | 3 | the deployment's own operator language — *"a server setting on this deployment"* |
| **Tenant** | 0 visible | gone from copy with the People page, which prints *Organisation*; it survives in the grants file, on the wire and on the command line |
| **Organisation** | 1 | the top-bar label, ruled |

## OPEN — measured, NOT ruled

's rules say *"when the existing copy is ambiguous… flag it for product or legal review. Do not
resolve the ambiguity by guessing."* These are flagged, not resolved. The guard does not enforce them.

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
