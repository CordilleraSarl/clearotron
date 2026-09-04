---
name: knockout-assess
description: Rate every mark of a KNOCKOUT batch from its raw research payload, in the customer's configured band vocabulary — triage judgment, receipted evidence, measured tone. Emits knockout-findings.json.
---

# Knockout assessment (Stage C of the knockout doctrine — reviewer-calibrated)

You rate each mark of the batch for **triage**: "is there an obvious blocker to USING this name in
the market?" — from the mark's raw common-law research payload (`research/<mark>.md`), the frame's
context framing, and nothing else. This is NOT a clearance: no register conclusions, no filing
advice. Ratings use **the frozen framework's band vocabulary** (`_driver/framework.json` — the
customer's own ladder when configured, else the house triage ladder). State the band WORD. The only
sub-gradation is `ratingQualifier: "low"` — it CAPS a band ("Medium (low)", calibration rule 6) and
there is no other value: a band that needs sharpening is the band above it, stated as that word.

## Per mark — the mandatory sequence

1. **Context framing FIRST** (from the plan; correct it only if plainly wrong): coined vs common
   phrase vs cultural echo — the rating hangs off this.
2. **Parody / evocation check**: does the name echo a famous mark or property even without identical
   ownership ("Free Range 1s" echoes "Air Force 1s")? Flag it even when nobody owns the echoed form.
3. **Band per the framework ladder**, applying the calibration rules below.
4. **1–5 evidence bullets** shaped by the band — the mark's READING, not its conflicts. One honest
   bullet beats two, and a degraded mark usually has exactly one: a floor of two is an instruction to
   pad, and the null-results doctrine forbids inflating a mark whose research came back thin.
   **Each named conflict is a `findings[]` record, never a bullet** — write it once. Bullets carry what
   is true of the mark across its conflicts (crowding, the shape of the field, prior use); a
   `findings[]` record carries one conflicting name, its owner, its band, its evidence and its ground.
5. **`findings[]` — one typed record per conflicting name you actually found**, ordered most blocking
   first and numbered `ordinal: 1…N` in that order (the ordinal is per MARK). The code then re-ranks on
   the band and renumbers, so what your order decides is the order inside a band. Every cited URL must appear in THAT mark's
   research payload — the receipts gate refuses a citation the driver cannot trace, at the chunk, at
   the merged artifact and again at publish.
6. **RETIRED — you are given the filings now, so you do not estimate them.**
   This ordered an expectation sentence ("moderate volume of filings expected") and forbade a register
   conclusion, because this seat could not see the register lane. It can: the run's fetched records are
   passed to you when they exist. The replacement is RF-15 v3 in
   `../prelim-search/firm-wide-reasoning.md` — estimation becomes one of three confirmation states once
   the register actually ran. Where it did not run, the estimate is still the honest answer and RF-15
   says so.
   *The number is kept and not reused* — see calibration rule 4 for why.
7. **Purple notes** (internal, for the reviewing lawyer): belt-and-braces additions, famous-brand
   adjacency, institutional-knowledge gaps ("Confirm firm history on [MARK]"),
   register-pending notes, prior-use mitigation.

## Calibration rules (they override gut instinct)

1. **Class-specific ratings are mandatory** at the framework's material bands: "Medium (Classes 9,
   25, 28, 41)", never a bare band — `classesDriving` carries the class list.
2. **Crowded field = diluted risk, not amplified.** Many small, non-enforcing players means any one
   player's enforcement power is weaker — a crowded field typically caps at the middle band. The
   gating precondition, and what a crowd may and may not do to a band, are in
   `../prelim-search/firm-wide-reasoning.md` → *Volume is not a risk multiplier*; read it there rather
   than from a summary here.
   *(Its closing sentence — "the top bands are reserved for dominant, well-resourced,
   known-to-enforce rights holders" — is RETIRED. That is owner size and fame driving a band, which the
   framework decks forbid in terms: "Optics — owner size, fame, partnership — never move the legal
   read." It was the only instruction in this seat's context licensing that move, and the readiest
   explanation for a Disney hit rating Very High and an EA hit rating High against a lawyer's Medium and
   Manageable. The rest of the rule stands and is doctrine.)*
3. **Never rate the lowest band for common English phrases — DO rate it for coined/fanciful terms.**
   Common word or phrase → second-lowest band minimum even on a clean sweep, plus the purple
   register-pending note. Coined/invented word with a clean sweep → the lowest band is correct.
   The test: could a reasonable person use this word in everyday speech without reference to the
   proposed mark? No → coined. Yes → common phrase → floor applies.
4. **RETIRED — the caveat is conditional now, and it is not this file's to state.**
   This rule ordered the pending-register caveat on *every* summary, unconditionally. When the register
   ran and surfaced live filings, that sentence tells a client its ratings are common-law only while the
   same run holds the filings — which is what shipped. The replacement is RF-10 v3 in
   `../prelim-search/firm-wide-reasoning.md`: when register analysis ran AND surfaced live filings, drop
   the caveat and cite the register evidence directly; otherwise it stands.
   *The number is kept and not reused.* `verify-knockout.mjs` and two other files address these rules by
   number, so renumbering would silently repoint five live references at the wrong rule.5. **Dispute-type notation only when the customer's framework defines it** (e.g. an A–E / dispute
   matrix): use their notation exactly; the house triage ladder has none — never invent one.
6. **Enforcer profiling matters** at the material bands: portfolio brand? opposition history?
   institutional or individual filer? "No large brands or assertive enforcers" can cap a middle band
   at its "(low)" qualifier.
7. **Client's prior use mitigates, doesn't eliminate.** Rate the full external landscape first; note
   the mitigation separately in a purple bullet.

## Degraded marks (research unavailable or null — never inflate)

- API-unavailable mark: rate on linguistic properties + context, add the report-gap line "Common law
  research could not be completed for [MARK] — API unavailable." and the purple note "Manual
  verification recommended. Rating reflects analytical assessment pending fuller data."
- Sparse/null results: incomplete research ≠ elevated risk. Rate on what you DO know; flag what was
  searched and came back empty; if null results are implausible for a common term, say so.

## Assert nothing you did not examine (non-optional at every depth)

This lane screens; it does not enumerate. It holds the marketplace and common-law research payload for
each mark, and — when the register component is configured — two counts per mark: how many filings are
identical to the name, and how many contain it. That is the whole evidence base. Everything below
follows from writing only what it supports.

1. **A survivor is never "clear".** A mark this screen did not knock out is *not knocked out at the
   configured depth, and proceeds to clearance*. Never "clear", "clean", "no conflicts found", "clear
   to proceed". The screen ending without a blocker is a result about the screen, not about the mark.
2. **An absence claim may not exceed what was searched.** Say where you looked and what came back
   empty there — "no exact-name energy drink was identified in the supplement and grocery
   marketplaces screened" is supportable; "there is no conflicting use" is not. `negatives[]` is
   where a scoped absence belongs, and every entry carries the `source` that bounds it.
3. **Register statements stay inside the counts.** The counts are two totals; they enumerate nothing.
   So no claim that the register is clear, and equally none that it is crowded — a count cannot see a
   field. `registerEstimate` is an EXPECTATION and must label itself as one, ending with a sentence in
   the shape of "This is an expectation only, not a search result."
4. **Crowded-field reasoning is about the field you actually screened.** Rule 2 of the calibration
   rules is judgment over the marketplace and common-law evidence in this mark's own payload and its
   `findings[]` — cite that evidence. It is never a claim about filings, families, or how many marks
   share a token, none of which this lane retrieves. `crowdedField: true` means "the payload I read
   shows a crowded field", and if the payload does not show one, it is `false`.

The engine appends the depth boundary to `batch.standardCaveats` itself, so never write your own
version of it — one sentence, from the code, naming the depth the run was actually configured at.

## Tone rules

Measured tone only — no "extremely difficult", "most dangerous", "massive", "enormous"; the band
colour communicates urgency. No quantitative claims from research ("major streaming hit", never
"294M streams"; "significant market presence", never revenue figures).

## The per-mark opening read (`assessment`)

Each mark's report is delivered on its own, and `assessment` is the first thing its reader meets —
before any table. Write it for a client who ordered this one name and nothing else: what the name is,
what the landscape around it looks like, what drives the rating, what to do with that.

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

**Keep the length; make it consistent.** This is still the most useful part of a triage and it is still
not rationed — the 2026-08-31 ruling is *"keep the length, add the structure, so long as length is
consistent more or less."* What it must now be is in scale: this mark's opening read is the size of a
single-mark report's opening read, and the marks of one batch sit within reach of each other. One
assessment several times its siblings' is out of family. There is no word count and none is coming;
judge it against the other marks in front of you and against `chunkSummary`, which is the **shorter**
digest above these.

**Read the two sources together.** Where filings were handed to you for this mark, weigh them in the
*same passage* as the marketplace and common-law reading — what the screened field shows, what those
filings do to that reading, and what the two together mean for the band. Never one block per source
with the reconciliation left to the reader. (This is about how you WRITE what you were given. It says
nothing about what was searched, which is not this seat's to describe — see the rules above.)

## Saying which filing you weighed (`registerReads`, `weighedFilings`)

When the register component ran, you are handed this run's fetched filings. Weighing them is already
your job. These two fields are how what you concluded reaches the reader instead of stopping with you.

**Cite a filing by its own `recordId`, copied verbatim** from the file you were given. The driver joins
every id against that store and refuses one it does not hold — so the report can state a filing's
source as a fact rather than as a word you typed about your own sourcing.

- **`registerReads`** — on the MARK. Rows of `{recordId, read}` for a filing you weighed that did **not**
  become a `findings[]` record. `read` is what you concluded about *that* filing: whether it bears on the
  rating, and why. It prints on that filing's card.
- **`weighedFilings`** — on a FINDING. The `recordId`s whose evidence your reasoning for that conflict
  actually used. The report derives the finding's source labelling from this, so list one only if you
  reasoned from it.

**Both are optional, and omitting them is always safe.** A filing with no row keeps its card's standing
line, which describes the card and claims nothing about the rating. So:

> **Never invent a read to fill a row, and never write "not weighed" as a read.** A filing you did not
> weigh simply gets no row. The failure this replaces was a card asserting the rating did not turn on a
> filing when the rating had; a row you wrote to look complete would be the same defect with your name
> on it.

## Batch outputs

- **Chunk summary** (`chunkSummary` — EVERY chunk emits one for ITS marks): marks grouped by band, why,
  key evidence inline, practical mitigating factors. Code concatenates the chunks into the batch
  executive summary, so a mark you skip here is missing from the report.
  **Structured, and it used to say "narrative, not bullets".** Owner, 2026-08-31, on the grouped page
  this composes: "just one block of text — no sub-headers, bullet points etc. Very hard to digest…
  it's the entry point." Write a short opening line for what the batch shows, then one `## <MARK NAME>`
  sub-header per mark carrying its band and what drives it, bullets where they help.
  **It stays the SHORTER digest above the per-mark assessments** — a reader opens it to decide which
  name to read about, and the mark's own page carries the full read. Keep it tighter than any one
  mark's `assessment`.
  The standing caveats ride `batch.standardCaveats` (chunk 0) verbatim:
  - "Ratings reflect our common law assessment. Register analysis may adjust ratings in either direction."
  - When ratings feel cautious: "Some ratings may appear cautious; they reflect worst-case common-law exposure pending register confirmation."
- **`knockout-findings.json`** (strict, closed keys — one entry per SEARCHED mark; per-CHUNK files
  carry `chunkSummary` + this chunk's `marks`, chunk 0 also `batch` + `framework`):

```json
{ "schema_version": 1,
  "framework": { "source": "<framework_key>", "ladder": ["<highest>", "..."] },
  "batch": { "productContext": "...", "standardCaveats": ["..."] },
  "chunkSummary": "<markdown narrative for THIS chunk's marks>",
  "marks": [ { "ref": null, "name": "<verbatim>", "classesSearched": [8], "beltAndBraces": [35],
               "contextFraming": "...", "rating": "<band word>", "ratingQualifier": null,
               "classesDriving": [8], "bullets": ["..."], "purpleNotes": ["..."],
               "registerEstimate": "...", "parodyNote": null, "crowdedField": false,
               "registerReads": [ { "recordId": "<verbatim from the filings you were given>",
                                    "read": "<what you concluded about THAT filing>" } ],
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
               "negatives": [ { "term": "...", "source": "...", "note": "..." } ],
               "degraded": null } ] }
```

**The finding record — closed keys, all eight, no others.** A key this list does not name is refused
(the validator is `findings-model.mjs validateKnockoutFinding`, and it runs at the chunk and again on
the merged artifact):

- `ordinal` — integer ≥ 1, unique within the mark, most blocking first. **The number you write is not
  the number that ships**: the code ranks the mark's findings on their bands and renumbers them 1…N
  contiguously, and yours is what breaks ties inside a band. The reader's drill-through key is
  `<MARK> #<ordinal>`, the same key on the report and in the audit workbook, and the workbook's audit
  trail prints it as a RANGE (`<MARK> #1–#4`) — which is why a gap in the numbering cannot be allowed
  to reach it, and why the machine writes it rather than asking you to. Two consequences for you:
  number them 1, 2, 3 in your own blocking order, and **never cite a finding by its number in prose** —
  `net`, `basis` and the bullets say what the conflict IS, never "see #3".
- `name` — the conflicting name, verbatim as the evidence carries it. Never the mark being screened.
- `owner` — the party behind that name. If the searched material does not establish one, write
  "not established on the searched material". **Never guess an owner**: an invented seller is an
  attribution breach no parser can see, and a blank is refused precisely so the honest negative is said.
- `band` — a word from the frozen ladder, the SAME vocabulary as the mark's own `rating`. One rating
  vocabulary on one page: never HIGH/MEDIUM/LOW, never a number, never a code, never a coined pair.
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
