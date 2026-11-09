# Delivery contract — `report.md` + `audit.md`

The driver assembles `report.md` from typed values. `report-overview` sends the caption and the shell's values; `report-card` sends one finding's `full_detail` entries. The driver orders the cards.

---

## `report.md` — the curated client report

What a card must SAY is in
`report-prose.md` and the risk framework; what it must LOOK like is code's.

**Curation:** The finding's disposition chooses the report band a card renders in; it never recomputes the finding's rating. Mirror the run's actual data. Rating vocabulary is the band words
of the framework in force (`risk-framework.md` house default, or the profile-selected
`risk-framework-<customer>.md`); synthesis discipline follows `synthesis-rules.md`.

**Banding by disposition (placement only — never the rating).** Each finding's `disposition` sets where the driver places it: adversarial among the conflicts, coexistence-partner and distinguished under notable but manageable, off-field as awareness. It never changes the band.

**Distil for the reviewing lawyer (the one reader).** Lead with the decision: `overall_caption` is at most 3 sentences of plain legal English.
`# Actions` lists the open external checks — both surface above the fold.
The card's risk chip is code-built from the finding's `band` + disposition; the typed `net` and
`overall_caption` are plain legal English: the consequence and the fact that conditions it, with no risk codes and no step to take — never
engineering/pipeline register. "Full detail" is collapsed.
This is distillation by *removal and relocation* — do not add length to hit it.

**Prose & curation (spec 09).** Cut dead weight and throat-clearing; one idea per sentence; 3+ parallel items
become a `- ` list (**inside card bodies too**), never an inline `(a)…(b)…(c)` run; verdict-first; numbers over
superlatives, no intensifiers or GPT-isms; say each caveat once. **Depth-on-click, not length-on-screen:** the
card head + the typed `net` are always visible; everything heavier goes to `### Full
detail`. The highest-risk card must be the **clearest**, never the longest.

**Order inside a card, and inside the report.** Verdict first, then what was looked for and not found,
then what was found — at every scale. In `### Full detail`, send the Risk assessment entry first.
Send a filing fact only where it carries the read: the driver prints the registrations.
A card that opens with a filing date makes the reader hunt for the
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
finding's actual-use line carries the searched result + link. Never
dress an un-run check as a searched negative — on any surface (report, cover, client table).

**Source layer on every card (spec 09 §5, v2).** Each `## ` card carries a `- source: Register | Common-law |
Both` meta line (which layer surfaced it), rendered as a small tag on the card head and reflected in Full
detail — **detail level only, never the top-line summary**. **Show what common-law actually contributed.** When
the marketplace / meaning search surfaced or strengthened this finding — it is *why* some conflicts lead at all
(e.g. an active competitor found selling under the mark in our field) — say so in one plain clause in Full
detail: what the marketplace/meaning check actually *found* for THIS mark. And keep what was **checked**
(searched and found) separate from what is only **assumed** or still **to-do** — a not-yet-run check is carried
as an explicit "not yet verified" or a `# Actions` open item, never dressed up as a result.

**Coverage = open items, not a telemetry panel.** Coverage is drawn **only** from the typed `coverage[]` array in
`findings.json` (states: `confirmed-clean` / `coverage-limited` / `open` / `not-searched` / `note`), which the
render turns into the coverage panel deterministically. `report-overview` does **not** author a `# Coverage`
section or enumerate confirmed-clean areas / clean-checks in prose. doc-35 close-the-loop: a `coverage[]` area
that is `open` / `not-searched` / `coverage-limited` and **search-reachable** is CLOSED in the run or an INTERNAL
reviewer note — it does NOT surface as a client `# Actions` item; a genuinely **un-cleared dangerous slice** the
search could not close is stated in the **risk read as analysis** (it also clamps the verdict to CONDITIONAL),
never a client "gap we should close" caveat. A forward step a human must take is a typed entry in the `actions` register, written in synthesis and rendered by code. The shell's `actions` carry results only. `confirmed-clean` / `note` areas are not gaps and are not actions. The
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

## House prose contract (P6 — spec §7 + the lawyer walk-through)

Prompt guidance, deliberately **not** a gate: a code gate on prose adds redelivery cycles and removes the
flexibility the judgment needs. The stage message carries the same contract — these two levels
must never teach different rules.

**This section is the PROHIBITIONS.** What a good finding positively reads like is
[report-prose.md](report-prose.md), which every prose stage reads: fact · assessment · prescription;
hedge the assessment, never the fact; numbers do the work adjectives would; say it once; concision never
trades away a fact; the controlled assessment vocabulary. Read both — a card that breaks none of the
rules below can still be unreadable.

- **Word budgets.** ~20–25 words a sentence, ~80 a paragraph. The one hard cap is the 3-sentence caption; it is a limit, not a target
  — three 60-word sentences obey the cap and
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
