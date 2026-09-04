// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The seat-retry instrument, tested on the row shapes that actually appear in `_driver/`.
//
// The fixtures below are the SHAPES read off real driver logs — field names, types and the exact
// discriminators — with every identifier replaced. That distinction matters here more than usual: this
// instrument's whole job is to tell four kinds of row apart, and a fixture invented from the spec would
// certify the reading the spec assumed instead of the one the driver writes. Three things were wrong in
// the spec and only reading the artifacts found them:
//
//   · `_driver/` holds six kinds of jsonl, not one. Selecting seat logs by FILENAME (the original plan,
//     "exclude run.jsonl") misses record-discard, register-record-bodies, tool-calls, reading-log and
//     jx-completions — 2,678 rows against 96 real dispatches in one sample.
//   · Finished runs are ARCHIVED two directory levels deeper, so a fixed-depth walk reports on the
//     recent runs only and its answer changes as runs age.
//   · A restart is not always a fault or a designed refinement. 17 of 60 carry no marker at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isDispatchRow, dispatchRows, cyclesOf, failKind, seatSummary, driverDirs, collectRuns, runTotals }
  from "../../scripts/seat-retry-report.mjs";

// A dispatch row, trimmed to the fields this instrument reads.
const row = (attempt, extra = {}) => ({
  ts: "2026-01-01T00:00:00.000Z", attempt, key: "prelim-matter-codename-stage",
  agent: "test", status: "ok", code: 0, wall: 1.0, fail: null, ...extra,
});

// ── selecting rows by SHAPE, which is the whole defence against the other five jsonl kinds ──────────

test("the four non-seat row shapes in _driver/ are NOT dispatch rows", () => {
  // Each of these is a real row shape from a real sidecar, identifiers replaced. If any were accepted,
  // one example run would contribute 2,678 phantom dispatches against 96 true ones.
  const notSeats = [
    { ts: "…", seam: "placement", stage: "placement-inquiry", trigger: null, pass: 1, uri: "/mark/xx/abc" },
    { ts: "…", provider: "someprovider", agentId: "test", sessionKey: "prelim-x", body: "…", target: "…" },
    { ts: "…", event: "started", seq: 1, server: "someserver", tool: "some_tool" },
    { ts: "…", detail: "…", pass: 1, reason: "…", reason_source: "step-stated", seam: "x", stage: "y" },
  ];
  for (const r of notSeats) assert.equal(isDispatchRow(r), false, JSON.stringify(r).slice(0, 60));
  assert.equal(isDispatchRow(row(1)), true, "…while a real dispatch row IS one");
});

test("a row is rejected unless it carries ALL THREE discriminators", () => {
  assert.equal(isDispatchRow({ attempt: 1, key: "k" }), false, "no status");
  assert.equal(isDispatchRow({ attempt: 1, status: "ok" }), false, "no key");
  assert.equal(isDispatchRow({ key: "k", status: "ok" }), false, "no attempt");
  assert.equal(isDispatchRow({ attempt: "1", key: "k", status: "ok" }), false, "attempt must be a NUMBER");
  assert.equal(isDispatchRow({ attempt: 0, key: "k", status: "ok" }), false, "attempts are 1-based");
  assert.equal(isDispatchRow(null), false);
});

test("a damaged line is skipped, never fatal — a half-flushed log still reports", () => {
  const text = [JSON.stringify(row(1)), "{not json", "", JSON.stringify(row(2))].join("\n");
  assert.equal(dispatchRows(text).length, 2);
  assert.deepEqual(dispatchRows(null), []);
});

// ── cycles ──────────────────────────────────────────────────────────────────────────────────────────

test("a cycle boundary is an attempt number that DOES NOT ADVANCE", () => {
  // The observed shape: two rows both `attempt: 1`, same dispatch filename, different sha, because the
  // driver re-ran the stage and rewrote attemptN.dispatch.txt in place.
  assert.equal(cyclesOf([row(1), row(2), row(1)]).length, 2);
  assert.equal(cyclesOf([row(1), row(2), row(3)]).length, 1);
  assert.equal(cyclesOf([row(1), row(1), row(1)]).length, 3);
  assert.equal(cyclesOf([]).length, 0);
  assert.deepEqual(cyclesOf([row(1), row(2), row(1), row(2)]).map((c) => c.length), [2, 2]);
});

test("the cycle is read from the driver's OWN counter, never from files on disk", () => {
  // `.prev-<hash>` files are pre-correction snapshots; anything counting them reads the wrong bytes and
  // produced two false blanks when it was tried. This function is given rows and nothing else — there is
  // no path argument it could be tempted with.
  assert.equal(cyclesOf.length, 1);
});

// ── the accounting identity, which is what makes the report trustworthy ─────────────────────────────

test("attempts = 1 + restarts + retries, on every shape", () => {
  for (const rows of [
    [row(1)],
    [row(1), row(2)],
    [row(1), row(2), row(3), row(4)],
    [row(1), row(1)],
    [row(1), row(2), row(1), row(2), row(3)],
  ]) {
    const s = seatSummary("seat", rows);
    assert.ok(s.accounted, `${rows.length} rows did not account`);
    assert.equal(s.attempts, 1 + s.restarts + s.retries);
  }
});

test("a retry and a restart are DIFFERENT and are never merged", () => {
  const retryOnly = seatSummary("s", [row(1), row(2)]);
  assert.equal(retryOnly.retries, 1);
  assert.equal(retryOnly.restarts, 0);

  const restartOnly = seatSummary("s", [row(1), row(1)]);
  assert.equal(restartOnly.retries, 0);
  assert.equal(restartOnly.restarts, 1);
});

test("THE THIRD CLASS: a restart with no `followup` marker is counted as UNLABELLED, not as a fault", () => {
  // 17 of 60 restarts across the measured campaign are this. A binary fault-vs-refinement report either
  // drops them or files them as faults; both readings are wrong, and the erasure is the exact defect the
  // instrument exists to end — one always-failing seat vanished inside an honest-looking 96%.
  const s = seatSummary("report-card:10", [row(1), row(1)]);
  assert.equal(s.unlabelled, 1);
  assert.equal(s.refinements, 0);
  assert.equal(s.faults.length, 0, "an unlabelled restart is NOT a fault — nothing failed");

  const designed = seatSummary("register-digest", [row(1), row(1, { followup: true })]);
  assert.equal(designed.refinements, 1);
  assert.equal(designed.unlabelled, 0);
});

test("faults are reported with their cycle, attempt and KIND — counts alone hide a recurrence", () => {
  // The observed synthesis seat: the same signature in cycle 1 and again in cycle 2 after a restart.
  // That is a different animal from failing twice running, and an incoming issue turns on telling them
  // apart, so the signatures are printed rather than summed away.
  const s = seatSummary("synthesis", [
    row(1, { fail: "invalid_file:some/path/findings.json", status: "ok" }),
    row(2),
    row(1, { fail: "invalid_file:some/path/findings.json", followup: true }),
    row(2),
  ]);
  assert.equal(s.faults.length, 2);
  assert.deepEqual(s.signatures, ["c1a1:invalid_file", "c2a1:invalid_file"]);
  assert.equal(s.cycles, 2);
  assert.ok(s.accounted);
});

test("the fault KIND is the class, not the whole string — paths do not fragment the tally", () => {
  assert.equal(failKind("invalid_file:a/very/long/path.json"), "invalid_file");
  assert.equal(failKind("nonzero_exit_1"), "nonzero_exit_1");
  assert.equal(failKind("missing_file:x"), "missing_file");
  assert.equal(failKind(null), null);
  assert.equal(failKind(""), null, "an empty string is not a fault");
});

test("there are MORE fault kinds than invalid_file, and they are not collapsed into it", () => {
  // Measured across the campaign: invalid_file 40, missing_file 2, nonzero_exit_1 1. The last is an
  // engine crash rather than a seat's validation failure, and reporting them as one number would put a
  // crash and a bad artifact in the same column.
  const s = seatSummary("s", [
    row(1, { fail: "invalid_file:x" }), row(2, { fail: "nonzero_exit_1", status: "error", code: 1 }), row(3),
  ]);
  assert.deepEqual(s.faults.map((f) => f.kind), ["invalid_file", "nonzero_exit_1"]);
  assert.deepEqual(runTotals([s]).kinds, { invalid_file: 1, nonzero_exit_1: 1 });
});

// ── the walk ────────────────────────────────────────────────────────────────────────────────────────

function tree() {
  const root = mkdtempSync(join(tmpdir(), "seat-retry-"));
  const put = (rel, rows) => {
    const dir = join(root, rel);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "some-seat.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  };
  return { root, put, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("ARCHIVED RUNS ARE FOUND — a fixed-depth walk reported on 9 of 25 and got quieter with age", () => {
  const t = tree();
  try {
    t.put("matter-a/2026-01-01-codename-one/_driver", [row(1)]);
    t.put("archive/2026-01/matter-b/2026-01-02-codename-two/_driver", [row(1), row(2)]);
    const runs = collectRuns(t.root);
    assert.deepEqual(runs.map((r) => r.run).sort(), ["2026-01-01-codename-one", "2026-01-02-codename-two"],
      "the archived run must be found at its deeper path, or the report silently shrinks over time");
    assert.equal(driverDirs(t.root).length, 2);
  } finally { t.cleanup(); }
});

test("`_experiments/` sandboxes are NOT counted as the run's seats", () => {
  const t = tree();
  try {
    t.put("matter-a/2026-01-01-codename-one/_driver", [row(1)]);
    t.put("matter-a/2026-01-01-codename-one/_experiments/2026-01-01T00-00-00Z-some-stage/_driver", [row(1), row(2), row(3)]);
    const runs = collectRuns(t.root);
    assert.equal(runs.length, 1);
    assert.equal(runTotals(runs[0].seats).attempts, 1, "the shadow dispatches must not inflate the count");
  } finally { t.cleanup(); }
});

test("a sidecar carrying NO dispatch rows contributes no seat — not an empty one", () => {
  // A seat that exists with zero dispatches would be a phantom in every average.
  const t = tree();
  try {
    const dir = join(t.root, "m/2026-01-01-x/_driver");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "tool-calls.jsonl"),
      JSON.stringify({ ts: "…", event: "started", seq: 1, server: "s", tool: "t" }) + "\n");
    writeFileSync(join(dir, "real-seat.jsonl"), JSON.stringify(row(1)) + "\n");
    const runs = collectRuns(t.root);
    assert.deepEqual(runs[0].seats.map((s) => s.seat), ["real-seat"],
      "tool-calls.jsonl is not a seat and must not appear as one");
  } finally { t.cleanup(); }
});

test("AN ABSENCE IS A FINDING — an empty root yields no runs, and the caller must say so", () => {
  const t = tree();
  try {
    assert.deepEqual(collectRuns(t.root), []);
    assert.deepEqual(collectRuns(join(t.root, "does-not-exist")), []);
    assert.deepEqual(driverDirs("/definitely/not/a/path"), []);
  } finally { t.cleanup(); }
});

// ── A UNIT WITH NO MODEL TURN CANNOT EXHIBIT THE RETRY DEFECT (2026-08-14) ──────────────────────────
//
// e2e's 47-vs-48 reconcile: the one-unit difference is `register-unit:saturation-probe`, `model:"code"`
// — attempt rows, no model turn, because the DRIVER executes it. Both tools were internally consistent
// and answering different questions. Counting a code-executed unit in a fault-rate denominator is a
// permanent free pass: it can never fault the way this report measures faulting, so every rate it
// appears in is flattered by exactly its share. It already touched a campaign headline.

test("a seat the driver executes is marked, and marked from its ROWS not its name", () => {
  // A name-based list would be a second place to say which seats are code, and it would rot the day
  // one is added or renamed.
  const code = seatSummary("register-unit:saturation-probe",
    [{ attempt: 1, key: "x", status: "ok", model: "code" }]);
  assert.equal(code.codeExecuted, true);
  const model = seatSummary("synthesis", [{ attempt: 1, key: "x", status: "ok", model: "opus" }]);
  assert.equal(model.codeExecuted, false);
  const mixed = seatSummary("odd",
    [{ attempt: 1, key: "x", status: "ok", model: "code" }, { attempt: 2, key: "x", status: "ok", model: "opus" }]);
  assert.equal(mixed.codeExecuted, false, "EVERY row must be code — one model turn makes it a model seat");
});

test("THE DENOMINATOR EXCLUDES THEM BY DEFAULT, and says how many it excluded", () => {
  // A seat excluded without being counted is a seat nobody can check the exclusion of.
  const seats = [
    seatSummary("synthesis", [{ attempt: 1, key: "s", status: "fail", fail: "x:1", model: "opus" },
      { attempt: 2, key: "s", status: "ok", model: "opus" }]),
    seatSummary("register-unit:saturation-probe", [{ attempt: 1, key: "r", status: "ok", model: "code" }]),
  ];
  const t = runTotals(seats);
  assert.equal(t.seats, 1, "one model-driven seat in the denominator");
  assert.equal(t.codeSeats, 1, "and the excluded one is counted, not silently dropped");
  assert.equal(t.includedCode, false);

  const raw = runTotals(seats, { includeCode: true });
  assert.equal(raw.seats, 2, "--include-code gives the raw count");
  assert.equal(raw.includedCode, true);
  assert.ok(raw.attempts > t.attempts, "and the attempts move with it, so the two are never confusable");
});

test("an empty seat is not a code seat — absence is not a model claim", () => {
  assert.equal(seatSummary("nothing", []).codeExecuted, false);
});
