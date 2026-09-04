// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
//, T3b — A CORRECTIVE PASS THAT FAILS VALIDATION RESTORES THE LAST GOOD STATE.
//
// Owner decision, 2026-08-26, put to him as a client outcome with options: a targeted fix that fails
// validation is DISCARDED — the report never ships text a repair degraded.
//
// ── WHAT THIS REPLACED IS WORSE THAN SHIPPING DEGRADED TEXT, WHICH IS WHY THE ARMS ARE HERE ─────────
//
// `must(correctivePass, …)` threw, and nothing between it and the run-level catch caught it. A
// corrective synthesis that could not produce a document its validators accept KILLED THE RUN — the
// client received no report, on a matter whose only defect was that a repair of an already-delivered
// draft did not take. The pre-corrective findings were on disk in full the whole time.
//
// So these arms are about delivery, not tidiness. The two that REFUSE to roll back matter as much as
// the one that does: each names a state where swallowing the failure costs more than the throw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { rollbackCorrectivePass } from "../pipeline.mjs";
import { paths as stagePaths } from "../stages.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const pipelineSrc = () => readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");

const GOOD = JSON.stringify({ schemaVersion: 2, findings: [{ ordinal: 1, mark: "NOVAPULSE", level: "C" }] }, null, 2) + "\n";
const DEGRADED = JSON.stringify({ schemaVersion: 2, findings: [] }, null, 2) + "\n";
const shaOf = (s) => createHash("sha256").update(s).digest("hex");

const withRun = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "t3b-rollback-"));
  try {
    const P = stagePaths(dir);
    mkdirSync(dirname(P.findings), { recursive: true });
    mkdirSync(dirname(driverDir(dir, "x.json")), { recursive: true });
    return fn(dir, P);
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

test("T3b: a failed corrective pass restores the findings the reviewer read", () => {
  withRun((dir, P) => {
    writeFileSync(P.findings, DEGRADED);                       // what the failed pass left behind
    const pre = { raw: GOOD, sha: shaOf(GOOD) };               // what synthesis wrote and the reviewer read
    const rec = rollbackCorrectivePass(P, dir, pre, { ok: false, fail: "findings_schema_invalid:3" });
    assert.ok(rec, "the rollback must fire — without it the run throws and the client gets no report at all");
    assert.equal(rec.restored, true, "the file differed from the snapshot, so it was restored");
    assert.equal(readFileSync(P.findings, "utf8"), GOOD,
      "the degraded document is still on disk. The whole decision is that a report never ships text a "
      + "repair made worse, and the last good state was sitting in the snapshot the entire time");
    assert.equal(rec.reason, "findings_schema_invalid:3", "the record names WHY, verbatim — a rollback with no cause is unauditable");
    const side = JSON.parse(readFileSync(driverDir(dir, "corrective-rollback.json"), "utf8"));
    assert.equal(side.preSha, pre.sha, "the sidecar pins which version came back");
    assert.equal(side.failedSha, shaOf(DEGRADED),
      "and which one was discarded — a rollback that does not record what it threw away destroys the "
      + "evidence of the defect it is recovering from");
  });
});

test("T3b: a rate-limited pass is NOT rolled back — the run parks and resumes", () => {
  withRun((dir, P) => {
    writeFileSync(P.findings, DEGRADED);
    const pre = { raw: GOOD, sha: shaOf(GOOD) };
    for (const fail of [{ ok: false, fail: "rate_limited" }, { ok: false, fail: "failed", resetsAt: "2026-08-27T02:00:00Z" }]) {
      assert.equal(rollbackCorrectivePass(P, dir, pre, fail), null,
        `${JSON.stringify(fail)} must decline the rollback. The run is PARKED with every stage intact and `
        + "auto-resumes when the cap resets; rolling back here spends the client's corrected report to "
        + "avoid a wait, and the corrective pass would never be retried at all");
    }
    assert.equal(readFileSync(P.findings, "utf8"), DEGRADED,
      "and it must not have touched the file on the way to declining");
    assert.equal(existsSync(driverDir(dir, "corrective-rollback.json")), false,
      "nor written a record of a rollback that did not happen");
  });
});

test("T3b: with NO snapshot there is no last good state, and the throw stands", () => {
  withRun((dir, P) => {
    writeFileSync(P.findings, DEGRADED);
    for (const pre of [null, {}, { sha: "abc" }]) {
      assert.equal(rollbackCorrectivePass(P, dir, pre, { ok: false, fail: "failed" }), null,
        `pre=${JSON.stringify(pre)} carries no text to restore. An absence is a finding, not a pass: with `
        + "nothing to roll back TO, delivering would ship whatever the failed pass left behind — which is "
        + "the one outcome this decision exists to prevent");
    }
  });
});

test("T3b: a pass that failed WITHOUT changing the file is recorded, not rewritten", () => {
  withRun((dir, P) => {
    writeFileSync(P.findings, GOOD);
    const rec = rollbackCorrectivePass(P, dir, { raw: GOOD, sha: shaOf(GOOD) }, { ok: false, fail: "empty_response" });
    assert.ok(rec, "the run still delivers — the failure is real even though the document is intact");
    assert.equal(rec.restored, false,
      "`restored: true` would claim a write that never happened, and this record is what a later reader "
      + "uses to tell a degraded-and-recovered run from one that simply could not repair");
    assert.equal(readFileSync(P.findings, "utf8"), GOOD);
  });
});

// ── SOURCE-LEVEL, AND SAID SO ───────────────────────────────────────────────────────────────────────
//
// The arms above drive the predicate. They cannot reach the WIRING — that a failing corrective pass
// now reaches the rollback instead of `must`, and that the verdict recheck is skipped afterwards —
// because the mock harness has no switch that fails a named stage's validation. Adding one belongs
// with the end-to-end arm and is NOT in this change; this reads the source instead, which is weaker
// and is the honest description of what is covered.
test("T3b: the corrective `must` is reached only where the rollback declined", () => {
  const src = pipelineSrc();
  assert.match(src, /correctiveRollback = correctivePass\.ok\s*\n?\s*\?\s*null\s*\n?\s*:\s*rollbackCorrectivePass\(/,
    "the corrective pass's failure must run through the rollback first");
  const guarded = /if \(correctiveRollback\) \{[\s\S]{0,900}?\} else \{\s*\n\s*must\(correctivePass,/;
  assert.match(src, guarded,
    "`must` must sit in the ELSE of the rollback. Left unconditional it throws before the rollback can "
    + "matter, which is the pre-change behaviour with a dead branch beside it");
  assert.match(src, /if \(!correctiveRollback && !correctiveCycleSettled && \(verdict === "CONDITIONAL"/,
    "and the verdict recheck must be skipped after a rollback — the document is byte-identical to the "
    + "one the reviewer just read, so a recheck spends a dispatch to re-derive the verdict it gave");
});
