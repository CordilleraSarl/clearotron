# scripts/

Two kinds of thing live here, and mixing them up wastes an afternoon or writes to a live pool.

**PORTABLE** — runs anywhere the repo runs. No deployment assumptions.
**OPERATOR-ONLY** — assumes a specific machine: a pool root, a workspace layout, systemd, an agent
roster, or the test instance. On a laptop these either do nothing or do something you did not intend.

The axis is *what the script assumes exists*, not where it happens to be run.

## Portable

| Script | What it does |
|---|---|
| `test-run.mjs` | Gives a test run its own `TMPDIR` and deletes it at exit. **Load-bearing** — every workspace's `npm test` shells out to it, so `scripts/` can never be dropped wholesale. |
| `render-check.mjs` | Renders a published report **inside the portal's iframe** in a real browser — the height bridge, the scrollbar loop, the sticky topbar. Needs a published run: point it at a pool with `--pool`, or pass `--fixture-pool` to replay `demo/` into a throwaway one. **Runs nowhere yet** — but its three interior assertions now MEASURE, deterministically: real time plus an explicit readiness signal, and `--plant-overflow` proves it still catches a broken report. What is left is a membership decision, not a defect.. |
| `home-render-check.mjs` | Draws the portal Home in a real browser, every state, both themes. Run by CI. |
| `composer-render-check.mjs` | Lays out the New Clearance composer and checks the levers reach the wire. Run by CI. |
| `clearances-render-check.mjs` | Checks the `/portal/clearances` columns hold together. Run by CI. |
| `report-print-check.mjs` | Shows what the exported PDF actually renders under print media. Run by CI. |
| `report-overflow-check.mjs` | The same two report lanes SIDEWAYS, under screen media — the print check cannot see a width, because print sets the watermark to `display:none` and the watermark was the overflow. Run by CI. |
| `portal-lifecycle-check.mjs` | Asks whether the portal names a brand owner and whether a person can manage their searches. Run by CI. |
| `validate-profiles.mjs` | Validates a customer-config store's profile bundles. Read-only. |
| `record-carry-probe.mjs` | Traces retrieval → findings over any finished run dir. Read-only. |
| `placement-diff.mjs` | Shows what the placement tier did between two runs of one matter. |
| `band-shape-probe.mjs` | Asks whether the order-probe seed moves the band shape and the tiers. |
| `write-up-form-census.mjs` | Counts, per clearance product, how many findings earn a full card and how many drop to the short-entry/grouped forms — the saving in the unit that is actually saved, a card dispatch. Read-only. Refuses rather than reporting a reassuring zero: an unresolved depth row, a missing band shape, or the two graded products disagreeing all stop it printing. |
| `score.mjs` | Scores a completed run against a reference answer. |
| `compare.mjs` | Lays the E2E product-comparison scenarios side by side — the depth dial, the config layers, fan-out, native language, the deep end. Reads files only, prints no verdict, always exits 0. |
| `feedback-mint.mjs` | The one file in the feedback feature that touches the network. |
| `publication-scan.mjs` | Reads every blob in a repository's history and asks whether all of it can be public: retired identities, operator identity, secrets, withheld paths, the licence. Portable, but it needs the private roster to say anything real — a check it could not run fails the scan rather than passing. |
| `mint-suite-census.mjs` | Re-stamps `driver/suite-census.json` — the persisted expectation that makes a DELETED, RENAMED or GUTTED test file visible. Dry-run by default;`--apply` writes it, and it prints removals and shrinkage first because a silently lowered ceiling is how a gutting gets laundered into a green suite. |
| `merge-presence-check.mjs` | Re-states every merge in a window against the tree: did the merged content reach `main` and is it STILL there (proved by content, never by ancestry), and did the branch carry work the merge never took. Deliberately not a CI gate — it reads the forge. A branch that is simply gone makes the second question unanswerable, which is a non-zero exit, waived only by an explicit dated flag that is itself invalid once it covers nothing. |

The six checks marked "Run by CI" are portable by demonstration: CI runs them on a stock GitHub
runner. They spawn the literal binary name `google-chrome`, so a machine that installs it as `chrome`
needs a symlink — which is what the CI job does before it runs them. A `ulimit -v` makes Chrome dump
core, so a box that sets one cannot run any of them; the CI runner does not.

## Nothing in this directory runs in the local test suite

`scripts/` is **not an npm workspace.** The root `test` and `test:full` scripts are
`npm test --workspaces` and `npm run test:full --workspaces`, and the workspace list is `driver`,
`mcp-server`, `providers/oauth-mcp-bridge`, `portal-ui`. So neither `npm test` nor `npm run test:full`
executes anything here, and the scripts have no unit tests of their own.

What that costs a contributor, concretely: **a green local suite has not looked at the portal screens,
the composer's wiring, the exported PDF, or the report's layout at any width.** Every test in this repo
asserts on strings; none of them can observe a scrollbar, a sticky header, or a frame two pixels shorter
than its contents, and the whole reason the browser checks exist is that a fix for "the report has two
scrollbars" shipped a report with two scrollbars past 1,500 passing tests. Those checks run in CI's
`build-and-verify` job and nowhere else — so **CI, not your machine, is what covers them.**

`render-check.mjs` is a further step out, running in **neither** — and wiring it up is what found out
why that mattered. CI left it out because it measures a PUBLISHED RUN and had no pool to point at;
`--fixture-pool` removed that reason, so wired it into`build-and-verify` as a blocking step.

**Its first run anywhere reported 6 of 9 assertions failing with `no-probe` and `null`** — not a layout
defect, an inability to *measure*. The three assertions that look inside the report frame (the height
bridge, the scrollbar loop, the sideways overflow) depend on a probe script in the sandboxed iframe
posting back to the shell. The pool built fine; the harness cannot see inside its own frame. **.**

**The first explanation written down here was wrong, and how it was wrong is the useful part.** This
paragraph used to say the message never arrives under `file://` with production's sandbox. Measured in
CI, messages from inside that frame arrive throughout and pass the shell's source filter — the report's
own height bridge travels the same path. The probe's actual defect was that it measured on a *clock*,
and a `setInterval` inside that frame never fires. Rewritten to post on layout events it does report,
and every post reads a 1400px viewport against a frame element measuring ~7456 — so the check now
returns `stale-probe` and refuses, where at one zoom level it used to hand back `-5599` as though that
were a measurement. Same six failures, one honest reason. The obstacle was one level up:
`--virtual-time-budget` services the outer page and starves that subframe.

**That rewrite has landed (, 2026-08-21) and the check measures.** It drives Chrome on real time
and the page POSTs its state to a loopback server when it is ready, so the harness is *told* rather than
guessing with a budget; a page that never signals fails by name and can no longer be mistaken for a
measurement. Baseline before: four consecutive runs gave 4, 6, 1 and 4 failures, with the settle loop
coming back 0 or 40 and never in between — a race, not a convergence. After: twelve runs, zero failures,
settling on the first try every time, and the slack figures that looked like a layout defect (125 and
147px against a 15-24 band) turned out to be the stale probe too. The sandbox is byte-identical to
`Result.tsx`'s and `allow-same-origin` was never added.

**It is still not in CI, and that is now a decision rather than a defect** — nobody has run it on a
runner since the rewrite, and wiring a blocking browser step on the strength of one developer box is the
mistake the membership guard exists to stop. That call is 's.

Read the other six with that in mind: they are outer-document measurements — does the page scroll, is
the header pinned, is Export reachable — and every one would pass against **an iframe that loaded
nothing**, because the frame is styled to a fixed height. A green from this check would have meant
almost nothing. The step is backed out and the script is declared, with the measurement, rather than
quietly dropped.

**Which check runs where is now checked, not just written here.**
the browser-check membership arm in the driver suite
reads `.github/workflows/ci.yml` and requires every `scripts/*-check.mjs` to be either invoked by a job
or declared, with a reason, as one that cannot run in CI.

**Three are declared**, and all three need something CI does not have: `live-surface-check.mjs` (a
running deployment), `merge-presence-check.mjs` (a range that does not exist before the merge) and
`deploy-drift-check.mjs` (a deployed host to compare against). Everything else runs.

That includes `render-check.mjs`, which joined the blocking browser step, and `report-frame-check.mjs`.
**This paragraph said the opposite until 2026-08-27** — it had them both on the declared list, left over
from when they were, and the membership test had moved on without it. A sentence saying a CI check
cannot run in CI is one the next reader believes, and prose is the half of this pair no test reads. If
you change what runs, change this paragraph in the same commit; the test will catch the workflow and
nothing will catch these words.

Restructuring the workspaces would fix the underlying split properly and is deliberately still not what
did — adding`scripts/` as a fifth workspace would pull every browser check into `npm test`, the
contributor tier, on machines where a `ulimit -v` makes Chrome dump core.

## Operator-only

| Script | What it assumes |
|---|---|
| `e2e.mjs` | **The test instance.** Says so in its own header. Not for dev, never for prod. |
| `sync-e2e-store.mjs` | The E2E config store checkout. |
| `live-surface-check.mjs` | A running deployment, and asks whether it agrees with itself. |
| `purge-runs.mjs` | A real pool. It is the delete path this system deliberately never had; survivors are supplied by the caller and never compiled in. |
| `backup-recall-stores.mjs` | The archive pool and the agent workspace layout. |
| `backfill-started-at.mjs` | The workspace root and an agent roster. Rewrites historical `status.json`. Dry-run by default; **there is no default workspace root** — it refuses rather than guess, because the guess used to be production. |
| `queue-inflight.mjs` | The queue directories. |
| `reconcile-runs.mjs` | The workspace root and an agent roster. Brings runs whose process is gone to an explicit terminal state — `stop_run` is cooperative and cannot reach a run that was killed. Rewrites `status.json`. Dry-run by default; **there is no default workspace root**, for the same reason `backfill-started-at.mjs` has none. |

## The rule that is worth stating

**An operator-only script that guesses a default is a script that writes to production.** If one of
these needs a path, it takes it as an argument or an environment variable and **refuses when it is
absent**. Falling back to the production value means an unset variable — a fresh shell, a clone, a
CI job — silently aims a real operation at live client matter.
