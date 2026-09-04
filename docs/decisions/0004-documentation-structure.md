# 0004 — README front doors, ADRs for decisions, no per-directory changelogs

**Accepted.**

## Context

The repository held ~423,000 words of Markdown with no short path through it: a 2,000-word README before a
reader learns which register to pick, a 5,400-word install document that is also an operations runbook and
an access-control reference, nine numbered architecture files with no index, and about fifty directories
with no README at all — including `providers/`, which holds ten adapters.

Two thirds of that Markdown is not documentation. `driver/skills/**` is prompt payload served to the model
at runtime.

## Decision

- **A README is a front door.** What lives here, what reads it, where to start. Concise and current — never
  a file-by-file activity log.
- **Every directory a reader opens *as a unit* has one; a leaf does not.** A package, a workspace, a
  documentation set, a tree with its own rules — those are units and each gets a front door. A
  `<package>/src/` or `<package>/test/` directory is not: its package README already names its files and
  says which to read first, so a second file there would restate that list in a place nobody looks, and the
  two copies would diverge. Same for a directory of one to four files whose parent already maps them. **The
  test is whether a stranger could arrive at the directory without passing its parent** — `providers/` and
  `driver/skills/` pass, `providers/signa/src/` does not.
  This bounds the set at about 35 front doors rather than 100 stubs, and a stub is what rots.
- **Decisions go in `docs/decisions/`.** A ruling gets a numbered ADR so the next reader finds it settled.
- **No hand-kept changelogs, at any level.** Git holds the history, and a hand-kept log rots. A
  per-directory one was never written and stays banned. **Amended 2026-08-31 (owner ruling on tracker
  issue 2055: the landed release-pipeline decision is master, and the old doc is cleaned up to match
  it, never the machinery bent to the doc):** the root `CHANGELOG.md` is the release pipeline's
  MACHINE-COMPILED output — assembled by `scripts/release-version.mjs` from the pending release notes
  when a release is cut, plain-language-gated, and public-facing (the website receives it). It is not
  the hand-kept log this rule banned, and nobody edits it by hand. The earlier sentence withholding it
  at the cut under [ADR-0006](0006-what-the-public-repository-carries.md) is superseded by the same
  ruling — see that record's amended table row for what travels and when the cut rule for it arrives.
- **`driver/skills/**` is engine input, not documentation.** It is excluded from documentation work, and
  that exclusion is stated in its own README, in `AGENTS.md`, and in `CONTRIBUTING.md`. Editing those files
  for brevity or tone changes what a clearance concludes. The exclusion is editorial and does not reach the
  owner-ruled identifier remediation of that tree, which is the one lane that rewrites it.
- One canonical statement per subject; everything else links to it. A second copy is a future contradiction.

## Consequences

- The reader-facing surface is about 35 files. `docs/architecture/`'s nine files consolidate; access control
  moves out of the install guide into operations.
- **Front doors are written, and the leaves are covered by a rule something now checks.** Every unit
  directory has one — the workspaces, `providers/` and each adapter, `driver/` and its trees, `docs/` and
  each of its sets, `mcp-server/` and its libraries, `portal-ui`, `shared/`, `scripts/`, `bin/`,
  `examples/`. Leaf `src/`, `test/`, `fixtures/` and few-file directories are deliberately without one, by
  the stranger test stated above.

  **`driver/test/a-directory-over-four-files-has-a-front-door.test.mjs` is the mechanism.** A
  tracked directory holding more than four files must carry a README, or the NEAREST README above it must
  name it. Both halves come from this record rather than from the guard's author: **four** is the "one to
  four files whose parent already maps them" above, and the ancestor rule is the stranger test — you
  cannot reach `providers/uspto-local/test/` without passing `providers/uspto-local/`, so that README
  naming `test/` is the criterion, checked.

  **It fails closed.** If the nearest README above a directory does not name it, the directory is
  unaccounted; the search does not continue to a grandparent. Walking on would let any directory be
  excused by a distant ancestor that happens to contain its name in prose — a guard that passes almost
  everything and reads exactly like one that passes because the tree is correct.

  **The declaration lives in the ancestor rather than in a marker file inside the directory**, and that is
  a decision, not a shortcut. Two of the classes this exempts cannot hold one: fixture corpora are
  enumerated by the suites that read them, so a file explaining the corpus changes it, and generated
  directories are overwritten on the next build. Measured when the guard was written: **19 directories
  exceed the threshold, 15 were already named by an ancestor**, and three one-line additions closed the
  rest. The mechanism was not new — it was unchecked.

  **This paragraph is what 's absence-record predicted it would become.** That record said "a new
  directory ships without a front door and nothing says so", named itself as a known gap rather than a
  mechanism, and ended "if the guard is built later, this paragraph is what it replaces". It has been.

- Withheld directories are **not deleted from this repository** — this repository is the historical record.
  They do not cross at the cut, which the withheld-paths record already enforces.
- **This work prepares the cut; it does not perform it.** The publication route is held on an identifier
  remediation of the doctrine tree, and nothing in this record releases that hold or depends on it landing.
  Documentation and configuration land on their own; the cut happens when the held lane clears.
- Deleting or moving a document means fixing its inbound links in the same commit;
  `scripts/markdown-link-check.mjs` is the gate.
- Some documents are bound to code: `INSTALL.md`'s index figures are asserted against
  `shared/uspto-index-size.mjs`. A rewrite keeps the binding or moves it.
