# Delivery contract — `report.md` + `audit.md`

**`report.md`** (the curated client report) is rendered in TWO isolated parts and **assembled by the driver**
(it is no longer one LLM pass over every card — that cross-contaminated cards):
- **`report-overview`** writes the cross-finding SHELL: the front-matter + `# Actions` + an OPTIONAL
  `# Methodology` (a short plain-English scope note, or nothing — never a telemetry block) — and **no cards,
  no `# Marks` heading**. It does **not** author a `# Coverage` section: coverage renders deterministically
  from the typed `coverage[]` states in `findings.json`, and genuine gaps surface as plain OPEN ITEMS in the
  `# Actions` buckets (see *Coverage = open items, not a telemetry panel* below).
- **`report-card`** writes ONE `## <owner> — <MARK>` card, in isolation, from **that finding's own machine
  record only** (it sees no other finding — so a card can never carry another finding's body/owner/dates/link).

The driver concatenates the shell + the cards (ordered by rated severity — the framework band — then ordinal) under a `# Marks` heading
into `report.md`, then `audit-emit` writes **`audit.md`** (the full audit record). Deterministic code then
renders these into a self-contained HTML report + a styled Excel workbook and publishes them. The combined
`report.md` shape below is the ASSEMBLED result — `report-overview` owns everything down to `# Marks`, and each
`## ` card is one `report-card`.

**Write markdown only. Do NOT build any Excel, compose HTML, or send email — later steps do that.**
Both files are forgiving markdown (labelled `- key: value` blocks): a malformed line is skipped, never
breaks the file. Long single-line values are fine; no escaping needed.

---

## `report.md` — the curated client report

**The shell half of this skeleton is gone (conversion 4).** The front-matter block, `# Actions`
and `# Methodology` are no longer dictated to anyone: the `report-overview` stage sends the caption, the
checks and the notes as typed values, and the driver renders every line of the shell. Nine of the ten
front-matter keys were driver facts a seat retyped, and three of those the driver stamped over
afterwards — this file annotated its own three fields as driver-replaced while still asking for them. It
also taught a `### Only you can close these` section that the stage's own dispatch forbade and that the
driver overwrote at assembly: three documents, three answers, now settled by there being no field for it.

`report-card`'s half stood here until conversion 5 owned it — the split was per-stage on purpose, so
that reverting conversion 4 could not drag report-card's skeleton out with it.

**Conversion 5 then took it.** The card's line shapes are no longer
dictated to anyone: the card seat sends its `### Full detail` items as typed values through its own
recording tool, and the driver renders every bullet, every optional bold lead-in, the internal-note
marker in the position the render splits on, and the final Source line — which it composes from the
finding's own record rather than asking a seat to build a URL out of a provider host table this stage is
never even given. The card's FRAME (the head, `- ord:`, `- group:`, `- source:`, `- net:`, `- open:`) was
already the driver's from the 2026-08-16 frame conversion, and the entries above described it for a
reader rather than ordering anyone to type it.

**What did NOT move, and must not be finished by a later reader:** the card's PROSE. Owner ruling S2
(2026-08-13) re-scoped the proposal rather than adopting it — the mechanical fields move now, and whether the
analysis itself should be rendered is decided by EVIDENCE, one matter built both ways and read side by
side. The transport carries the seat's sentences; it does not write them.

So this document no longer carries a `report.md` skeleton at all. What a card must SAY is in
`report-prose.md` and the risk framework; what it must LOOK like is code's.

*(These notes deliberately do NOT name any record tool. This file is served to `report-overview` as well
as `report-card`, and the agreement guard reads served text as doctrine: a tool named here reads as
an order to every seat that reads the file, including the ones whose grant does not carry it. The same
note tripped that guard in conversion 4 and again in conversion 5 — describe the mechanism, name no
tools.)*


**Curation (the judgment):** promote genuine **on-field** conflicts as headline cards (band-1 placement,
top card `open: true`); identical-mark-but-different-customer findings go **off-field**; the rest go
**out-of-scope**. Mirror the run's actual data. Do **not** emit every finding as a headline card — a run
with ~20–50 findings typically curates to a handful of headline cards. Rating vocabulary is the band words
of the framework in force (`risk-framework.md` house default, or the profile-selected
`risk-framework-<customer>.md`); synthesis discipline follows `synthesis-rules.md`.

**Placement's record — `placements.json` + the rulings tail (B2, 2026-07-31).** `placement-inquiry` writes
its four tier sections as a structured sibling of `placement-recommendations.md`: `placements.json`, one
entry per placed candidate, `{mark, owner, jurisdiction, records[], tier, reason}` with `tier` exactly one of
`headline-candidate` / `sheet-2` / `watchlist-annex` / `out-of-scope-filtered`. When it is present it is the
**authoritative per-candidate tier record**, and `reason` is placement's own short paragraph — the candidate
characterisation, the decisive placement ground, any Stage-2 mitigant flag. Every consumer, this one
included, **adopts or counters each placement BY ENGAGING ITS REASON**: a departure quotes the reason it
contradicts and says why it does not hold; it is never a silent re-tier, and a caption or an `# Actions`
emphasis that quietly reverses placement's call without engaging its reason is a delivery defect. The md
keeps the **rulings tail** (band reconciliation, disagreements, coverage rulings, open questions) as prose —
it travels verbatim and is adjudicated the same way: adopt each ruling or counter-reason it, never silently
drop one. A run minted before this contract carries no `placements.json`; the md's tier sections are then the
record, read the same way.

**Banding by disposition (placement only — never the rating).** Each finding in `findings.json` carries an
OPTIONAL `disposition` (set by `synthesis`), one of: `adversarial` | `coexistence-partner` | `distinguished` |
`off-field`. It chooses the report **band** a card renders in — it **never** recomputes the finding's rating
(its `band` under the framework in force):
`adversarial` → band 1 (the on-field conflicts that drive the verdict); `coexistence-partner` / `distinguished`
→ band 2 (notable but manageable); `off-field` → band 3 (commercial awareness). So a mid-band
`coexistence-partner` (e.g. a documented-coexistence partner) renders in band 2, NOT band 1, while an
identically-rated `adversarial` (a bare near-identical mark the owner would block) leads band 1. **Back-compat:** when `disposition`
is ABSENT on every finding (a legacy / archived `findings.json`), placement falls back to the composite split
(on-field = composite ≥ 3, secondary = composite ≤ 2) and renders byte-identically to before.

**Ruled out (doc-52).** An OPTIONAL `ruled_out: true` (+ short plain `ruled_out_reason`) marks an `off-field`
finding that shares **no word or sound** with the applicant's mark — a concept/genre neighbour, a same-theme
name under a different word (e.g. `UNTAMED` surfacing against `OPEN COUNTRY`). It leaves the conflict
bands + the landscape for a quiet, collapsed **"Also considered — ruled out"** list; it is never surfaced as a
conflict. Never set it on anything sharing a word/sound with the mark (that is a real conflict, however weak).
When the flag is absent, the render falls back to the same signal (an `off-field` register finding whose mark
shares no word with ours), so the routing still holds on runs authored before the flag existed.

**Plain coverage.** `coverage[]` `area` + `note` are read by a lawyer and the client — write them in plain
English, never internal engine idioms ("slice", "crossed into the band", "null class/owner/status",
"unadjudicable", "enumerated-empty", telemetry counts). The render also sanitises these as a backstop, but the
authored text should already be plain.

**Distil for the reviewing lawyer (the one reader).** Lead with the decision: `overall_caption` is the ≤3-line
plain-legal-English bottom line and `# Actions` lists the open external checks — both surface above the fold.
The card's risk chip is code-built from the finding's `band` + disposition; the typed `net` and
`overall_caption` are plain legal English — business consequence + action, ZERO risk codes — never
engineering/pipeline register. "Full detail & provenance" and Methodology are
progressive-disclosure (collapsed). This is distillation by *removal and relocation* — do not add length to hit it.

**Prose & curation (spec 09).** Cut dead weight and throat-clearing; one idea per sentence; 3+ parallel items
become a `- ` list (**inside card bodies too**), never an inline `(a)…(b)…(c)` run; verdict-first; numbers over
superlatives, no intensifiers or GPT-isms; say each caveat once. **Depth-on-click, not length-on-screen:** the
card head + the typed `net` are always visible; everything heavier goes to `### Full
detail`. The highest-risk card must be the **clearest**, never the longest. State the "preliminary assessment"
posture once (in `overall_caption`), never per-card.

**Order inside a card, and inside the report.** Verdict first, then what was looked for and not found,
then what was found — at every scale. The assembled report already has that order (the caption, then the
coverage panel and the reasoned negatives, then the conflict cards), and `### Full detail` repeats it in
miniature: the **Risk assessment** bullet leads, the checks that ran and came back empty follow, then the
filing, enforcement and use facts. A card that opens with a filing date makes the reader hunt for the
answer they were given a chip about.

**Findings group by why they matter — never by jurisdiction or class.** That grouping is code's: the
reasoned negatives render under a heading whose ground comes from the finding's typed `disposition` /
`off_field_ground` / `manageable.category`, with the shared ground in a parenthetical, stated **once**.
So a card body never re-derives its group's shared ground — *"as with the other marks in this section,
the fields do not meet"* is the sentence the grouping exists to delete. Carry what is this finding's
own: its goods, its owner's actual business, its specific reason.

**The card does not author the finding sentence.** `- net:` is stamped by the driver from the finding's
typed `net` (written once in `synthesis`); its shape is specified in
[synthesis-rules.md](synthesis-rules.md) → *The finding sentence*, and nothing on the card restates or
re-condenses it. One finding, one summary, one source.

**Honesty — a negative is a searched result only if a search produced it (spec 09 §2, rule 7 / v2).** "No
marketplace use of [mark] found" is a *result* — write it only when a search actually ran for that mark. If the
basis is an inference (the owner looks like a music act, not a games company), say that: "owner is a music-act
entity; no targeted use-check ran, so there is no use finding either way", never a clean negative. Note the
shape — the un-run check is a FACT with its consequence, not a recommendation to run one ("— recommended" is
prescription grammar, ruled out; a check a human must still make is a typed action the code renders). Once WS2's use-check runs, the
finding's actual-use line carries the searched result + link (and the "Checks we ran" bucket states it). Never
dress an un-run check as a searched negative — on any surface (report, cover, client table).

**Source layer on every card (spec 09 §5, v2).** Each `## ` card carries a `- source: Register | Common-law |
Both` meta line (which layer surfaced it), rendered as a small tag on the card head and reflected in Full
detail — **detail level only, never the top-line summary**. **Show what common-law actually contributed.** When
the marketplace / meaning search surfaced or strengthened this finding — it is *why* some conflicts lead at all
(e.g. an active competitor found selling under the mark in our field) — say so in one plain clause in Full
detail: what the marketplace/meaning check actually *found* for THIS mark. And keep what was **checked**
(searched and found) separate from what is only **assumed** or still **to-do** — a not-yet-run check is carried
as an explicit "not yet verified" or a `# Actions` open item, never dressed up as a result. **Do NOT** write a common-law telemetry line into
`# Methodology` (platform/storefront counts, variant counts, "N surfaced, remainder clean", cell-matrix sizes,
the audit-Excel matrix size): that run telemetry lives in the run-dir / audit, not the report body. The
coverage panel (rendered from the typed `coverage[]` states) and any genuine gap as an `# Actions` open item
carry what the reviewer needs about coverage; `# Methodology`, when present at all, is a short plain-English
scope note only.

**Coverage = open items, not a telemetry panel.** Coverage is drawn **only** from the typed `coverage[]` array in
`findings.json` (states: `confirmed-clean` / `coverage-limited` / `open` / `not-searched` / `note`), which the
render turns into the coverage panel deterministically. `report-overview` does **not** author a `# Coverage`
section or enumerate confirmed-clean areas / clean-checks in prose. doc-35 close-the-loop: a `coverage[]` area
that is `open` / `not-searched` / `coverage-limited` and **search-reachable** is CLOSED in the run or an INTERNAL
reviewer note — it does NOT surface as a client `# Actions` item; a genuinely **un-cleared dangerous slice** the
search could not close is stated in the **risk read as analysis** (it also clamps the verdict to CONDITIONAL),
never a client "gap we should close" caveat. Only a **client-only** ask (no search reaches it) is a `# Actions`
item, under "Only you can close these". `confirmed-clean` / `note` areas are not gaps and are not actions. The
`overall_caption` never **leads** with a coverage gap — it leads with the substantive risk.

**Coverage prose — the numbers are code's, the substance is yours (P6).** The register coverage line a reader
sees is computed from the run's own record (`scope-facts.mjs`) and stamped as the `coverage_line:`
front-matter beside `classes:`. **Never re-type its numbers in prose** — not in a card, not in `# Actions`,
not in `# Methodology`. The code-stamped line is deliberately outside the prose scan (front-matter is
stripped before `predelivery-lint.mjs` looks), so a duplicated count is not caught for you and does not
"disagree" with anything — it simply drifts from the record the next time the run is republished. Carry the
substance, drop the number: *"the remaining forms are non-Latin script"* is the useful half; the stamped line
says how many. And **say which kind of negative you hold, every time**: a source this run queried and got
nothing from reads *"searched — none found"*; a source it never reached reads *"not searched this run"* or
*"could not be searched — <reason>"*. The same source must never wear both readings in one report.

**Emission voice — numbers, inferences, attributions (CHANGE 5).** (a) **No floating registration numbers in
prose.** The per-record structured render is the source of truth for registration / application / serial numbers
(the code lane renders them); a card's prose (`### Full detail` narrative bullets) names the
OWNER + MARK and does not float the number — the only place a number appears is the final `- Source:` bullet's
`<id>`. (b) **An inferred enforcer reads as an inference.** A litigiousness / enforcer claim reasoned from a
signal (owner size, a good law firm, portfolio shape — `inferred-from-signal`) is presented AS an inference ("on
the available signals the owner appears likely to object…"), never as established fact; only a `verified-from-record`
enforcer (a filed action / C&D / litigation on record) is stated as fact. (c) **Off-record attributions carry a
source or are omitted** — a corporate-history / ownership-transfer / affiliation claim that is not itself a
fetched register or common-law record fact (e.g. "acquired by X in 2024") needs an inline source or is left out
(set in `synthesis`; the report never re-introduces an unsourced one).

**Evidence & precision (spec 09 v1).** For an ambiguous fact, give the base-rate counts, not an adjective ("of
marks filed that week: 966 registered, 453 refused, 691 pending", not "a crowded field"). A bounded rating
carries its scope in parentheses ("Medium (Germany only)", "(only while the application is live)") — never
unscoped where scope exists. Never assert foreign procedure as fact — "as we understand [jurisdiction] examination
practice…"; and where the run could not reach the practice at all, that limit is a **fact stated once**
("the Irish position turns on local examination practice this run could not reach"), never a **referral
parenthetical**. "(local advice needed)", "(subject to local counsel)", "(confirm with local counsel)" are
prescriptions and never appear on any surface — the ask itself is a typed action in the `actions` register,
which code renders ([report-prose.md](report-prose.md) → *Fact · assessment · prescription*). Where the
owner's own site/words undermine their claim, quote a short **sourced** fragment (attribute + link, never
invent).

**Plain language (rule 8) — every surface, including this internal report the reviewer reads.** No coined
jargon; a smart non-lawyer must follow each finding line without a glossary. The skill's internal-reasoning
vocabulary is for reasoning, never output — TRANSLATE it, don't echo it: `apex` → "the single highest-risk
conflict" (or name the mark); the STACK `bare-token … HAPTICS-formative incumbents` → "other owners of marks
containing [term]" — a SINGLE `[MARK]-formative` is fine (normal trademark vocabulary; only the *stack* is
banned); `spine` / `ranking spine` → don't surface (say "we
ranked by …"); `saturation` / `saturated` → "crowded field" / "many similar marks"; `slice` / `SDK slice` →
"the developer-tools goods (class 9)".

**The substitutions are illustration; the rule is the test.** They are examples of one failure, not its
boundary, and a list cannot be the boundary: `slice` sits in the list above and has still gone out to a
client, alongside other engine words the list never anticipated. Ask the question of every noun (*does
the reader already own this word?*), never only of the words listed here. The standard is
[report-prose.md](report-prose.md) → *The reader owns every noun*.

**No second person, no named individuals (rule 9) — every surface.** Never "you" / "your" — write "the client"
or impersonal. Never address the reviewer by name ("[Name] —"). Flags and actions are impersonal imperatives ("Confirm
whether the client has prior use predating <date>", not "you should confirm…"). Owner / filer names (the parties
behind the marks) stay — they are the findings' subject.

RETIRED — this told the seat to surface the reviewer's open points at the top of
`# Actions`. The driver code-builds that section from the review and places it at the TOP OF THE BODY
(T3a, `buildReviewerOpenPointsSection`), which is a different place, so following this sentence produced a
second copy in the wrong one. It was true when the driver's half did not exist; spec-49 deleted that half
and T3a brought it back, and this line went false where it stood without anybody editing it. The substance
survives in the code: impersonal, at the top, never withheld.

## House prose contract (P6 — spec §7 + the lawyer walk-through)

Prompt guidance, deliberately **not** a lint: a code gate on prose adds redelivery cycles and removes the
flexibility the judgment needs. The stage message carries the same contract verbatim — these two levels
must never teach different rules.

**This section is the PROHIBITIONS.** What a good finding positively reads like is
[report-prose.md](report-prose.md), which every prose stage reads: fact · assessment · prescription;
hedge the assessment, never the fact; numbers do the work adjectives would; say it once; concision never
trades away a fact; the controlled assessment vocabulary. Read both — a card that breaks none of the
rules below can still be unreadable.

- **Word budgets.** ~20–25 words a sentence, ~80 a paragraph. The hard caps code folds at (3-sentence
  caption, 2-sentence read) are **fold points, not targets** — three 60-word sentences obey the cap and
  defeat it. One idea a sentence; 3+ parallel items become a list.
- **Each fact once, at its rank.** A finding is stated in its row; the caption names the decisive one and
  no other; a later section **cross-references by ordinal** (*"the three US class-32 rights — findings 1, 4
  and 7"*) instead of retelling. The delivered report told one mark in six of its nine sections — that, not
  sentence length, is what made it undigestible, and the section spine already holds each fact once.
- **No prescriptions (ruled).** State the position, never the remedy. No *"we recommend / advise /
  suggest"*, no *"you should"*, no *"the practical path is"*. Forward steps live **only** in the typed
  actions register.
- **No disclaimers (ruled).** None per card, none in the caption, none in the email. A real limit is a
  **fact**, stated once, in consequence terms: *"Chinese-script registers were not searched, so a Chinese
  filing could surface later."*
- **One reader, one posture.** Every surface is for the reviewing lawyer, in the calibrated register of an
  advisory preliminary assessment. Never hedge *more* on one surface than another; never flatten one to
  bald assertion. The hedge is calibration, **never** a substitute for a fact the run holds.
- **The reader owns every noun.** Every noun on a reader surface is a word the reader already holds — from
  their business, their market, or the law said plainly. Where the run has no reader-facing word for a
  thing, **describe** it rather than name it: *"the full variant band enumerated to zero"* → *"we searched
  every spelling of the name and found no live rights"*. One pass is the bar — a smart reader who is not a
  lawyer takes the meaning the first time. Judge the sentence, never the word: a mark genuinely called AXIS
  or BAND is written exactly as it is named ([report-prose.md](report-prose.md) → *The reader owns every
  noun*).
- **Language (from the walk-through).** Say the level (*"a manageable risk"*), never its neighbours
  (*"sits below that level"*). *"<MARK>-formative rights"* / *"rights that contain <MARK>"* — never
  *"<MARK>-branded"*. Never assert a fact about the client's own file (*"consent is not in hand"* → *"no
  consent appears on the record searched"*). Private acts — C&D letters, settlements, licences — are
  unreachable by any search: their absence is never evidence. Name the legal test in plain words
  (*"applying the well-accepted framework for confusion"*), never a court's factor template. Cut filler
  (*"session-wide notice coverage"*, *"it is worth noting that"*).

---

## `audit.md` — the full audit record (mechanical re-format; emit EVERY finding)

Same forgiving labelled-block markdown. Three sections:

```
# Findings
## <finding / mark text>             ← block title = the finding name
- source_layer: Both                 ← Register | Common-law | Both | Cross-pollination
- type: Direct Conflict
- owner: <owner>
- owner_country: SG
- classes: 9
- status: Live (Registered; …)
- dates: filed … / renewed …
← (no per-finding risk fields here — the audit is the factual record; the rating is the finding's band
←  word, per the framework in force, carried in findings.json and the curated report)
- source: <provider record refs>
- url: <record base host>/mark/<cc>/<number>   ← the composed record URL (Record-URL contract: the ACTIVE provider's base host from `prelim-register/providers/<name>.md` + `uri`); emit the full URL, never a bare /mark/… path and never a host belonging to a register this run did not search
- description: <one line>
- key_factors: ELEVATION: …  MITIGATION: …
- cross_ref: N/A
- search_terms: <variants used>
- verify: ✅

## <next finding>  …                  ← ALL findings (register + common-law), not just the headline ones

# Negative Results
## NR1
- source_layer: Register
- search_term: PROJECT NAME (exact)
- platform: <provider> — worldwide
- result: 0 identical hits
- notes: …
## NR2  …

# Audit Trail
## AT1
- source_layer: Variants
- step: Step 0–6: Archetype + manifest
- query: …
- rationale: …
- source: <stage / tool>
- result_summary: …
- tool_call: N/A
- finding_ref: Manifest
## AT2  …
```

Pull Findings/Negatives/Audit-Trail straight from `register-findings.md` + `common-law-findings.md`
(+ placements). This is re-formatting existing analysis into the block shape — do not re-analyse or
re-search. Omit a key if the source doesn't have it; `Mark` defaults to the report's title at render time.
