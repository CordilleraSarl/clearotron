// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// env-local.mjs — read `<repo>/.env` when this process IS one of the declared CLI entries, and never
// otherwise. Zero dependencies (node: builtins only), because it must be safe to evaluate before
// anything else in the tree has run.
//
// WHY IT EXISTS. Every knob is an environment variable. On a server that is what systemd's
// EnvironmentFile is for, and nothing here changes that. On a laptop it meant a first-time reader had
// to keep a `set -a; source .env; set +a` incantation in their head for every command, and the failure
// when they forgot was not an error — it was a run that refused with "CLEAROTRON_DATABASE is not
// set" while their .env sat in the repo saying otherwise.
//
// ── WHY THIS IS AN IMPORT AND NOT A CALL INSIDE THE `isMain` GATE ────────────────────────────────────
//
// This has to be evaluated BEFORE the entry's own imports, so it is written as a module whose side
// effect is the load, and each entry imports it FIRST. A call placed in the main gate — the obvious
// shape, and the one sketches — runs after the entry's whole import graph has already been
// evaluated, and that is too late for anything captured at module top. The captures are not
// hypothetical or rare: there are 24 in the import closure of the seven entries, and two of them are
// exactly the variables a first run needs.
//
//   driver/driver.config.mjs   export const REGISTER_PROVIDER = (process.env.CLEAROTRON_DATABASE …
//   driver/profiles.mjs        const PROFILE_DIR = (process.env.CLEAROTRON_CUSTOMERS_DIR ?? "").trim() …
//
// Measured, not reasoned about: import driver.config.mjs, then set CLEAROTRON_DATABASE=euipo, then
// call requireRegisterProvider() — it throws "CLEAROTRON_DATABASE is not set". A main-gate loader
// would therefore have shipped the confident wrong answer this whole file exists to prevent, and would
// have shipped it while printing a line claiming it had applied the variable.
//
// The GATE is `process.argv[1]`, not the position of the call. A library import loads nothing because a
// library import means some OTHER file is argv[1] — a test, a script, `node -e`. That is the property
// asks for, and driver/test/env-local.test.mjs is what proves it.
//
// ── WHAT IT CANNOT DO ────────────────────────────────────────────────────────────────────────────────
//
// Nothing reaches a variable read at module top of a module imported BEFORE this one. Keep this import
// first in every entry and that set is empty. It is not empty for a process that reaches an entry's
// exports by importing it — driver/pipeline-knockout.mjs, say, which lists but which has no CLI
// entry gate at all (it is lazily imported by pipelineInner and never invoked as a CLI). Every route
// into it comes through pipeline.mjs or runner.mjs, both of which load this first.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { homedir } from "node:os";
import { warnRetiredEnv } from "./env-aliases.mjs";
import { standFrom } from "./invocation.mjs";   // the project root, derived once

/** The repo root — this file lives at <repo>/shared/env-local.mjs. */
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The processes that are allowed to read `<repo>/.env`: every executable entry point a person or a
 * unit file starts directly. DATA, deliberately — a test asserts each path exists, that each one
 * imports this module, and that nothing else does. lists eight; driver/pipeline-knockout.mjs is
 * the eighth and is absent because it has no entry gate to hang this on (see the header).
 *
 * `bin/start.mjs` is the one that reads this file ON BEHALF OF OTHERS: it is the local install's
 * supervisor, and it hands each service it starts an explicit environment with CLEAROTRON_NO_ENV_FILE=1 in
 * it. So exactly one process in that tree reads `<repo>/.env`, and a value the supervisor never saw
 * cannot reach a child and disagree with it. driver/portal-service.mjs is deliberately NOT on this list
 * for the same reason it carries no EnvironmentFile in production — every value arrives named.
 */
export const CLI_ENTRIES = Object.freeze([
  "bin/start.mjs",
  "driver/pipeline.mjs",
  "driver/runner.mjs",
  "driver/enqueue.mjs",
  "driver/dev-portal.mjs",
  "bin/uspto-sync.mjs",
  // item 2 — the guest-list editor. It is a CLI an operator runs by hand, so it reads `<repo>/.env`
  // the way every other hand-run entry does; that is also what translates the CLEAROTRON_ACCESS_FILE an
  // operator sets into the CLEAROTRON_ACCESS_FILE spelling every reader in the tree uses.
  "bin/grant.mjs",
  // F44 — issuance became a verb precisely BECAUSE the old path could not read
  // this file. `mcp-server/mint-token.mjs` never loaded it, so on a fully configured install it refused
  // "TRADEMARK_MCP_TOKEN_SECRET is unset" and the documented way round was to lift the signing secret
  // out of an env file onto the command line. This entry is the fix, so it belongs on this list by the
  // same argument grant.mjs does: a hand-run operator CLI reads `<repo>/.env`.
  "bin/key.mjs",
  "bin/brandowner.mjs",
  "bin/project.mjs",
  // via — connect/disconnect statically reach driver/driver.config.mjs (the
  // ledger write goes through driver/progress.mjs), so the rename layer must apply before that capture
  // evaluates. Both are hand-run operator CLIs; reading <repo>/.env is the same behaviour as grant's.
  "bin/connect.mjs",
  "bin/disconnect.mjs",
  // — `clearotron cancel` is a hand-run operator CLI in the same family as
  // grant/connect above: it resolves the studio roots through driver.config.mjs, so the rename layer
  // must apply before that module-top capture evaluates. Declared here rather than left to the guard,
  // which is the point of the guard — an entry that imports the loader and says nothing is exactly the
  // undeclared reach this list exists to make visible.
  "bin/cancel.mjs",
  // — the background pair. Both import bin/start.mjs (the pin), whose import graph
  // reaches module-top env captures; hand-run operator CLIs, so <repo>/.env applies like grant's.
  "bin/stop.mjs",
  "bin/status.mjs",
  // — `clearotron update`. A hand-run operator CLI, so it reads <repo>/.env exactly as the
  // entries above it do. It is NOT translation-only: the three configuration variables it resolves to
  // decide whether to refuse an upgrade are precisely the ones an operator sets in that file, and a
  // refusal that could not see them would protect nothing.
  "bin/update.mjs",
  "mcp-server/server.mjs",
  "mcp-server/http-server.mjs",
]);

/**
 * Files that import this module for the TRANSLATION ONLY, and must never read `<repo>/.env`.
 *
 *. Importing this module does two separable things: it applies the CLEAROTRON_* rename
 * (unconditional, at the bottom of this file) and it loads `<repo>/.env` (gated on
 * `isCliEntry(process.argv[1])`, i.e. on membership of CLI_ENTRIES above). Everything here needs the
 * first and is refused the second, and it gets exactly that by importing without joining that list.
 *
 * WHY THEY CANNOT USE `warnRetiredEnv` INSTEAD, which is what they did until: a call in an
 * entry's body runs AFTER every static import has been evaluated, and each of these statically reaches
 * — or itself contains — a module-top `process.env` capture. `driver.config.mjs` captures
 * `REGISTER_PROVIDER`, `profiles.mjs` captures the customer-store directory, and the scripts capture
 * their pool, queue and workspace roots. Measured through the real entry before the fix, with only the
 * new spellings set: `REGISTER_PROVIDER` came back null — which makes a run refuse by name — and the
 * store fell back to the bundled default. The fact was translated; the ordering was not.
 *
 * ── — AND A FILE THAT IMPORTS A NAMED HELPER BELONGS HERE TOO ──────────────
 *
 * The list was written for the bare `import "…"` form, because until 2208 that was the only form the
 * guard over it could see: its grep excluded a literal `n` where it meant to exclude a newline, so every
 * named import of this module was invisible and `bin/onboard.mjs` sat outside both lists on main without
 * anything noticing. The property the list actually declares has nothing to do with import syntax — it
 * is "needs the rename, must not have `<repo>/.env` applied to its process" — and a named import gets
 * exactly the same two things a bare one does, because an ESM import runs the module body either way.
 *
 * ADDING A NAME HERE IS NOT A WAY TO GET `.env`. It is the opposite: it is a declaration that this file
 * must NOT get it. The two services below carry a production ruling to that effect ( — "every
 * value arrives named"), and a test fails if either is moved into CLI_ENTRIES.
 */
export const NO_DOTFILE = Object.freeze([
  // ── THE WIZARD, WHICH REPORTS THE FILE RATHER THAN OBEYING IT ───────────
  // `doctor` is the one command whose job is to describe an install, and it would be useless if the file
  // it exists to report on had already been folded into its own environment: every value would read as
  // "set in the environment" and the question "where did this come from" could not be answered. So it
  // calls `loadEnvLocal` itself, with a throwaway env object and its own `repoRoot`, and prints what it
  // found. That is a READ, deliberately, and it is not the same thing as the module applying the file to
  // this process — which is what membership here refuses. `driver/test/hermetic-install-root.mjs` records
  // the same seam from the fixtures' side.
  "bin/onboard.mjs",
  // Services. Both are long-running, both are started by systemd with every value named in the unit.
  "driver/portal-service.mjs",
  "driver/profile-service.mjs",
  // Operator scripts. Each captures a renamed name at its own module top, so each broke on a box
  // configured with the new spellings — e2e.mjs the most quietly, because its workspace root feeds
  // `findRunsByRef` and an empty one answers "not found" for a run that exists.
  "scripts/e2e.mjs",
  "scripts/live-surface-check.mjs",
  "scripts/reconcile-runs.mjs",
  "scripts/backfill-started-at.mjs",
  "scripts/validate-profiles.mjs",
  // ── REOPENED — THE LIST ABOVE WAS HAND-FOUND, AND A HAND-FOUND LIST STOPS AT WHOEVER WAS LOOKING.
  // `scripts/purge-runs.mjs` was reported as one more entry; a DERIVED scan of every shebang entry in the
  // tree found TEN, of which it was one. The nine below joined it in the same pass. The guard in
  // driver/test/env-local-precedes-capture.test.mjs no longer reads a hand list either — it walks
  // the tree — so an eleventh cannot arrive quietly the way these ten did.
  // — env-classify joined this list the moment it imported the derived credential
  // names, because that import makes it statically reach driver.config.mjs and its module-top capture.
  // TRANSLATION-ONLY and not a CLI entry on purpose: this script CLASSIFIES environment variables, so
  // reading `<repo>/.env` into its own process would fold the developer's local file into the answer it
  // is computing. It needs the rename applied before the capture, and nothing else.
  "scripts/env-classify.mjs",
  "scripts/purge-runs.mjs",
  "scripts/authority-boundary-probe.mjs",
  "scripts/backup-recall-stores.mjs",
  "scripts/band-shape-probe.mjs",
  "scripts/write-up-form-census.mjs",
  "scripts/contract-dictation-scan.mjs",
  // — a read-only census over a queue directory. Reaches profiles.mjs through enqueue-schema.mjs,
  // so it inherits that module-top capture; it is pointed at a queue by --queue and must never pick up a
  // repo .env that could aim it somewhere else.
  "scripts/undeclared-field-census.mjs",
  "scripts/deploy-preflight.mjs",
  // — the doctrine overlay report. Reaches driver/driver.config.mjs to resolve the overlay the
  // SAME way the engine does. TRANSLATION-ONLY on purpose: it reports on the install it is pointed at,
  // and a repo `.env` could only make it describe a configuration nothing runs.
  "scripts/doctrine-report.mjs",
  // — the scorer became one of these by GAINING AN IMPORT, not by being overlooked. Reading the
  // reviewer's verdict through `parseVerdict` (driver/verify.mjs) pulled this entry into statically
  // reaching driver/driver.config.mjs, and the tree-walking guard caught it on the first full suite.
  // TRANSLATION-ONLY on purpose: score.mjs measures a PRESERVED run dir handed to it by `--run`, and a
  // repo `.env` could only aim it somewhere other than where the reader pointed it.
  "scripts/score.mjs",
  // — the engine turn probe's standalone entry point. TRANSLATION-ONLY on purpose: it answers
  // "can THIS box run a turn, under the billing mode it thinks it is using", and the boxes that matter
  // are the SERVICES, which are started by systemd with every value named in the unit and never read
  // `<repo>/.env`. A probe that picked up the dotfile would answer about a configuration nothing runs —
  // which is the exact class of mis-answer opened to settle.
  "scripts/engine-probe.mjs",
  "driver/publish/pool-admin.mjs",
  "driver/publish/profiles-page.mjs",
  "driver/replay-archive.mjs",
  // follow-up — joined the list the moment it grew a static import of driver.config.mjs (for
  // ENGINE_BINARIES, so its "the engine must be mocked" refusal reads the binary for the engine that
  // will actually run). That import captures env at module top, and a static import evaluates before
  // any body statement, so nothing this file could call in its own body would be early enough. The
  // derived guard caught it in the same commit that created it, which is the eleventh arriving loudly.
  "scripts/post-deploy-validate.mjs",
  // step 4 / — THE DERIVED SCAN COULD NOT SEE THESE TWO, and the reason is worth keeping.
  // 's scan walked every shebang entry looking for a module-top `process.env` capture of a renamed
  // name. These capture INSIDE a function, so the scan passed over them — and they were stranding an
  // operator all the same: both read a retired spelling and reached no translation, so a box configured
  // with the name in force handed them nothing and the read fell through to a default. `compare` printed
  // "no directory was walked" to someone who had configured one. A derived list is only as wide as the
  // property it derives on.
  "bin/example.mjs",
  "scripts/compare.mjs",
  // A LONG-RUNNING SERVICE, called out because it is not the same risk class as the scripts above: this
  // one resolves at BOOT, so the fix reaches a running box only after a restart. Inert wherever the old
  // spellings are still in use — translation with nothing to translate is a no-op — and it is the only
  // entry here that a deploy has to act on.
  "driver/recipe-service.mjs",
]);

// Mirrors driver.config.mjs `envOn` rather than testing `=== "1"`: an operator who writes
// CLEAROTRON_NO_ENV_FILE=false means off, and a switch that arms on the spelling someone used to disable it
// is the bug that idiom exists to stop. Duplicated instead of imported because this module must stay
// dependency-free; driver/test/env-local.test.mjs pins the two readings equal.
const OFF_WORDS = new Set(["0", "off", "false", "no"]);
const optedOut = (env) => {
  // ── — THIS GATE RUNS BEFORE THE ALIASES ARE APPLIED, so it has to know both spellings itself.
  //
  // `warnRetiredEnv()` is called at the bottom of this module; this gate decides whether the `.env`
  // file is read at all and therefore runs first. Reading only `CLEAROTRON_NO_ENV_FILE` would have made the
  // new name ADVERTISED AND INERT: an operator setting `CLEAROTRON_NO_ENV_FILE=1` on a service box would
  // get the checkout's `.env` read anyway, which is the exact failure the variable exists to prevent —
  // and it would fail silently, because a suppressed read and a successful one look the same from here.
  //
  // Resolved through `spellingsOf` rather than by listing the two names, so this cannot drift from the
  // table. Both are read for the same reason the compat window exists at all.
  for (const name of ["CLEAROTRON_NO_ENV_FILE"]) {
    const v = env[name];
    if (v != null && v !== "") return !OFF_WORDS.has(String(v).trim().toLowerCase());
  }
  return false;
};

// ── A SERVICE NEVER READS THE CHECKOUT, AND NOBODY HAS TO REMEMBER THAT ──────────────────────────────
//
// systemd sets INVOCATION_ID on every unit it starts, and nothing else does — a hand-run command, a
// test, an MCP client spawning the stdio server all have it unset. So "was I started as a service?" is
// answerable without configuration, and this is the answer.
//
// It exists because the OTHER guard cannot be relied on. `Environment=CLEAROTRON_NO_ENV_FILE=1` lives in
// the git-tracked unit files, and a unit file in git is not a unit file on a box: the deploy syncs
// CODE, not units. Measured, not assumed — the test instance pulled the commit carrying that line and
// went on running a live unit without it, and would have kept doing so until a human noticed. A guard
// whose installation is a step someone has to remember is a guard that is off.
//
// So the opt-out stays (it is the explicit, readable statement, and it is what a non-systemd
// deployment — a container, a supervisor — sets), and this makes it redundant on every box that runs
// under systemd. Belt and braces, with the braces now fastening themselves.
//
// A human-started process is deliberately NOT covered, because for a human the file is the point: a
// developer running `node driver/runner.mjs`, or an MCP client spawning mcp-server/server.mjs from a
// checkout, SHOULD read the .env sitting next to it. Unattended is the case that must be closed.
const serviceManaged = (env) => Boolean(String(env.INVOCATION_ID ?? "").trim());

const realOrSelf = (p) => { try { return realpathSync(p); } catch { return p; } };

/** `$HOME` / `${HOME}` — a value written for a shell that is about to be handed to a parser. */
const SHELL_EXPANSION = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/;

/**
 * ── WHERE THIS INSTALL'S `.env` LIVES —, awaiting the ruling on 2177 ─────────
 *
 * NOTHING IS DECIDED HERE, AND THAT IS THE POINT. On a packaged install the wizard writes `.env` to the
 * package root, which is `<project>/node_modules/clearotron` — a directory npm owns and any `npm install`
 * in that project may replace, destroying the configuration silently. Where it should live instead is a
 * product decision with three measured candidates and real costs on each; it is the owner's call on
 * and it is deliberately NOT taken in this file.
 *
 * What this file does is make the answer ONE LINE. Before it, nine sites each computed the path
 * themselves — four on the package root, five on `~/.env` — and a move that changed the writer without
 * the reader would have lost an operator's configuration while every command still exited 0. That
 * failure is silent, which is why the resolver exists ahead of the decision rather than after it.
 *
 * ✕ IT IS NOT A KNOB, AND MUST NOT BECOME ONE. No env var reads it, no flag sets it, and it is not
 * documented to operators. A user-facing setting for this WOULD BE the 2177 decision — made by giving
 * every operator a fourth answer and a support burden, which is the one outcome nobody asked for.
 * Flipping the constant below is the whole change.
 *
 * The three candidates are Grogu's, measured on the 2177 thread against the resolution sites, not
 * invented here:
 *
 *   "package-root"   <install>/.env                   TODAY. Option 3 — no code change, hazard documented.
 *   "project-root"   <project>/.env                   Option 1 — survives npm; keeps the two-file split
 *                                                     the door-divergence guard reasons about; on a git
 *                                                     clone `standFrom` returns the checkout, so this
 *                                                     spelling is IDENTICAL to today's there.
 *   "xdg-config"     ~/.config/clearotron/.env        Option 2b — survives npm and project deletion;
 *                                                     diverges from the clone shape everywhere.
 *
 * Option 2a — merging into the services' `~/.env` — is NOT wired, on purpose. It is the only candidate
 * that changes what a running service can be configured by, collapsing two deliberately disjoint files
 * into one and deleting the door-divergence guard's whole subject. Offering it as a one-line flip beside
 * three path changes would misrepresent it as the same size of decision. If the owner picks it, it is a
 * separate piece of work with that guard in scope.
 *
 * WHOEVER FLIPS THIS: `doorDivergence` in `bin/onboard.mjs` compares this file against `~/.env` by name,
 * and it reads the same resolver — so the pair it compares follows the flip. That is the check Grogu
 * named as part of the work rather than an afterthought; it is wired, not left.
 */
export const ENV_LOCAL_LOCATION = "package-root";

/**
 * The path `.env` is read from and written to, for every site on the CLI's side of the split.
 *
 * `~/.env` — the file the systemd services load — is a DIFFERENT file and is not resolved here. The two
 * are disjoint by design; see the door-divergence note in `bin/onboard.mjs`.
 *
 * PURE and fully parameterised so an arm can drive a candidate that is not the one in force. A switch
 * whose unchosen branches are never executed is wiring that asserts itself.
 */
export function envLocalPath({ repoRoot = REPO_ROOT, home = homedir(), location = ENV_LOCAL_LOCATION } = {}) {
  switch (location) {
    case "package-root": return join(repoRoot, ".env");
    case "project-root": return join(standFrom(repoRoot), ".env");
    case "xdg-config": return join(home, ".config", "clearotron", ".env");
    // An unknown location REFUSES rather than falling back to today's. A silent fallback would let a
    // typo in the flip read as "the ruling landed and nothing moved", which is the state this whole
    // block exists to make impossible to reach quietly.
    default: throw new Error(`ENV_LOCAL_LOCATION names no candidate: ${JSON.stringify(location)}`);
  }
}

/**
 * Is `argv1` one of CLI_ENTRIES? Compared by real path so a symlinked checkout, a relative
 * invocation and an absolute one all answer the same.
 */
export function isCliEntry(argv1, repoRoot = REPO_ROOT) {
  if (!argv1) return false;                       // `node -e`, a REPL, an embedder
  const entry = realOrSelf(isAbsolute(argv1) ? argv1 : resolve(process.cwd(), argv1));
  return CLI_ENTRIES.some((rel) => realOrSelf(join(repoRoot, rel)) === entry);
}

/**
 * Apply `<repo>/.env` to `env`, and report what happened.
 *
 * THE ENVIRONMENT ALWAYS WINS: a name already present in `env` is left alone, including when its value
 * is empty. An `X=` line in a systemd EnvironmentFile means "not configured on this deployment", and a
 * file inside the checkout must not be able to overrule the deployment that runs it.
 *
 * Returns {path, applied[], skipped[], reason} — names only. Values are never returned and never
 * logged: this file is where the credentials are.
 */
export function loadEnvLocal({ env = process.env, repoRoot = REPO_ROOT, note = defaultNote,
                              location = ENV_LOCAL_LOCATION } = {}) {
  // `location` is here SO AN ARM CAN DRIVE A CANDIDATE NOBODY HAS CHOSEN. Today every candidate but one
  // is unreachable, and `package-root` happens to resolve to the same string the nine sites used to
  // compose by hand — so an arm asserting that the reader follows the resolver would be true by
  // construction and would keep being true after a flip broke it. It is not a knob: no caller passes it,
  // and the note on ENV_LOCAL_LOCATION above says why it must not become one.
  const path = envLocalPath({ repoRoot, location });
  if (optedOut(env)) return { path, applied: [], skipped: [], reason: "opted-out" };
  if (serviceManaged(env)) {
    // Loud ONLY when there is a file to ignore. A service with no .env beside it is the normal case on
    // every box and says nothing; a service that HAS one is somebody's surprise waiting to happen, and
    // they need to know which configuration actually won.
    if (existsSync(path)) note(`[env-local] ignoring ${path}: this process was started by systemd (INVOCATION_ID set), and a service is configured by its EnvironmentFile, never by a file inside the checkout. Run it by hand to use that file.\n`);
    return { path, applied: [], skipped: [], reason: "service-managed" };
  }

  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    // ENOENT is the normal case on every server and in CI — silent, because "no .env" is not news.
    // Anything else IS news: the file is there and this process cannot read it, and the run is about to
    // fail for a reason that will look like the config is missing rather than unreadable.
    if (e.code !== "ENOENT") note(`[env-local] ${path} exists but could not be read (${e.code}) — continuing on the environment alone\n`);
    return { path, applied: [], skipped: [], reason: e.code === "ENOENT" ? "absent" : "unreadable" };
  }

  const parsed = parseEnv(raw);
  const applied = [], skipped = [], unexpanded = [];
  for (const key of Object.keys(parsed)) {
    if (key in env) { skipped.push(key); continue; }
    if (SHELL_EXPANSION.test(parsed[key])) unexpanded.push(key);
    env[key] = parsed[key];
    applied.push(key);
  }
  // `.env` IS NOT SOURCED BY A SHELL, and the difference is invisible until it costs you an afternoon.
  // The documented recipe used to be `set -a; source .env; set +a`, so the templates were written in
  // shell — the developer env example still said CLEAROTRON_REPORTS_DIR=$HOME/trademark-dev/pool. parseEnv does no
  // expansion, so that arrives as the literal string `$HOME/trademark-dev/pool` and the driver quietly
  // creates a directory NAMED `$HOME` under the cwd. The run then succeeds, into the wrong place.
  //
  // Warned rather than refused, and the trade is deliberate: a value is delivered as written, because a
  // loader that second-guesses values is one nobody can predict, and `$` is legal in a password. The
  // templates are being rewritten off the shell form in the same lane; this line is for the reader who
  // already copied it, and for every hand-written .env that will never be rewritten by anyone.
  if (unexpanded.length) {
    const verb = unexpanded.length === 1 ? "holds" : "hold";
    note(`[env-local] ${unexpanded.join(", ")} ${verb} what looks like an unexpanded shell variable — ${path} is PARSED, not sourced by a shell, so a value like $HOME stays those five characters and any path built on it lands somewhere nobody meant. Write absolute paths.\n`);
  }

  // Loud, once, on stderr, naming the file and the KEYS — so a run that behaves unexpectedly can be
  // traced to the file that configured it without anyone having to guess whether it was read.
  if (applied.length) note(`[env-local] applied ${applied.length} variable${applied.length === 1 ? "" : "s"} from ${path}: ${applied.join(", ")}${skipped.length ? ` (${skipped.length} already in the environment, left alone: ${skipped.join(", ")})` : ""}\n`);
  else if (skipped.length) note(`[env-local] ${path} read; every variable in it was already in the environment — nothing applied\n`);
  return { path, applied, skipped, reason: "read" };
}

function defaultNote(line) { try { process.stderr.write(line); } catch { /* a closed stderr must never fail a run */ } }

// ── the gate ─────────────────────────────────────────────────────────────────────────────────────────
// ESM caches by resolved URL, so this runs exactly once per process however many entries import it
// (mcp-server/http-server.mjs imports mcp-server/server.mjs; both are entries).
export const loaded = isCliEntry(process.argv[1]) ? loadEnvLocal() : null;

// ── — the install surface's new names, translated into the ones every read site still reads ────
//
// AFTER the `.env` read, because a `.env` may be where the new names are written, and BEFORE anything
// else in the process — this module is imported first by every entry, which is the whole reason the
// the warning lives here rather than at each read site, and here means BEFORE the entry own import
// graph is evaluated. A notice that arrives after the modules have already read their values is a
// notice about a decision nobody can still change.
//
// UNGATED, unlike the load above, and the asymmetry is deliberate. That read is gated because a
// checkout .env must never overrule a deployment. This has the opposite requirement: a systemd-started
// service takes its names from an EnvironmentFile and needs the notice exactly as much as a laptop does.
//
// IT WARNS AND RETURNS. There is nothing here that can refuse: the only names it knows are settings
// whose BEHAVIOUR was deleted, so there is no value to apply wrongly. The renamed install-surface names
// are not checked for at all — owner ruling, 2026-08-26 — because a machine reaches this code through
// the install and the two boxes that predate the rename are rebuilt rather than deployed onto.
export const aliased = warnRetiredEnv();
