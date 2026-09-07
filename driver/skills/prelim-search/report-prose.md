# Report prose — what a good finding reads like

Every earlier ruling about report prose was a **prohibition**: no advice, no disclaimers, no repetition
(the *House prose contract* sections in [synthesis-rules.md](synthesis-rules.md) and
[delivery-contract.md](delivery-contract.md)). Nothing stated what a good finding should READ like, so
the prose drifted to model defaults — hedging, over-explanation, adjectives, the same point four to six
times. This file is the other half: the **positive standard**, derived from three trademark lawyers'
actual clearance reports, which agree with each other.

It is guidance, **not a checker**. No lint rule reads this file and no delivery gate fails on it — a
prose checker is a rule engine that flattens the writing and then passes its own test.

**The reader is a lawyer who layers advice on top.** The report is facts, evidence, assessment. That one
sentence generates most of what follows.

Every stage that writes a line a reader sees is held to these rules: `synthesis` (the narrative and the
typed findings), `report-overview` (the shell), `report-card` (the cards). The **form** each of those
writes lives in that stage's own file — the finding sentence and the grouped reasoned negative in
[synthesis-rules.md](synthesis-rules.md), the card and section shape in
[delivery-contract.md](delivery-contract.md). What is below is general and is stated only here.

## Fact · assessment · prescription

Three different things, and only two of them belong in a report.

- A **fact** is what the record shows: *"US registrations lapsed (specimen due 2019)"*.
- An **assessment** is your read of a right's strength: *"vulnerable to non-use cancellation"*,
  *"no obvious commercial overlap"*.
- A **prescription** is what the client should do: *"file in Switzerland first"*, *"consent is
  required"*. It **never appears.**

Facts and assessments stay. Prescriptions go — every forward step a human must take is a typed entry in
the `actions` register, which code renders.

**A referral parenthetical is a prescription.** *"(local advice needed)"*, *"(confirm with local
counsel)"*, *"(subject to local advice)"* — cut them. They read as hedges but they are instructions,
and they are instructions the reader is better placed than we are to give.

## Hedge the assessment, never the fact

**Facts land flat.** No *"appears to have"* or *"it seems that"* in front of a record fact — the record
either says it or it does not, and a hedge there tells the reader the search was uncertain when it was
not.

**An assessment gets exactly one precise hedge** — *"appears revocable"* — not a spray. *"May
potentially appear to be arguably vulnerable"* says strictly less than *"appears revocable"* and costs
four times the words. One hedge, chosen for what it concedes.

**Explicit exception — never train this one away.** A finding declared `borderline_between` two bands
is a **required** hedge. The framework's own criteria did not settle which band the conflict belongs
in, and recording that is a correct professional outcome, not weak writing.

## Numbers do the work adjectives would

*"132-filing portfolio"*, not *"large portfolio"*. *"~70 'mixed' reviews"*, not *"poorly received"*.
*"545 live filings worldwide, 6 in class 9 in the target markets"*, not *"a heavily crowded field"*.

The number is shorter than the adjective and it lets the reader disagree with you.

**Where no number exists, name the fact — do not characterise it.** *"A two-person studio with one
shipped title"* is a fact a lawyer can use; *"a small player"* is an adjective wearing its coat.

## Say it once

**A principle is stated in one place and referenced after.** Never restate the verdict inside each
section: the report's structure already holds each fact at its rank, and a cross-reference by ordinal
(*"the three US class-32 rights — findings 1, 4 and 7"*) is what replaces retelling.

No section preambles. No *"it is important to note"*. No metadiscourse about the search — *"our
analysis proceeded by…"*, *"this section examines…"*, *"we then turned to…"* — the reader can see what
the section is from its heading.

## Concision never trades away a fact

**If removing a sentence removes evidence a lawyer would need, it stays.** The budgets and the caps
exist to cut restatement, hedging and adjectives. They never cut evidence, and a cut that loses a fact
is a defect however short the result reads.

**Evidence lists are never compressed for rhetoric.** A clearance has as many conflicts as it has.
Naming eight and summarising three is not concision — it is an incomplete answer dressed as a tight
report.

## Assessment vocabulary — a controlled core

The **verdict words** are controlled. The **evidence sentence** is free prose, and stays free.

- *vulnerable to non-use cancellation*
- *appears revocable* · *may be partially revocable*
- *no obvious commercial overlap*
- the framework in force's own band words, **verbatim** — that framework file is the rating authority
- where `borderline_between` is declared, both band words as that framework names them

Reusing a defined term is **not** repetition — it is the reader recognising the same assessment they
read three findings ago. Minting a synonym (*"seems cancellable"*, *"looks shaky"*, *"a bit exposed"*)
makes them work out whether you meant something new, and usually you did not.

[synthesis-rules.md](synthesis-rules.md)'s revocability rule states the same assessment in its Key
Factors form (*"vulnerable to partial revocation in [classes] on non-use grounds"*). That is the **same
term**, not a second one — do not mint a third phrasing for it.

Control the verdict words. Never control the evidence sentence: that is where the facts of this
particular matter live, and a controlled vocabulary there would flatten exactly what the reader came
for.

## The reader owns every noun

**Who the reader is has not changed; what may be assumed of them has.** The addressee is still the
reviewing lawyer who layers advice on top — that is what sets the posture, the hedge and the depth. It
has never set the vocabulary. [delivery-contract.md](delivery-contract.md) holds *every* surface,
"including this internal report the reviewer reads", to a line **a smart non-lawyer follows without a
glossary**, and [synthesis-rules.md](synthesis-rules.md) says the same of every finding line. Both claims
govern the same surfaces, so where they meet, the wider one binds: the lawyer is who the report is
**written for**; the smart non-lawyer is the comprehension floor it never drops **below**. Every line here
is read downstream, too: a card's sentence and an action's text reach the client verbatim, and the cover
note is assembled in code around that same caption.

So the rule is not "avoid jargon", and it never was. Trademark vocabulary a lawyer uses daily belongs
here: a class number, a specification, an opposition, a formative mark. **What does not is this engine's
own vocabulary** — the words the machine has for its own parts and its own acts. A lawyer is no better
placed than a client to decode those, because nobody outside this project was ever given them, and no
context on the page supplies one.

**Where there is no reader-facing word for the thing, describe the thing.** The description is the
finished sentence, not a stand-in for the term you meant.

> ✗ The full variant band enumerated to zero.
>
> ✓ We searched every spelling of the name and found no live rights.

> ✗ Annexed on mark distance, not cleared on goods.
>
> ✓ The right was set aside because the marks look different, not because their goods were checked.

The same engine writes the standard on its good days, and this is it:

> ✓ Every other right on the record turned out narrower than its class number suggested once the
> specification was read.

Nothing there is simplified. It carries a finding, the evidence behind it and its limit, and a smart
reader takes it in one pass. One pass is the bar.

**Judge the sentence, never the word.** A mark, an owner or a product genuinely called AXIS, SLICE or
BAND is written exactly as it is named — the same letters are a defect in one sentence and the client's
own brand in the next. That is why this is a reading and not a list. A word list catches the brand,
misses the next coinage, and teaches the writer to swap one opaque word for another; the question it
cannot ask is the only one that works, asked of each noun: **does the reader already own this word?**
