// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── Where the shared register ledger lives — ONE resolver for the writer and every reader ──────────
//
// READ THE BLOCK FURTHER DOWN BEFORE ACTING ON ANY OF THIS. Everything in this header describes
// ONE GLOBAL FILE PER BOX, and since that shape survives only for the CALL ledger. The RECORD log
// lives in the run directory (`runRecordLogPath` below); the existence ladder still answers for
// `"record"` for exactly one purpose — telling an operator that the old global file is still on disk
// and is no longer read by anything.
//
//. This ledger is written by whichever SINGLE register provider is wired — corsearch, clarivate,
// signa, euipo or uspto-local — and read by the driver. It was named after the first vendor that ever
// wrote to it, which asserts a vendor dependency that does not exist. A name that misleads during an
// incident is a defect, and that is what this file fixes.
//
// ── THE RENAME'S OWN TRAP ───────────────────────────────────────────────────────────────────────────
//
// This is a module and not a `sed` because of one fact measured before the change: THE ENV VAR WAS
// NEVER THE PROBLEM. No deployed box sets it. On 2026-08-10 all three accounts carried the homedir
// default and nothing else:
//
//     every account carried ~/.openclaw/telemetry/corsearch-records.jsonl and nothing else —
//     one of them hundreds of megabytes, the others small or archived
//
// So changing the DEFAULT FILENAME is what would actually move a box off its own ledger — and it would
// do it in silence. `forEachLedgerLine` maps ENOENT to `error: null` deliberately, because a run before
// any fetch genuinely has no ledger. A renamed default would therefore read a file that is not there,
// collect zero records, and report no fault: nineteen `verified-from-record` meters with no record on
// disk and no flag anywhere. That is 's incident exactly, re-created by the fix for.
//
// Hence resolution is by EXISTENCE, not by name alone — and since moved the DIRECTORY as well as
// the filename, by existence over both:
//
//   1. the neutral env var                          CLEAROTRON_REGISTER_RECORD_LOG
//   2. ( — the legacy env var was step 2 for one release; it is REMOVED. The steps below stay.)
//   3. the neutral default IF PRESENT                ~/trademark/telemetry/register-records.jsonl
//   4. the neutral dir, legacy name, IF PRESENT      ~/trademark/telemetry/corsearch-records.jsonl
//   5. the legacy dir, neutral name, IF PRESENT      ~/.openclaw/telemetry/register-records.jsonl
//   6. the legacy default IF PRESENT                 ~/.openclaw/telemetry/corsearch-records.jsonl
//   7. the neutral default                           (fresh install — there is nothing to inherit)
//
// An upgraded box keeps its ledger with no operator action and no migration step; a fresh clone never
// sees a vendor name and never sees another product's folder. Steps 3-6, not the alias, are what
// satisfy "a deployed box upgraded across the rename keeps reading its existing ledger" — and step 6 is
// where production resolves today, which is why deleting any of them is not a tidy-up.
//
// BOTH DEFAULTS PRESENT IS NOT SILENT. Preferring the neutral file would read a 3-row new ledger sitting
// beside a 31,109-row legacy one and look perfectly clean — this issue's own failure mode wearing the
// fix's clothes. The legacy file and its size travel back to the caller as `legacy`, which
// registry-fidelity routes into the channel built for "the ledger could not be read", because an
// unread ledger full of rows is an absence however it arose.
//
// EXISTENCE IS CHECKED AT CALL TIME AND NEVER FROZEN IN A CONST. At driver import neither file exists;
// by publish time the writer has created one. A module-level const would answer the import-time question
// for the life of the process — the same freeze that `DEFAULT_LEDGER_PATH` already forces two tests to
// work around.
//
// `homedir()` IS CALLED PER RESOLUTION, never captured. Two read sites once hardcoded a literal
// /home/operator and split the ledger under every other service account (2026-07-19); the same mistake
// held in a module const here would split it again.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { homedir } from "node:os";

/**
 * The two ledgers, and every name each answers to. Frozen: this is the wire contract between the
 * provider cores (writers), driver/provider-usage.mjs + driver/registry-fidelity.mjs (readers) and
 * driver/engine/mcp/gather-config.mjs (which hands the resolved path to spawned servers).
 */
export const LEDGERS = Object.freeze({
  // Billing-grade: one line per provider API call.
  call: Object.freeze({
    env: "CLEAROTRON_REGISTER_CALL_LOG",
    file: "register-calls.jsonl",
    legacyFile: "corsearch-calls.jsonl",
  }),
  // Citation fidelity: one line per fetched record, carrying the record BODY. This is the provenance
  // cache that `verified-from-record` joins against — docs/architecture/06-operations-runbook.md
  // covers what clearing it destroys.
  record: Object.freeze({
    env: "CLEAROTRON_REGISTER_RECORD_LOG",
    file: "register-records.jsonl",
    legacyFile: "corsearch-records.jsonl",
  }),
});

// ── — WHERE A SUITE RUN'S LEDGER GOES, AND WHY IT IS NOT THE BOX'S ──────────────────────────
//
// The CALL ledger is deliberately box-global (see the block below), and that design has a cost
// nobody had costed: a full-suite run on a dev or test box appends FIXTURE traffic to the same file
// production analysis reads. Measured on this repo's own CI-shaped box before the fix — 2,005 rows,
// of which ZERO carried anything marking them as synthetic:
//
//     "provider":"corsearch"     1280
//     "provider":"uspto-local"    725
//
// Every usage pattern, provider comparison and cost read over that file silently included them, and no
// filter could have excluded them because there was nothing to filter on.
//
// A MARKER FIELD WAS THE OTHER CANDIDATE AND IS WORSE. It leaks by default — a row written by a path
// that forgets the marker is indistinguishable again, and the rows still bloat the real file — and it
// obliges every reader, present and future, to remember the filter. A redirect makes the wrong file
// unreachable instead of merely labelled, which is the difference between a convention and a mechanism.
//
// IT IS A DIRECTORY, NOT A PATH PER LEDGER, so one export from the harness contains both ledgers and
// any ledger added later. And it is read from the passed `env`, so `resolveLedger(which, {})` — how
// every ladder test drives this — is untouched by construction.
//
// IT SITS BELOW THE EXPLICIT ENV VAR ON PURPOSE. A test that names its own ledger file is being
// deliberate about a path it then asserts on; the suite redirect exists for the runs that name nothing,
// which are exactly the ones that used to land on the box.
export const SUITE_TELEMETRY_DIR_ENV = "CLEAROTRON_SUITE_TELEMETRY_DIR";

const sizeOf = (p) => { try { return statSync(p).size; } catch { return null; } };
const present = (p) => { try { return existsSync(p); } catch { return false; } };

/**
 * Resolve one ledger's path, and say how the answer was reached.
 *
 * @param {"call"|"record"} which
 * @param {object} [env] — process.env by default; injectable so a test can drive every branch without
 *                         mutating the real environment.
 * @returns {{path: string, source: string, legacy: {path: string, bytes: number|null}|null}}
 *   source — "env" | "suite" | "default" | "legacy-default" | "default-fresh"   ( removed "legacy-env")
 *            "suite" is 's redirect: a suite run's ledgers live under its own temp root.
 *   legacy — set ONLY when a legacy-named file exists and is NOT the one being used, i.e. when rows are
 *            being left unread. Callers must surface it; nothing here logs.
 */
export function resolveLedger(which, env = process.env) {
  const spec = LEDGERS[which];
  if (!spec) {
    throw new Error(`[ledger-path] unknown ledger "${which}" — expected ${Object.keys(LEDGERS).join(" | ")}`);
  }
  const explicit = String(env[spec.env] ?? "").trim();
  if (explicit) return { path: explicit, source: "env", legacy: null };

  // — a suite run resolves inside its own temp root and never touches the box's ledger. `legacy`
  // is null because the existence ladder is not consulted at all: a suite run has nothing to inherit,
  // and reporting the box's unread files at it would be a notice about a machine it is not writing to.
  const suiteDir = String(env[SUITE_TELEMETRY_DIR_ENV] ?? "").trim();
  if (suiteDir) return { path: join(suiteDir, spec.file), source: "suite", legacy: null };

  // — THE LEGACY ENV NAMES ARE GONE, AND THE LEGACY FILENAME IS NOT. Two mechanisms, two jobs,
  // and only one of them has expired.
  //
  // The env alias existed for one release so an upgraded box would not lose its ledger. It was never
  // load-bearing: measured before removal, ZERO of the four env files on the test and production boxes
  // set either name, and no systemd unit does. Deleting it costs nobody anything.
  //
  // The FILENAME fallback below stays, and deleting it with the env alias would have been the exact
  // failure was written to prevent: production's ledgers are still `corsearch-calls.jsonl` (7.2 MB)
  // and `corsearch-records.jsonl` (432.6 MB), so `legacy-default` is a LIVE resolution there right now.
  // Removing it would silently point production at an empty file, and `forEachLedgerLine` maps ENOENT
  // to `error: null` — a clean-looking measurement of a measurement that never happened. It expires
  // when those files are actually renamed, which is an ops action and not a release boundary.
  // — THE DIRECTORY MOVED TOO, AND IT IS THE SAME TRAP AS THE FILENAME, ONE LEVEL UP.
  //
  // The telemetry dir was `~/.openclaw/telemetry` — the integrator platform's folder, in a repo whose
  // README says in bold that it does not require that platform. It is now `~/trademark/telemetry`,
  // beside the pool and workspace `bin/onboard.mjs` writes.
  //
  // Moving it by editing one `join` would have re-created exactly, which is what the whole header
  // above is about: a deployment carries hundreds of megabytes of records under ~/.openclaw/telemetry, sets
  // neither env var, and `forEachLedgerLine` maps ENOENT to `error: null`. A moved default would read a
  // file that is not there, count zero records, and flag nothing. So the DIRECTORY joins the existence
  // ladder on the same terms the filename is already on: four candidates, preferred in order, and the
  // first one that EXISTS wins.
  //
  // The four sources stay three (`default`, `legacy-default`, `default-fresh`) rather than growing a
  // "legacy-dir" value: a caller's response to "you are reading an old location" and "you are reading an
  // old name" is identical — leave it, or move it, and it is read either way — and every reader of this
  // contract switches on that response, not on the archaeology.
  const NEUTRAL_DIR = join(homedir(), "trademark", "telemetry");
  const LEGACY_DIR = join(homedir(), ".openclaw", "telemetry");
  const fresh = join(NEUTRAL_DIR, spec.file);
  const candidates = [
    { path: fresh, source: "default" },
    { path: join(NEUTRAL_DIR, spec.legacyFile), source: "legacy-default" },
    { path: join(LEGACY_DIR, spec.file), source: "legacy-default" },
    { path: join(LEGACY_DIR, spec.legacyFile), source: "legacy-default" },   // production, today
  ];
  const found = candidates.filter((c) => present(c.path));
  if (!found.length) return { path: fresh, source: "default-fresh", legacy: null };

  // THE UNREAD ONE REPORTED IS THE BIGGEST, not the next in preference order. With two places and two
  // names there can now be three unread files, and the number this hands back becomes the sentence an
  // operator reads ("N bytes are NOT being read"). The largest is the one that decides whether that
  // matters; naming a 3-row straggler while 432 MB sits unread would be this file's own failure mode
  // wearing the fix's clothes.
  const [chosen, ...rest] = found;
  const unread = rest
    .map((c) => ({ path: c.path, bytes: sizeOf(c.path) }))
    .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0))[0] ?? null;
  return { path: chosen.path, source: chosen.source, legacy: unread };
}

/** Where a ledger goes on a machine with nothing to inherit — the name a notice tells an operator to move to. */
export const neutralLedgerPath = (which) => join(homedir(), "trademark", "telemetry", LEDGERS[which].file);

// ── — THE RECORD LOG'S ADDRESS IS THE RUN, NOT THE HOME DIRECTORY ─────────────────────────────
//
// Everything above this line is about ONE global file per box and the archaeology of its name. That
// shape is the defect for the RECORD log, and no amount of renaming fixes it: a register response
// belongs to the run that fetched it, is verified against that run's report, is archived with that run
// and should die with it. Held globally it is append-only for the life of the box, and bounding it
// needs a rotation timer that every deployment, including every open-source install, has to set up.
// Nobody should install cleanup
// machinery to run a clearance engine.
//
// So the record log moves INTO the run directory, and the growth problem stops existing: the file is
// created with the run, is unioned into `_records/` by `assembleRunRecords`, and is purged with the
// run's own lifecycle. It also takes an unbounded writer off the home filesystem — `homedir()` is
// wherever the service account lives, commonly the root volume — and puts it under CLEAROTRON_REPORTS_DIR
// with the rest of the run.
//
// THE NAME IS NOT `register-records.jsonl`. `<runDir>/_driver/register-records.json` ALREADY EXISTS and
// is a different artifact entirely (the knockout lane's filings listing). Two files one character apart
// in the same directory, holding different things, is a mis-read waiting for an incident; the name
// below matches the writer that produces it (`logRecordBody`) and cannot be confused with it.
//
// The CALL ledger does NOT move, for a REAL run. `provider-usage.mjs`'s billing tallies read it across
// runs, and — the part that matters for 's own safety — it is the evidence that a run made record
// fetches at all.
//
// QUALIFIES THAT SENTENCE AND NOTHING ELSE ABOUT IT: a SUITE run redirects both ledgers into its
// own temp root (`SUITE_TELEMETRY_DIR_ENV`, above), because "box-global" was also collecting fixture
// traffic into the file production analysis reads. The global shape, and every reason for it, is
// unchanged for every run that is not the test suite.
// A run-scoped record log is EMPTY on every fresh run, so "nothing was fetched" and "the records went
// somewhere this reader never looks" produce an identical file. The global call ledger, filtered by run
// prefix, is what tells those two apart (registry-fidelity `fetchedWithoutRecord`).
export const RUN_RECORD_LOG_FILE = "register-record-bodies.jsonl";

/** The run-scoped record log — where a register response body lands for a run whose dir is known. */
export const runRecordLogPath = (runDir) => driverDir(runDir, RUN_RECORD_LOG_FILE);

/** The path alone, for the many call sites that only need somewhere to append. */
export const ledgerPath = (which, env = process.env) => resolveLedger(which, env).path;

// ── The deprecation notice ──────────────────────────────────────────────────────────────────────────
//
// ONE line per process per ledger, and the driver is the only thing that prints it. A provider core is
// re-spawned per MCP server, so "once" there is once per server per run — noise that teaches nobody
// anything. The driver is long-lived and its stderr is what an operator actually reads.
//
// removed `legacy-env`. `legacy-default` is still a supported state, not a fault: production is
// on the legacy FILENAMES today and the notice is how an operator learns that a rename is available,
// not that anything is broken.
const announced = new Set();

/**
 * @returns {string|null} a one-line notice the first time a ledger resolves through a legacy name in
 *          this process, or a legacy file is being left unread; null on every later call and whenever
 *          the resolution was already neutral.
 */
export function ledgerDeprecationNotice(which, env = process.env) {
  const r = resolveLedger(which, env);
  // BOTH FACTS, WHEN BOTH ARE TRUE — they were an if/else while there was only one axis to be legacy on.
  // added the directory, so "you are reading an old location" and "rows over here are going unread"
  // can now hold at once, and that pair is exactly production's shape: a legacy-located ledger with a
  // legacy-named sibling beside it. Reporting only the first would have dropped the byte count, which is
  // the half that tells an operator whether any of it matters.
  const parts = [];
  if (r.source === "legacy-default") {
    parts.push(`reading the legacy ${which} ledger ${r.path} — this release's home is `
      + `${neutralLedgerPath(which)}; move it there at your convenience, it is read either way`);
  }
  if (r.legacy) {
    parts.push(`${r.legacy.bytes ?? "?"} bytes of another ${which} ledger at ${r.legacy.path} are NOT being read — ${r.path} is in use. Merge or archive it; its rows are absent from every record set until you do.`);
  }
  const msg = parts.length ? `[ledger] ${parts.join(" ALSO: ")}` : null;
  if (!msg) return null;
  const key = `${which}:${r.source}:${r.path}`;
  if (announced.has(key)) return null;
  announced.add(key);
  return msg;
}

/**
 * — the RECORD half of the notice above, after the record log moved into the run directory.
 *
 * `ledgerDeprecationNotice("record")` said which of four global candidates was being read. Nothing reads
 * any of them for a new run now, so that sentence became false the moment this shipped — and a
 * diagnostic that describes something that did not happen is worse than none. The fact an operator
 * still needs is the one underneath it: the box is carrying a global record log that is now written by
 * nothing and read by nothing.
 *
 * NO CODE FALLBACK READS IT. That is the point, not an oversight: keeping a "read the old global file
 * if it exists" ladder would restore the second address this redesign removes, and it would do it
 * permanently rather than for a migration. Every run that has already assembled holds its own records
 * in its own `_records/`; this file is history, and archiving it is one `mv` per box.
 *
 * @returns {string|null} one line, once per process, while a global record log still exists; null on a
 *          fresh install and on every later call.
 */
export function retiredGlobalRecordLogNotice(env = process.env) {
  const r = resolveLedger("record", env);
  // `default-fresh` means the ladder found NOTHING on disk — a clean install, nothing to archive. Every
  // other source means a file is actually there.
  if (r.source === "default-fresh") return null;
  if (!present(r.path)) return null;
  const key = `retired-record:${r.path}`;
  if (announced.has(key)) return null;
  announced.add(key);
  const bytes = sizeOf(r.path);
  return `[ledger] the box-global record log ${r.path}${bytes === null ? "" : ` (${bytes} bytes)`} is RETIRED (#743) — `
    + `register response bodies now live in each run's _driver/${RUN_RECORD_LOG_FILE} and are archived and purged with the run. `
    + `Nothing writes to or reads this file any more; archive it once (mv it aside) at your convenience.`;
}

/** Test seam: forget what has been announced. Never called by product code. */
export const _resetLedgerNotices = () => announced.clear();
