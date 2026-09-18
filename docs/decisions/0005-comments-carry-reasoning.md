# 0005 — Source comments carry reasoning, not history

**Accepted.**

## Context

Shipping source carried many references to a private issue tracker, and a large volume of retrospective
narration — what the code used to be, what an earlier version said, and when. `CONTRIBUTING.md` instructed
contributors to keep the references, on the ground that the attached reasoning is load-bearing.

The reasoning is load-bearing. The archaeology is not. A comment explaining *why* a timeout is 900 seconds,
or carrying a probe's observed figure and its date, is this repository's best asset. A comment explaining
what the code used to be is a changelog written into source, worthless to a reader who never saw the old
version, and it is most of the volume.

Separately, comment citations of the form `file.mjs:N` were found pointing at the wrong code — still in
range, so they fail silently and read as precise.

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
- The sweep is too large to review by eye, so it runs last, with a script that reports before it edits.
- **The sweep must exclude `driver/skills/**` entirely.** Those files are the instructions the engine reads
  at runtime, not source comments: an edit there changes what a clearance concludes, and a mass edit that
  cannot be reviewed by eye must not run across them.
- New work cites this repository's own issues normally, and comments that would have carried history point
  at an ADR instead.
