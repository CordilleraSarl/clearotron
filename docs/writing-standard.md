# Writing standard

Every surface a user reads: report HTML, portal screens, README, docs. Two parts.

## Part one: how to write

`writing-rules.md` beside this file is the prose standard, and it applies to every sentence in those
surfaces before anything below does. Read it in full once. The six rules it says to enforce first, because
they are the ones a trained writer and a language model both break by instinct: no hedging, no
over-explaining, keep it short, no metadiscourse, finish strong, and do not fake contradiction. If a
sentence sounds like a language model wrote it, rewrite it.

## Part two: the product's own rules

Eight rules, each with the sentence that caused it.

## One header per page, and nothing restating it

A page names itself once. A line under the title earns its place only by saying something the title
does not.

- Before: `Home` over `Now`.
- After: `Home`.

## Example text goes inside the field

A field's example belongs in its placeholder, where the reader is typing. A sentence above the field is
read before the reader knows what the field is for.

- Before, above the field: "A sentence is enough, or paste the whole thread."
- After, in the field: "Need a quick check on AQUAPLUS for energy drinks in the US before Friday."

## No caveat, no disclaimer, no "what this is not"

Say what the search did and what happens next. Never define the product by negation.

- Before: "What it is not. A clearance search. We drew no register conclusions and give no filing advice."
- After: "A name that passes here goes on to clearance."

## No engineering word in anything a user reads

Error codes, connector names, routing tables and internal identifiers are not the reader's vocabulary.
State the limit and its consequence.

- Before: "the Japan adapter was unavailable this session (CONNECTION_CLOSED)".
- After: "Case-law research could not be completed for Japan."

## A count only when it changes what the reader does

Register hit counts tell a lawyer how crowded a field is. Keep those. Activity counts measure the
engine, not the answer.

- Before: "Fifty-two meaning and connotation queries were run across the Latin, katakana and hiragana forms."
- After: "Meaning was checked in three scripts; nothing loaded attaches to the name."

## The product's own words for its own states

A state has one name, used on the screen, in the report, in help and in the export.

- Before: "No permissions".
- After: "View reports".

## The audit lives in the workbook and the MCP server, never on the page

Every search run, every empty result and the working notes go to the audit workbook, and the MCP server
answers questions about any of them. The page carries the finding.

- Before: "Source routing attempted: Per the source-selection table, Japan is a non-US, non-EU
  jurisdiction, so the applicable adapter is…"
- After: nothing on the page. One row in the workbook.

## A fault is fixed, or shown to the person who can act on it

A reader cannot repair a missing coverage record. Narrating the failure to them turns our defect into
their problem.

- Before: "No coverage record was produced for this run. This section normally lists what each search
  covered and what is still open… Ask us before relying on it."
- After: the operator is told; the report carries the coverage that exists.

## What holds these

`enforcement.md` lists the classes a CI check refuses in a diff. Tone is not one of them, and no word
list will ever catch it: a reviewer reads the rendered page as someone who has never seen this product,
against `writing-rules.md`, and asks what they would think each sentence means.

A stylesheet that is inlined into a delivered document is delivered with it, comments included — the
reader receives the file, so a class name in a CSS comment is engineering vocabulary on a page they can
open, exactly as it would be in prose.
