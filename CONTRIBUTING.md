# Contributing

Thanks for looking. This file tells you what you can run on a fresh clone with no credentials, what
you cannot run and why, and the three rules that fail CI if you miss them.

Start with [README.md](README.md) for what the engine does and [INSTALL.md](INSTALL.md) for a real
installation.

## What you can run, with nothing but a clone

**Node 22 is a hard floor.** `package.json` declares it, `.nvmrc` pins it, and the free US register
runs on `node:sqlite`. Node 20 will fail in ways that look like your change.

```bash
npm install
npm test                    # the fast tier, offline, no network, no keys
```

The suite is offline by design. Domain models are pure, and the engine tests run against
`driver/test/mock-claude.mjs`, so a green `npm test` means the machinery works without a model, a
register, or an account. It says so on the first line it prints: the `model=opus … timeout=2250s`
lines that scroll past are the mock engine's dispatch record, not a bill.

### Two tiers, and the line between them is what a test does

`npm test` is the **fast tier**: one module's behaviour, a contract, a schema, a fixture rendered and
asserted, the guards that read the tree. It is what you need to know your change is sound before
opening a PR, and it is the default because the first command in this file should be one you wait
for.

`npm run test:full` is the **merge gate**: the fast tier plus the files that drive the orchestrator
end to end — a whole pipeline run, the runner's claim/queue lifecycle, a complete corrective or
operability cycle. Those files spawn stage after stage against the mock engine, which is why they
carry most of the suite's time and why nothing merges without them. CI runs `npm run test:full` and
`npm run test:providers` on every pull request. Nothing was dropped; it moved off your first command.

**Adding a test — which side is it on?** If it exercises a module, do nothing: a new file is
fast-tier. If it drives the pipeline, the runner or an operability cycle end to end, mark it and say
what it drives:

```js
// @tier full — drives the mock pipeline from intake to delivered packet
```

That marker is the whole mechanism. There is no list of filenames to keep in step, and marking a file
cannot take it out of the merge gate — `npm run test:full` is the unfiltered suite.

Four more things run for free:

| Command | What it proves |
|---|---|
| `node mcp-server/smoke.mjs` | Drives the real MCP server over stdio against a built fixture. Prints `SMOKE OK`. |
| `node driver/dev-portal.mjs` | Serves a pool at `http://127.0.0.1:18899/` — archive index, reports, customer pages. Loopback only; it refuses any other host. Needs a pool to point at (`CLEAROTRON_REPORTS_DIR`). |
| The $0 mock pipeline | A full run — intake, every stage, publish, delivery packet — on a mocked engine. Recipe in [docs/E2E.md § Tier 1](docs/E2E.md). Follow it as written; the absolute-path trap in it catches everybody. |
| `npx clearotron demo` | Replays `examples/sample-run/` — a real run on a fictional mark — through the real publisher into `~/trademark-demo/pool` and serves it. No keys, no model, no engine. |

**About `npx clearotron demo`.** `npx clearotron demo --no-open --once` publishes the sample and exits without
touching a browser. `npx clearotron demo --pool <dir>`
puts the pool somewhere else, and `npx clearotron demo --run-dir <dir>` replays a finished run of your
own instead of the shipped example.

Fix a bug, add a jurisdiction, add a doctrine test case: all of it is reachable from here.

## What you cannot run, and why

**A live clearance needs two credentials** — a register (free EUIPO, or a local USPTO index you build)
and `PERPLEXITY_API_KEY`. The research key is not an enrichment: all three clearance searches carry the
common-law sweep and cannot switch it off, so a clearance refuses at preflight without it. A Knockout
search is the exception — it runs, delivers its register half, and says on the report that the open-web
half did not run. `npx clearotron install` walks through both, and
[INSTALL.md § 1](INSTALL.md#1-prerequisites) is the full list.

**The scenario suite is private by design.** `scripts/e2e.mjs` scores runs against lawyer-written
reference answers on real matters; the references and the config store they load from are client work
product and will not be published. Its absence weakens nothing you can run — the in-repo suite covers
the machinery, and the scenario suite covers the answers. The validation ladder, from the $0 offline
suite to a paid live run, is [docs/E2E.md](docs/E2E.md).

**Some comments cite issues you cannot open** — `(#324)` and the like, against the private tracker this
repository was cut from. They are being removed rather than preserved.
[ADR-0005](docs/decisions/0005-comments-carry-reasoning.md) is the ruling and states what a new comment
has to meet; read it there rather than from a summary here. New work cites this repository's issues
normally, and a comment that would have carried history points at an ADR instead. A citation of a path
this tree does not carry has to be declared with its reason, and the publication guard in the suite
fails an undeclared one.

**`driver/skills/**` is engine input, not documentation.** Those Markdown files are the prompt payload
served to the model at run time — `synthesis-rules.md` is a 16,000-word program. Editing them for
brevity, tone or tidiness changes what a clearance concludes. Nothing in this section, and nothing in
any writing pass over the documentation, applies to them.

## The three rules that fail CI

**1. Rebuild `portal-ui/dist` and commit it.** The bundle is committed so a deploy never builds. CI
rebuilds it from source and requires byte equality, so a change under `portal-ui/src` that ships
without its rebuilt bundle fails:

```bash
npm run build:ui
git add portal-ui/dist
```

CI builds on the exact Node version named in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml). Build on that version. If the gate fails and
your diff looks right, check `node --version` first — the failure message names the version CI used.
The gate is required and does not get relaxed; if it ever fails for a reason you cannot act on, fix
the reproducibility and say so in the PR.

**2. The client-identifier guard runs in sentinel mode here, and that is a pass.**
The client-identifier guard forbids client identity in this repo. Half of it is a
blocklist of names, and that list is the roster it protects — so it is not in this repo. With no
table the guard runs on synthetic sentinels instead, which exercise
every branch of the matcher and identify nobody. The test prints which mode it ran in. Sentinel mode
is the expected mode for a public clone.

What it means for you: do not add a real company name, mark, matter number, or run id to a fixture,
a comment, or a test. And do not read a green run as a clearance — three measured limits:

- The sentinel run cannot catch a name it has never seen.
- **A roster entry protects one spelling, not the name.** A real mark carried with one vowel changed
  passed the matcher; so did one differing by a two-letter suffix. Twice, on different names.
- **Of 101 fixture files, 9 are reached by an identifier guard at all.** Widening that is tracked work.

The reviewer is the check. Say what you checked in the PR rather than citing a passing test.

**3. Types are enforced, and `vite build` does not typecheck.** `npm run typecheck -w portal-ui`
runs as its own CI step. Run it before you push.

### If your change touches a Markdown file, two more will catch you

Both are in `npm run test:full` rather than the fast tier, and neither is something a reviewer spots.

**A guard binds prose figures to the code that declares them.** A stage count,
a timeout, a product sizing — if a document states one, that document is pinned to the constant, and
deleting the sentence fails as loudly as contradicting it. `README.md`'s "How long a run takes" alone carries
seven bindings. The patterns match **contiguous text**, so re-wrapping a paragraph such that
`the longest is 45 minutes` breaks across a line makes the restatement invisible to the pattern while
reading identically to a human. Either keep the sentence, or retire its row in `driver/doc-constants.mjs`
on purpose.

**A guard fails a line that states one deployment's topology as the
product's.** Name a vendor as an example, a reference, or what *this* deployment uses. The accepted
qualifiers are a closed list (`VENDOR_QUALIFIED` in `shared/identifier-scan.mjs`) and the window is
per-line on purpose — a qualifier three paragraphs up must not excuse a line below. "Example tunnel ingress"
does not pass; "one such tool", "e.g.", "adapt", "this deployment" do. A file that legitimately names one
vendor throughout gets a row in that test's `DECLARED` table with the reason, and each reason has to survive
a reader asking when the entry goes away.

## Before you merge: is `main` actually red?

```sh
node scripts/main-health.mjs        # exit 0 you may merge · exit 1 main is red
```

A red `main` blocks every merge but its own fix, and that rule is right. **But a run can report failure
having executed nothing at all** — a scheduled run that cannot allocate a runner fails in four seconds
with no runner assigned and no steps recorded, and every job that gates on it is skipped. Measured on
this repository: two runs on one SHA, thirty minutes apart, the push run green on every job and the
scheduled one red having run nothing.

That is **could-not-look**, not a fault, and this tool says so rather than making you open the run and
read timings to find out. It does not block on it — nothing ran, so nothing can have regressed.

**It also does not call it green.** A run that never ran told you nothing about `main`, and the last
real answer is an earlier run. The exit code answers *may I merge*; the text answers *what do you know*.

**A real failure beside an allocation failure is red.** The two ways to be wrong here are not
symmetric: calling a regression "could not look" waves a broken `main` through, so anything it cannot
positively identify as never-started counts as a fault — including a job whose step list it could not
read at all.

## Sending a change

Branch, commit, open a PR. One change per PR.

The commit **body** is what gets read — not the title. State what changed, why this approach and
what you rejected, and how to verify it. "How to verify" should be a command someone else can run.

Two things reviewers will ask about, so save a round trip:

- **What does a zero mean?** An empty result, a missing file, a grep that found nothing — if your
  code reports that as a pass rather than as an absence, it will be sent back. This has been the
  source of more defects here than any other single cause.
- **Does it need a new environment variable?** Then it needs a row in
  [`docs/architecture/05-config-governance.md`](docs/architecture/05-config-governance.md) **and** a row in
  [`.env.example`](.env.example). Both are ratcheted by a guard that fails a
  new name missing from either.
- **Does it touch `driver/skills/**`?** Those files are prompt payload served to the model at runtime, not
  documentation — an edit for brevity or tone changes what a clearance concludes. Never touch that tree in a
  documentation or tidy-up task, and never let a mass edit reach it. Nothing enforces this yet, which is why
  [ADR-0005](docs/decisions/0005-comments-carry-reasoning.md) has it written down in several places and why
  this is one of them. **If the change to that tree is deliberate**, read
  [Changing the clearance doctrine](#changing-the-clearance-doctrine) below — it carries a different
  evidence bar from the rest of this file.

## Writing the release note for your change

**If your change is user-visible, it needs a release note, and the note is what a user reads.** Run
`npx changeset`, or write the file by hand under `.changeset/`: which package changed, how big the
change is, and one sentence about what someone can now do that they could not before.

The release build refuses a note that names a file, names a function, or describes the work as
"refactor", "implement", "leverage", "optimise" or "utilise". That is not a style preference. The person
reading a changelog does not have this repository open, so a line naming a file tells them nothing they
can act on, and a line saying "refactored the pipeline" tells them nothing at all. The refusal names the
line and prints what matched, so it takes a minute to fix.

Write the effect, not the work:

| Refused | Write instead |
|---|---|
| Refactored `stages.mjs` to leverage batching | A clearance with many marks now finishes in one pass instead of several |
| Implemented `parseVerdict()` | The report says why a mark was cleared, not just that it was |
| Optimised the run lock | Two clearances started at the same moment no longer wait on each other |

**No note is needed for a change nobody outside would notice** — a test, an internal guard, a comment.
The check is whether a user could tell the difference.

## Changing the clearance doctrine

`driver/skills/` is not documentation. It is the instruction set the model follows when it reasons about
a mark — what to search for, how to weigh a conflict, when to escalate, what a risk band means. Editing a
line there changes what a clearance concludes. That is why the tree is excluded from tidy-ups and mass
edits, and why a change to it is reviewed differently from a change to code.

**Not by a different process.** It is a pull request, it is reviewed, it is accepted or declined, the same
as anything else here.

**By different evidence.** A code fix states something a reviewer can confirm by reading it — this was an
off-by-one, this leaked a handle. A doctrine change states a claim about *outcomes*: that a clearance
reaches a better answer with your version than with ours. Nothing in the diff can settle that. Only
running clearances and comparing them can.

So a doctrine pull request has to bring the comparison with it.

### What to include

1. **What you intend to change about the reasoning.** One paragraph, in plain language. Not what the file
   now says — what a clearance now concludes that it did not before.
2. **What actually changed when you ran it.** At least one matter run both ways, with the differences
   named: findings that appeared, findings that disappeared, anything re-banded or reasoned differently.
3. **Where it should and should not apply**, if you know. A change that is right for one sector or
   jurisdiction can be wrong for another, and saying so is not a weakness in the proposal.

Without the second item we will usually decline without a deep review. That is not a judgement on the
idea — it is that we have no way to evaluate it, and accepting doctrine on how well it reads is how a
clearance engine gets quietly worse.

**This costs real money to produce.** A comparison run spends model time and register calls. Decide
whether the change is worth that before you start, not after.

**Do not add rules to make a case pass.** A mark is cleared by judgment, not by accumulating gates,
exceptions and coverage flags until a known example comes out right. A change that makes the funnel
narrower is usually the defect rather than the fix, and it will be read that way.

### The three possible outcomes

**Into the base layer.** Your change becomes part of what every install gets, including ours and our
clients'. That is the highest bar: it has to be an improvement for the matters this doctrine is tuned
for, not only for yours.

**Published as a pack.** Doctrine resolves file by file — an install can point at another directory and
have its files win, with everything it does not override falling through to ours. So a change that is
right for your practice but not for everyone can be published as a small directory that others opt into,
without being merged here. **A pack is the work of whoever wrote it. It is not part of this project, it
is not reviewed by us, and we make no representation about it.**

**Declined**, with a reason.

### Keeping yours to yourself

You do not have to contribute anything. Point your install at your own doctrine directory and the files
you put there win; every file you have not overridden still comes from us, including the updates. You can
run modified doctrine indefinitely, privately, and stay current with everything else.

### Licence

A contribution accepted into this repository is licensed on the same terms as every other contribution
here — see [LICENSE](LICENSE) and the contributor agreement referenced in this file. Doctrine files are
source code for this purpose, not documentation, and nothing about them is treated differently.

## Licence and contribution terms

This project is licensed under [AGPL-3.0-only](LICENSE). Additional terms under section 7 of that
licence are in [ADDITIONAL-TERMS.md](ADDITIONAL-TERMS.md), and use of the project's name and marks is
governed by [TRADEMARKS.md](TRADEMARKS.md) — the software licence grants no rights in them.

**Before your first change is merged you will be asked to sign a Contributor Licence Agreement.** It
applies to every contribution, not only substantial ones. Sign
[CLA-INDIVIDUAL.md](CLA-INDIVIDUAL.md) if you are contributing on your own account. If your employer
owns what you write at work — which most employment contracts provide for — your employer signs
[CLA-CORPORATE.md](CLA-CORPORATE.md) and names you on its schedule. You keep copyright in what you
contribute; the agreement is a licence, not an assignment.

## How your PR reaches the maintainers

Development happens in a **private copy of this repository**. The two share ancestry, so moving a
commit between them is ordinary git — not a re-export, and not a replay.

- Your PR is reviewed and merged **here**, on the public repo.
- Maintainers pull merged public commits into the private copy, which is the origin the team works
  from, and push back from it.
- Your commit keeps its authorship in both.

**On your first PR, CI will sit unstarted until a maintainer approves it.** That is GitHub's
first-time-contributor gate on workflows from forks, not a broken pipeline and not a judgement on
your change. It runs on every later PR automatically. If it stays unstarted for more than a day,
say so in the PR — that one is on us.

The consequence worth knowing: the private copy can be ahead of this one, so a `main` here may not be
the newest state of the world, and a rebase after a push from it can look noisier than your change.
Ask in the PR if that makes your branch hard to land.

## Security

Do not open an issue for a security problem. [SECURITY.md](SECURITY.md) has the disclosure path.

### `npm audit` reports nothing, and one pin is why

`npm audit` is the second command this file gives a new reader, so it should not end in a number that
needs a paragraph. It ends in `found 0 vulnerabilities`, and the reason is one line in the root
`package.json`:

```json
"overrides": { "uuid": "^11.1.1" }
```

**What it fixes.** `exceljs` — the `.xlsx` writer behind `driver/publish/xlsx.mjs` — declares
`uuid@^8.3.0`, and advisory GHSA-w5hq-g745-h8pq covers `uuid <11.1.1`. That one dependency produced both
rows the audit used to report.

**Why the pin rather than the fix npm offers.** `npm audit fix --force` resolves the same advisory by
installing `exceljs@3.4.0` — a two-major downgrade of a shipping output path. Overriding the transitive
FORWARD leaves `exceljs` at 4.4.0 and takes the count to zero. `uuid@11` ships CommonJS, which is the
form `exceljs` requires it in, and the workbook suites pass against it.

**This note used to argue the opposite, and the argument was sound.** It said the advisory could not fire
here — `exceljs` calls only `uuid`'s `v4`, with no arguments, while the advisory concerns `v3/v5/v6` with
a caller-supplied `buf` — and therefore that a two-major downgrade was the worse trade. Both halves were
true. What it never weighed was the third option: pin the transitive forward and leave `exceljs` alone.
The reachability argument is no longer load-bearing, so it is not repeated as though it were.

**When the pin becomes dead weight.** The moment `exceljs` ships a release declaring `uuid >= 11.1.1` on
its own. You will not have to remember:
`driver/test/uuid-advisory-is-pinned-out.test.mjs` asserts that `exceljs` still declares a range the
advisory reaches, so it **fails on that day** and its message says to delete the override and the file.

**If you are re-checking this:** the claim to test is that the lockfile RESOLVES `uuid` at 11.1.1 or
later and that the entry EXISTS. A lockfile with no `uuid` entry also reports `found 0 vulnerabilities`
— over a tree missing a dependency. That is why the guard asserts presence before version.

## Changing a production dependency

Run `npm run notices` and **commit `THIRD-PARTY-NOTICES.md` in the same commit as the dependency
change.** The file is generated from the installed production tree, so any move in a production
dependency — a bump, an addition, a removal, a Dependabot pull request — moves it too, and CI reds
until the regenerated file is pushed alongside.

Regenerating without committing it is the commonest way to meet that red twice: the check passes on
your machine and CI still fails, because CI reads what you pushed. The refusal itself says this now;
this line is here so you read it before the push rather than after.

## Conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Contributor Covenant 2.1.
