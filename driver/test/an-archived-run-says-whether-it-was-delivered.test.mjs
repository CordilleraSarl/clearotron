// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// an-archived-run-says-whether-it-was-delivered.test.mjs —.
//
// THE FIXTURE IS SHAPED BY WHAT THE POOL OMITS, NOT BY WHAT A RUN DIR HAS. A real pool copy carries
// meta.json, report.md, report.html, report-data.json and the audit workbook — and NO status.json and
// NO _driver/. Measured on a real pool copy on the test instance, 2026-09-03; the run is named on the
// tracker thread rather than here, because a run identifier is a client identifier.
// This whole class is invisible to a fixture that includes the files the pool leaves out, which is why
// the parent issue asked for a real pool directory. These arms are necessary and NOT sufficient: the
// real-pool measurement is reported on the tracker thread beside them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSettleStamp, readSettleStamp, backfillSettleStamp, SETTLE_FILE } from "../settle-stamp.mjs";
import { deliveryLine } from "../reference-score.mjs";

/** A pool copy, faithful to what the pool actually holds: no status.json, no _driver/. */
function poolCopy({ stamp = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "settle-pool-"));
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ runId: "tmpx1-acme-2026-09-01-jade-anvil", issuedAt: "2026-09-01T09:00:00Z", verdict: "CONDITIONAL" }));
  writeFileSync(join(dir, "report.md"), "# Report\n");
  if (stamp) writeFileSync(join(dir, SETTLE_FILE), typeof stamp === "string" ? stamp : JSON.stringify(stamp));
  assert.ok(!existsSync(join(dir, "status.json")), "the fixture grew a status.json — it no longer omits what the pool omits");
  assert.ok(!existsSync(join(dir, "_driver")), "the fixture grew a _driver/ — it no longer omits what the pool omits");
  return dir;
}
/** The record scripts/score.mjs builds for a pool copy: no status.json, so no state and no deliveredAt. */
const asScored = (dir) => ({ hasStatus: false, deliveryState: null, deliveredAt: null, poolMeta: JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")), settle: readSettleStamp(dir) });

test("2153 an archived run's terminal state is readable WITHOUT the workspace copy", () => {
  const dir = poolCopy();
  // THE DEFECT, FIRST — and asserted as the failing shape, so this arm cannot pass on a fixture that
  // never reproduced it. Before the stamp, the pool copy could only decline.
  const before = deliveryLine(asScored(dir));
  assert.match(before, /NOT PRESERVED/, "the pre-stamp pool copy did not reproduce the defect this arm is about");
  assert.doesNotMatch(before, /delivered: (YES|NO)\b/, "an unstamped pool copy answered a question it cannot answer");

  // THE FIX, written by the delivery path at settle with the pool dir in hand.
  const res = writeSettleStamp(dir, { state: "delivered", verdict: "CONDITIONAL", deliveredAt: "2026-09-01T09:04:11Z", runId: "tmpx1-acme-2026-09-01-jade-anvil", lane: "clearance" });
  assert.equal(res.written, true, res.reason);
  const after = deliveryLine(asScored(dir));
  assert.match(after, /delivered: YES — 2026-09-01T09:04:11Z/);
  assert.match(after, /settle stamp/, "the answer does not say where it came from");
  rmSync(dir, { recursive: true, force: true });
});

test("2153 a run that PUBLISHED and then FAILED never reads as delivered", () => {
  // The stamp records a state; it is not a token whose presence means delivery. A failed terminal state
  // stamped into the pool reads as the failure — the opposite direction of the original defect.
  const dir = poolCopy({ stamp: { schema_version: 1, state: "failed", verdict: null, deliveredAt: null, runId: "tmpx1-acme-2026-09-01-jade-anvil", lane: "clearance" } });
  const line = deliveryLine(asScored(dir));
  assert.match(line, /delivered: NO/);
  assert.match(line, /state=failed/);
  assert.doesNotMatch(line, /delivered: YES/);
  rmSync(dir, { recursive: true, force: true });
});

test("2153 an ABSENT or unreadable stamp means unknown — never 'not delivered'", () => {
  // Every one of these is a pool copy whose stamp cannot be believed. None of them may become a verdict:
  // a run archived before the stamp shipped is the common case and it is not a refusal.
  const cases = [
    ["no stamp at all", null],
    ["a stamp with no state", { schema_version: 1, verdict: "CLEAR" }],
    ["a stamp with an empty state", { schema_version: 1, state: "" }],
    ["a schema this build does not know", { schema_version: 99, state: "delivered", deliveredAt: "2026-09-01T09:04:11Z" }],
    ["the neighbouring spelling, which this envelope does not use", { schema: 1, state: "delivered", deliveredAt: "2026-09-01T09:04:11Z" }],
    ["a stamp that is not an object", "[1,2,3]"],
    ["a stamp that is not JSON", "delivered, honest"],
  ];
  for (const [what, stamp] of cases) {
    const dir = poolCopy({ stamp });
    assert.equal(readSettleStamp(dir), null, `${what}: was read as an answer`);
    const line = deliveryLine(asScored(dir));
    assert.match(line, /NOT PRESERVED/, `${what}: did not decline`);
    assert.doesNotMatch(line, /delivered: (YES|NO)\b/, `${what}: became a verdict`);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("2153 meta.json alone is still not delivery — the original defect stays fixed", () => {
  // Pinned in a-pool-copy-is-not-a-refusal.test.mjs too, and re-asserted here because this change adds
  // the first file the pool has ever carried that DOES answer the question. The two must not blur.
  const dir = poolCopy();
  assert.equal(readSettleStamp(dir), null);
  assert.doesNotMatch(deliveryLine(asScored(dir)), /delivered: YES/);
  rmSync(dir, { recursive: true, force: true });
});

test("2153 the stamp can never cost a delivery", () => {
  // This runs on the delivery path after the client's report is already published. Every failure mode
  // returns a reason for the caller to log; none of them throws, because a run that delivers and fails
  // to stamp is strictly better than one that stamps and fails to deliver.
  assert.equal(writeSettleStamp(null, { state: "delivered" }).written, false, "a run that published nowhere threw or claimed a write");
  assert.equal(writeSettleStamp("/nonexistent/pool/dir", { state: "delivered" }).written, false);
  // A stamp with no state is refused rather than written: an empty answer in the file is worse than no
  // file, because a reader would have to decide what it meant.
  const dir = poolCopy();
  assert.equal(writeSettleStamp(dir, {}).written, false);
  assert.ok(!existsSync(join(dir, SETTLE_FILE)), "a stateless stamp was written to disk");

  // AN UNWRITABLE TARGET, MADE UNWRITABLE FOR EVERY USER. The first version of this arm used a 0o500
  // directory and branched on whether the write succeeded, because root ignores the mode — and the
  // coverage census caught the branch that never runs here. A test whose assertion depends on who is
  // running it asserts nothing on half its runs. A path whose PARENT is a regular file fails ENOTDIR
  // for root exactly as it does for anyone else, so there is one branch and it is always taken.
  const notADir = join(mkdtempSync(join(tmpdir(), "settle-ro-")), "i-am-a-file");
  writeFileSync(notADir, "not a directory\n");
  const res = writeSettleStamp(notADir, { state: "delivered", deliveredAt: "2026-09-01T09:04:11Z" });
  assert.equal(res.written, false, "a write into a path that cannot hold a file reported success");
  assert.match(res.reason, /\w/, "a failed write reported no reason for the caller to log");
  rmSync(dir, { recursive: true, force: true });
  rmSync(notADir, { force: true });
});

test("2153 the stamp round-trips, and carries what a reader needs to name the run", () => {
  const dir = poolCopy();
  writeSettleStamp(dir, { state: "delivered", verdict: "CLEAR", deliveredAt: "2026-09-01T09:04:11Z", runId: "tmpx1-acme-2026-09-01-jade-anvil", lane: "knockout" });
  const s = readSettleStamp(dir);
  assert.equal(s.state, "delivered");
  assert.equal(s.verdict, "CLEAR");
  assert.equal(s.deliveredAt, "2026-09-01T09:04:11Z");
  assert.equal(s.runId, "tmpx1-acme-2026-09-01-jade-anvil");
  assert.equal(s.lane, "knockout", "the lane is not recorded — a reader cannot tell which product settled");
  assert.match(s.stampedAt, /^\d{4}-\d{2}-\d{2}T/, "no stamping time recorded");
  rmSync(dir, { recursive: true, force: true });
});

// ---- the backfill, where the two times MUST differ ---------------------------------------------

/** A workspace run dir carrying the run's own terminal record — what the pool copy does not have. */
function workspaceRun(status) {
  const dir = mkdtempSync(join(tmpdir(), "settle-ws-"));
  writeFileSync(join(dir, "status.json"), JSON.stringify(status));
  return dir;
}

test("2153 a BACKFILL records the delivery time, not the time it was stamped", () => {
  // THE DEFECT THIS ARM EXISTS FOR, found by the test lane on a real backfill: composing `deliveredAt`
  // by hand reaches for the clock, which is the STAMPING time. On a live settle the two coincide and
  // the error is invisible; on a backfill they differ by the whole lag — and the stamp is exactly the
  // artifact a later reader trusts for a delivery date.
  const DELIVERED = "2026-09-02T21:41:45.487Z";      // ~20 hours before any plausible stamping
  const ws = workspaceRun({ state: "delivered", verdict: "CONDITIONAL", deliveredAt: DELIVERED, runId: "tmpx1-acme-2026-09-02-jade-anvil" });
  const pool = poolCopy();

  const res = backfillSettleStamp(pool, ws);
  assert.equal(res.written, true, res.reason);
  const s = readSettleStamp(pool);
  assert.equal(s.deliveredAt, DELIVERED, "the backfill invented a delivery time instead of reading the run's own");
  assert.notEqual(s.stampedAt, s.deliveredAt, "deliveredAt and stampedAt hold one value — on a backfill they cannot");
  assert.ok(Date.parse(s.stampedAt) > Date.parse(s.deliveredAt), "the stamp claims to predate the delivery it records");
  assert.equal(s.verdict, "CONDITIONAL");
  // And it reads back as the delivery it actually was, at the delivery's own time.
  assert.match(deliveryLine(asScored(pool)), new RegExp(`delivered: YES — ${DELIVERED}`));
  rmSync(ws, { recursive: true, force: true });
  rmSync(pool, { recursive: true, force: true });
});

test("2153 a backfill with nothing to read REFUSES rather than composing a time", () => {
  // The refusals are the point: every one of them is a case where the hand-rolled version would have
  // reached for the clock. A missing stamp reads as unknown, which is honest; a stamp carrying a made-up
  // delivery date is not.
  const pool = poolCopy();
  assert.equal(backfillSettleStamp(pool, null).written, false, "a backfill with no run dir wrote something");
  assert.equal(backfillSettleStamp(pool, "/nonexistent/run/dir").written, false);

  const noState = workspaceRun({ runId: "x", deliveredAt: "2026-09-02T21:41:45.487Z" });
  assert.equal(backfillSettleStamp(pool, noState).written, false, "a status.json with no state was stamped anyway");

  // DELIVERED with no time is the shape that would tempt an invention, and it is refused by name.
  const noTime = workspaceRun({ state: "delivered", runId: "x" });
  const r = backfillSettleStamp(pool, noTime);
  assert.equal(r.written, false);
  assert.match(r.reason, /deliveredAt/);
  assert.ok(!existsSync(join(pool, SETTLE_FILE)), "a refused backfill still wrote a stamp");

  // A FAILED run legitimately has no delivery time, and stamps honestly with a null one — the terminal
  // state is still recoverable, which is the whole point, and it never reads as a delivery.
  const failed = workspaceRun({ state: "failed", runId: "x", verdict: null });
  assert.equal(backfillSettleStamp(pool, failed).written, true);
  assert.equal(readSettleStamp(pool).deliveredAt, null);
  assert.match(deliveryLine(asScored(pool)), /delivered: NO/);

  for (const d of [pool, noState, noTime, failed]) rmSync(d, { recursive: true, force: true });
});
