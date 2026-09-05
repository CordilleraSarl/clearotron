#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ROUNDS THAT REACHED A TERMINAL NOBODY READ — and, of those, which can still be recovered.
//
// Nothing drains round terminals. The receipt already records reading: `_e2e-doors-<ID>.json` carries
// `reportedAt`/`reportedState` and maintains them correctly. Nothing ever listed the unsettled. By that
// field, 39 of 62 rounds are unread — and one confirmed case reached terminal FAILED with a blocking
// verdict and sat unread for 34 hours, surfacing only because the next launch of the SAME scenario
// tripped a stale-terminal warning. A scenario never relaunched never surfaces its terminal at all.
//
// THE ASYMMETRY IS THE WHOLE POINT. An unread terminal whose run dir is still on disk can be read
// today. One that has been purged cannot: whether it reached terminal, and what it said, is now
// unknowable forever. So the list is not a tidy-up — it is a deadline, and this check exists to run
// BEFORE a purge decision so unrecoverable misses stop being created.
//
// It records; it does not judge. It prints no PASS and assigns no verdict: each listed round gets a
// disposition from a reader. What it does do is exit non-zero while recoverable unread rounds exist,
// so a purge path can be gated on it.
//
// ── WHAT THIS DELIBERATELY DOES NOT INFER ───────────────────────────────────────────────────────────
//
// It does not claim to know which rounds are still IN FLIGHT. The obvious field for that is
// `clearedAt`, and it does not mean that: measured over the current receipts, SEVEN REPORTED rounds
// carry no `clearedAt` at all. A check that read it as "terminal" would mislabel those and would be
// wrong in the direction that matters — quietly excusing rounds from being read.
//
// So the two facts it does have are reported honestly: whether the round was read, and whether its run
// dir is still on disk. AGE is printed beside each one, because "unread and older than a campaign
// window" is a reader's judgement about staleness, not this script's.
//
// Usage:
//   node scripts/e2e-unread-terminals.mjs <e2e-dir> --runs <workspace-root>
//   node scripts/e2e-unread-terminals.mjs <e2e-dir> --runs <root> --json
//   node scripts/e2e-unread-terminals.mjs <e2e-dir> --runs <root> --older-than-hours 24

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
// The seat-record reader, imported rather than re-derived: "does this run have work in it" must be the
// SAME question the retry instrument asks, or two tools disagree about one fact (,).
import { dispatchRows } from "../driver/seat-attempts.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — realpath both sides, or a symlinked invocation exits 0 silently

/** The receipts, one file per scenario. Returns [{scenario, file, rounds}]. */
export function readDoors(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return []; }
  const out = [];
  for (const fn of entries.sort()) {
    const m = /^_e2e-doors-(.+)\.json$/.exec(fn);
    if (!m) continue;
    let parsed;
    try { parsed = JSON.parse(readFileSync(join(dir, fn), "utf8")); } catch { continue; }
    const rounds = Array.isArray(parsed?.rounds) ? parsed.rounds : [];
    out.push({ scenario: m[1], file: join(dir, fn), rounds });
  }
  return out;
}

/**
 * Every directory name under `root`, at any depth.
 *
 * DEPTH-AGNOSTIC ON PURPOSE. Finished runs are moved into `archive/<YYYY-MM>/…`, two levels deeper than
 * live ones, so a fixed-depth walk would report a run as purged simply because it had aged into the
 * archive — turning "recoverable" into "unrecoverable" without anything being deleted. That is the
 * worst error this script could make, because it would license the very purge it exists to prevent.
 */
export function directoryNames(root, { maxDepth = 12 } = {}) {
  const names = new Map();
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = join(dir, e.name);
      if (!names.has(e.name)) names.set(e.name, p);
      walk(p, depth + 1);
    }
  };
  try { if (!statSync(root).isDirectory()) return names; } catch { return names; }
  walk(root, 0);
  return names;
}

/**
 * Where a round's work lives, if it still does.
 *
 * The link is the TOKEN, which the harness embeds in the matter directory name — `tmpe2er<n><token>-…`.
 * Matching on the token alone (rather than reconstructing the whole prefix) keeps this working if the
 * prefix convention changes, and an 8-hex-character token is specific enough that a coincidental hit
 * would be remarkable. A round with no token cannot be located at all, and says so.
 * PURE given `names`.
 */
export function locateRun(token, names) {
  const t = String(token ?? "").trim();
  if (!t) return null;
  for (const [name, path] of names) if (name.includes(t)) return path;
  return null;
}

/** Hours between an ISO stamp and `now`, or null when there is no stamp to measure from. */
export function ageHours(iso, now) {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return null;
  return (now - t) / 3_600_000;
}

/**
 * IS THERE ANYTHING IN THERE? — the question the first version never asked.
 *
 * It classified on the DIRECTORY EXISTING, and 15 of the 26 rounds it called readable were empty
 * shells: a cleanup had taken the contents and left the directory. So it budgeted 27 reads that would
 * have yielded 12, and — worse — reported completed losses as recoverable, which is the one direction
 * this script must never err in, because "recoverable" is what licenses waiting.
 *
 * `shell` IS KEPT DISTINCT FROM `purged` DELIBERATELY. They are different events with different
 * lessons: a purge removed a run, something else removed a run's CONTENTS and left its name behind.
 * Folding them would lose the evidence that the second thing happens at all.
 *
 * The probe is INJECTED so `classify` stays pure and testable over invented trees; the impure caller
 * supplies the filesystem one.
 */
export function runStateProbe(path) {
  try {
    const entries = readdirSync(path, { withFileTypes: true });
    if (!entries.length) return "shell";
    // ── THE READABILITY TEST IS THE ATTEMPT-ROW RULE, NOT `status.json` PRESENCE (2026-08-14) ────────
    //
    // The first version asked whether `status.json` existed. e2e's resolution of the 3e738078
    // discrepancy showed why that is too weak, and too weak IN THE SAME DIRECTION as the defect it
    // replaced: the one measured specimen carries a `status.json`, carries `run.jsonl`, and carries NO
    // attempt row in any seat file. Its whole lifetime — startedAt to updatedAt — is TWO MILLISECONDS.
    // It failed at claim. Nothing about it is readable, and by directory, by `status.json` and by file
    // count it is indistinguishable from a live run seconds after launch.
    //
    // So the question is the one that already governs attempt counting: is there at least one row
    // carrying an `attempt` in a seat jsonl, `run.jsonl` EXCLUDED? Reused rather than reinvented — a
    // second notion of "this run has work in it" is how two tools come to disagree about one fact.
    //
    // `stillborn` IS ITS OWN STATE, not folded into `shell`. They are different findings with different
    // owners: a shell evidences a RETENTION event (something took a run's contents), a stillborn
    // evidences a DRIVER failure at birth. Folding them would file a driver defect as a cleanup.
    // ──: ASK AT BOTH LEVELS, BECAUSE `locateRun` HANDS THIS THE MATTER DIR ────────────────────
    //
    // This line used to be `hasAttemptRows(path)`, and `hasAttemptRows` reads `<dir>/_driver` with no
    // fallback — deliberately, because the teardown gate in e2e.mjs depends on that exactness. But
    // `_driver` is a child of the DATED RUN DIR (`<matter>/<YYYY-MM-DD>-<codename>`), and `locateRun`
    // resolves a round token to the MATTER dir above it, because the token only appears in the matter
    // directory's name. So the question was always asked one level too high and the answer was always
    // no: nothing ever classified as `readable`, every unread round fell through to `stillborn`, and
    // the exit code — which this module's own header offers as a purge gate — was always 0.
    //
    // Measured on the test box before the fix: 4 of the 6 rounds it called `stillborn` had attempt rows
    // on disk. Anyone who took the header at its word and gated a purge on this exit code got a green
    // light to delete readable evidence, which is the one error this instrument cannot afford.
    //
    // The asymmetry is the tell, and it was sitting in the next three lines the whole time: the
    // `status.json` check below ALREADY descends one level. Two questions about the same directory,
    // one of them looking in the right place. Now they agree.
    //
    // NOT fixed inside `hasAttemptRows`: teardown-refuses-unread-terminals.test.mjs asserts that
    // function returns false for a matter dir, and asserts it for the right reason — the gate must be
    // fed the dated dir and must not be papered over with a fallback. The two tools share ONE
    // definition of "this run has work in it"; what differed was which directory each handed it.
    if (evidenceDirs(path, entries).some((d) => hasAttemptRows(d))) return "readable";
    const hasStatus = entries.some((e) => e.isFile() && e.name === "status.json")
      || entries.filter((e) => e.isDirectory()).some((d) => {
        try { return readdirSync(join(path, d.name)).includes("status.json"); } catch { return false; }
      });
    return hasStatus ? "stillborn" : "shell";
  } catch { return "shell"; }
}

/**
 * The directories a round's evidence can be in, given the directory we were able to locate.
 *
 * A round token names the MATTER (`tmpe2er<n><token>-<slug>`); the run's `_driver` sits under a dated
 * child (`<YYYY-MM-DD>-<codename>`) which carries no token and so can never be located by name. This
 * returns both levels so a caller holding either one asks the right question.
 *
 * ONE LEVEL, NOT A WALK. The layout is fixed and a walk would eventually reach an archive of unrelated
 * runs and report them as this round's evidence — a false POSITIVE, which on a purge gate is the same
 * class of error as the false negative this fixes, pointed the other way.
 *
 * A matter can hold MORE THAN ONE dated run dir (a re-run under the same matter), which is why this
 * returns every child rather than the first: `unreadTerminalsInTeardown` already loops runs per round,
 * and a lister that stopped at the first child would under-report exactly the way this one did.
 *
 * PURE given `entries`, which the caller has already read.
 */
export function evidenceDirs(path, entries) {
  return [path, ...entries.filter((e) => e.isDirectory()).map((d) => join(path, d.name))];
}

/**
 * Is there at least one DISPATCH ROW anywhere in this run's seat records?
 *
 * `run.jsonl` is EXCLUDED, and that exclusion is the whole test: the stillborn run has a `run.jsonl`
 * and nothing else, so a reader that counted it would call the one run that never dispatched readable.
 * Same exclusion the retry instrument makes, for the same reason.
 */
export function hasAttemptRows(runDir) {
  const dir = driverDir(runDir);
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith(".jsonl") && f !== "run.jsonl"); } catch { return false; }
  for (const f of files) {
    let text;
    try { text = readFileSync(join(dir, f), "utf8"); } catch { continue; }
    if (dispatchRows(text).length) return true;
  }
  return false;
}

/**
 * Classify every round. FIVE states, and each one names a different fact:
 *
 *   readable     the run is there and has attempt rows — the actionable set
 *   stillborn    a status record and NO attempt row anywhere: the run failed at claim. A DRIVER
 *                finding, kept apart from `shell` because that is a retention finding
 *   shell        the directory survives and its contents do not — a loss, and evidence of a cleanup
 *                that is not the purge
 *   purged       no directory at all — the permanent loss the purge window produced
 *   unlocatable  the round carries no token, so nothing can be matched for it either way
 *
 * Reported rather than dropped, all of them, because an absence that is never named reads as though it
 * never happened — which is exactly how these went missing.
 * PURE given `names`, `now` and `probe`.
 */
export function classify(doors, names, now, probe = runStateProbe) {
  const rows = [];
  for (const { scenario, rounds } of doors) {
    for (const r of rounds) {
      // ── UNCLOSED IS `reportedState !== "settled"`, NOT `reportedAt != null` (2026-08-14) ──────────
      //
      // e2e's measurement: 64 rounds = 21 never read + 9 READ-BUT-NOT-SETTLED + 34 settled. Unclosed is
      // 30, not 21. A round that was looked at and came back "unknown" got a `reportedAt` stamp and
      // dropped off this list while remaining exactly as unclosed as the ones that were never opened —
      // so reading a round was enough to make it stop being counted, whatever the read found.
      //
      // The harness already knows this. previousRoundNotice in e2e.mjs:2256 says the round closes on
      // `reportedState === "settled"`, NEVER on `reportedAt != null`, and gives the incident that
      // taught it. This lister was the last reader keying on the weaker field.
      if (String(r?.reportedState ?? "") === "settled") continue;
      const runDir = locateRun(r?.token, names);
      const state = !r?.token ? "unlocatable" : !runDir ? "purged" : probe(runDir);
      rows.push({
        scenario,
        token: r?.token ?? null,
        startedAt: r?.startedAt ?? null,
        ageHours: ageHours(r?.startedAt, now),
        runDir,
        state,
      });
    }
  }
  return rows;
}

export function summarise(rows, olderThanHours) {
  const of = (s) => rows.filter((r) => r.state === s);
  // STALE COUNTS ONLY WHAT CAN STILL BE READ. Counting a shell as stale would keep budgeting a read
  // that cannot happen, which is the defect one level up from the one this fixes.
  const stale = of("readable").filter((r) => r.ageHours == null || r.ageHours >= olderThanHours);
  return {
    unread: rows.length,
    readable: of("readable").length,
    stillborn: of("stillborn").length,
    shell: of("shell").length,
    purged: of("purged").length,
    unlocatable: of("unlocatable").length,
    stale: stale.length,
  };
}

function main(argv) {
  const args = argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--"));
  const runsAt = args.indexOf("--runs");
  const runsRoot = runsAt >= 0 ? args[runsAt + 1] : null;
  const asJson = args.includes("--json");
  const oldAt = args.indexOf("--older-than-hours");
  const olderThanHours = oldAt >= 0 ? Number(args[oldAt + 1]) : 24;

  if (!dir || !runsRoot) {
    console.error("usage: e2e-unread-terminals.mjs <e2e-dir> --runs <workspace-root> [--json] [--older-than-hours N]");
    return 2;
  }

  const doors = readDoors(dir);
  // AN ABSENCE IS A FINDING. No receipts under the path given is a result about the path — the likeliest
  // cause is pointing at the wrong directory — and it must never read as "nothing is unread".
  if (!doors.length) {
    const note = `no _e2e-doors-*.json under ${dir} — a finding about the path, not a clean result`;
    if (asJson) { console.log(JSON.stringify({ dir, rounds: [], note }, null, 2)); return 2; }
    console.error(note);
    return 2;
  }

  const names = directoryNames(runsRoot);
  if (names.size === 0) {
    // Equally a finding: with no directories to match against, EVERY round would be called purged and
    // the script would cheerfully license deleting all of them.
    const note = `no directories under --runs ${runsRoot} — refusing to report every round as purged`;
    if (asJson) { console.log(JSON.stringify({ dir, runsRoot, rounds: [], note }, null, 2)); return 2; }
    console.error(note);
    return 2;
  }

  const rows = classify(doors, names, Date.now());
  const sum = summarise(rows, olderThanHours);

  if (asJson) {
    console.log(JSON.stringify({ dir, runsRoot, olderThanHours, summary: sum, rounds: rows }, null, 2));
    return sum.stale ? 1 : 0;
  }

  const age = (h) => (h == null ? "  age unknown" : `${String(Math.round(h)).padStart(5)}h old`);
  console.log(`${sum.unread} unread round${sum.unread === 1 ? "" : "s"} across ${doors.length} scenarios`
    + ` — ${sum.readable} still readable, ${sum.stillborn} stillborn, ${sum.shell} emptied, `
    + `${sum.purged} purged, ${sum.unlocatable} unlocatable\n`);

  for (const state of ["readable", "stillborn", "shell", "purged", "unlocatable"]) {
    const set = rows.filter((r) => r.state === state);
    if (!set.length) continue;
    const head = { readable: "STILL ON DISK — readable now, and the reason this check runs before a purge",
      stillborn: "FAILED AT CLAIM — a status record and not one attempt row. A DRIVER finding, not a "
        + "retention one: nothing removed this run's work, it never had any",
      shell: "EMPTIED — the directory survives and its contents do not. A LOSS, counted separately from a "
        + "purge because it is a different event: something removed a run's contents and left its name",
      purged: "PURGED — whether these reached terminal is no longer knowable, and that is permanent",
      unlocatable: "NO TOKEN — cannot be tied to a run at all" }[state];
    console.log(`${head}`);
    for (const r of set.sort((a, b) => (b.ageHours ?? 0) - (a.ageHours ?? 0))) {
      console.log(`  ${r.scenario.padEnd(4)} ${String(r.token ?? "—").padEnd(10)} ${age(r.ageHours)}`
        + (r.runDir ? `  ${r.runDir}` : ""));
    }
    console.log("");
  }

  if (sum.stale) {
    console.log(`${sum.stale} unread round${sum.stale === 1 ? " is" : "s are"} still on disk and at least`
      + ` ${olderThanHours}h old. Read each one, or waive it explicitly, BEFORE any purge — a purge`);
    console.log("makes the miss permanent, and nothing here decides which of those two it should be.");
  }
  return sum.stale ? 1 : 0;
}

if (isEntrypoint(import.meta.url)) process.exit(main(process.argv));
