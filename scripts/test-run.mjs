#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// test-run.mjs — give a test run its own TMPDIR, and delete it when the run ends.
//
//   node ../scripts/test-run.mjs node --test test/*.test.mjs
//
// ── the problem ──────────────────────────────────────────────────────────────────────────────────────
//
// The suites create mkdtemp fixture directories and never remove them. On 2026-07-31 /tmp held ~300,000
// directories and ~90 GB, and the root filesystem hit 100% — 5.8 MB free of 123 GB. The first symptom
// named nothing useful ("command output was lost — the temp filesystem is full"), which points at the
// harness rather than the cause.
//
// Nothing is wrong with any individual test. It is volume: 582 mkdtempSync call sites across 166 test
// files, roughly four in five with no cleanup, times a day of parallel agents each running the suites
// repeatedly. then dropped --test-concurrency=1 and made the suite ~2.4x faster, so the same day's
// work now leaks the same fixtures in under half the time.
//
// ── why this shape, and not the other two ────────────────────────────────────────────────────────────
//
// The obvious fix is a shared tmpFixture() helper plus a codemod over all 582 sites. That is a very large
// diff with 582 chances to break a fixture, in a repo whose tests are load-bearing evidence, and it fixes
// only the sites that exist today.
//
// The second obvious fix is a posttest sweeper matching fixture prefixes with an mtime floor. But agents
// run these suites CONCURRENTLY — that is how the box filled in the first place — so "delete everything
// matching prelim-mock-* older than N" can delete another run's live fixtures. Prefix matching cannot
// distinguish my fixtures from yours.
//
// A third option needs neither. os.tmpdir() honours TMPDIR, and every leaking call site is already
// mkdtempSync(join(tmpdir(), "prefix-")). So give the run its own tmpdir: every fixture lands inside a
// directory THIS process created, and cleanup is one rmSync of that directory. No call site changes, no
// monkey-patching (an ESM `import { mkdtempSync }` snapshots the binding, so patching fs afterwards does
// nothing anyway — measured), no cross-run race because no two runs share a root, and every future test
// inherits it for free.
//
// Verified: two fixture dirs from two test files both landed inside the run root, zero in /tmp, and one
// rmSync removed them.
//
// ── the constraint this must not break ───────────────────────────────────────────────────────────────
//
// NEVER widen the delete to anything the suite did not create. This removes exactly one directory, whose
// path it holds because it made it, under a name it chose. There is no glob over /tmp. The box hosts
// production services and other users' sessions (/tmp/claude-* in particular), and a sweeper that reasons
// about paths it did not create is how a tidy-up becomes an outage.

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readdirSync, statSync, existsSync, readFileSync, symlinkSync, copyFileSync, chmodSync } from "node:fs";
import { delimiter, dirname, join, parse as parsePath, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";


// ── TAIL — THIS WRAPPER READS BOTH SPELLINGS; IT DOES NOT TRANSLATE THE ENVIRONMENT ───────────
//
// The defect and the fix, and the fix that looked obvious and was wrong.
//
// THE DEFECT. This file is what every workspace's `npm test` runs, and it reads renamed names three
// times: the register-provider default below, the data-plane containment guard, and the contained queue
// default. The last two derive both spellings from the alias table already; the first read one name.
// Measured through this file, spawning a child that prints what it inherited:
//
//     CLEAROTRON_DATABASE=clarivate node scripts/test-run.mjs node -e '<print>'
//       -> CLEAROTRON_DATABASE = "corsearch"
//
// The operator named a vendor and the suite ran as a different one, in silence. That is 's own
// sentence — "a default is the one wrong value that never announces itself" — reached through the
// compatibility window rather than through a code default.
//
// THE FIX THAT LOOKED OBVIOUS: call `warnRetiredEnv()` here, first, so every read below sees one
// vocabulary. It is what every other program in the tree does, and it is WRONG HERE, because this
// program's job is to hand an environment to children. Translating mutates what they inherit, and a
// test that points a child at its own fixture pins ONE spelling:
//
//     {...process.env, CLEAROTRON_QUEUE_DIR: <fixture queue>}   with CLEAROTRON_QUEUE_DIR inherited
//       -> [env-aliases] both are set and disagree — CLEAROTRON_QUEUE_DIR wins
//       -> deploy-preflight: no run is queued   (it read the harness's queue)   exit 0, expected 1
//
// Measured, not predicted: `CLEAROTRON_DATABASE=clarivate npm test` — a form this file's own
// comment documents as supported — went from 40/40 to 38/40 with the translation in place, and the two
// arms failed in `engine.gather` and `register-advertisement-vs-grant`, neither of which this change
// is about. The population is every test that pins one spelling for a child, which is most of them.
//
// SO THE WRAPPER READS BOTH AND WRITES NEITHER. Nothing needs the mutation: a child that imports the
// loader translates for itself, and a child that does not is reading `driver.config.mjs`, which resolves
// both spellings since this same change. What was missing was one CHECK asking the question in both
// vocabularies, and that is all that is added.

const PREFIX = "ct-testrun-";
// The real tmpdir, read BEFORE we set TMPDIR for the child — a nested invocation must not root itself
// inside its parent's root, or the parent's cleanup removes a live child's fixtures.
const REAL_TMP = process.env.CT_TEST_TMP_BASE || tmpdir();

// A run killed with SIGKILL (or a machine that reboots) never reaches its own cleanup and leaves one
// directory behind. One per killed run is a tractable number, but it should not accumulate forever, so
// each run clears the abandoned roots of previous ones. Bounded three ways: the exact prefix we own, an
// age floor well beyond any real run, and a failure here never blocks the tests.
// — THE FLOOR IS A KNOB, because the safe value depends on who is running.
//
// Six hours is right for a developer box: the sweep reads the root's mtime, and a suite that stops
// creating fixtures in its own root for a while must never be mistaken for an abandoned one. On CI the
// answer is known exactly — no job outlives its `timeout-minutes` (30, the longest here) — so CI sets a
// floor just above that and a killed run's tree goes within the hour instead of within six.
//
// Measured 2026-08-24: seven abandoned roots on the runner box, aged 1h03m to 3h03m. Every one of them
// was UNDER the six-hour floor, which is why they accumulated through the merge burst.
const STALE_MS = Math.max(60_000, Number(process.env.CT_TESTRUN_STALE_MS) || 6 * 60 * 60 * 1000);
function sweepAbandonedRoots() {
  let entries = [];
  try { entries = readdirSync(REAL_TMP); } catch { return 0; }
  let swept = 0;
  for (const name of entries) {
    if (!name.startsWith(PREFIX)) continue;
    const p = join(REAL_TMP, name);
    try {
      const st = statSync(p);
      if (!st.isDirectory() || Date.now() - st.mtimeMs < STALE_MS) continue;
      rmSync(p, { recursive: true, force: true });
      swept++;
    } catch { /* another run may be clearing the same one; not ours to worry about */ }
  }
  return swept;
}

const argv = process.argv.slice(2);
if (!argv.length) {
  console.error("usage: node scripts/test-run.mjs <command> [args...]");
  process.exit(2);
}

// ── A NAMED TEST FILE THAT IS NOT THERE IS A REFUSAL, NOT A PASS ────────────────────────────────
//
// `node --test a.test.mjs absent.test.mjs` exits 0 and prints `# pass N` / `# fail 0`, and says
// NOTHING about the file it could not find. It refuses only when every path it was handed is missing.
// So the one thing this repository asks of a contributor — derive the arms your change touches and
// run them by name — goes green over every arm that is not there, and reports the same green as full
// coverage.
//
// This is not hypothetical on this tree. The public cut withholds test files that exist privately,
// and the withheld one is often the file named after the module somebody just changed. Two arms were
// run by name on a fresh clone, came back clean, and neither existed.
//
// SUFFIX, NOT SHAPE. Only an argument ending in a test-file suffix is checked. Flags, a flag's value,
// the command itself and directories are left alone: guessing which arguments are paths is how a
// guard starts refusing invocations that were fine, and this one has to be safe enough to sit in
// front of every suite run on the box.
//
// AND A FLAG'S VALUE IS NOT A PATH. The first cut of this guard refused
// `--test-name-pattern 'nothing.test.mjs'` — a legitimate invocation, caught by its own control before
// it shipped. Anything beginning with a dash is skipped, and so is the argument straight after a flag
// that takes a value. `--test` is not in that set, because the file list follows it and that list is
// the whole point.
const TAKES_A_VALUE = new Set([
  "--test-name-pattern", "--test-skip-pattern", "--test-reporter", "--test-reporter-destination",
  "--test-shard", "--test-concurrency", "--test-timeout", "--import", "--require", "-r",
  "--loader", "--experimental-loader", "--conditions", "-C", "--env-file",
]);
const namedButAbsent = argv.filter((a, i) =>
  !a.startsWith("-")
  && !TAKES_A_VALUE.has(argv[i - 1])
  && /\.(test|spec)\.[cm]?[jt]sx?$/.test(a)
  && !existsSync(a));
if (namedButAbsent.length) {
  console.error("[test-run] named on the command line and not on disk:\n  "
    + namedButAbsent.join("\n  ")
    + "\n\nRefusing rather than running the rest. `node --test` would have run the files that DO exist "
    + "and reported `# fail 0`, which reads as coverage of everything you asked for.");
  process.exit(2);
}

// ── — COVERAGE ON REQUEST, SO THE FIFTH MEMBER CAN BE ASKED ABOUT ─────────────────────────────
//
// A GATED arm — `if (!process.env.X) return;` at the top of a test body — moves no token, so the suite
// passes and driver/suite-census.json passes. The only question that sees it is "did this line ever
// run", and that is a coverage question. `CT_COVERAGE_DIR` turns it on for one invocation.
//
// OFF BY DEFAULT AND ADDITIVE, both deliberately. Off, because coverage is a cost every contributor run
// would pay for a check only CI acts on. Additive, because naming ANY reporter silences the default TAP
// stream, and CI greps that stream for the repo-guard markers — so the TAP pair is written out
// explicitly beside the lcov one rather than assumed. Measured with both: 7,423 pass, 0 fail, TAP intact.
//
// ONE FILE PER WORKSPACE, keyed on the directory this ran in. `npm run test:full` walks three
// workspaces through this same wrapper, and a single shared path would have the last one overwrite the
// rest — an lcov that silently describes one workspace while named for all of them.
if (process.env.CT_COVERAGE_DIR && argv.includes("--test")) {
  const dir = process.env.CT_COVERAGE_DIR;
  mkdirSync(dir, { recursive: true });
  const name = `${parsePath(process.cwd()).base || "root"}.lcov`;
  argv.splice(argv.indexOf("--test") + 1, 0,
    "--experimental-test-coverage",
    "--test-reporter=tap", "--test-reporter-destination=stdout",
    "--test-reporter=lcov", `--test-reporter-destination=${join(dir, name)}`);
  console.error(`[test-run] coverage on — ${join(dir, name)}`);
}

// ── THE TEST RUN DECLARES ITS REGISTER PROVIDER ───────────────────────────────────────────
//
// `CLEAROTRON_DATABASE` has no default any more. It used to fall back to "corsearch" inside
// driver.config.mjs, which meant every one of these suites had been running as Corsearch without
// anything saying so — 211 tests depended on a value none of them mentioned. Removing the default made
// that visible, which is the point: the variable decides which vendor gets called and billed, and a
// value nobody states is a decision nobody made.
//
// So the harness STATES it, here, rather than the driver guessing it there. The difference is not
// cosmetic. A test run is not a deployment: it dials no vendor, and its fixtures and expectations are
// written against Corsearch's capability contract specifically — the tool counts, the OR-width, the
// screening source. Declaring anything else would silently change what most of these tests mean.
//
// It does NOT override an explicit value, so `CLEAROTRON_DATABASE=clarivate npm test` still works
// and the suites that spawn children with their own setting are untouched. And the refusal itself is
// covered: driver/test/register-provider-required.test.mjs clears the variable in a child process and
// asserts every door throws.
// TAIL — "ALREADY CHOSEN" IS A QUESTION IN TWO VOCABULARIES, and this asked it in one. An
// operator who set `CLEAROTRON_DATABASE` — the name every document and every refusal gives them — was
// invisible here, so the harness overwrote their choice with corsearch and said nothing. Derived
// through `spellingsOf` rather than by naming the pair, so the next rename carries this with it.
//
// It still WRITES the one name, deliberately: writing both, or translating the whole environment, wins
// over any child env that pins a single spelling. See the note above PREFIX.
const providerChosen = ["CLEAROTRON_DATABASE"]
  .some((n) => String(process.env[n] ?? "").trim() !== "");
if (!providerChosen) process.env.CLEAROTRON_DATABASE = "corsearch";

// ── A PARTLY-BLIND SUITE IS NOT A FAILING SUITE ────────────────────────────────────────────
//
// `git worktree add` gives you no `node_modules`, nothing in this repo creates one, and the tracker asks
// for a worktree per PR. Run the suite there and it does not refuse — it runs, and reports the blindness
// as failures:
//
//     # tests 3456   # pass 3159   # fail 295      <- fresh worktree
//     # tests 3949   # pass 3947   # fail 0        <- same commit, after an install
//
// Every one of those 295 is `Cannot find package 'undici' | 'exceljs' | '@modelcontextprotocol/sdk'`
// and the assertions downstream of them, printed as `not ok` lines with stack traces in
// driver/test/*.test.mjs. They are indistinguishable from code defects. An agent who runs the suite on a
// branch, sees 295 red, and diffs the failing NAMES against a baseline taken the same way sees zero
// regressions and calls the branch clean — and it is, but roughly 190 tests never executed, and a real
// regression inside any of them is invisible by exactly that arithmetic. It has already happened: 's
// first full-suite comparison was taken against a 295-fail baseline.
//
// So: refuse, name what is missing, and name the command. REFUSE RATHER THAN INSTALL — this wrapper is
// what CI and scripts/publication-scan.mjs run the suite through, and a wrapper that can start a network
// install is a wrapper that can turn a publication gate into a package fetch. `npm ci` already runs
// ahead of both.
//
// Declared dependencies of the package.json THIS RUN STARTS FROM, resolved the way Node resolves a
// package directory — walking up for `node_modules/<name>/package.json`. Deliberately not
// `require.resolve`: a package whose exports map has no "." entry (@modelcontextprotocol/sdk is one)
// throws there while being perfectly installed, and a false refusal here would be worse than the defect.
function packageDirExists(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    if (existsSync(join(dir, "node_modules", name, "package.json"))) return true;
    const up = dirname(dir);
    if (up === dir || dir === parsePath(dir).root) return false;
    dir = up;
  }
}

function missingDependencies(cwd) {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return [];
  let pkg;
  try { pkg = JSON.parse(readFileSync(pkgPath, "utf8")); } catch { return []; }
  const names = Object.keys(pkg.dependencies ?? {});
  // A workspace root declares its members' dependencies nowhere, so "no dependencies here" must not read
  // as "nothing to check": the install itself is what is missing, and node_modules is where it lands.
  if (!names.length && Array.isArray(pkg.workspaces) && pkg.workspaces.length)
    return existsSync(join(cwd, "node_modules")) ? [] : ["(the workspace install)"];
  return names.filter((n) => !packageDirExists(n, cwd));
}

const missingDeps = missingDependencies(process.cwd());
if (missingDeps.length) {
  console.error(`[test-run] REFUSING TO RUN — this checkout has no resolvable dependencies.`);
  console.error(`  missing: ${missingDeps.join(", ")}`);
  console.error(`  from:    ${process.cwd()}`);
  console.error(``);
  console.error(`  npm install            (from the repo root — it installs every workspace)`);
  console.error(``);
  console.error(`  A fresh 'git worktree add' has no node_modules. Running anyway would report ~190`);
  console.error(`  tests that never executed as ~295 failed assertions, which reads as code defects and`);
  console.error(`  makes a clean-looking baseline diff out of a suite that was never run. #535.`);
  process.exit(1);
}

// ── THE SUITE CANNOT READ THE OPERATOR'S CONFIGURATION, IN OR OUT (,) ──────────────────
//
// TWO DIRECTIONS, ONE SEAT. The guard below refuses when a data-plane ROOT escapes; these two stop the
// suite reading the operator's configuration and stop it writing into their data plane. Same wrapper,
// same reason: it is the last place that sees the whole run as one thing.
//
// IN — the checkout `.env`. shared/env-local.mjs reads `<repo>/.env` for every declared CLI entry, and
// the tests drive those entries. So an operator who wrote a `.env` exactly as INSTALL.md §3 describes
// has their real configuration inside the test process, and it DISARMS the arms that assert a refusal.
// Measured 2026-08-25 with §3's own example file: `CLEAROTRON_CLAUDE_PATH=/nope refuses BEFORE any run dir
// exists` and ` a disk that cannot hold the run refuses...` both fail, because §3 sets
// CLEAROTRON_CLAUDE_PATH itself, and the wrapper’s value outranked the one the test set.
//
// A GUARD THAT STOPS REFUSING LOOKS IDENTICAL TO A GUARD WITH NOTHING TO REFUSE. That is why this is
// the worst class of test to disarm quietly, and why it is fixed at the wrapper rather than per arm.
//
// OUT — the MCP access log. mcp-server/lib/audit.mjs defaults to join(homedir(), "trademark",
// "telemetry", ...), which is the DOCUMENTED default base for this product's data plane, and `npm test`
// wrote 9,479 bytes of fixture rows into it on a machine the document calls safe to run anywhere.
//
// BOTH USE A MECHANISM THAT ALREADY EXISTED. Nothing is invented here: CLEAROTRON_NO_ENV_FILE is §3's
// own documented opt-out, the one the systemd units already set, and TRADEMARK_MCP_AUDIT_LOG is the
// variable audit.mjs already reads first. The defect was never a missing mechanism; it was that the
// suite did not use them.
//
// NEITHER IS FORCED OVER AN EXPLICIT CHOICE. A caller that sets either name keeps it, so a test that
// needs to exercise the .env read, or to point the audit log somewhere of its own, still can.
for (const name of ["CLEAROTRON_NO_ENV_FILE"]) {
  if (String(process.env[name] ?? "").trim() !== "") { process.env["CLEAROTRON_NO_ENV_FILE"] ??= process.env[name]; break; }
}
process.env["CLEAROTRON_NO_ENV_FILE"] ||= "1";

// ── THE SUITE CANNOT REACH THE LIVE DATA PLANE ───────────────────────────────────────────
//
// On 2026-08-18 a suite run was launched with the operator account's `~/.env` sourced. That put the LIVE data-plane
// paths into the unit tests: the enqueue-exercising tests wrote REAL jobs into the live queue, the
// armed driver claimed them, and TWO full fixture clearances were running — four live model stages,
// real subscription turns — before anything objected. The containment tripwire did fire, as one red
// line among 207, AFTER the jobs were enqueued and claimed. A tripwire that reports containment loss
// once the clearances are already running is a receipt, not a guard.
//
// So the refusal happens HERE, in the wrapper every workspace's test script goes through, before the
// child is spawned and therefore before a single test executes. This is the same seat and the same
// shape as the dependency refusal above it, for the same reason: the wrapper is the last place
// that sees the whole run as one thing.
//
// NAMED, BECAUSE THERE IS ONE SPELLING TO NAME. / renamed the install surface and kept the
// old names readable alongside; closed that window and deleted them, so a run arrives with the
// current name or with nothing at all.
//
// This list used to be derived from the alias table, for a good reason that no longer has a mechanism:
// a hand-copied list keeps watching a name nobody sets and goes quiet rather than red, which is this
// whole family's failure mode. What replaces the derivation is an arm that names each variable it
// expects to find here — ` VOID CONTROL` in driver/test/suite-cannot-reach-live-data-plane.test.mjs
// — so a name dropping out of this list fails there instead of silently narrowing the scrub.
const DATA_PLANE_VARS = Object.freeze([
  "CLEAROTRON_QUEUE_DIR", "CLEAROTRON_REPORTS_DIR", "CLEAROTRON_WORK_DIR",
]);

// Contained means "under a temp root this box uses for temporary things" — the run root has not been
// minted yet at this point, but it is created UNDER one of these, so a value pointing inside it passes.
//
// THE PLATFORM TEMP DIRECTORY IS IN THIS LIST SEPARATELY FROM `tmpdir()`, and the first draft of this
// guard was wrong for want of it: this box exports `TMPDIR=/mnt/datadisk1/tmp`, so `tmpdir()` answers
// that and a perfectly contained `/tmp/...` value was REFUSED. A guard that refuses correct work gets
// removed, and then nothing is guarded at all — the false refusal is the expensive direction here, not
// the missed one, because the value this is protecting against is somebody's live estate under /home
// or /srv, never a temp filesystem.
const PLATFORM_TMP = process.platform === "win32" ? [] : ["/tmp"];
const CONTAINMENT_ROOTS = Object.freeze([...new Set(
  [REAL_TMP, tmpdir(), ...PLATFORM_TMP].map((p) => resolve(p)),
)]);
const isContained = (value) => {
  const p = resolve(value);
  return CONTAINMENT_ROOTS.some((r) => p === r || p.startsWith(r + sep));
};
// The acceptance asks the refusal to name the value's ROOT, because that is the part that says "this is
// somebody's live estate" at a glance, where a long path does not.
const rootOf = (value) => {
  const parts = resolve(value).split(sep).filter(Boolean);
  return parts.length ? sep + parts[0] : sep;
};

// A guard with no way through gets deleted the first time somebody genuinely needs it, and then nothing
// is guarded at all. So there is a way through, it is NAMED, and taking it is loud on every run —
// deliberately not the shape the incident had, which was silence.
const LIVE_OVERRIDE = "CT_ALLOW_LIVE_DATA_PLANE";

const escaped = DATA_PLANE_VARS
  .map((name) => ({ name, value: String(process.env[name] ?? "").trim() }))
  .filter((v) => v.value !== "" && !isContained(v.value));

if (escaped.length && !String(process.env[LIVE_OVERRIDE] ?? "").trim()) {
  console.error(`[test-run] REFUSING TO RUN — the suite is pointed at a data plane outside any temp root.`);
  for (const { name, value } of escaped) console.error(`  ${name}=${value}   (root: ${rootOf(value)})`);
  console.error(``);
  console.error(`  These decide where jobs are ENQUEUED and where runs PUBLISH. Pointed at a live estate,`);
  console.error(`  the enqueue-exercising tests write real jobs into the real queue and an armed driver`);
  console.error(`  claims them: on 2026-08-18 that started two full clearances, four live model stages, and`);
  console.error(`  the containment tripwire only said so afterwards. #1243.`);
  console.error(``);
  console.error(`  Almost always the cause is a shell that sourced a box .env before running the suite. CI`);
  console.error(`  never does this, and the fix is to run the suite in a shell that has not.`);
  console.error(``);
  console.error(`  If a live data plane is genuinely what you want:  ${LIVE_OVERRIDE}=1 <command>`);
  process.exit(1);
}
if (escaped.length) {
  console.error(`[test-run] ${LIVE_OVERRIDE} IS SET — running against a data plane outside any temp root:`);
  for (const { name, value } of escaped) console.error(`  ${name}=${value}   (root: ${rootOf(value)})`);
  console.error(`  Real jobs written by this run are real. #1243.`);
}

// ── WHAT THE NEXT TWENTY MINUTES OF OUTPUT IS, SAID BEFORE IT STARTS ───────────────────────
//
// The suites print thousands of lines shaped like
//   [register-unit:primary-sweep] attempt 1/1 (engine=anthropic-agent agent=clawdi model=opus … timeout=1500s)
// and to somebody who cloned this repo ten minutes ago that is their subscription being spent, at
// speed, for reasons nobody explained. It is the mock engine's dispatch record. Nothing here can tell
// them that except a line that says it, and it has to come FIRST — an explanation after the scroll is
// an explanation after the decision to hit Ctrl-C.
//
// It lives HERE, in the wrapper every workspace's test script goes through, rather than in one
// workspace's setup where the other workspaces would print nothing. stderr, so no TAP consumer sees it.
console.error(`
────────────────────────────────────────────────────────────────────────────
 OFFLINE SUITE — no model is called, no register is queried, nothing is spent.
 The \`(engine=… model=opus … timeout=…s)\` lines below are the MOCK engine's
 dispatch record: every suite that dispatches a stage points CLEAROTRON_CLAUDE_PATH
 at driver/test/mock-claude.mjs, so \`model=opus\` names the tier a stage WOULD
 ask for, not a call anyone makes. Provider suites drive their adapters over a
 stubbed fetch. Fixture hosts are *.trademark.test and every file this run
 writes lands in a temporary directory it deletes on the way out.
────────────────────────────────────────────────────────────────────────────
`);

const swept = sweepAbandonedRoots();
if (swept) console.error(`[test-run] cleared ${swept} abandoned run root(s) from a killed run`);

// ── THE ROOT IS OWNED BEFORE IT EXISTS ──────────────────────────────────────────────────────────────
//
// — CLEANUP AND THE SIGNAL HANDLERS USED TO BE REGISTERED BESIDE THE SPAWN, ~190 LINES BELOW.
// Everything between here and there — env wiring, the symlink farm, the dependency check — is a window
// in which the root exists and nothing would remove it, because a signal arriving then killed this
// process by default action with no `exit` handler installed. `cancel-in-progress` signals on every
// superseded push, so that window is not hypothetical: it reddened main on 2026-08-24 (run
// 32703734578), where the arm below caught a root that outlived a SIGINT. Under load the window is
// wider, which is exactly when cancels arrive.
//
// So ownership is established here, at the line that creates the thing being owned, rather than at the
// line that happens to spawn the child.
let root = null;
let cleaned = false;
function cleanup() {
  if (cleaned || root === null) return;   // nothing minted yet is nothing to remove, not an error
  cleaned = true;
  // Belt and braces: only ever remove a path we minted, under the name we own.
  if (!root.startsWith(join(REAL_TMP, PREFIX))) return;
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
}
process.on("exit", cleanup);

// Forward the signal rather than dying on it, so the child gets to flush its own output first; cleanup
// then runs on its exit, in the `close` handler far below.
//
// BEFORE THE CHILD EXISTS THERE IS NOTHING TO FORWARD TO, and that case is the one this move is for:
// clean up, drop this listener, and re-raise so the exit status is still the signal's rather than a
// tidy zero that hides a cancelled run.
let child = null;
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    if (child) { try { child.kill(sig); } catch { /* already gone */ } return; }
    cleanup();
    process.removeAllListeners(sig);
    try { process.kill(process.pid, sig); } catch { process.exit(1); }
  });
}

// AND ONLY NOW is it created. Registering after the mkdtemp left a window of a few statements that a
// signal could still land in — measured at ~7% of cancels signalled the instant the directory appeared,
// against 100% before the handlers moved at all.
root = mkdtempSync(join(REAL_TMP, PREFIX));

// ── AN UNSET QUEUE DIR FALLS BACK INSIDE THE RUN ROOT, NEVER TO A LIVE PATH ──────────────
//
// Refusing on UNSET would break CI and every contributor run, so the acceptance's other arm is taken
// for the variable that actually received the real jobs: `CLEAROTRON_QUEUE_DIR` falls back INSIDE this
// run's own temp root. Empty counts as unset deliberately — `X=` in an EnvironmentFile means "not
// configured", and an empty string silently reaching a `||` default is the defect this family
// is named for. Set it blank and you get the contained path.
//
// `CLEAROTRON_WORK_DIR` GETS NO DEFAULT HERE, AND THAT IS A MEASUREMENT RATHER THAN AN OPINION.
// The first cut set one and took the driver suite from 0 red to 7: the runner claim, takeover and jx
// families all failed. The five affected files run 8-fail with that default and 1-fail without it,
// against the same tree, so the cause is not in doubt. The mechanism is in the failure output —
//
//     [env-aliases] CLEAROTRON_WORK_DIR and CLEAROTRON_WORK_DIR are both set and disagree
//
// Those tests build a child env from `process.env` and inject the CURRENT spelling. Anything this
// wrapper pre-sets under the LEGACY spelling therefore arrives next to a disagreeing current one, and
// the run splits into two derivations of the same root — precisely what gather-config.mjs's
// comment says must stay unrepresentable. Pre-setting the current spelling instead only inverts the
// bug: the wrapper would then win over a test's deliberate value. While the compat window is open
// there is no spelling this wrapper can safely pre-set.
//
// So the unset workspace root keeps main's behaviour. It is a `process.env.X || <live default>`
// fallthrough, which is defect 1 word for word, and it belongs in that fix rather than in a
// harness wrapper that cannot express it without breaking the harness.
//
// `CLEAROTRON_REPORTS_DIR` gets no default either, for a different and better reason: it has none by design
// and REFUSES when unset, which is acceptance 2's other half already satisfied by the config
// itself. Handing it a temp value would defeat that refusal for the whole suite and silently delete
// the coverage in driver/test/data-plane-defaults.test.mjs.
const containedDefaults = {
  CLEAROTRON_QUEUE_DIR: join(root, "queue"),
};
const applied = [];
for (const [legacy, fallback] of Object.entries(containedDefaults)) {
  const names = [...new Set([legacy, legacy])];
  if (names.some((n) => String(process.env[n] ?? "").trim() !== "")) continue;
  process.env[legacy] = fallback;
  applied.push(legacy);
}
if (applied.length) console.error(`[test-run] contained (unset -> inside the run root): ${applied.join(", ")}`);

// ── THE OFFLINE BANNER IS ENFORCED HERE, NOT ASSERTED FURTHER DOWN ──────────────────────────────────
//
// The banner below this block has said "no model is called, no register is queried, nothing is spent"
// since. Nothing enforced it. On 2026-08-23 a unit suite run under that banner reached the real
// `claude` on PATH and spent 284 opus-5 turns across two hours, because the suite that dispatches a
// stage inherits whatever binary the operator's shell names and no test asserts otherwise.
//
// A banner is a claim. This block is what makes it true.
//
// ── WHY THE STUB GOES ON THE LEGACY SPELLING, WHICH LOOKS BACKWARDS ─────────────────────────────────
//
// Measured in this tree: 98 test sites pin `CLEAROTRON_CLAUDE_PATH`; ZERO pin `CLEAROTRON_CLAUDE_PATH`.
// `applyEnvAliases` resolves the CURRENT name first and copies it onto the old one, so a child that
// inherited `CLEAROTRON_CLAUDE_PATH` would have every one of those 98 mock pins overwritten — by this
// stub, turning a green suite into a wall of refusals.
//
// So: DELETE every spelling, then set the LEGACY one. A test's own `process.env.CLEAROTRON_CLAUDE_PATH = mock`
// then wins by same-name assignment in the child, translation has no current-name value to prefer, and a
// suite that pins nothing inherits a binary that only ever refuses.
//
// THE NAMES ARE TYPED AND THE SPELLINGS ARE DERIVED, the same shape as DATA_PLANE_VARS above and for the
// same reason: a future rename moves the guard with it. The typed roots are held honest by
// driver/test/suite-cannot-reach-a-real-engine.test.mjs, which reads driver.config's own ENGINE_BINARIES
// table and fails naming any engine this list has not caught up with.
const ENGINE_BIN_VARS = Object.freeze([...new Set(
  ["CLEAROTRON_CLAUDE_PATH", "CLEAROTRON_CODEX_PATH"].flatMap((n) => [n, n]),
)]);
const ENGINE_STUB = fileURLToPath(new URL("../driver/test/refusing-engine.mjs", import.meta.url));

// The bare words the engines fall back to when no variable is set — the only names an unpinned suite can
// spawn. Typed here and held honest by suite-cannot-reach-a-real-engine.test.mjs, which reads every
// `fallback` in driver.config's ENGINE_BINARIES and fails naming one this list has not caught up with.
const ENGINE_FALLBACK_NAMES = Object.freeze(["claude", "codex"]);

// A unit suite has no business holding a provider credential. With none present the key-based lanes
// cannot reach anything either — `driver/engine/jx-turn.mjs` POSTs the Anthropic Messages API directly
// on ANTHROPIC_API_KEY and spawns no binary, so the stub above cannot stop it and this can.
//
// MATCHED BY SUFFIX, not by a list of vendors. A list is complete as of whoever last typed it, and the
// name this misses is by definition the one nobody remembered. The same test asserts this pattern covers
// every credential declared by driver.config's four credential tables — ENGINE_BINARIES, PROVIDERS,
// RESEARCH_PROVIDERS and SERP_PROVIDERS — so a new provider whose variable does not match goes red here
// rather than quietly staying reachable.
//
// It deliberately does NOT match MOCK_*, PORTAL_* or TRADEMARK_MCP_TOKEN_*: those are the suite's own
// fixtures and the portal's local auth, they spend nothing, and stripping them breaks tests that set them.
const CREDENTIAL_RE = /_API_KEY$|_SESSION_KEY$|_CLIENT_SECRET$|_CLIENT_ID$/;

// The declared credentials whose NAME carries no credential suffix, so the pattern above cannot see them.
// `USPTO_LOCAL_DB` is the uspto provider's `credEnv` and holds a path rather than a key — it spends
// nothing, and it still has no business arriving from an operator's shell into a unit suite. Measured
// before adding it: no CI workflow sets it, and the provider degrades loudly when it is absent
// ("USPTO_LOCAL_DB absent from driver env") rather than reaching for a default.
//
// THIS LIST IS SHORT BECAUSE THE ARM KEEPS IT SHORT. suite-cannot-reach-a-real-engine.test.mjs plants
// every credential every driver.config table declares and fails naming any that survives, so a new one
// lands here as a red with its own name in the message — never as a silent gap.
const CREDENTIAL_NAMES = Object.freeze(["USPTO_LOCAL_DB"]);

// A guard with no way through gets deleted the first time somebody genuinely needs it. So there is one,
// it is NAMED, and taking it is loud on every run — the same discipline as CT_ALLOW_LIVE_DATA_PLANE.
const REAL_ENGINE_OVERRIDE = "CT_ALLOW_REAL_ENGINE";

if (String(process.env[REAL_ENGINE_OVERRIDE] ?? "").trim()) {
  console.error(`[test-run] ${REAL_ENGINE_OVERRIDE} IS SET — this suite can reach a real engine binary and`);
  console.error(`  real provider credentials. Model turns spent by this run are really spent.`);
} else {
  // An inherited pin is an operator's shell naming a real binary. Delete every spelling of it — that is
  // the direction this can safely act in.
  for (const n of ENGINE_BIN_VARS) delete process.env[n];

  // AND THEN SET NOTHING. The first version of this pinned the legacy spelling to the stub and it was
  // WRONG in a way worth recording, because the reasoning that produced it was sound and the model of
  // `applyEnvAliases` behind it was not.
  //
  // The fill is BIDIRECTIONAL: given only `CLEAROTRON_CLAUDE_PATH`, it writes `CLEAROTRON_CLAUDE_PATH` too
  // (env-aliases.test.mjs asserts exactly that). So a wrapper pin on the legacy name reappears under the
  // CURRENT name inside the child — and when a test then assigns the legacy name its own mock, the two
  // DISAGREE and the current name wins, which is the stub. The mock loses to the guard meant to protect
  // it. Measured: four runner arms went red that way, and the run said so in one line —
  // "CLEAROTRON_CLAUDE_PATH and CLEAROTRON_CLAUDE_PATH are both set and disagree".
  //
  // Pinning BOTH spellings fails identically: the test still assigns one, and one still loses.
  // There is no value this wrapper can write to an engine variable that a single-spelling pin survives.
  //
  // So the default is closed WITHOUT naming a variable at all. `claudeBin()` falls back to the bare word
  // `"claude"`, and `resolveExecutable` walks PATH for a bare name — so a shim directory at the FRONT of
  // PATH decides what an unpinned suite spawns, and is invisible to anything that sets a variable. An
  // explicit pin, in either spelling, still wins outright: no disagreement is ever created.
  const shimDir = join(root, "engine-shims");
  mkdirSync(shimDir, { recursive: true });
  for (const name of ENGINE_FALLBACK_NAMES) {
    const p = join(shimDir, name);
    // A symlink resolves through statSync/X_OK exactly like a file. Copy is the fallback for filesystems
    // that refuse links, so this cannot fail open by leaving the real binary first on PATH.
    try { symlinkSync(ENGINE_STUB, p); }
    catch { copyFileSync(ENGINE_STUB, p); chmodSync(p, 0o755); }
  }
  process.env.PATH = shimDir + delimiter + (process.env.PATH ?? "");
  // Names, never values — this line is read by whoever is wondering why a credential-reading test skipped.
  const withheld = Object.keys(process.env)
    .filter((n) => CREDENTIAL_RE.test(n) || CREDENTIAL_NAMES.includes(n))
    .sort();
  for (const n of withheld) delete process.env[n];
  if (withheld.length) {
    console.error(`[test-run] withheld ${withheld.length} inherited credential(s): ${withheld.join(", ")}`);
  }
}

// ── — THE TELEMETRY THIS SUITE PRODUCES IS THIS SUITE'S, NOT THE BOX'S ─────────────────────
//
// The register CALL ledger is box-global by design (: billing tallies read it across runs). The
// consequence nobody had costed is that a full-suite run APPENDS FIXTURE TRAFFIC to the file
// production analysis reads. Measured on a box before this line existed: 2,005 rows, 1,280 corsearch
// and 725 uspto-local, none of them from a real call and none of them marked as anything.
//
// UNCONDITIONAL, unlike `containedDefaults` above, and that is the whole point rather than an
// inconsistency. Those defaults fill only what is UNSET, because an operator's own value is a
// deliberate choice worth keeping. Here the harm lands exactly on the boxes that HAVE a real ledger
// configured or inherited, so honouring the box's setting would preserve the defect on every machine
// that has it — a containment that steps aside for the case it was written for.
//
// A directory, not a path per ledger: `resolveLedger` composes each ledger's filename under it, so a
// ledger added later is contained without touching this line. Individual `CLEAROTRON_REGISTER_*_LOG`
// values a test sets for itself still win — they resolve above this in the ladder, and a test naming
// its own file is being deliberate about a path it then asserts on.
process.env.CLEAROTRON_SUITE_TELEMETRY_DIR = join(root, "telemetry");
mkdirSync(process.env.CLEAROTRON_SUITE_TELEMETRY_DIR, { recursive: true });

child = spawn(argv[0], argv.slice(1), {
  stdio: "inherit",
  // OUT — the MCP access log lands inside this run's own tmpdir, not the operator's data plane.
  // Set HERE rather than earlier because `root` is created further up this file, and an audit path
  // pointing at a directory that does not exist yet is not isolation. An explicit caller value wins.
  env: {
    ...process.env,
    TMPDIR: root,
    TRADEMARK_MCP_AUDIT_LOG: String(process.env.TRADEMARK_MCP_AUDIT_LOG ?? "").trim()
      || join(root, "mcp-access.jsonl"),
  },
});

child.on("error", (e) => {
  cleanup();
  console.error(`[test-run] could not start ${argv[0]}: ${e.message}`);
  process.exit(1);
});

child.on("close", (code, signal) => {
  cleanup();
  // The exit code IS the result — CI reads it. Never swallow a failure to report a tidy cleanup.
  if (signal) { process.kill(process.pid, signal); return; }
  process.exit(code ?? 1);
});
