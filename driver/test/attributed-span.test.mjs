// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — DRIVER WORK BETWEEN STAGES IS ATTRIBUTED, AND IS NOT MISTAKEN FOR A SEAT.
//
// The D8 addendum on measured 13m41s of a 217-minute run as "outside any stage" and found it was
// not slack and not code: driver compute across the three seams was ~5.5 seconds. The rest was register
// dispatches and a completed engine turn, neither of which left a row the decomposition could attribute.
//
// TWO INSTRUMENTS READ `_driver/*.jsonl` AND THEY WANT DIFFERENT THINGS. That is the whole design here,
// so it is what these arms assert:
//
//   · the wall decomposition counts a row with `wall` and `ts`, and takes the STAGE LABEL FROM THE
//     FILENAME. Satisfy it and the time is attributed.
//   · `seat-attempts.isDispatchRow` counts a row with `{attempt:int≥1, key, status}`, and
//     `scripts/seat-retry-report.mjs` then treats that file as a SEAT in its fault-vs-refinement
//     statistics. Satisfy it and register-repair work silently enters a denominator that report keeps
//     deliberately model-driven — the distortion it already excludes `codeSeats` to avoid.
//
// So a span row must satisfy the first and MUST NOT satisfy the second. The two contracts are disjoint,
// which is why this needed no ruling — but nothing enforces disjointness except the arm below, and a row
// that quietly gained an `attempt` field would change what the retry report measures without changing a
// line of that report.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { recordSpan, DISPATCH_FIELDS } from "../attributed-span.mjs";
import { isDispatchRow, dispatchRows } from "../seat-attempts.mjs";
import { createRepairLedger } from "../repairs.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const tmpRun = () => mkdtempSync(join(tmpdir(), "span-"));
const rowsOf = (runDir, name) =>
  readFileSync(driverDir(runDir, `${name}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("#1345 the decomposition can attribute the span: `wall` in seconds, `ts` at the END, file named for the stage", () => {
  const d = tmpRun();
  try {
    const started = Date.UTC(2026, 7, 19, 12, 0, 0);
    const ended = started + 220_400;                       // the 220.4s silence the addendum measured
    recordSpan(d, "register-repair", { startedMs: started, endedMs: ended }, { repair: "plan-direct-execute" });

    // The filename IS the stage label — asserted literally, not by asking driverDir where it put things.
    assert.ok(existsSync(join(d, "_driver", "register-repair.jsonl")));
    const [row] = rowsOf(d, "register-repair");
    assert.equal(row.wall, 220.4, "seconds, not milliseconds — the instrument multiplies by nothing");
    assert.equal(row.ts, new Date(ended).toISOString(), "`ts` is the END; the interval is [ts − wall, ts]");
    assert.equal(row.repair, "plan-direct-execute", "detail rides along");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("#1345 a span is NOT a seat dispatch — the seat reader must find nothing in this file", () => {
  const d = tmpRun();
  try {
    recordSpan(d, "register-repair", { startedMs: 1_000, endedMs: 3_000 }, { repair: "r", target: "t", outcome: "ok" });
    recordSpan(d, "engine-turn", { startedMs: 1_000, endedMs: 2_500 }, { ok: true, basis: "completed-turn" });

    for (const name of ["register-repair", "engine-turn"]) {
      const text = readFileSync(driverDir(d, `${name}.jsonl`), "utf8");
      for (const row of rowsOf(d, name))
        assert.equal(isDispatchRow(row), false,
          `${name} row satisfies isDispatchRow — scripts/seat-retry-report.mjs would count this file as a `
          + `SEAT and fold driver-side work into its fault rate: ${JSON.stringify(row)}`);
      assert.deepEqual(dispatchRows(text), [],
        `${name}.jsonl yields dispatch rows, so seat-retry-report would report a phantom seat for it`);
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("#1345 a caller cannot smuggle a dispatch field in, even by accident", () => {
  const d = tmpRun();
  try {
    recordSpan(d, "register-repair", { startedMs: 0, endedMs: 1_000 },
      { attempt: 3, key: "prelim-x-register-unit-y", status: "ok", repair: "kept" });
    const [row] = rowsOf(d, "register-repair");
    for (const f of DISPATCH_FIELDS) assert.equal(f in row, false, `${f} must be dropped, not written`);
    assert.equal(row.repair, "kept", "everything else survives — this refuses three names, not the detail");
    assert.equal(isDispatchRow(row), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("#1345 an unmeasurable span writes nothing, and never throws", () => {
  const d = tmpRun();
  try {
    // No clock, a backwards clock, and a missing run — three ways a caller can be wrong. A receipt that
    // guessed would be worse than one that is absent, because the decomposition would attribute the guess.
    assert.equal(recordSpan(d, "register-repair", { startedMs: NaN, endedMs: 5 }), null);
    assert.equal(recordSpan(d, "register-repair", { startedMs: 900, endedMs: 100 }), null);
    assert.equal(recordSpan("", "register-repair", { startedMs: 0, endedMs: 1 }), null);
    assert.equal(recordSpan(d, "", { startedMs: 0, endedMs: 1 }), null);
    assert.ok(!existsSync(join(d, "_driver", "register-repair.jsonl")), "a refused span leaves no file");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("#1345 both silences the addendum named are actually wired, not just wire-able", () => {
  const src = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  // The register repair: timed at the DISPATCH, and the duration reaches the ledger row.
  assert.match(src, /const dispatchStartedMs = Date\.now\(\);/);
  assert.match(src, /durationMs: dispatchEndedMs - dispatchStartedMs/);
  assert.match(src, /recordSpan\(run\.runDir, "register-repair"/);
  // The engine turn preflight: TIMED at the probe, WRITTEN beside the verdict. Those are different places
  // on purpose — there is no run dir at the probe, and a span written there names `run` in its temporal
  // dead zone. Measured: it did, and 199 tests went red on one line.
  assert.match(src, /engineTurnEndedMs = Date\.now\(\);/, "the clock must STOP at the probe, not at the write");
  assert.match(src, /recordSpan\(run\.runDir, "engine-turn", \{ startedMs: engineTurnStartedMs, endedMs: engineTurnEndedMs \}/);
  // …and the clock is not started after the work. A `startedMs: Date.now()` inside the recordSpan call
  // would time nothing and report zero, which the decomposition would attribute as zero.
  assert.doesNotMatch(src, /recordSpan\([^)]*startedMs:\s*Date\.now\(\)/);
});

// ── THE OTHER HALF: the duration on the repair row, which is a DIFFERENT job from attribution ───────
//
// `repair-attempted` goes to run.jsonl, which the decomposition skips. So this field attributes nothing
// and is not meant to — it is what a person reading the log needs in order to see that a "successful"
// repair took 220 seconds. The issue called it the one-liner; it is a signature change, because `record`
// is called after the dispatch returns and cannot time what already happened.

test("#1345 the repair row carries how long the dispatch took, in the log and durably", () => {
  const d = tmpRun();
  try {
    const rows = [];
    const ledger = createRepairLedger(d, { log: (o) => rows.push(o) });
    ledger.record("plan-direct-execute", "transliteration-numeric", "ok",
      { effect: { asked: 2, closed: 2 }, durationMs: 220_400 });

    const [logged] = rows;
    assert.equal(logged.event, "repair-attempted");
    assert.equal(logged.duration_ms, 220400, "the log line says how long the phone was off the hook");

    // Durable too — across a park/resume the log line is gone and the row is what survives.
    const durable = JSON.parse(readFileSync(driverDir(d, "repairs.json"), "utf8"));
    assert.equal(durable["plan-direct-execute:transliteration-numeric"].lastDurationMs, 220400);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("#1345 an unmeasured dispatch says nothing rather than saying zero", () => {
  const d = tmpRun();
  try {
    const rows = [];
    const ledger = createRepairLedger(d, { log: (o) => rows.push(o) });
    ledger.record("plan-direct-execute", "a", "ok", {});                    // caller measured nothing
    ledger.record("plan-direct-execute", "b", "ok", { durationMs: -5 });    // and a caller that got it wrong

    for (const r of rows)
      assert.equal("duration_ms" in r, false,
        "0 would read as an instant repair, which is a confident wrong value — the field is absent instead");
    const durable = JSON.parse(readFileSync(driverDir(d, "repairs.json"), "utf8"));
    for (const k of ["plan-direct-execute:a", "plan-direct-execute:b"])
      assert.equal("lastDurationMs" in durable[k], false, k);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
