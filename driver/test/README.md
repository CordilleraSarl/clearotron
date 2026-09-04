# driver/test — the driver's suite

470 `*.test.mjs` files, the `fixtures/` they read, and the mock binaries they drive. The suite is offline by
construction: no network, no credentials, no model. Engine tests spawn `mock-claude.mjs` (or `mock-codex.mjs`)
in place of a reasoning CLI, so a green run proves the machinery without a bill.

## Two tiers

| Command | What runs |
|---|---|
| `npm test` | The fast tier — every file except the ones marked full. One module's behaviour, a contract, a schema, a fixture rendered and asserted, a guard over the tree. |
| `npm run test:full` | The merge gate — the unfiltered `node --test test/*.test.mjs`. CI runs this on every pull request. |

A file joins the full tier with a comment line near the top: `// @tier full — drives the mock pipeline end to end`.

That marker is the whole mechanism: `../../scripts/test-fast.mjs` holds no list of filenames, because a list rots
the first time a file is renamed. 37 files carry it today, and it names every one of them on every run. Marking one
cannot take it out of the merge gate — `test:full` runs all of them, and `test-tiers.test.mjs` asserts that wiring.
Both npm scripts wrap the runner in `../../scripts/test-run.mjs`: the run gets its own `TMPDIR`, deleted at the end,
so `mkdtemp` fixtures do not pile up in the real one.

## Running as root

**Measured 2026-08-24 on `34d160ec`: the suite passes as root, and 13 arms declare a skip to make that
true.** `npm run test:full`, run as root with an isolated `TMPDIR`:

```
              root      devuser1
failures         2             2      the same two, and neither is about root (below)
skipped         14             1      13 of these are root declaring what it cannot falsify
assertions    8617
```

**Nothing fails because of root.** The two failures are byte-identical in both runs: `#854` and `#1764`
compare against the tree `node_modules` actually holds, so a checkout whose install predates a
dependency change reports them. CI's cold install passes both. If you see only those two, you have
measured nothing about root.

**The 13 are the point, and each says what it gave up** — `root reads through mode 000`, `root writes
through a 0o500 directory`, `root ignores a broken queue dir`. That is the / pattern working:
an arm that cannot inject its fault as root says so and names the gap, rather than passing on a fault
that never happened.

So a root run is worth doing and it is not a substitute for an ordinary one: **13 real behaviours go
unverified there.** Run as an ordinary user for coverage; run as root to check that the skips still
declare themselves.

The pattern to copy when adding one is `platform-caps.mjs`: probe what a machine can falsify, never infer
it from `process.platform`.

## The guards that read the whole tree

Five tree-scanning tests run in the fast tier and fail on content anywhere in the repository: `dead-names.test.mjs`
,`no-nul-bytes.test.mjs` ,`absent-path-citations.test.mjs` and the two identity guards below.
Each carries something that reddens when the sweep stops looking — a planted hit, a corpus floor, or an allow-listed
file that must still match — and the identity guards print which mode they ran in, because a sweep that found
nothing and one that never looked look alike. `vendor-as-architecture.test.mjs` (publishable markdown) and
`env-governance.test.mjs` (`process.env` reads in code) scan tree-wide but scoped, so are not counted here.

- `no-client-identifiers.test.mjs` — no client identity in the product repo. Identifiers with a shape get a positive
  allowlist of the reserved synthetic forms; customer and mark names have no shape, so those are a blocklist loaded
  from the private config store via `CLEAROTRON_IDENTIFIER_BLOCKLIST`, falling back to synthetic sentinels when no table
  is configured. That half cannot catch a name it has never seen — the reviewer is that check, and a legitimate use
  goes in `LEGIT` with its reason.
- `publication-scrub.test.mjs` — no operator identity, the withheld-path table still describes the tree, and no
  shipped file points a reader at a path that will not be there. Citations outside this tree are declared with a
  reason in `../../shared/withheld-paths.mjs`; an undeclared one fails.

## Setting up a worktree: run a real `npm ci`, and do not link `node_modules`

**In a fresh worktree, install from the worktree root** — `npm ci`, about two minutes, which is what CI
does. Do not symlink `node_modules` from another checkout, and do not copy it.

The reason this has its own section is not that linking fails. It is that **linking often almost works**,
and the failures it produces read as defects in the code you were about to change.

Measured on `e8dbbae2`, in a throwaway worktree, with `node_modules` symlinked from a checkout whose own
install was **complete and current**, `npm run test:full` invoked from the worktree root:

```
driver       6986 / 6989      1 failed:  test/third-party-notices.test.mjs
mcp-server    405 / 406       0 failed
```

One failure. Its output is `npm error missing: eslint-plugin-promise@^6.1.1, required by keyv@4.5.4` —
inside a test about third-party licence notices. Nothing in that says "your `node_modules` is a symlink".
It reads like a dependency or licensing problem in the product, which is the trap: **the better the tree
you linked FROM, the fewer failures you get, and the more each survivor looks like a real defect.**

**Do not expect a refusal to protect you.** `scripts/test-run.mjs` does refuse a checkout with no
resolvable dependencies — `REFUSING TO RUN — this checkout has no resolvable dependencies` — and that
refusal is loud and correct when it fires. It did **not** fire in the run above, because the linked tree
resolved everything it asked for. A refusal is evidence about the tree you linked from, not about
whether linking is safe.

**Numbers other than the one above are floating around and none of them is settled.** Reports of 3 and
of 11 driver failures exist for the same nominal setup; adding `portal-ui/node_modules` was measured to
change nothing, so the count is not simply "how many trees you linked". The leading unexplained
candidate is the invocation directory — `cd driver && npm run test:full` goes through a different npm
workspace resolution than the same command at the repo root, and three of the arms involved are about
dependency resolution. **If you quote a count, stamp the commit, which trees were linked, and which
directory you invoked from** — without those three a number here means nothing.

**And never `npm ci` while a link is in place.** npm follows the symlink and rewrites the *target's*
`node_modules` — you will break the checkout you borrowed from. Remove the link first.

## Where to start

`../../scripts/test-fast.mjs` — its header states the tier rule and why the line is drawn on what a test does rather
than on a stopwatch. Then `mock-claude.mjs`, whose environment knobs (stall, junk stream, `max_tokens` with no file,
silent model substitution) are the fault surface most engine tests assert against.
