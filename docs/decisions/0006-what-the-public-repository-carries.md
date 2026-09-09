# 0006 — What the public repository carries

**Accepted 2026-08-17, by the owner.**

## Context

The documentation set reached 212,000 words across 142 files. A reader arriving to install the engine, pick
a register and run a clearance needs a fraction of that. The rest is product framing, internal mechanics
and release history — each true, none of it load-bearing for that reader.

Five documents were reviewed against the question *does somebody need this to use or change the engine?*
and none of them passed: `docs/THE-OFFERING.md` (2,217 words), `docs/KNOCKOUT.md` (1,532),
`docs/REGISTER-HIT-COUNTS.md` (1,470), `docs/JX.md` (1,419), `CHANGELOG.md` (803).

## Decision

**The public repository carries what somebody needs to install the engine, choose a register, run a
clearance, and change the code. Nothing else.** In particular it carries no product framing, no marketing
material, no worked internal mechanics for a lane, and no historical narrative.

Four of the five documents above are withheld. They stay in this repository, which is the archive; they do
not cross at the cut. **`CHANGELOG.md` left this list on 2026-08-31 (owner ruling:
the landed release-pipeline decision is master).** The 803-word hand-written file this record reviewed was
already absent; what carries the name now is the release pipeline's machine-compiled, plain-language,
public-facing changelog — release history a reader of the public repository is meant to have, which the
"no release history" clause above never contemplated. Its `shared/withheld-paths.mjs` entry is removed
under the same ruling. The CUT rule that decides it arrives together with the file at the first release
cut, not before: `cut/rules.mjs` treats a rule matching nothing as a refusal, so a rule for a file that
does not yet exist cannot be pre-added, and `driver/test/release-pipeline.test.mjs` reds the moment the
file exists undecided.

**The drop list is `shared/withheld-paths.mjs`, and it is the only place a cut decision is recorded.** A
decision recorded anywhere else — an issue, a chat, a comment — is not recorded.

**Amended 2026-09-09.** This paragraph named two tests as the enforcement: `publication-scrub` and
`no-caveat-repair`. Neither exists. Measured across both repositories that day: neither file is tracked,
neither is on disk, and neither was ever added or deleted in either repository's history. A decision
record that names enforcement which was never written is worse than one that names none, because a
reader stops looking. What follows is what actually holds the line.

**The drop list itself does not ship.** It stays with the archive by owner ruling, 2026-08-31, so the
published tree carries no copy — and neither, today, does any other tree. `CUT_RECORD_PRESENT` is false
everywhere the code runs.

**What enforces the cut today is `shared/withheld-paths-access.mjs` and its three readers.** The accessor
is the only thing that reads the drop list, and it is written to work where the list is absent:

| Reader | With the list | Without it, which is every tree today |
|---|---|---|
| `scripts/citation-line-check.mjs` | a withheld file's citations need not resolve | every file crosses the cut, so every citation must resolve |
| `scripts/mint-suite-census.mjs` | a withheld test file is a stated absence | a removed test file is a LOSS |
| `shared/reference-guard-classes.mjs` | withheld paths are skipped | nothing is skipped, so the whole tree is counted |

Every one degrades **stricter**, never weaker, which is the property that makes the absence safe. A
separate record of what was cut is kept with the archive rather than published, so this repository can be
checked without it.

**The gap, stated rather than left to be found.** Because no tree carries the list, the with-the-list
column above has never run. What is enforced today is the strict fallback, not the record — and a check
that has never executed its other branch is a check whose other branch is unproven. The accessor
announces which mode it is in, once, so a reader of any run can tell which column applies.

**What survives a withheld document is the fact itself, moved to where the code enforces it:**

| Withheld | Where the surviving fact lives |
|---|---|
| `docs/THE-OFFERING.md` | `driver/products.mjs` declares the four products; `docs/INTAKE.md` is what a run may be asked for; `docs/DELIVERY.md` is what it emits |
| `docs/KNOCKOUT.md` | The intake contract and the refusal messages, both of which ship |
| `docs/REGISTER-HIT-COUNTS.md` | Each adapter's `capabilities.js`: a count the vendor flags approximate is UNKNOWN, never a number |
| `docs/JX.md` | `providers/jx/README.md` — why the lane exists, what it costs, what it cannot do |
| `CHANGELOG.md` | Git — for the old hand-written file this record reviewed. Row superseded 2026-08-31: the machine-compiled changelog is no longer withheld and travels at the cut |

**An agent front door ships; a vendor-named pointer to it does not.** `AGENTS.md` is carried, because
"change the code" is the clause it answers to and this repository's working practice is that agents change
the code. `CLAUDE.md` is not carried: it was only ever a one-line pointer at `AGENTS.md`, a second copy of
one subject is a future contradiction ([ADR-0004](0004-documentation-structure.md)), and the de-identified
public cut names that file specifically. Ruled by the owner 2026-08-19, on the question raised against the
recovery — where the two files had been held back because the revert that stripped them recorded no
decision either way, and `shared/withheld-paths.mjs` did not cover them.

The general rule this settles for the next asker: **the test is what the reader needs, not who made the
tool they read it with.** A vendor-neutral document that a contributor's agent needs passes; a
vendor-branded duplicate of it does not, however small.

## Consequences

- **A citation of a withheld path is rewritten to state its conclusion** ([ADR-0005](0005-comments-carry-reasoning.md)),
  because a public reader cannot open the document. Declaring the five withheld this ruling named 17 such
  citations across code, comments, env examples and docs; all but six were rewritten, and the six declared
  are this record's own, where naming what is dropped is the content.
- **A binding to a withheld document is retired.** `driver/doc-constants.mjs` pinned four prose figures in
  `docs/KNOCKOUT.md` and `docs/REGISTER-HIT-COUNTS.md`; those rows are gone, and the test pinning 's
  one-file-states-it-twice case now anchors to the shape rather than to a named document.
- **Withholding is reversible**, which is why this is a list rather than a `git rm`. This repository keeps
  every word.
- **The question does not get re-opened per document.** A new document is judged against the sentence in
  Decision above. If it is not needed to install, choose, run or change, it does not ship.
