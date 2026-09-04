# 0003 — One model credential, one register, one research key — and degradation is disclosed

**Accepted.**

## Context

Credentials were documented inconsistently and enforced three different ways. `.env.example`, described as
the full variable catalogue, held 124 entries against 351 names read by code — including credentials for
software not in this repository, and omitting two that shipping code reads. `COURTLISTENER_TOKEN` was named
in four documents as the case-law switch and is read by no code at all.

## Decision

**Three credentials, stated once:**

- **Model access** — a signed-in coding CLI. Pick a lane and stay in it: the CLI's own login (billing rides
  your subscription) *or* an API key. Never both; the engine strips the key when running on a subscription,
  deliberately.
- **A register credential** — one of the tiers in [0001](0001-register-ladder.md).
- **`PERPLEXITY_API_KEY`** — the common-law and marketplace sweep, on every product. Metered, prepaid, no
  free tier. The documentation explains *why* it is required rather than merely naming it.

**Every credential in a reader-facing file is read by code here, and every credential read by code appears
in exactly one table.** A phantom variable is exactly as damaging as a missing one: it makes a reader
believe they configured something they did not.

**A component that cannot run must say so on the artifact.** Refusing at preflight and degrading with a
disclosure are both acceptable; degrading in silence is not. Which one applies is per component:

| Component | Behaviour | Why |
|---|---|---|
| Register | refuses at preflight, by name | An unconfigured register that answered "no conflicts found" is the most dangerous output this system can produce |
| Case law (Full country search) | runs without the bridge, and the run's ledger records that the sweep did not dispatch | Access is free but auth breaks in practice. `driver/verify.mjs` plus `case-law-citations.json` stop any report claiming "no adverse case law" when nothing was read — the disclosure is the guard |
| Native-script lane | degrades and says so | Reached only on CJK territories |
| Research sweep (open web / marketplaces) | **on a Knockout search: degrades and says so.** On the three clearance searches: **refuses at preflight, by name** | acceptance 6, 2026-08-20. A knockout carries`registerProbe: true`, so its register half is a whole product without the sweep — refusing the screen threw away an answer the deployment could give. The three clearances carry `commonLawGrid: true` and their unregistered-use half is not severable, so nothing there degrades quietly into a clearance with a missing half. -6, 2026-08-20: that clearance failure MOVED to preflight — it used to happen at the common-law stage, after every register stage had been paid for. Same outcome, no spend.`preflightResearchCredential` gates on the component, never on the pipeline: `prelim-register-only` is a clearance carrying `commonLawGrid: false` and is not refused |

## Consequences

- `.env.example` is hand-kept, and a RATCHET IN BOTH DIRECTIONS is what makes the rule above
  enforceable rather than aspirational. This line used to say the file was generated from
  `scripts/env-audit.mjs`, and that was never true: the audit only ever read the file — no write path,
  no `--apply`, and nothing else writes it either. So the sentence that named the enforcement mechanism
  was the thing with no mechanism behind it, and it told every reader not to hand-edit the only file
  hand-editing maintains. What enforces it now, in the environment-governance guard: a variable
  read by shipping code with no row fails (-10), and a row nothing in the tree accounts for fails
  .
- Case-law setup is an OAuth flow, not a variable. It is documented where credentials are listed, and
  `COURTLISTENER_TOKEN` is not an install-surface name: no `.env.example` row, no wizard roster entry,
  nothing in shipping code reads it.

  **One file still names it on purpose** — `scripts/freeze-example-run.mjs`'s secret-scrub pattern. A
  scrubber has to name what it redacts, and narrowing it would mean a published example run stops
  redacting a token that any historical artifact might carry. That exception is the same one
  `driver/test/deployment-hostnames.test.mjs` states for operator paths: the guards that forbid a
  string are the one place it must survive.

  *This consequence was written in the past tense before it was true, and stayed false for weeks
  . It is written as the present state now, with the exception named, so "was this done?" can be
  answered by reading it.*
- A new external dependency arrives with its enforcement decision made — refuse or disclose — and the
  disclosure is visible on the report, not only in `_driver/`.
