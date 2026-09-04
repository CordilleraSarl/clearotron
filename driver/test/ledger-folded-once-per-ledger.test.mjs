// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE RUN-LEVEL HISTOGRAM COUNTS EACH LEDGER ENTRY ONCE.
//
// `recordConnotationAudit` loops over the audit seats and folds "the seat's" verdict ledger into one
// run-level map. The ledger is not seat-scoped: `callRecordPaths` derives it from
// `dirname(formSidecarPath(...))`, and every half's accumulator lives in the SAME `_driver/`, so all
// three halves resolve to one shared `disposition-calls/verdicts.jsonl`. Three seats folded one file.
//
// Measured on a production read: ledger total 283 → folded total 849, every bucket exactly ×3, and
// `callRows` carrying 300 entries for 100 distinct rows.
//
// IT IS INVISIBLE ON A SINGLE-SEAT RUN, where the multiplier is one and every number reconciles
// perfectly. That is the whole reason this file exists and why its central fixture is a THREE-half run:
// an n=1 population cannot exercise a per-seat multiplication at all, so the suite that covered this
// code — 21 passing tests, all on the merged single-seat path — could never have caught it.
//
// THE INVARIANT, and it is the one the issue asked for: the histogram's total equals the ledger's own
// line count, on a one-seat run AND on a three-seat run. A run that multiplies by one proves nothing,
// so both are asserted and the three-seat case is the load-bearing one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { recordCallVerdict, callRecordPaths } from "../disposition-tool.mjs";

const GRID = JSON.stringify({ cells: [], extras: { pr_risk: [{ query: "a meaning query", results: [] }] } });

/** A run directory whose paths are the ones `connotationAuditSeats` resolves. */
function runDir(prefix) {
  const rd = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(driverDir(rd), { recursive: true });
  return {
    rd,
    P: {
      commonLaw: join(rd, "common-law-findings.md"),
      commonLawGrid: join(rd, "common-law-grid.json"),
      commonLawHalf: (h) => join(rd, `common-law-findings.half-${h}.md`),
      commonLawGridHalf: (h) => join(rd, `common-law-grid.half-${h}.json`),
      commonLawDispositions: join(rd, "common-law-dispositions.json"),
      commonLawDispositionsHalf: (h) => join(rd, `common-law-dispositions.half-${h}.json`),
    },
  };
}

/** Three refusals over two rows — enough that a ×3 fold is unmistakable in every bucket. */
function writeLedger(dispositionsPath) {
  const rows = [
    { row_id: "Q-ONE", reason: "fragment_absent" },
    { row_id: "Q-TWO", reason: "segment_absent" },
    { row_id: "Q-ONE", reason: "fragment_absent" },
  ];
  rows.forEach((r, i) => recordCallVerdict(dispositionsPath, i + 1, {
    accepted: [], overflow: [], dropped: [],
    refused: [{ row_id: r.row_id, reason: r.reason, ruling: "benign", detail: "planted" }],
  }));
  return rows.length;
}

/** The ledger's own line count — the number the histogram has to reconcile against. */
const ledgerLines = (dispositionsPath) =>
  readFileSync(callRecordPaths(dispositionsPath, 0).verdicts, "utf8").split("\n").filter((l) => l.trim()).length;

const total = (histogram) => Object.values(histogram ?? {}).reduce((n, v) => n + v, 0);

async function audit(setUp, prefix) {
  const { recordConnotationAudit } = await import("../pipeline.mjs");
  const { rd, P } = runDir(prefix);
  const calls = setUp(P);
  recordConnotationAudit({ runDir: rd }, P);
  return { artifact: JSON.parse(readFileSync(driverDir(rd, "connotation-receipts.json"), "utf8")), calls, P };
}

// ── the case the defect hid on ───────────────────────────────────────────────────────────────────────

test("#1241 a SINGLE-seat run reconciles — and this is the run that proved nothing", async () => {
  const { artifact, calls } = await audit((P) => {
    writeFileSync(P.commonLaw, "merged\n");
    writeFileSync(P.commonLawGrid, GRID);
    return writeLedger(P.commonLawDispositions);
  }, "ct-1241-one-");
  assert.equal(artifact.ledger.seatsWithLedger, 1, "the fixture is not the single-seat shape it claims to be");
  assert.equal(total(artifact.refusalReasons), calls, "even ×1 did not reconcile — the fold is wrong for another reason");
  assert.equal(artifact.ledger.calls, calls);
});

// ── the case that could not hide ─────────────────────────────────────────────────────────────────────

test("#1241 a THREE-half run counts each ledger entry ONCE", async () => {
  const { artifact, calls, P } = await audit((P) => {
    // No merged pair on disk, so connotationAuditSeats takes the per-half branch and returns three.
    for (const h of ["a", "b", "m"]) {
      writeFileSync(P.commonLawGridHalf(h), GRID);
      writeFileSync(P.commonLawHalf(h), `half ${h}\n`);
    }
    // ONE ledger, written through one half — every half resolves to this same file, which is the defect.
    return writeLedger(P.commonLawDispositionsHalf("m"));
  }, "ct-1241-three-");

  assert.equal(artifact.seats.length, 3, "the fixture did not produce three seats — it cannot exercise the multiplication");
  assert.equal(total(artifact.refusalReasons), calls,
    `the histogram totals ${total(artifact.refusalReasons)} against a ledger of ${calls} lines — `
    + "three seats are folding one shared ledger (#1241)");
  assert.equal(artifact.ledger.calls, calls, "ledger.calls multiplied by the seat count");
  // Per-row, because a bucket total can be right while the rows are duplicated.
  assert.equal(artifact.callRows.length, 2, "callRows carries one entry per seat per row instead of one per row");
  assert.deepEqual(artifact.callRows.map((r) => r.row).sort(), ["Q-ONE", "Q-TWO"]);
  assert.equal(artifact.callRows.find((r) => r.row === "Q-ONE").calls, 2, "the per-row call count multiplied too");
});

test("#1241 the invariant, stated once: histogram total == the ledger's own line count", async () => {
  // The issue's acceptance in one assertion, on the shape that can fail it.
  const { artifact, P } = await audit((P) => {
    for (const h of ["a", "b", "m"]) { writeFileSync(P.commonLawGridHalf(h), GRID); writeFileSync(P.commonLawHalf(h), `half ${h}\n`); }
    return writeLedger(P.commonLawDispositionsHalf("a"));
  }, "ct-1241-inv-");
  assert.equal(total(artifact.refusalReasons), ledgerLines(P.commonLawDispositionsHalf("a")));
});

// ── attribution: the ledger has no seat, so it must not be given one it cannot support ───────────────

test("#1241 a ledger several seats share is attributed to none of them", async () => {
  // The ledger's records are {at, seq, accepted, refused, dropped, overflow} and ledgerRows keys on row
  // id: there is no seat in it. Stamping one seat's name on rows drawn from a file three seats share is
  // attribution the artifact cannot back, and it read as "half-a refused these" for a whole round.
  const { artifact } = await audit((P) => {
    for (const h of ["a", "b", "m"]) { writeFileSync(P.commonLawGridHalf(h), GRID); writeFileSync(P.commonLawHalf(h), `half ${h}\n`); }
    return writeLedger(P.commonLawDispositionsHalf("m"));
  }, "ct-1241-attr-");
  for (const r of artifact.callRows)
    assert.equal(r.seat, "shared", "a shared ledger's rows are stamped with one seat's name");
});

test("#1241 a ledger exactly ONE seat owns keeps that seat's name", async () => {
  // The merged run is most runs, and there the seat IS the answer — the existing audit test asserts
  // `rulingDrift[0].seat === "merged"`. Widening "shared" to every case would trade one wrong
  // attribution for another.
  const { artifact } = await audit((P) => {
    writeFileSync(P.commonLaw, "merged\n");
    writeFileSync(P.commonLawGrid, GRID);
    return writeLedger(P.commonLawDispositions);
  }, "ct-1241-solo-");
  for (const r of artifact.callRows) assert.equal(r.seat, "merged");
});
