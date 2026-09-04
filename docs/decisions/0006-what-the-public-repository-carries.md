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

**The drop list is `shared/withheld-paths.mjs`, and it is the only place a cut decision is recorded.** Two
tests read it: `driver/test/publication-scrub.test.mjs` fails a shipped file that cites a withheld path
without a declared reason, and `driver/test/no-caveat-repair.test.mjs` treats an absent-and-declared file
as a stated consequence rather than damage. A decision recorded anywhere else — an issue, a chat, a comment
— is not recorded.

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
