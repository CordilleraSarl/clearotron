# End-to-end validation

*How to prove a deployment works end to end, at four cost tiers.*

How to prove a deployment of this product works end to end, at four cost tiers. The same recipe
doubles as the **dev/prod instance split**: a dev instance is just a second env-file pointing every
data-plane path somewhere isolated — the code is identical.

## Tier 0 — offline, in-repo (already in `npm run test:full`, $0)

`driver/test/pipeline.anthropic.test.mjs` runs the full clearance pipeline on the production engine
shape with `claude -p` and every provider MCP faked, and asserts the real `_driver/delivery.json`
packet + `.delivered{sendPending}`. `driver/test/enqueue-cli.test.mjs` + `intake-reject.test.mjs`
prove the intake→runner→outbox loop with **no gateway / no network / no agent workspaces**. Green
CI = the machinery works.

Only `pipeline.anthropic.test.mjs` is a full-tier file (it carries the `// @tier full` marker, the only
thing that sets a tier): it drives the orchestrator end to end, so `npm test` (the contributor tier)
leaves it out and `npm run test:full` — what CI runs on every pull request — does not. The two intake
files carry no marker, so they run in BOTH tiers, `npm test` included.

## Tier 1 — the DEV INSTANCE (dry-run e2e on a real box, $0)

A second, fully isolated installation driven by one env file. Nothing here touches production data.

Write it as `.env` **at the repo root**. The CLI entries read that file themselves
(`shared/env-local.mjs`), so there is no `source` step and no `set -a`. Your environment always wins
over the file, and `CLEAROTRON_NO_ENV_FILE=1` switches the mechanism off entirely.

Every path is ABSOLUTE on purpose. `.env` is parsed, not run by a shell, so `$HOME` would stay five
literal characters and the driver would build a directory named `$HOME`.

```bash
# .env — the dev-instance profile (all paths isolated; engine mocked). Substitute your own home
# directory and your own checkout path.
CLEAROTRON_QUEUE_DIR=/home/you/trademark-dev/queue
CLEAROTRON_WORK_DIR=/home/you/trademark-dev/workspace
CLEAROTRON_REPORTS_DIR=/home/you/trademark-dev/pool
CLEAROTRON_OUTBOX_DIR=/home/you/trademark-dev/outbox
CLEAROTRON_AI=anthropic-agent
CLEAROTRON_CLAUDE_PATH=/home/you/clearotron/driver/test/mock-claude.mjs   # $0 mock engine; ABSOLUTE — see below
MOCK_VERDICT=CLEAR
MOCK_SKEPTIC=no flags surfaced                          # clean skeptic pass under the mock (quotes optional; both work)
CLEAROTRON_DATABASE=corsearch                      # REQUIRED, no default (#503) — the mock never calls it
CORSEARCH_SESSION_KEY=dev-offline                       # the credential preflight wants it set; never fetches under the mock
CLEAROTRON_SATPROBE_CODESIDE=0                              # the probe dials the provider; a mock run cannot
CLEAROTRON_BAND_TRUTH_GATE=0                                # the gate evidences bands against the production call ledger
CLEAROTRON_CUSTOMERS_DIR=                                    # unset ⇒ the in-repo demo customers (aurora/zephyr/petcary)
# MCP face (optional): TRADEMARK_MCP_DEV=1 TRADEMARK_MCP_AUTH_DISABLED=1 + loopback host + an ABSOLUTE
#   CLEAROTRON_ACCESS_FILE=/abs/path/grants.json. All four, or it refuses to start: with auth off and no
#   grants file every token-less caller resolves to internal read-all across every customer.
```

`CLEAROTRON_CLAUDE_PATH` must be absolute, and this is the one that catches everybody: the engine child is
spawned with the RUN DIRECTORY as its cwd, so`driver/test/mock-claude.mjs` is looked for
*inside the run* and never found. A run now refuses at preflight, before it creates a run directory,
and the refusal prints the absolute path to write.

Drive one run through the whole spine by hand:

```bash
node driver/enqueue.mjs --mark "AURORA PROBE" --classes 9,41 --goods "game software" \
  --forwarder ops --profile aurora
node driver/runner.mjs            # claims, runs all stages on the mock, publishes, writes the packets
ls /home/you/trademark-dev/outbox # → <runId>.pending (+ failure/intake packets on the sad paths)
cat <archived run>/_driver/delivery.json
```

Each command prints one `[env-local] applied N variables from …` line on stderr naming what it read.
If you do not see it, the file is not where the engine looks — it is `<repo>/.env`, not `.env.dev`, and
not the directory you happen to be standing in.

What Tier 1 proves: the intake doors, the queue lifecycle, the full stage spine, publish, and every
outbox packet kind — on a real filesystem with real process boundaries, for free. A pass looks like
this, from a clean `env -i` shell: enqueue → runner → `DELIVERED (verdict CLEAR)` → archived run dir
+ `<runId>.pending` outbox marker + `_driver/delivery.json` (runId, forwarder, subject,
`emailBodyHtml`, url, verdict — no profile field; that is `_driver/profile.json` beside it, the run's
frozen `aurora` demo profile, and the file to open to prove which profile resolved).

### Tier 1b — the UI PORTAL (browse the dev instance; develop UI features against it)

The pool already contains the whole UI (archive index, per-run report + client report + audit
workbook, per-customer pages); production serves it with a real web server behind the auth proxy.
The dev stand-in is `driver/dev-portal.mjs` — zero-dep, **loopback-only** (refuses anything else):

```bash
CLEAROTRON_REPORTS_DIR=$HOME/trademark-dev/pool node driver/dev-portal.mjs   # http://127.0.0.1:18899/
```

- `/` → the archive index · `/<run>/report.html` → the report · `/customer/<key>/` → customer pages
- `/profiles.html` + `/profiles/*` → the profile editor UI + a reverse-proxy to the profile-service
  (run that in ITS dev mode: `PROFILE_AUTH_DISABLED=1 PROFILE_DEV=1 PROFILE_PORT=<dev port>`)
- the MCP HTTP face runs separately in its own dev mode (`TRADEMARK_MCP_DEV=1
  TRADEMARK_MCP_AUTH_DISABLED=1 CLEAROTRON_ACCESS_FILE=<abs path>`, loopback host — all four, or it
  refuses to start)

A new UI feature is developed by editing the generators (`publish/index.mjs`, `publish/render.mjs`,
`shared/site-nav.mjs`, `profile-page.html`), re-running the runner (or `publish/pool-admin.mjs` to
regenerate) against the dev pool, and refreshing the browser.

**Ports on a shared machine.** Every service defaults to the same port whichever instance starts it,
so a dev instance beside a live one must be given its own (`PORTAL_PORT`, `PROFILE_PORT`,
`RECIPE_PORT`, `TRADEMARK_MCP_HTTP_PORT`). Leave them at the defaults and the dev portal's
`/profiles/*` and `/recipes/*` proxies reach the OTHER instance's profile and recipe services,
silently — each is a proxy to a port, and the port is all it knows. `/recipes/*` is the worse half:
its save endpoint writes and git-commits into whichever recipe store it reached.

A pass here looks like: index, run report, the aurora customer page and the profile-editor UI all
render against the Tier-1 pool; the `/profiles/*` proxy round-trips; traversal and non-loopback binds
are refused (unit-tested).

## Tier 2 — the INTEGRATOR CONFORMANCE LOOP (the real e2e)

The product's edges are the two documented contracts — [INTAKE.md](INTAKE.md) and
[DELIVERY.md](DELIVERY.md). A deployment is proven when a real integrator (an agent platform, a
mail-loop, a ticketing system) demonstrates the full loop against a dev instance:

**Intake conformance**
1. enqueue via the CLI (door 1) AND via ops-MCP `start_run` (door 2)
2. a `clarify`-class request is refused at the door and the `intake-rejected` packet reaches the
   requester
3. a duplicate re-submission parks and the `duplicate-skipped` packet reaches the requester

**Delivery conformance**
4. on `delivered`: send `emailBodyHtml` **verbatim** (threading via `msgId`), optional chat line,
   then write `.sent` into the (archived) run dir and clear the `.pending` marker
5. on `run-failed`: route the packet's `text` to the requester (never silent)
6. idempotency: a re-fired marker must NOT double-send (`.sent` guard); a deleted marker must not
   lose a delivery (the `status.json sendPending` backstop scan finds it)

**What an integrator is:** anything that enqueues through door 2 and consumes the outbox per this
checklist. The contract is the six points above and nothing else — no SDK, no callback registration,
no shared process. A deployment that already runs an agent platform can make its connector skill the
integrator; a deployment with a cron job and a mail relay can do the same six points and is equally
correct.

## Tier 3 — the paid cutover run (once, ~$40)

Same loop as Tier 2 with the real engine (`CLEAROTRON_CLAUDE_PATH=claude`) + real provider credentials +
a real matter. Validates model/vendor OUTPUT QUALITY, not machinery (Tiers 0–2 already proved that).
Run it once, at cutover — it bills a real matter against real vendor credentials, so it is not a
loop you repeat to debug something Tier 1 could have shown you.

## Engine selection is process-wide — what that rules out

`CLEAROTRON_AI` is read from the process environment at every driver activation and governs **every
stage of every job in that activation**. There is no per-stage override and no per-job override.
`gateway.selectEngine()` takes no argument, which is the code saying the same thing.

Two round shapes this rules out, worth knowing before a plan assumes them:

- **A same-instance parallel A/B is not available.** Comparing codex against anthropic on one matter
  means flipping `CLEAROTRON_AI` and running the arms **sequentially**, or standing up a second instance
  with its own env, pool and ports. Two engines cannot run concurrently under one driver.
- **Reviewer family diversity is not available** by routing one stage elsewhere. Sending the refutation
  reviewer to a different engine needs a per-stage engine override, and there is none: `CLEAROTRON_AI`
  selects one adapter for the whole run.

Both are absences of a capability, not defects in one. Building per-stage selection is an architecture
change — a job spec would have to carry the engine and the routing would have to survive a resume — and
it has not been done.

## What `--experiment` can and cannot answer

The `--experiment` sandbox re-runs one stage of a preserved run against a different model or prompt, so
a fault can be attributed to the model rather than to the contract. It cannot do that for **the
meaning-sweep form contract**, and the reason is structural rather than a missing flag.

**No ledger, no form.** The obligations a seat is judged against are computed from the research ledger
the sweep just wrote — `renderConnotationObligations` returns an empty string on `!ob?.queries?.length`,
so with no recorded queries there are no obligations, no form, and no contract for the seat's turn to
be measured against. A sandbox arm that produces no ledger produces a turn that proves nothing about the
thing under test.

**Recorded rather than fixed, and the issue argues why.** leaves it as a stated limit: either
`--experiment` gains a way to supply a recorded ledger as a fixture — making the seat turn replayable —
or contract questions are answered from full runs and within-run comparisons, which is the current
behaviour and is not obviously worse. The fixture path is only worth building if
contract-attribution questions recur often enough to pay for it.

### The two rules that came out of it, which are not about this rig

Three consecutive rig failures were spent on one question — whether a seat's faults were
model-attributable — on 2026-08-15. Each failure was cheap; the sequence was not.

**Ask whether the artifacts already separate the variables, before spending a run.** That question was
finally answered with no new run at all: within the runs already in hand, two axes were clean 9/9 while
a third faulted 9/9 — same model, same matter, same date, same provider. A within-run comparison
attributes by construction. Three runs were spent discovering that.

**Read the instrument's own vitals before you read its result.** One of the three failures was a spawn
`ENOENT` from a bare shell `PATH`. It was caught because `wall=0.01s` and `modelActual=null` were read
*before* the output was interpreted. Had they not been, **a rig failure would have published as a model
exoneration** — an instrument defect degrading to a plausible value rather than to an absence, which is
the direction that survives review and the direction this repo keeps paying for.

## Where a finished run goes — the live run store holds no delivered runs at all

Read that heading again, because it is the whole thing and it surprises careful people. **The live
run store holds failures and work in progress. A run that succeeded is never there** — succeeding is
what moves it. So looking for a finished run at the live path and finding nothing is not evidence of
loss; it is the only possible outcome.

**A delivered run is moved out of the live run store into the archive, with everything it carried.**
`pipeline.mjs` renames the whole directory (`renameSync(run.runDir, run.archiveDir)`; the knockout
lane does the same in `pipeline-knockout.mjs`), so `_driver/` — the per-call ledger, the receipts,
`run.jsonl` — travels with it. Nothing is deleted and nothing is pruned.

The destination is `archive/<YYYY-MM>/<slug>/<date>-<codename>/`, derived by `archiveDirFor()` in
`phase0.mjs`. Same codenamed leaf as the live run dir, same workspace.

**Measured on the test box, 2026-08-17:**

| | count | states |
|---|---|---|
| under `archive/` | 56 | **56 delivered** |
| at the live path | 16 | 15 failed, 1 running |

Not "mostly delivered" and "mostly not" — **every** archived run had been delivered, and **not one**
of the runs at the live path had. The split is total, which is what makes the wrong reading so easy:
there is no partial state to hint that something else is going on.

That is not hypothetical. It manufactured a false alarm three times in one day, by a careful reader,
who reported a per-call ledger and its receipts destroyed by delivery. They were in the archive the
whole time, intact. The reader's own directory listing contained `archive/`, and the harness prints
`archive/2026-08/…` paths per round: **the answer was on the screen twice and the framing beat it.**

### Where the durable evidence for a question actually lives

| Question | Read | Not |
|---|---|---|
| what a run's stages cost, per call | the archived run's `_driver/` | the live path, which no longer has the run |
| what receipts a search produced | the archived run's `_driver/` | — |
| when a run really started | the doors receipt, and `startedAt` with its `startedAtSource` label | `startedAt` alone on a pre-2026-07-28 run: it recorded the last RESUME until that was fixed, and `backfill-started-at.mjs` repaired the history with provenance |
| whether a run ended at all | `state` in `status.json` — and if it says `running` with no process behind it, see `scripts/reconcile-runs.mjs` | the UI, which used to show a killed run as live and then drop it silently |

### The reading rule this incident minted

**Before asserting an absence from one path, ask what the system DOES with the thing you cannot
find.** An absence is a finding — that rule is elsewhere in this repo for good reasons — but it is a
finding about *the path you looked at*, and promoting it to a finding about the *artifact* needs the
second question answered first. Here the artifact had simply moved, one directory over, by design.
