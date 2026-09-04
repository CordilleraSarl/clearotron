# 0002 — A switch that silently changes output does not ship

**Accepted.**

## Context

`driver/flag-snapshot.mjs` names four environment switches whose class it calls
`silent-output-change` — in its own words, *"off means the output is different and NOBODY IS TOLD."*
Three of them arm the native-script lane. That file also records what production runs, read from the
production unit on 2026-08-04:

```
PRODUCTION_POSTURE { CLEAROTRON_JX_SERP_GRID: true, CLEAROTRON_JX_NATIVEREAD: true, CLEAROTRON_JX_CONSUME: true }
"Three units ship dark in the source, run live in production, and — at the time this was
 written — had never once executed under test."
```

So the build a stranger clones is not the build we validate against. The registry is also explicitly an
allowlist — *"anything not named here is not in the snapshot, whatever it is"* — and it names four of the
159 distinct `CLEAROTRON_*` names non-test code reads. (`node scripts/env-audit.mjs` counts the whole env
surface, not just the prefix: **352 distinct names read by code, 213 of them by product code**. That is
the reproducible instrument; run it rather than trusting a figure typed into a document.)

A classification sweep over that surface enumerated **31 `silent-output-change` switches, against the four
declared** — 25 of its findings survived an adversarial refutation pass and 40 claims were overturned.
It also found 10 names with no reader left (three declared in `RETIRED_ENV`) and four live authentication
bypasses classified as test-only. Its own driver-area inventory truncated with roughly 85 rows in scope
and unenumerated, so 31 is a floor, not a total.

## Decision

**A switch that silently changes what a run produces does not ship.** Either the behaviour is
unconditional, or the switch and its code are deleted. Defaulting a flag on is not sufficient: a
default-on flag is still a hidden off switch, and someone's environment will find it.

The four named switches are removed and their behaviour becomes unconditional, gated only on conditions
that are honest and already disclosed — a credential being present, the product carrying the component,
the territory having a lane. Each of those produces a visible coverage row when it does not hold.

Every `CLEAROTRON_*` name read by shipping code declares an effect class, and an undeclared new one fails CI.

## Consequences

- The shipped default and production's posture cannot diverge for anything that changes output. If they
  ever do, that is a defect and not a configuration.
- Behaviour that is genuinely optional is gated on something a reader can see — a credential, a product,
  a territory — not on a variable nobody documents.
- A rollback switch counts. `CLEAROTRON_COMMONLAW_SPLIT` was on by default and existed to restore an older
  assembly; the switch and the old path both go, because a rollback lane nobody will use is legacy code
  kept warm.
- Deleting all four empties the flag half of `flag-snapshot.mjs`. That surface is retired with its readers
  or states plainly that it tracks nothing; a snapshot that silently reports nothing recreates this problem
  in miniature.
- The four named switches are the ones the repository had already identified. The sweep's other 27 are the
  same defect undeclared, and they are handled the same way — a name that changes output either loses the
  switch or declares its class. Two of them decide what verdict is delivered
  (`CLEAROTRON_BAND_TRUTH_GATE`, `CLEAROTRON_UNREACHABLE_SENIOR`), which is why this is a correctness ruling and
  not a tidiness one.
- **The count is a floor.** Any figure in this record is superseded by `node scripts/env-audit.mjs` and by
  whatever the declaration test enforces. Do not re-derive it by hand; that is how 172, 159 and 352 all
  came to describe the same repository.

## Addendum — 2026-08-20, on implementation ( item 8)

All four switches are deleted, as ruled. One consequence above is narrowed by what the code turned out
to be, and it is recorded here rather than in a pull request body, because this document is what the
next reader will act on.

**"the switch and the old path both go" applies to the switch only.** The single-member common-law
assembly stays. The clause's premise is that it was "a rollback lane nobody will use" — a flag-gated
alternative kept warm. It is not: `deriveGridSpec` reaches that assembly on two mechanical conditions
that no environment variable touches.

- **`single-term-grid`** — a grid carrying fewer than two terms. There is nothing to partition, and
  running the split machinery over it is work with no object.
- **`resumed-unsplit`** — a resume of a run whose `common-law-findings.md` is valid with no half
  artifacts beside it. That run's grid already ran unsplit; re-running it as halves re-spends the whole
  grid, which the resume principle exists to prevent and which costs real money.

Both are recorded on `ctx.clSplitDecision` and written to `_driver/common-law-path.json` with the
reason that decided them, so a run can always be asked which path it took and why — the record
added, now carrying one fewer term in its conjunction. Both have tests that assert the recorded reason.

Deleting the assembly would not have honoured this decision; it would have manufactured two defects to
satisfy a premise the code disproves. What the decision actually required — that no hidden switch
changes what a run produces — is met, because nothing selects between these paths except facts about
the run that are already disclosed.

**The `resumed-unsplit` arm can retire** once no box can still hold a run whose findings predate the
split. Nobody has measured that and this addendum does not ask for it now; the condition is written
down so the question can be asked later rather than rediscovered.
