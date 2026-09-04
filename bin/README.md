# bin/

The five commands that take an install from a fresh clone to a running product. They are not the only
runnable files in the tree — `driver/runner.mjs` drains the queue, and `scripts/` holds the guards and
probes CI runs — but they are the ones to start from.

## What each one costs

This table is also the mapping between the two names each command has. **The shipped name is the
`clearotron` verb** — it is what every reader-facing document uses, and the only form that works for
someone who installed from the registry rather than cloning. The npm script is the in-checkout alias
and is what you want when you are working in this tree.

| File | Shipped verb | In a checkout | Cost |
|---|---|---|---|
| `example.mjs` | `clearotron demo` | `npm run example` | Free. No credentials, no model, no engine, no register call. |
| `onboard.mjs` | `clearotron install` | `npm run setup` | **Spends one cheap engine turn.** `clearotron doctor` writes nothing and calls nobody. |
| `start.mjs` | `clearotron start` | `npm start` | Free to start. What it starts can spend — see below. |
| `uspto-sync.mjs` | `clearotron sync` | `npm run sync:uspto` | Not billed, but 41.5 GB of download and about nine hours of indexing. |
| `signa-sync.mjs` | — | `node bin/signa-sync.mjs` | One vendor read (`GET /v1/offices`, paged). Needs `SIGNA_API_KEY`. |

`example.mjs` replays `examples/sample-run` through the ordinary publisher into `~/trademark-demo/pool` and
serves it on `127.0.0.1:18900`. Every path the demo pool could collide with is checked by realpath and by
containment before anything is written, because a demo runs on deployed machines too.

`onboard.mjs` validates each answer through the door the engine itself uses before it persists anything,
and the engine check is a real turn through the adapter's own spawn path. `--check` is the free half: it
reports what this machine is configured for and writes nothing. Add `--probe-engine` to spend the turn
deliberately.

`start.mjs` is a supervisor. It starts exactly two children — `driver/portal-service.mjs` (the portal,
default port 18802) and `mcp-server/http-server.mjs` (the engine door the portal's Start button calls,
default 18790) — and if either exits it says which and stops the other. Since it also starts a
third child, `driver/runner.mjs --watch`, which drains the queue, so ordering a clearance from the portal
runs it. That child is **non-fatal**: an install with no worker is a supported state (`--no-worker`), so a
worker that dies leaves the portal serving and says what to restart, rather than taking the install down.

That is where hours of model time and vendor calls are spent, and the consent for it is the portal's own
review dialog — which prices the run and takes the confirmation — not this file.
Concurrency is unchanged: every run takes the same filesystem slot lock, so this worker and one you start
by hand share one cap rather than becoming two lanes.

`uspto-sync.mjs` builds or updates the local US register. The USPTO account is free and exists to
rate-limit the endpoint, so nothing is billed — the cost is time and disk, and those figures come from
`shared/uspto-index-size.mjs` rather than from prose. `--dry-run` lists what would be pulled and
downloads nothing; `--from-file` ingests an archive you already have and needs no API key.

`signa-sync.mjs` writes `providers/signa/src/offices.generated.js`, the committed snapshot of Signa's
live office list, so a change in what we claim to search arrives as a diff in a pull request. The gate is
each office's own `status`, and a failed sync exits non-zero with the existing snapshot untouched.

## Where to start

`example.mjs` (172 lines) is the shortest complete path through the system: frozen example, ordinary
publisher, local pool, loopback server. Then read the header of `start.mjs` for why the real product is
two processes and what each of its two doors demands of a caller.

The long install path is in [`../INSTALL.md`](../INSTALL.md), and the index `uspto-sync` builds is in
[`../providers/uspto-local/README.md`](../providers/uspto-local/README.md).
