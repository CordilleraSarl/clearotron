# Glossary

Words this codebase uses in a particular way. They are here because they are already in the tree —
in file names, comments and test titles — and a contributor meeting one should not have to reverse
it out of the code. Product vocabulary a client would meet is in [`../README.md`](../README.md); the
tenant, account and project model is in [`../INSTALL.md`](../INSTALL.md) under "The four things, and
what contains what".

Nothing here is a rule. Each line says what the word points at, and names the file that owns it.

## The run

**Seat** — one model turn with one job, inside a stage that has several. The common-law grid runs
halves `a` and `b` and a meaning seat `m`; each has its own model tier and its own ledger, and one
seat failing is not the stage failing.

**Dispatch** — handing a seat its prompt and waiting for the turn. Recorded per attempt in
`_driver/<stage>.jsonl`, so a stage that ran three times has three dispatches and one result.

**Matter frame** — what the run understands the request to be: the mark, the goods, the sector, the
territories. Everything downstream derives from it, and it is told not to widen past the territories
the job named.

**Blind frame** — a second reading of the raw request that never sees the matter frame. It runs
beside the investigation as a non-fatal sibling, so a framing mistake shows up as a disagreement
rather than propagating quietly.

**Feedforward** — the reviewer's flags reaching the corrective pass as data rather than as prose.
`corrections-feedforward.mjs` decides which flags count as still open.

**Carry-through** — of every subject the run's findings surface, which ones reach none of the
delivered documents. A finding that is recorded and never carried is the thing this measures.

**Declination** — a record the run enumerated and then decided not to pursue, with the position of
its reason in `_driver/declination-spec.json`. A declination is a decision, not a gap.

**Refusal** — the product declining rather than failing. `terminalKind: "designed-refusal"`. Nothing
about a refusal is retried, parked or recovered; the remedy is always the operator's.

## What a run leaves behind

**Ledger** — an append-only record of what was covered, kept so that "unsearched" can never be
reported as "clean". The coverage ledger appears in the report as prose and as JSON, from one source.

**Receipt** — a record that something happened, kept for observability and deliberately not used as a
gate. A receipt read as a gate is a Goodhart problem, and the reasoning-integrity receipt says so on
its own face.

**Register-digest** — the condensed register result a downstream stage reads instead of the raw
records: the same evidence, at the size a model turn can hold.

**Hit list** — one line per enumerated record and the fate it was given. It is not a read: a record
can be on the hit list and never opened, and the sign-off condition is about documents actually read.

**Predelivery** — the checks that run after the documents exist and before anyone receives them
(`predelivery-lint.mjs`, `_driver/predelivery-lint.json`). A failing predelivery withholds the
artifact; it never annotates it.

**Courier** — delivery as a self-contained packet handed to the integrator. The engine does not send;
what it produces is carried.

**Drift** — a value that is mirrored in two places by design, and the two disagreeing. The catalogue
of what is mirrored, and which copy owns it, is in the architecture docs.

## Guards and tests

**Arm** — one `test(...)` block. A file has many; each is named for the property it holds, and a red
arm is read by its output rather than by its name.

**Plant** — deliberately breaking something to prove a check would catch it. A guard that has never
been shown failing has not been shown to work, so the hard version plants a NEW instance of the class
rather than the one the check was written against.

**Contract dictation** — the rule that a contract is stated once and everything else derives from it.
`contract-dictation.mjs` computes over a corpus; `scripts/contract-dictation-scan.mjs` builds that
corpus from the tracked tree, so a new authoring layer is caught structurally rather than because
somebody remembered to list it.

**Assert census** — counting the assertions that never executed. An assertion inside a branch nothing
reaches is a test that passes and guards nothing (`scripts/unexecuted-asserts.mjs`).

**Authority probe** — asking the live CLI whether it honours a boundary the driver sets, and whether
the turn survives being refused. CI has no CLI and no subscription, so it can only prove the decision
is made correctly; whether it is obeyed is a property of the real binary
(`scripts/authority-boundary-probe.mjs`).
