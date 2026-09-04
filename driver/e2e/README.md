# E2E scenarios — the suite lives in the config store

There is **one suite**, and it is not in this repository. Every scenario — the real matters a lawyer
has answered AND the two synthetic mechanism probes — lives in a private config store's `e2e/`
directory, in one table, labelled. Nothing here bundles synthetic copies of the same IDs as a
fallback: two suites sharing IDs with different marks is exactly the confusion the store's swap-whole
rule exists to prevent.

```
CLEAROTRON_E2E_DIR set     →  $CLEAROTRON_E2E_DIR/scenarios/<ID>.json; the scorer reads
                          $CLEAROTRON_E2E_DIR/baselines/. The ONLY mode.
CLEAROTRON_E2E_DIR unset   →  scripts/e2e.mjs refuses, and says why.
```

The suite's standard — what each scenario is for, the product coverage table, the run order — is
`TEST-SUITE.md`, kept in the store beside the scenarios.

What lives in this repo: the harness (`scripts/e2e.mjs`), the scorer (`scripts/score.mjs`), the
cross-scenario comparison views (`scripts/compare.mjs`), and their tests. The harness sweeps every job
block in the configured store through both admission gates before anything runs or spends
(`validateStoreJobs`, the check) — a store scenario the doors would treat differently than it
declares refuses **that scenario's own `run`**. Every finding is printed whoever it is about, but
findings naming OTHER scenarios do not stop you: one out-of-coverage scenario used to refuse the whole
store, so a scenario well inside a deployment's coverage could not run because of one that never
could. On `list`, where no scenario is named, every finding is fatal — surveying the store is the one
job that must keep failing on a store/doors disagreement (`sweepStoreOrDie` · `findingIsAbout`).

`compare.mjs` does the one job `score.mjs` cannot: reading several scenarios of ONE mark together.
`score.mjs` measures one run against a lawyer's answer; `compare.mjs` measures five runs against each
other, which is the only proof available where no gold set exists.

## A gold set is shaped like the product it grades

A knockout scenario graded against a similar-marks sheet scores a **structural zero**. Knockout answers
one narrow question — how many register filings exist for the exact mark and its close variations in the
named classes — and never retrieves similar marks, so a lawyer's list of TIKI PUNCH and TIKI TROPICS is
unreachable by construction. R3 and R4 scored 0/8 and 0/9 on both free-tier and clarivate on the same
day with the same engine, which measured the pairing rather than the engine.

`scripts/score.mjs` now **refuses** that pairing rather than annotating it. The refusal names the
scenario and what to add. So a knockout scenario's gold set carries a `counts` block:

```json
{
  "schema_version": 1,
  "scenario": "R3",
  "source": "who answered this, so it can be audited",
  "counts": [
    { "mark": "CORAL FREEZE",
      "classes": [30, 32],
      "identical": { "min": 0, "max": 4 },
      "close_variations": ["CORALFREEZE", "CORAL-FREEZE", "CORAL FREEZY"] }
  ]
}
```

- **`identical` is a RANGE, never a number.** The register moves between rounds — filings are added,
  abandoned, reinstated — and a gold set pinned to an exact total goes red on the register doing its job.
  The range is the lawyer's judgement about what the answer cannot fall outside. Both ends are inclusive
  and either may be omitted. Only the `identical` predicate is graded; `containing` is the register's own
  broad name match and runs to the hundreds.
- **`close_variations` is where the recall signal lives.** A count in range proves the lane answered; it
  does not prove the lane still generates CORALFREEZE from CORAL FREEZE. Each form is graded on whether the
  run PUT IT TO THE REGISTER, read from `register-records.json`'s terms — never asked is a fact about the
  engine, asked-and-answered-zero is a fact about the register, and they must not read the same.
- **Both are read from the run's register sidecars, never from findings.** Findings are what the lane
  rated; these are what it counted, and confusing the two is the mismatch this closed.
- **`counts` is optional and the schema version does not move.** Every existing gold set validates and
  scores exactly as before. Where a count-shaped set also keeps its lawyer sheet — worth keeping, it is a
  real answer to a real matter — the sheet is NOT scored on a knockout run, and the buckets block says so
  rather than printing `LOST` rows for marks the product cannot reach.

The clearance scenarios with a gather/judgment seam (R2, R6, the R1/R5 families) keep the lawyer sheets
as their gold sets. That is where the product does promise retrieval of similar marks.

## The product-comparison set

The five scenarios of (R7–R11) — one crowded mark through all four products, plus row 5 repeating
row 2's product under a second client setup (a different `profileKey` plus a project overlay) — are
written **as the config store must receive them**, in a repo-side design document rather than in the
store. A `R7.json` committed here would be read by nothing — `scenarioStore()` resolves only
`$CLEAROTRON_E2E_DIR/scenarios/` — while looking exactly like a delivered scenario. They have not been
received; what stops them being decoration is `driver/test/e2e-product-comparison.test.mjs`, which
lifts every block out of that document and puts it through both admission gates plus the store lint,
offline, exactly as the harness sweeps a real store before anything spends. They
carry a `compare` block; `scripts/compare.mjs` selects and orders on it. R0–R6 are untouched by that
set and stay as regression cover.

## A round, and a pair

Each `e2e.mjs run <ID>` is a **round**, identified by the token it prints. `_e2e-doors-<ID>.json` beside
the pool is that scenario's **history of rounds** — every round's token, when it started, what each door
answered, and whether it has been reported. It is appended to, never replaced.

A **pair** is two rounds of one scenario on one commit: the noise floor, which needs the same
scenario run twice to see how much of the difference between two runs is the engine and how much is
variance. `report <ID>` reads exactly ONE round (the newest, or the one `--round <token>` names) and
lists every round it knows; `score.mjs <ID> --run <dir> --previous auto` finds the other half.

**Report and score the first half before launching the second.** Nothing is lost if you do not — the
receipt keeps both rounds and `--round` reads either — but a `report` run while the second half is in
flight describes a job thirty seconds old, and its FAILs read like engine defects. `run` says so before
it queues when the previous round reached a terminal nobody has read.

Client identity never enters this repo: the store is where the matters live.
