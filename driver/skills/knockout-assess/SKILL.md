---
name: knockout-assess
description: Rate every mark of a KNOCKOUT batch from its research payload and the filings you hold, in the customer's configured band vocabulary. Triage judgment, receipted evidence, measured tone. Emits knockout-findings.json.
---

# Knockout assessment

You rate each mark of the batch for **triage**: "is there an obvious blocker to USING this name in
the market?" This screens; it does not clear, and it gives no filing advice.

**What you hold is the whole evidence base:** the client's request, the plan with each mark's context
framing, each mark's raw research payload (`research/<mark>.md`), and, when the register component ran,
the filings the reading step carried forward, what it set aside, and the owner searches made for them.

**Rate in the frozen framework's words** (`_driver/framework.json`: the customer's own ladder when
configured, else the house triage ladder). State the band WORD. The only sub-gradation is
`ratingQualifier: "low"`. It CAPS a band ("Medium (low)", calibration rule 4) and there is no other value:
a band that needs sharpening is the band above it, stated as that word.

## Per mark — the mandatory sequence

1. **Context framing FIRST** (from the plan, read against the client's request): coined vs common
   phrase vs cultural echo. It frames what the name READS as, and the evidence bullets draw on it. It
   does not set, floor or lift a band. A risk that belongs to the NAME rather than to one user is its
   own `findings[]` record, rated there: Famous Brand and Cultural Reference are card types for that.
2. **Parody / evocation check**: does the name echo a famous mark or property even without identical
   ownership ("Free Range 1s" echoes "Air Force 1s")? Flag it even when nobody owns the echoed form.
3. **Band per the framework ladder**, applying the calibration rules below.
   [worked-examples.md](../clearance-search/worked-examples.md) — the spine + per-finding reasoning
   depth (per-customer variants calibrate under that customer's framework)
4. **1–5 evidence bullets** shaped by the band — the mark's READING, not its conflicts. One honest
   bullet beats two, and a degraded mark usually has exactly one: a floor of two is an instruction to
   pad, and the null-results doctrine forbids inflating a mark whose research came back thin.
   **Each named conflict is a `findings[]` record, never a bullet** — write it once. Bullets carry what
   is true of the mark across its conflicts (crowding, the shape of the field, prior use); a
   `findings[]` record carries one conflicting name, its owner, its band, its evidence and its ground.
5. **`findings[]` — one typed record per conflicting name you actually found**, ordered most blocking
   first and numbered `ordinal: 1…N` in that order (the ordinal is per MARK). The code then re-ranks on
   the band and renumbers, so what your order decides is the order inside a band. A cited URL must appear in the mark's own research payload or in a filing held for this batch. The receipts gate refuses a citation the driver cannot trace, at the chunk, at the merged artifact, and again at publish.
6. **`registerEstimate`.** Use registerEstimate only where the register component was skipped, under
   RF-15. An empty carried list does not establish that it was skipped. Use the run's recorded state; keep
   a verified zero, a failed question, and an unread answer distinct. With held filings, weigh their
   evidence. Where it is owed it is an EXPECTATION and labels itself as one, ending with a sentence in the
   shape of "This is an expectation only, not a search result."
7. **Purple notes** (internal, for the reviewing lawyer): belt-and-braces additions, famous-brand
   adjacency, institutional-knowledge gaps ("Confirm firm history on [MARK]"),
   register-pending notes, prior-use mitigation.

## Calibration rules (they override gut instinct)

1. **Class-specific ratings are mandatory** at the framework's material bands: "Medium (Classes 9,
   25, 28, 41)", never a bare band — `classesDriving` carries the class list.
   Where the filings and use you hold support different conclusions for different groups of the classes
   searched, say so in `classGroups`: one row per group, with `band`, `ratingQualifier` where it applies,
   and `classes`. Every class searched belongs to one group. `rating` is the highest group's band and
   `classesDriving` that group's classes. `basis` and the opening read say what divides the groups, and a
   finding or filing read that bears on only some classes says which. Where one conclusion holds across
   the classes searched, leave `classGroups` out. Divide on the requested goods and the evidence, never to
   soften a rating.
2. **Crowded field = diluted risk, not amplified.** Many small, non-enforcing players means any one
   player's enforcement power is weaker — a crowded field typically caps at the middle band. The
   gating precondition, and what a crowd may and may not do to a band, are in
   `../clearance-search/firm-wide-reasoning.md` → *Volume is not a risk multiplier*; read it there rather
   than from a summary here.
3. **Dispute-type notation only when the customer's framework defines it** (e.g. an A–E / dispute
   matrix): use their notation exactly; the house triage ladder has none — never invent one.
4. **Enforcer profiling matters** at the material bands: portfolio brand? opposition history?
   institutional or individual filer? "No large brands or assertive enforcers" can cap a middle band
   at its "(low)" qualifier.
5. **Client's prior use mitigates, doesn't eliminate.** Rate the full external landscape first; note
   the mitigation separately in a purple bullet.
6. **A NAME IS NEVER RATED ABOVE THE WORST CARD ON ITS PAGE.** The page is one judgment: the name's
   band, its basis line, its Why and Why-not boxes and its opening read all have to agree with each
   other and with the cards under them. A reader who sees a band on the name and a milder band on
   every card beneath it has been given two answers and no way to choose.
   **Cards means every rated item on this name's page** — each `findings[]` record, and each
   `registerReads[]` row that carries a band. A row with no band is not a card and does not count.
   **A name with no rated cards takes the bottom band of the client's own ladder.** Nothing was found
   against it; that is what the bottom band is for. It is not a reason to reach up a band.
   **Rating BELOW the worst card is allowed and needs a sentence**, because it is a real judgment:
   the worst card's holder may touch only the edge of the request. Say which card and why it does not
   carry the name.
   **Anything that should lift a name is a card of its own** — a famous-mark echo, a cultural
   reading, a risk that belongs to the NAME rather than to one user. Write it as a `findings[]`
   record and rate it there, where a reader can see what it is and disagree with it. A band lifted
   without a card is a conclusion with its evidence left out.
   The driver checks this and REFUSES, naming the card it read: it never rewrites your band.

## Degraded marks (research unavailable or null — never inflate)

- API-unavailable mark: rate on linguistic properties + context, add the report-gap line "Common law
  research could not be completed for [MARK] — API unavailable." and the purple note "Manual
  verification recommended. Rating reflects analytical assessment pending fuller data."
- Sparse/null results: incomplete research ≠ elevated risk. Rate on what you DO know; flag what was
  searched and came back empty; if null results are implausible for a common term, say so.

## Assert nothing you did not examine (non-optional at every depth)

Everything below follows from writing only what your evidence supports.

1. **A survivor is never "clear".** Never "clear", "clean", "no conflicts found", "clear to proceed".
   The screen ending without a blocker is a result about the screen, not about the mark.
2. **An absence claim may not exceed what was searched.** Say where you looked and what came back
   empty there — "no exact-name energy drink was identified in the supplement and grocery
   marketplaces screened" is supportable; "there is no conflicting use" is not. `negatives[]` is
   where a scoped absence belongs, and every entry carries the `source` that bounds it.
3. **Weigh the filings; do not describe the search.** A filing you were handed is evidence like any
   other: whose it is, what it covers, what it is worth against this name. Claim neither that the register
   is clear nor that it is crowded.
4. **Crowded-field reasoning is about the field you actually screened.** Rule 2 of the calibration
   rules is judgment over the marketplace and common-law evidence in this mark's own payload and its
   `findings[]` — cite that evidence. It is never a claim about filings, families, or how many marks
   share a token. `crowdedField: true` means "the payload I read
   shows a crowded field", and if the payload does not show one, it is `false`.

The engine appends the depth boundary to `batch.standardCaveats` itself, and the standing caveat where
one is owed, so never write your own version of either.

## Tone rules

Measured tone only — no "extremely difficult", "most dangerous", "massive", "enormous"; the band
colour communicates urgency. No quantitative claims from research ("major streaming hit", never
"294M streams"; "significant market presence", never revenue figures).

## Plain language — the two-register rule

The report goes to a lawyer who layers advice on top, and that lawyer's client reads the same page. The
band, the summary, the basis line and the one-liners are the whole product for the second reader. They
were the hardest lines on the page.

**Everything a reader sees before opening a fold is written for the client's business owner.** Ordinary
nouns, one idea per sentence, no sentence over 25 words, the conclusion first. On this product that is:
`chunkSummary`, `basis`, `factors`, `counterFactors`, `mitigation`, every finding's `net`, every
`registerReads[].read`, the `purpleNotes`, and `standardCaveats`.

**Inside a fold the lawyer's vocabulary is allowed** where a plain word would lose precision — a
finding's `basis`, the provenance, the long `assessment`. Even there, a term is explained the first time
it appears on the page.

The rule is the test, not the list. Ask of every noun: *does the reader already own this word?* These
are worked examples of the one failure, not its boundary:

| Instead of | Write |
|---|---|
| proprietor | owner |
| subsisting | live |
| senior | earlier, or came first |
| specification | goods list |
| VELTR-formative | names built on VELTR- |
| prevail | win |
| citable prior rights | earlier marks the office can raise against you |
| vulnerable to a non-use attack | could be cancelled for not being used |
| on the record as it stands | on what we found |
| the marks-and-goods comparison | same name, same goods |
| the confusion comparison meets on every limb | same name, same goods, same shops |
| belt-and-braces classes | extra classes |
| dispatch, instructed | the request, what was asked |
| lane | class, or channel — whichever you mean |
| chunk | never; say the batch, or these names |

The target is the level of these, each the standard for its line:

> **Basis.** "WAYPOINT is already the name of two navigation apps on the same app stores, and of an
> established mapping company. Any of them would likely win a dispute over this name
> for this software. The word is a weak mark for these goods, which is why this is High and not Very
> High."

> **A finding's `net`.** "Same name, same goods, and their filing came first in every territory we
> searched. We see no argument against it."

> **The batch opener.** "One name screened: WAYPOINT, rated High."

**Shortening by dropping the reason is not the fix.** The "why" stays, in plain words. A visible
line that is short because it no longer says why is worse than the long one it replaced, and it
passes every length rule on this page while telling the reader less.

**Say it once.** A caveat, a limit or a finding belongs in one place. Four `standardCaveats` that each
restate "this is not a clearance" are one caveat and three repetitions — and the report's scope block
already carries that sentence in the renderer's own words, so a caveat repeating it is dropped before
the reader sees it. Write the one thing the scope block does not say, or write none.

**A note is verb-first, one line, and about one of two things.** Write each `purpleNotes` entry as an
instruction to the reviewing lawyer, opening on the verb. Every note is about the REQUEST — what was
asked, and whether it holds together — or about the NAME. The report prints the first kind at the top,
above the conflicts, and the second under that name's cards, so a note that mixes the two lands in one
place and reads oddly in it. Write two notes.

A note about the request NAMES the request in the note — "the request", or "what we were asked". That is
not a formality: the report sorts the two kinds by what the note talks about, so a request note that
never mentions the request is filed under the name and prints in the wrong place.

> "Check the request. The client is described as a bakery business, but we were asked
> to screen navigation software in Class 9. We screened the software. If baking is the real
> business, this screen looked at the wrong market."

> "Ask the client whether it already uses WAYPOINT. The request does not say, and the client's own earlier
> use would change the picture."

A note about the name opens on what the lawyer should do about the name:

Use the missing-goods note only when no wording is held; open a shortened held record before concluding that wording is missing.

> "Goods wording is not held for this filing, so its relevance to the requested goods remains unresolved."

> "Search Classes 42 and 39 in their own right. Both carry live WAYPOINT filings, not spillover from
> Class 9."

A note that restates a finding already on the page is not a note. Cut it.

## The per-mark opening read (`assessment`)

Each mark's report is delivered on its own, and `assessment` is the first thing its reader meets —
before any table. Write it for a client who ordered this one name and nothing else: what the name is,
what the landscape around it looks like, what drives the rating.

**No recommendation, and no next step.** Never say what to do with the name, whether it advances, or
what happens next — not under a heading of your own, and not as a closing line. The findings and the
rating are the whole of this read; the report's own caveat says what the screen is.

**It names THIS mark and no other.** A sibling's name here is another client's mark on this client's
page. The cross-mark reading is `chunkSummary`, and it has its own page.

**Structure it so it can be scanned.** Sub-headers where the content divides, `- ` bullets for the
load-bearing points, a blank line between blocks.

> **Sub-headers are `## ` or `### `. Never `# `.** One hash opens a *section of the report itself*: the
> publisher splits `report.md` on `^# ` and the portal's summary route terminates on it, so a single
> hash written here ends the summary at that line and drops everything after it from the client's page.
> Nothing reports the loss. The validator refuses it for that reason.

A single sub-header over one unbroken block is not structure. The blocks are what make the length
readable.

**Keep the length; make it consistent.** This is the most useful part of a triage and it is not
rationed. This mark's opening read is the size of a single-mark report's opening read, and the marks of
one batch sit within reach of each other. One assessment several times its siblings' is out of family.
There is no word count; judge it against the other marks in front of you and against `chunkSummary`,
which is the **shorter** digest above these.

**Read the two sources together.** Where filings were handed to you for this mark, weigh them in the
*same passage* as the marketplace and common-law reading — what those filings show, what the screened
field adds to that reading, and what the two together mean for the band. Never one block per source
with the reconciliation left to the reader.

## The typed read (`basis`, `factors`, `counterFactors`, `mitigation`)

Every mark carries the read as typed fields, not as a paragraph:

- `basis`: ONE sentence: why this band, for this name, in these classes.
- `factors`: 2-4 strings, one line each: the load-bearing observations behind the band.
- `counterFactors`: 1-3 strings: what holds it at this band rather than the next one either way.
- `mitigation`: ONE line: the single thing that would move it. "" if nothing would.

Each is a standalone line: no semicolon chains, no clause stacking, no restating the band word. Write
each observation ONCE: a point made in `factors` is not repeated in `bullets`.

## What the register reading hands you

The step before you read the register name by name, and its work is yours to build on. On each name in the file you are
handed, `records` are the filings it carried forward, and `carriedBecause` says why. `setAsideRecords` are the filings it
read and set aside, with their goods views, and `reading.setAside` says why, by question. `terms` is each question with its
`state`: `read`, `narrowed`, `zero` (a verified zero), `failed` (no answer), `crowd-not-read` or `not-asked`. `reading.notAsked`
is what it did not ask, with its reason; a class it records there stays unresolved, neither searched nor clean.
`reading.openQuestions` is what it could not settle. Do not read the lists again to rebuild this. Reconsider a set-aside where the client's scope, the evidence or a
specific concern gives reason: read that question's whole list with `read_register_list` by its qid, which fetches nothing,
and cite the filing by its `recordId` as usual. It then reaches the report with the carried ones.

## Saying which filing you weighed (`registerReads`, `weighedFilings`)

When the register component ran, you are handed this run's fetched filings. Weighing them is already
your job. These two fields are how what you concluded reaches the reader instead of stopping with you.

**Cite a filing by its own `recordId`, copied verbatim** from the file you were given. The driver joins
every id against that store and refuses one it does not hold — so the report can state a filing's
source as a fact rather than as a word you typed about your own sourcing.

A filing held for this batch may bear on more than one name. Weigh it against the particular name and its instructed scope, and cite its held recordId and source. Keep where it was found: using that filing does not mean its original search answered this name's register question.

- **`registerReads`** — on the MARK. Rows of `{recordId, read, band?}` for a filing you weighed that did
  **not** become a `findings[]` record. `read` is what you concluded about *that* filing: how its goods meet
  the goods the client asked about, whether it bears on the rating, and why. It prints on that filing's card. `band` is **optional** and is how you rate that
  filing on its own — in the framework's band words, the same vocabulary as the mark's rating. Send it
  whenever you formed a view on the filing itself: a registered right is often the one hard legal fact on
  the page, and with no band its card is the only one carrying no rating while softer uses around it carry
  one, which reads as though the registration mattered least. Omit it and the read still prints, claiming
  no rating.
- **`weighedFilings`** — on a FINDING. The `recordId`s whose evidence your reasoning for that conflict
  actually used. The report derives the finding's source labelling from this, so list one only if you
  reasoned from it.

**Both are optional, and omitting them is always safe.** A filing with no row keeps its card's standing
line, which describes the card and claims nothing about the rating. So:

> **Never invent a read to fill a row, and never write "not weighed" as a read.** A filing you did not
> weigh simply gets no row. A row written to look complete would tell the reader the rating turned, or
> did not turn, on a filing you never reasoned from.

## Saying what you put down (`setAside`)

**Written after your rating is written, and it changes no band.** This is a record of what you read and
did not carry, not a reason to re-weigh anything: the rating you have already reached stands exactly as it
is, and nothing in this section asks you to raise or lower it.

The web search hands you every result it got. Some become `findings[]`. The rest you read and put down.
`setAside` is where that judgment goes, so a result you judged irrelevant and a result you never opened do
not look identical afterwards.

- **Rows of `{url, ground}`** on the MARK, for a result the search returned that you are **not** carrying
  as a finding. `ground` is what it turned out to be, or why it does not bear on this name — one line.
- **It reaches the audit workbook, never the client's report.**
- **Where many results share one ground, write it once**, against the one you actually read, and say in
  that ground that it covers the others. A row each for forty results off one store is not a record of
  judgment; it is the same sentence forty times.
- **This is not `negatives[]`.** A negative is a search that came back EMPTY, bounded by the `source`
  that makes the absence claim true. A set-aside is a result that came back and did not survive your
  reading. A run that returns fifty results and raises one finding has one finding, no negatives and a
  set-aside record.

> **Optional, and omitting a row is always safe.** A result your reading took for a possible conflict and
> then put down gets a ground, one row per owner's set or group of like results, never one per result.
> Never invent one to fill the list, and never write "not relevant" on its own: that is
> the conclusion, not the ground. What the result turned out to be is the ground.

## Batch outputs

- **Chunk summary** (`chunkSummary` — EVERY chunk emits one for ITS marks): marks grouped by band, why,
  key evidence inline, practical mitigating factors. Code concatenates the chunks into the batch
  executive summary, so a mark you skip here is missing from the report.
  **Structure it:** a short opening line for what the batch shows, then one `## <MARK NAME>` sub-header
  per mark carrying its band and what drives it, bullets where they help. A sub-header is `## ` or `### `,
  never `# `.
  **It stays the SHORTER digest above the per-mark assessments** — a reader opens it to decide which
  name to read about, and the mark's own page carries the full read. Keep it tighter than any one
  mark's `assessment`.
- **`knockout-findings.json`** (strict, closed keys — one entry per SEARCHED mark; per-CHUNK files
  carry `chunkSummary` + this chunk's `marks`, chunk 0 also `batch` + `framework`):

```json
{ "schema_version": 1,
  "framework": { "source": "<framework_key>", "ladder": ["<highest>", "..."] },
  "batch": { "productContext": "...", "standardCaveats": ["..."] },
  "chunkSummary": "<markdown for THIS chunk's marks>",
  "marks": [ { "ref": null, "name": "<verbatim>", "classesSearched": [8], "beltAndBraces": [35],
               "contextFraming": "...", "rating": "<band word>", "ratingQualifier": null,
               "classesDriving": [8],
               "classGroups": [ { "band": "<band word>", "ratingQualifier": null, "classes": [8] } ],
               "bullets": ["..."], "purpleNotes": ["..."],
               "registerEstimate": "...", "parodyNote": null, "crowdedField": false,
               "registerReads": [ { "recordId": "<verbatim from the filings you were given>",
                                    "read": "<what you concluded about THAT filing>",
                                    "band": "<OPTIONAL — your rating of THAT filing, in the ladder's words>" } ],
               "basis": "<ONE sentence: why this band, for this name, in these classes>",
               "factors": ["<2-4 load-bearing observations, one line each>"],
               "counterFactors": ["<1-3: what holds it at this band rather than the next>"],
               "mitigation": "<ONE line: the single thing that would move it, or \"\">",
               "assessment": "<this mark's own opening read — see \"The per-mark opening read\" above>",
               "findings": [ { "ordinal": 1, "name": "<the CONFLICTING name, verbatim>",
                               "owner": "<the party behind it>", "band": "<band word>",
                               "net": "<one conclusion sentence>", "type": "Active Business",
                               "evidence": ["https://…"], "basis": "<the ground the band rests on>",
                               "weighedFilings": ["<recordIds this finding's reasoning used>"] } ],
               "setAside": [ { "url": "<verbatim from the payload you were given>",
                               "ground": "<why this result is not carried as a finding>" } ],
               "negatives": [ { "term": "...", "source": "...", "note": "..." } ],
               "degraded": null } ] }
```

**The finding record — closed keys, all nine, no others, and "inputs" where the framework states a method.** A key this list does not name is refused
(the validator is `findings-model.mjs validateKnockoutFinding`, and it runs at the chunk and again on
the merged artifact):

- `ordinal` — integer ≥ 1, unique within the mark, most blocking first. The code ranks the mark's
  findings on their bands and renumbers them, and yours breaks ties inside a band. So number them 1, 2, 3 in
  your own blocking order, and **never cite a finding by its number in prose** — `net`, `basis` and the
  bullets say what the conflict IS, never "see #3".
- `name` — the conflicting name, verbatim as the evidence carries it. Never the mark being screened.
- `owner` — the party behind that name. If the searched material does not establish one, write
  "not established on the searched material". **Never guess an owner**: an invented seller is an
  attribution breach no parser can see, and a blank is refused precisely so the honest negative is said.
- `band` — a word from the frozen ladder, the SAME vocabulary as the mark's own `rating`. One rating
  vocabulary on one page: never HIGH/MEDIUM/LOW, never a number, never a code, never a coined pair.
- `inputs` — only where the framework states a method: its own inputs for this finding, keyed by its
  labels, each one of the values it lists, reasoned in its order before the band. The band is the one
  its table gives for them.
- `net` — ONE sentence answering "is this a problem for the applicant". A conclusion, not a chain: no
  semicolons stitching facts to a verdict, no arrows, and never an action ("we recommend…").
- `type` ∈ Famous Brand | Active Business | Cultural Reference | Domain | Descriptive Use | Negative
  Association | Competitor Intelligence. It names what the finding IS, not how bad it is.
- `evidence` — a NON-EMPTY array of URLs held for this mark. Every one must appear in that mark's own
  research payload. A finding nobody can open is a bullet with a shape around it.
- `basis` — the ground the band rests on: what the evidence shows about use, reach and the owner. The
  rank is read off the band, so a band with no stated basis is an unarguable ranking.

`rating` must be a band from the frozen ladder, and `ratingQualifier` is `null` or `"low"` — nothing
else. A clean mark keeps `findings: []` with the negatives recording what was checked. A degraded mark
(no research payload on disk) MUST carry `degraded: { "reason": "<token>" }` + the doctrine's purple
"Manual verification recommended" note — and a mark WITH a payload must never claim degraded. The
validator joins both directions against the disk; the model's echo is never the truth.
