# 0005 — Source comments carry reasoning, not history

**Accepted.**

## Context

Shipping source carried 6,891 references to a private issue tracker across 694 files, and a large volume of
retrospective narration: 415 instances of "used to", 445 of "It was", 415 of "retired", 268 of "the old",
188 of "WAS the", and 1,104 date stamps. `CONTRIBUTING.md` instructed contributors to keep the references,
on the ground that the attached reasoning is load-bearing.

The reasoning is load-bearing. The archaeology is not. A comment explaining *why* a timeout is 900 seconds,
or carrying a probe's observed figure and its date, is this repository's best asset. A comment explaining
what the code used to be is a changelog written into source, worthless to a reader who never saw the old
version, and it is most of the volume.

Separately, measured 808 comment citations of the form`file.mjs:N` and verified seven of seven wrong
— in-range but pointing at the wrong code, which fails silently and reads as precise.

## Decision

- **Keep the reasoning.** Why the code is as it is, what was measured, what a vendor actually returned, and
  the date of the observation.
- **Delete the retrospective.** What the code used to be, what a previous version said, and which issue
  renamed it. Where that history has durable value, it becomes an ADR.
- **A citation must state the conclusion it cites.** A reference is a note about where a decision was
  settled, never the evidence for a claim the line asks the reader to take on trust — a public reader cannot
  open the private tracker.
- **Cite the symbol, not the line.** `toolGroupsForStage()` in `gather-config.mjs` survives every move; a line number
  survives none. Where the target is not a named symbol, quote a few words of it.
- The same rule governs user-facing text. An error message states the requirement, not the incident that
  produced it.

## Consequences

- `CONTRIBUTING.md`'s instruction to preserve issue references is superseded by this record.
- The sweep touches 694 files, cannot be reviewed by eye, and runs last, with a script that reports before
  it edits.
- **The sweep must exclude `driver/skills/**` entirely, and that exclusion is a requirement on a script
  nobody has written yet.** Those files are prompt payload, not source comments, and part of that tree is
  under an identifier remediation whose ruling is that string substitution is the wrong instrument — a
  rename there leaves real conflicts attached to a mark nobody owns. A mass edit that cannot be reviewed by
  eye must not run across files being rebuilt by hand for correctness. **Until the script exists the
  exclusion is enforced by nothing**, so it is stated here, in `AGENTS.md`, in `CONTRIBUTING.md` and in
  `driver/skills/README.md` as a rule a human or an agent has to hold. Writing it into the script is the
  first thing that script does.
- New work cites this repository's own issues normally, and comments that would have carried history point
  at an ADR instead.
