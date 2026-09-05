# Release notes

Every user-visible change ships with a note in this folder. The note is what a customer reads on the
releases page and in `CHANGELOG.md` to decide whether to upgrade.

**Everything below the line is the standard, and it is not advisory.** `scripts/release-notes-lint.mjs`
refuses a note that breaks the mechanical parts of it, on the pull request that adds the note — where the
person who wrote it is still holding it — and again before a release is cut.

## How to add one

    npx changeset

Pick the packages, then write the note. **Open it with its group**: `New:`, `Fixed:` or `For operators:`.
That is the one thing the standard below does not spell out, because it is the mechanism rather than the
rule — the page groups notes New / Fixed / For operators and only the person writing the note knows which
it is, so the note carries it and the changelog reads it off. A note without one is refused.

    ---
    "prelim-driver": patch
    ---

    Fixed: The demo now offers only the two example accounts it ships with.

Then check it:

    node scripts/release-notes-lint.mjs

---

# Release notes contract — owner ruling 2026-09-05 ("SUPER CLEAR AND SIMPLE", enshrined in the repo, not in memory)

## Who reads a release note
Someone who installs and runs Clearotron: a trademark lawyer, or the IT person helping them. They have never
opened this repository, do not know our issue tracker, our test names, our agents, or our words for things.
They read the GitHub Releases page or `CHANGELOG.md` to decide whether to upgrade and what will be different.

## The one rule
A note states, in one plain sentence, what is different for that reader after upgrading. Nothing else.

## Form
1. One sentence, at most 25 words, ordinary words. A second sentence is allowed only to say what to do
   about it ("Run `clearotron doctor` after upgrading.").
2. Lead with the thing the reader knows: the feature, the command, the screen, the situation.
   "The demo…", "Installing from npm…", "Server installs…", "Reports…", "The setup wizard…".
3. Name the reader by situation, never a bare "you": "Anyone installing with npm can verify…" — or write it
   without a person at all: "Each release is signed, so an install can be checked against this repository."
4. Say the outcome. Mechanism only when the reader needs it to act, and then in plain words.
5. Group on the page: **New** · **Fixed** · **For operators** (server/hosted installs). User-facing groups first.

## Banned in a note (the lint refuses these)
- Issue numbers, PR numbers, `#NNN`, "tracker issue", agent or lane names.
- File paths, module names, anything ending in `.mjs` / `.ts` / `.json`, function names, flag names not
  documented for users, port numbers.
- Our internal words: arm, gate, guard, plant, lane, tracker, sidecar, funnel, digest, seam, cut, ratchet,
  census, drive, stranger, hardening, class, mechanism, invariant, resolver, predicate, provenance (unless
  glossed as "a signed record"), OIDC, dist-tag, changeset, pre-release mode.
- "now correctly", "as expected", "properly" — say what happens instead.
- A sentence a reader cannot act on or picture.

## Before → after (the two the owner rejected, and one more)
- ✗ "Every release now carries a signed record of the commit and the build that produced it, so you can check
  that what you installed is what this repository holds."
  ✓ "Releases are now signed. Each npm package carries a record of the exact source and build it came from,
  so an install can be verified against this repository."
- ✗ "Asking the demo for a search it has no example of now explains what happened, that nothing was started
  or charged, and what to pick instead."
  ✓ "The demo now says plainly when a search type has no sample run, and lists the ones it has. Nothing is
  started and nothing is charged."
- ✗ "The trigger key re-mints on every --background start and doctor refuses within seven days of expiry."
  ✓ "Server installs no longer stop accepting new clearances after 30 days: the internal key renews itself on
  every start, and `clearotron doctor` warns a week before it would lapse."

## Where this lives so it cannot be forgotten
1. `.changeset/README.md` on the public repo: this contract, verbatim, with the three examples — the file
   every contributor reads when adding a note.
2. `scripts/release-notes-lint.mjs`, run by the release workflow BEFORE the version step and by CI on every
   PR that adds a `.changeset/*.md`: refuses any banned token, any sentence over 25 words, any `#NNN`, any
   path/module name; prints the offending line and the rule. A refused note blocks the merge, not the release.
3. The PR template: one line — "Release note added under .changeset/, written for a lawyer, passes the lint."
4. The version step's compiled changelog and the GitHub release body are generated from the notes only, grouped
   New / Fixed / For operators, no commit hashes, no contributor handles.

---

## What the check can and cannot do

It refuses what is mechanically decidable: issue and pull-request numbers, paths into this source tree,
module names, flags the user documentation never shows, port numbers, our internal vocabulary, the empty
phrases, and any sentence over 25 words. It prints the line and the rule.

It cannot tell whether a sentence is true, or useful, or the right thing to say. A note that passes is
not thereby a good note — it is a note whose remaining problems are the kind a person has to see. Read it
once more as the reader: a trademark lawyer who has never opened this repository, deciding whether to
upgrade.

**A path is judged by whose it is.** `~/.config/clearotron/` is where the reader's own settings live and
telling them is the note's job; `driver/…` and `scripts/…` are ours and mean nothing to them. Commands a
reader types — `clearotron doctor` — are theirs too.
