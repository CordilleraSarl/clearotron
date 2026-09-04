#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHY A SEAT WAS DISPATCHED MORE THAN ONCE — read back from what the driver already recorded.
//
// Every clearance run since 10 Aug re-dispatched at least one seat, and no structured artifact said so:
// status.json reports `attempts:1` and `delivered` while a second dispatch sits in the same directory.
// The data was never missing. It is in `_driver/<seat>.jsonl`, one row per dispatch, and nothing
// aggregated it — so the state was invisible without archaeology.
//
// This reads; it does not judge. It prints no PASS. Exit 0 means it managed to read, not that anything
// is well.
//
// ── THE MODEL, AND IT WAS MEASURED RATHER THAN ASSUMED ───────────────────────────────────────────────
//
// Every dispatch row is exactly one of three things, and over 22 runs / 234 seats / 326 dispatches the
// identity holds with no remainder:
//
//     attempts = seats + restarts + retries          (326 = 234 + 60 + 32)
//
//   · RETRY — a further attempt inside the same cycle. Measured: 32 of 32 retries follow an attempt
//     carrying a `fail`. Zero exceptions. A retry IS the fault signal.
//   · RESTART — the driver re-ran the whole stage, so the attempt counter goes back to 1 and
//     attemptN.dispatch.txt is rewritten in place. `followup: true` marks the ones that are designed
//     adversarial passes: the skeptic loop and the reconciliation channels re-dispatching on purpose.
//   · The seat's own first dispatch.
//
// THE THIRD CLASS IS THE POINT. 17 of 60 restarts carry NO marker at all — not a fault, not a labelled
// refinement. A binary fault-vs-refinement report either drops them or files them as faults, and both
// readings are wrong. They are printed as `unlabelled` and counted separately, because an aggregate that
// cannot name a thing it saw is how a 0-of-7 seat hid inside a 96% success rate in the first place.
//
// ── THREE WAYS THIS COULD HAVE LIED, ALL FOUND BY READING THE ARTIFACTS ──────────────────────────────
//
//  1. `_driver/` IS NOT ONLY SEAT LOGS. It also holds run.jsonl, record-discard.jsonl,
//     register-record-bodies.jsonl, tool-calls.jsonl, reading-log.jsonl and jx-completions.jsonl —
//     2,678 rows of them against 96 real dispatch rows in one sample. Rows are therefore selected BY
//     SHAPE (an integer `attempt`, a session `key`, a `status`), never by filename. A filename blocklist
//     was the original plan and it rots the moment a seventh sidecar is added.
//  2. RUNS ARE ARCHIVED. A finished run moves to `archive/<YYYY-MM>/…`, two directory levels deeper. A
//     fixed-depth glob silently reported on 9 of 25 runs — and, because archiving is time-based, its
//     answer would have changed as runs aged. The walk is depth-agnostic.
//  3. `_experiments/` CARRIES ITS OWN `_driver/`. Those are --experiment shadow dispatches, not the
//     run's seats, and counting them inflates every figure. Skipped.
//
// `.prev-<hash>` dispatch files are NEVER read. They are pre-correction snapshots — the version from
// before the correction was written in — so anything reading them as "the attempt-2 dispatch" reads the
// wrong bytes. Nothing here counts files at all; it counts what the driver wrote down.
//
// Usage:
//   node scripts/seat-retry-report.mjs <root>            every run under <root>
//   node scripts/seat-retry-report.mjs <root> --json     machine-readable
//   node scripts/seat-retry-report.mjs <root> --run <codename>
//   node scripts/seat-retry-report.mjs <root> --quiet    only runs with something to say

import { readFileSync, readdirSync, statSync } from "node:fs";
import { isDispatchRow, dispatchRows, cyclesOf, failKind, clearedSignatures } from "../driver/seat-attempts.mjs";
import { join, basename, dirname } from "node:path";
import { DRIVER_DIR } from "../shared/driver-dir.mjs";   //
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — realpath both sides, or a symlinked invocation exits 0 silently

// The pure primitives moved to driver/seat-attempts.mjs when needed them at RUNTIME. Imported, not
// copied: a second reader of one record shape is the defect this codebase spent 2026-08-14 removing.
export { isDispatchRow, dispatchRows, cyclesOf, failKind, clearedSignatures } from "../driver/seat-attempts.mjs";

// ── A UNIT WITH NO MODEL TURN CANNOT EXHIBIT THE RETRY DEFECT (2026-08-14) ───────────────────────────
//
// e2e's 47-vs-48 reconcile: the one-unit difference is `register-unit:saturation-probe`, `model:"code"`
// — a seat with attempt rows and NO model turn, because the driver executes it. Both tools were
// internally consistent and answering different questions.
//
// Counting a code-executed unit in a fault-rate DENOMINATOR is a permanent free pass: it can never
// fault the way a model turn faults, so every rate it appears in is flattered by exactly its share.
// This already touched a campaign headline. Excluded by default, `--include-code` to get raw counts,
// and labelled either way so the number is never silently one thing or the other.
//
// RUN.JSONL IS NOT A STAGE LIST. It names 49 stages including an umbrella `common-law-half` parent that
// has no seat file of its own. A future stage-counter reading it gets 49 against 48 seat files and
// mints a phantom discrepancy — the same shape as this one, one file over. Nothing here reads it.
export const isCodeExecuted = (d) => String(d?.model ?? "").trim().toLowerCase() === "code";


/**
 * One seat's story. Every attempt is classified, and the three counts plus the first dispatch account
 * for every row — asserted by `accounted`, which a caller can check rather than trust.
 * PURE.
 */
export function seatSummary(name, rows) {
  const cycles = cyclesOf(rows);
  const faults = [];
  let retries = 0, refinements = 0, unlabelled = 0;
  cycles.forEach((cycle, ci) => {
    retries += cycle.length - 1;
    if (ci > 0) { if (cycle[0]?.followup === true) refinements += 1; else unlabelled += 1; }
    for (const d of cycle) if (typeof d.fail === "string" && d.fail) {
      faults.push({ cycle: ci + 1, attempt: d.attempt, kind: failKind(d.fail), fail: d.fail });
    }
  });
  return {
    seat: name,
    // CODE-EXECUTED, and therefore out of every fault-rate denominator unless a caller asks otherwise.
    // A seat the DRIVER executes has attempt rows and no model turn, so it cannot exhibit the defect
    // these rates measure. Judged on the rows themselves rather than on the seat's name: a name-based
    // list would be a second place to say which seats are code, and it would rot the day one is added.
    codeExecuted: rows.length > 0 && rows.every(isCodeExecuted),
    attempts: rows.length,
    cycles: cycles.length,
    retries,
    restarts: cycles.length - 1,
    refinements,
    unlabelled,
    faults,
    // The identity from the header. If this is ever false the model is wrong, not the run.
    accounted: rows.length === 1 + (cycles.length - 1) + retries,
    // Kept visible per the reporting requirement: a signature recurring in a LATER cycle after a clean
    // attempt is a different animal from one that fails twice running, and it is unreadable from counts.
    signatures: faults.map((f) => `c${f.cycle}a${f.attempt}:${f.kind}`),
  };
}

/** Every `_driver` directory under root, at any depth, excluding experiment sandboxes. */
export function driverDirs(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 12) return;
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === "_experiments") continue;              // shadow dispatches, not this run's seats
      const p = join(dir, e.name);
      if (e.name === DRIVER_DIR) { out.push(p); continue; }   // never recurse into one
      walk(p, depth + 1);
    }
  };
  try { if (!statSync(root).isDirectory()) return out; } catch { return out; }
  walk(root, 0);
  return out;
}

/** Read every run under root. Returns runs in codename order. */
export function collectRuns(root) {
  const runs = new Map();
  for (const dd of driverDirs(root)) {
    const runDir = dirname(dd);
    const run = basename(runDir);
    let files; try { files = readdirSync(dd); } catch { continue; }
    for (const fn of files) {
      if (!fn.endsWith(".jsonl")) continue;
      let rows; try { rows = dispatchRows(readFileSync(join(dd, fn), "utf8")); } catch { continue; }
      if (!rows.length) continue;                            // not a seat log — see note 1
      if (!runs.has(run)) runs.set(run, { run, dir: runDir, seats: new Map() });
      const seats = runs.get(run).seats;
      const seat = fn.slice(0, -6);
      seats.set(seat, [...(seats.get(seat) ?? []), ...rows]);
    }
  }
  return [...runs.values()]
    .map((r) => ({ ...r, seats: [...r.seats.entries()].map(([n, rows]) => seatSummary(n, rows)) }))
    .sort((a, b) => a.run.localeCompare(b.run));
}

/** Roll a run's seats up. Counts only; the seat rows keep the detail. PURE. */
export function runTotals(seats, { includeCode = false } = {}) {
  // THE DENOMINATOR IS MODEL-DRIVEN SEATS. A code-executed unit has attempt rows and no model turn, so
  // it cannot fault the way this report measures faulting — leaving it in flatters every rate by
  // exactly its share, permanently and invisibly. `codeSeats` is reported rather than dropped, because
  // a seat excluded without being counted is a seat nobody can check the exclusion of.
  const all = seats;
  const counted = includeCode ? all : all.filter((s) => !s.codeExecuted);
  const t = { seats: counted.length, codeSeats: all.length - counted.length, includedCode: includeCode,
    attempts: 0, cycles: 0, retries: 0, restarts: 0,
    refinements: 0, unlabelled: 0, faultSeats: 0, faultedAttempts: 0, unaccounted: 0, kinds: {} };
  for (const s of counted) {
    t.attempts += s.attempts; t.cycles += s.cycles; t.retries += s.retries;
    t.restarts += s.restarts; t.refinements += s.refinements; t.unlabelled += s.unlabelled;
    t.faultedAttempts += s.faults.length;
    if (s.faults.length) t.faultSeats += 1;
    if (!s.accounted) t.unaccounted += 1;
    for (const f of s.faults) t.kinds[f.kind] = (t.kinds[f.kind] ?? 0) + 1;
  }
  return t;
}

const plain = (t) => `${t.seats} model-driven seats${t.codeSeats ? ` (+${t.codeSeats} code-executed, ${t.includedCode ? "INCLUDED" : "excluded"})` : ""}, ${t.attempts} dispatches`
  + ` — ${t.faultSeats} fault ${t.faultSeats === 1 ? "seat" : "seats"} (${t.faultedAttempts} faulted`
  + ` ${t.faultedAttempts === 1 ? "attempt" : "attempts"}), ${t.refinements} designed`
  + ` ${t.refinements === 1 ? "refinement" : "refinements"}, ${t.unlabelled} unlabelled`
  + ` ${t.unlabelled === 1 ? "restart" : "restarts"}`;

function main(argv) {
  const args = argv.slice(2);
  const root = args.find((a) => !a.startsWith("--"));
  const asJson = args.includes("--json");
  const includeCode = args.includes("--include-code");
  const quiet = args.includes("--quiet");
  const only = args.includes("--run") ? args[args.indexOf("--run") + 1] : null;

  if (!root) {
    console.error("usage: seat-retry-report.mjs <root> [--json] [--quiet] [--run <codename>] [--include-code]");
    console.error("  <root> is a directory holding run workspaces; archived runs are found at any depth.");
    return 2;
  }

  let runs = collectRuns(root);
  if (only) runs = runs.filter((r) => r.run.includes(only));

  // AN ABSENCE IS A FINDING. Nothing found is a result about the root that was given, not a clean bill,
  // and it is the likeliest outcome of pointing this at a pool directory: the pool keeps the published
  // copy and NOT the `_driver` sidecars.
  if (!runs.length) {
    const msg = `no seat dispatch rows under ${root}`
      + (only ? ` matching --run ${only}` : "")
      + " — this is a finding about the path, not a clean result."
      + " Seat logs live in the run WORKSPACE (`…/<matter>/<date-codename>/_driver/<seat>.jsonl`),"
      + " never in the published pool copy.";
    if (asJson) { console.log(JSON.stringify({ root, runs: [], note: msg }, null, 2)); return 0; }
    console.log(msg);
    return 0;
  }

  if (asJson) {
    console.log(JSON.stringify({
      root,
      runs: runs.map((r) => ({ run: r.run, dir: r.dir, totals: runTotals(r.seats, { includeCode }), seats: r.seats })),
    }, null, 2));
    return 0;
  }

  const grand = { seats: 0, attempts: 0, cycles: 0, retries: 0, restarts: 0, refinements: 0,
    unlabelled: 0, faultSeats: 0, faultedAttempts: 0, unaccounted: 0, kinds: {} };
  for (const r of runs) {
    const t = runTotals(r.seats, { includeCode });
    for (const k of Object.keys(grand)) if (k !== "kinds") grand[k] += t[k];
    for (const [k, n] of Object.entries(t.kinds)) grand.kinds[k] = (grand.kinds[k] ?? 0) + n;

    const notable = r.seats.filter((s) => s.attempts > 1 || s.faults.length);
    if (quiet && !notable.length) continue;
    console.log(`\n${r.run}`);
    console.log(`  ${plain(t)}`);
    if (t.unaccounted) console.log(`  ${t.unaccounted} seat(s) DO NOT ACCOUNT — the model is wrong for them, not the run`);
    for (const s of notable) {
      const bits = [`${s.attempts} dispatches in ${s.cycles} cycle${s.cycles === 1 ? "" : "s"}`];
      if (s.retries) bits.push(`${s.retries} ${s.retries === 1 ? "retry" : "retries"} after a fault`);
      if (s.refinements) bits.push(`${s.refinements} designed`);
      if (s.unlabelled) bits.push(`${s.unlabelled} unlabelled restart${s.unlabelled === 1 ? "" : "s"}`);
      console.log(`    ${s.seat.padEnd(38)} ${bits.join(", ")}`);
      if (s.signatures.length) console.log(`      ${s.signatures.join("  ")}`);
    }
  }
  console.log(`\nALL RUNS — ${plain(grand)}`);
  console.log(`  dispatches ${grand.attempts} = seats ${grand.seats} + restarts ${grand.restarts} + retries ${grand.retries}`
    + `  [${grand.attempts === grand.seats + grand.restarts + grand.retries ? "accounts" : "DOES NOT ACCOUNT"}]`);
  if (Object.keys(grand.kinds).length) console.log(`  fault kinds: ${JSON.stringify(grand.kinds)}`);
  if (grand.unlabelled) {
    console.log(`  ${grand.unlabelled} of ${grand.restarts} restarts carry no \`followup\` marker. They are neither`);
    console.log(`  a recorded fault nor a declared refinement, and nothing here guesses which they are.`);
  }
  return 0;
}

if (isEntrypoint(import.meta.url)) process.exit(main(process.argv));
