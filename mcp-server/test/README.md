# mcp-server/test — the interrogation server's suite

The `*.test.mjs` files, the `_fixture.mjs` that builds a synthetic run-dir for the read-projection ones, and
`fixtures/` — two byte-faithful excerpts of real artifacts, identities substituted (see `fixtures/README.md`).
Offline by construction: no network, no credentials, no model. What-if is exercised with injected fakes for the
shelling `runExperiment` and `compareCmd`, so no gateway is touched and the compute engine's native dependencies are
never loaded.

## Running it

```sh
npm test -w mcp-server            # the whole suite; test:full is the same command
node mcp-server/smoke.mjs         # spawns the real stdio server and drives it over MCP
node --test mcp-server/test/read.test.mjs    # one file
```

The npm script wraps the runner in `../../scripts/test-run.mjs`, which gives the run its own `TMPDIR` and deletes it
at the end; a bare `node --test` leaves its `mkdtemp` fixtures behind in the real one.

`smoke.mjs` is the end-to-end check the unit files cannot be: it builds the fixture, spawns `../server.mjs` as a
child process, and calls the real tools over a stdio transport — `list_runs`, `brief`, `trace`, `get_coverage`,
`what_if_plan`, `diff_artifact`, `search_runs`, the resources — plus the refusals (path traversal, an empty
`confirmationToken`). It prints a line per call and ends with `SMOKE OK`; no other line means it passed.
`../http-smoke.mjs` is the same idea for the HTTP face — it spawns the real `../http-server.mjs` with auth disabled
on a loopback port and proves `what_if_*` is absent from the remote surface. Both need the workspace deps installed
(`@modelcontextprotocol/sdk`, `jose`) — and so do most of the test files, so `npm ci` before any bare `node
--test`. Only `cf-access` and `http-handler` name `jose` themselves; the rest reach it through `../server.mjs`,
through `../lib/http-handler.mjs` or `../lib/cf-access.mjs` (`api-key-door`, `identity-mode`,
`client-surface-hardening`), or by spawning `../http-server.mjs` (`auth-disabled-grants-guard`, `roster-boot-check`,
`token-door-boot`) or `../http-server-client.mjs` (`client-surface-hardening` again).

## What the suite covers

| Area | Files |
|---|---|
| The doors and who they admit | `scope`, `grants`, `cf-access`, `identity-mode`, `http-handler`, `token-door-boot`, `api-key-door`, `auth-disabled-grants-guard`, `account-principal`, `ops-token`, `client-surface-hardening`, `roster-boot-check`, `security` |
| The client cut, on the wire | `scrub`, `client-view-wire`, `connector-guidance`, `evidence`, `packs` |
| Read projections | `read`, `brief`, `events`, `diff`, `lexsearch`, `babysit-output-honesty`, `list-profiles`, `list-profiles-archived` |
| Ordering, writes and delivery | `describe-options`, `plan`, `plan-archived-project`, `ops`, `ack-event-account-gate`, `delivery-state`, `delivery-runid-resolve`, `portal-trigger-wire`, `whatif` |
| The plumbing | `ratelimit`, `audit` |

Several arms are pinned incidents rather than unit coverage, and their headers say which one. One test is opt-in:
the `evidence.test.mjs` corpus arm walks a real run pool and needs `CLEAROTRON_EVIDENCE_CORPUS` set, skipping with that
sentence otherwise.

## Where to start

`_fixture.mjs`. It defines the runs the ten read-projection files assert against — a normal run, a "rich" archived
one with a `_history` snapshot and a verdict change, a knockout, and an in-flight one — and its header carries the
discipline that makes the suite work: it sets `CLEAROTRON_WORK_DIR` and `CLEAROTRON_REPORTS_DIR` at import time, so a
test file may import it statically but must import `../lib/*` **dynamically** (top-level `await import()`, or inside
`before()`), or ESM hoisting loads the driver config before the environment is set. Nothing enforces it — no lint
covers `mcp-server`, only the file headers. `evidence` and `list-profiles-archived` import the fixture for those env
vars alone; the remaining 25 files build their own `mkdtemp` workspaces (`ops`, `plan`, `describe-options`,
`grants`, `delivery-state`, …) or need no run dir at all (`scope`, `scrub`, `packs`, `ratelimit`, …).

Then `read.test.mjs`, the shortest path from that fixture through the read libs.
