# clearance-common-law — MEANING

> Read `SKILL.md` first (the shared spine). This file is the meaning sweep: the PR / reputational section of the findings file, and the rulings you record for it.

### PR / reputational risk

Covers the core element(s) **and their plausible near-forms** (the connotation hazard often rides a
near-form — `mora` ("blackberry") → `Mara` = a gang name — not the literal mark). `(None identified)` may be written
**only when the searched social/subcultural web came back empty** — never on a dictionary gloss. "It just
means *blackberry*" is context, not a clearance: a connotation reads clean only when Urban-Dictionary / Wikipedia
/ news / forums were searched (on the near-forms too) and surfaced nothing.

**Surface what the meaning search actually returned — a receipt is not a read.** Even when your call is clean, do **not** collapse the meaning sweep to a bare `(None identified)`: for the mark **and each near-form**, name the actual readings the search surfaced and label each benign or loaded (e.g. `mora → "blackberry" (benign); Mara → a Central American street gang (loaded)`). You are an extraction worker — lay out what the social/subcultural web actually returned per form; you do **not** make the final clearance call. The strong synthesis layer reads that material and decides whether a loaded secondary reading needs pulling. A row that only says "searched, nothing found" hands synthesis a verdict instead of the evidence it needs to look past the obvious gloss.

| Finding | Source | Notes |
|---|---|---|
| meaning readings surfaced | Urban Dictionary / Wikipedia / news / forums | per form, the readings the search returned + benign/loaded label — e.g. `RAISE → ordinary verb "lift" (benign)`; near-forms `RAIZE / RAYSE → no slang/gang/offensive reading`. Write `(None identified)` as the *bottom line* only after the readings are laid out and none is loaded. |

A clean PR/connotation row MUST cite its search — add a `**Connotation-search source:** <URL | "perplexity_research — no result">` line. The driver dictates the meaning sweep into the grid (the matter frame's meaning questions) and the plugin records every query into the ledger's `extras.pr_risk[]`; the `commonLaw` validator rejects a `(None identified)` claim with no recorded queries (`connotation_search_missing`). An empty-results search is a clean receipt; a *missing* search is not.

The dictated sweep is the matter frame's own meaning questions (its `Meaning angles:` line — the cultural
origin and communities the word evokes, charged historical or political associations of the term or its
imagery, category-specific controversy for these goods, what the mark means in each language whose market
matters, and any slang, gang or offensive reading), and this section's scope is exactly that sweep — never
a generic sensitivities checklist. Each is recorded into `extras.pr_risk[]` and policed by the identity join.

**Receipts disposition (machine-enforced). You send VALUES through a tool; you never write or edit a
file for this.** When the grid tool returns, its result lists every meaning obligation you owe — one row
per recorded meaning query that returned results: the query itself, and under it that query's own
candidate receipts, numbered. Record every ruling by calling `record_dispositions`, passing
`grid_spec_path` (the same driver-written spec path the grid tool was given — never a path you compose)
and `rows`, one entry per obligation:

- `row_index` — the NUMBER printed beside that obligation in the obligations block: 1 for the first,
  2 for the second, and so on. **Not an id, and not the query text.** The block prints no identifier for
  a row and never has; the number beside it is the address;
- `receipt_index` — the POSITION of the candidate you ruled on in that row's own list: 1 for the first,
  2 for the second, and so on. Not its id. **You never type an identifier here**, and you never retype a
  query, a title or a URL — the driver resolves the position to the id and records it for you. A row
  listed with exactly ONE receipt is already resolved: give it only your `ruling` and `note`;
- `ruling` — exactly one of `benign`, `off-topic`, `loaded`, `inconclusive`;
- `note` — one line: what the receipt says and why it reads that way. An `inconclusive` row's note owes
  something different — what you could not establish, and what a human should look at;
- `segment_index` — **required on every row the tool's answer marks as owing it**, and only those; `fragment` is optional:
  - `segment_index` says **which** passage. The receipt you ruled on carries its snippet split into
    numbered passages; give the number of the one you relied on. It is checked only for being in range,
    so there is always an answer.
  - `fragment` is **optional and never refused.** The driver copies the passage into the record from the
    number alone, so the number is the whole obligation. If a few characters of that passage come easily,
    send them and they are recorded as a check on transcription; if the script is one you cannot
    reproduce, omit it. **Do not translate** — a translation is not a copy, and an empty field is better
    than a wrong one.
  **It does not have to mention the mark.** The check is that the text you point at is really in that
  passage, not that the receipt is about the mark. A row owing segment_index is accepted once the number names a passage with text. If the material seems
  off-topic, point at it anyway and rule it `off-topic`.
- `obstacle` — **only when you cannot evidence a row at all**, and never instead of judging it. One line
  saying what stops you: the passages are elision markers with nothing quotable in them, the snippet is
  truncated mid-word, the text you need is not in any passage of the receipt you ruled on. Send it
  **alongside** your `ruling` and `note`, not in place of them. The row is then recorded as undecided,
  with your sentence shown to the reviewing lawyer in place of proof, and the stage completes instead of
  stalling on it.
  **Try first.** Pointing at a passage is checked only for being in range, and any passage with text in it will do. A fragment is recorded, never refused. A row where some passage is quotable is a row you can discharge, and one production run spent 217
  calls on a receipt that was quotable seven different ways. `obstacle` is for the receipt that genuinely
  offers nothing, not for the one that is awkward.

Rows are validated as they arrive, per row: rows that validate are KEPT even when others in the same
call are refused, and the answer names each refusal, every obligation still outstanding, and which of
them owe a `segment_index` and `fragment`. Send up to the per-call limit and the rest in a further call — you never have to
guess whether you are finished, and you stop when the answer reports nothing outstanding.

**Two kinds of row.** Most are `kind: "query"` — one query, its candidates, and you choose which one
you ruled on. Some are `kind: "recurrence"`, and they differ in three ways:

- **`queries` is a LIST**, not one string: every distinct query that surfaced this same result. Four or
  more distinct queries promotes a result to load-bearing *by recurrence* — the sweep kept finding it,
  whatever any single query concluded — and this row forces that receipt onto the page.
- **The receipt is already chosen.** One candidate, resolved by the driver, and no `receipt_index` to
  give. You rule on a named result, you do not select one.
- **You still owe `ruling` and `note`.** The note says what the result is and why it reads that way
  across the queries that kept returning it.

**If the material does not support a confident ruling, say so — do not improvise, do not leave it
out.** `off-topic` only when it genuinely is. When it is on-topic but you cannot responsibly call it
`benign` or `loaded` from what the receipt shows — contested sources, material serious enough that a
guess is worse than a gap, a snippet too thin to judge — rule `inconclusive` and use the note to state
plainly what you could not establish and what a human should look at. `inconclusive` raises it to a
Finding exactly as `loaded` does, which is where an unresolved reputational question belongs. A confident
`benign` on material you could not assess is the one outcome no gate detects and no reader recovers from.
This is about the JUDGMENT, and it stays the answer for one you cannot make — `obstacle` above is a
different thing entirely, for a row you have judged and cannot prove you read.

**`loaded` and `inconclusive` are different answers, and the report prints them apart.** `loaded` is a
judgment you made — the reading is charged, and your note says what the material is and why it reads
that way. `inconclusive` is a judgment you declined to make — your note says what you could not
establish. Both reach the reader as a Finding; what changed is that the reader can now tell which one
you handed them. Do not reach for `inconclusive` to duck a call you can make: an open question a human
must chase costs more than a ruled row, and the value is worth having only while it means what it says.

Declining to improvise is correct, and the contract carries it: a seat that will not invent rulings on
gang names or abuse-ring material is doing the right thing.

**Your rulings accumulate across calls and across attempts:** the driver folds each accepted row into
its own record, so a row you have ruled on stays ruled and a corrective turn never re-earns work you
have already done. Nothing is transcribed anywhere: you never retype a query, a title or a URL, and you
never author, edit or save any dispositions file — the one route a ruling can take is the tool call.

The driver renders these into the canonical findings file as the PR / reputational disposition table, so
do **not** hand-write that table. This section still carries your own narrative, and a charged reading
still becomes a Finding — whether you ruled it `loaded` or declined it as `inconclusive`.

A query LIST without a ruling is not a disposition. The validator
judges the recorded rulings against the same obligation list the tool computed, and rejects the turn
while **any** row is unruled, whatever this section concludes. Reporting a loaded reading does not
discharge the other queries; the two are different facts and only the second is what the gate
establishes. Queries whose recorded results are empty get no row at all — the empty receipt is itself
the clean evidence.

**What the failure tokens mean.** These tokens can reach you, and they
mean different things:

- `connotation_call_never_made` — rulings are owed and `record_dispositions` was never called this run.
  Rulings written into your findings prose are not read by this check. Call the tool.
- `connotation_call_partial` — rows landed and obligations remain. Everything recorded is KEPT; send
  only what the answer lists as outstanding.
- `connotation_call_truncated` — a call was killed in flight before its rows were recorded. The
  driver's fault, not yours: re-send that chunk as it was, and never re-derive your rulings.
- `connotation_call_schema_violation` — calls arrived and no row was accepted: the payload SHAPE is
  wrong. `rows` is an array of objects with integer `row_index`, `ruling`, `note`, integer
  `receipt_index`.
- `connotation_form_damaged` — a recorded row's receipt is no longer one of that row's own candidates
  (a ledger top-up can re-deal a row's candidates). Re-send only the named row(s) with
  `receipt_index` set to a position; never type an id.
- `connotation_quote_unbound` — **the row is ruled and accepted; only its evidence did not join.**
  Re-send only the named row(s) with the evidence corrected and nothing else changed. The tool's own
  answer names which of the two fields is wrong, and they have different remedies:
  - `segment_absent` / `segment_invalid` — no passage number, or a number that is not one of that
    receipt's passages. Give a number in the range the answer states.
  - `segment_dead_end`

A spot-checked row is where you show you read the receipt. Only a few rows per run carry it and the driver
picks which, so it is never a transcription tax on the whole sweep — and because the passage number does
the finding, the copied characters can be short in any script.
