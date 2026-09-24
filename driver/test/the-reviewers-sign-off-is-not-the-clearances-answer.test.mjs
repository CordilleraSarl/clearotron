// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REVIEWER'S SIGN-OFF IS NOT THE CLEARANCE'S ANSWER.
//
// The narrative-refutation stage signs the draft off CLEAR, CONDITIONAL or BLOCKING. It sat at the top of
// the run record as `verdict`, where it read as the clearance's answer and competed with the rating: a
// client was told a matter was "on hold" because the reviewer had not signed, although nothing holds a
// delivery on that, and the quick-search lane stored its rating in the same field, so one field held two
// vocabularies. Ruled 2026-09-22: the sign-off lives under the stage that produced it, named for what it
// is (`review.signoff`), and the rating (`tier`) is the run's headline. Records written before the move
// carry the old field, and every reader still reads them.
//
// The restore on a rebuilt run is held in pipeline.mock.test.mjs, beside the mock run it needs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { writeRunStatus, signoffPatch, readSignoff } from "../progress.mjs";
import { writeSettleStamp, backfillSettleStamp, readSettleStamp } from "../settle-stamp.mjs";
import { scanAccountRuns } from "../portal-service.mjs";

const runDirWith = (status) => {
  const dir = mkdtempSync(join(tmpdir(), "signoff-"));
  if (status) writeFileSync(join(dir, "status.json"), JSON.stringify(status));
  return dir;
};
const read = (dir) => JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));

test("the run record carries the sign-off under review.signoff, and a rewrite retires the old field", () => {
  const dir = runDirWith({ runId: "r1", state: "running", verdict: "CLEAR", tier: "High" });
  writeRunStatus(null, signoffPatch("BLOCKING"), dir);
  const s = read(dir);
  assert.deepEqual(s.review, { signoff: "BLOCKING" });
  assert.equal(s.verdict, undefined, "the sign-off is still at the top of the run record as `verdict`");
  assert.equal(s.tier, "High", "the rating was touched");
  // THE CONTROL: a record written before the move still reads, through the one reader every site uses.
  assert.equal(readSignoff({ verdict: "CONDITIONAL" }), "CONDITIONAL");
  assert.equal(readSignoff({ review: { signoff: "CLEAR" }, verdict: "BLOCKING" }), "CLEAR", "the old field outranked the new one");
  assert.equal(readSignoff({}), null);
});

test("the settle stamp names each lane's word for what it is, and a backfill reads either shape", () => {
  const clearance = runDirWith();
  writeSettleStamp(clearance, { state: "delivered", signoff: "CONDITIONAL", deliveredAt: "2026-09-22T10:00:00Z", runId: "r1", lane: "clearance" });
  assert.equal(readSettleStamp(clearance).signoff, "CONDITIONAL");
  assert.equal(readSettleStamp(clearance).verdict, undefined);
  const knockout = runDirWith();
  writeSettleStamp(knockout, { state: "delivered", tier: "Manageable", deliveredAt: "2026-09-22T10:00:00Z", runId: "r2", lane: "knockout" });
  assert.equal(readSettleStamp(knockout).tier, "Manageable");
  assert.equal(readSettleStamp(knockout).signoff, undefined, "the quick-search lane's rating was filed as a sign-off");
  // A status.json written before the move, on each lane: the old field goes to the name it always meant.
  const oldClearance = runDirWith({ state: "delivered", deliveredAt: "2026-09-21T10:00:00Z", runId: "r3", verdict: "BLOCKING" });
  const pool1 = runDirWith();
  assert.equal(backfillSettleStamp(pool1, oldClearance).written, true);
  assert.equal(readSettleStamp(pool1).signoff, "BLOCKING");
  const oldKnockout = runDirWith({ state: "delivered", deliveredAt: "2026-09-21T10:00:00Z", runId: "r4", verdict: "Manageable", marks: [{ name: "X" }] });
  const pool2 = runDirWith();
  assert.equal(backfillSettleStamp(pool2, oldKnockout).written, true);
  assert.equal(readSettleStamp(pool2).tier, "Manageable");
  assert.equal(readSettleStamp(pool2).signoff, undefined);
});

test("the portal's live row shows the rating, never the reviewer's sign-off word", () => {
  const poolRoot = mkdtempSync(join(tmpdir(), "signoff-pool-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "signoff-ws-"));
  const liveRun = (slug, status) => {
    const dir = join(workspaceRoot, "workspace-test", "studio", "clearance-search", slug, "2026-09-22-amber-x");
    mkdirSync(driverDir(dir), { recursive: true });
    writeFileSync(join(dir, "status.json"), JSON.stringify({ markName: "LIVEMARK", state: "failed", updatedAt: "2026-09-22T10:00:00Z", ...status }));
    writeFileSync(driverDir(dir, "profile.json"), JSON.stringify({ profileKey: "demo-brand-owner", name: "Demo Brand Owner" }));
  };
  liveRun("tmp1-rated", { runId: "tmp1-rated-amber-x", tier: "High", review: { signoff: "BLOCKING" } });
  liveRun("tmp2-before", { runId: "tmp2-before-amber-x", verdict: "BLOCKING" });
  const rows = scanAccountRuns({ poolRoot, workspaceRoot, account: "demo-brand-owner" });
  const row = (id) => rows.find((r) => r.runId === id);
  assert.ok(row("tmp1-rated-amber-x"), "the live run is not listed, so this arm asserts nothing");
  assert.equal(row("tmp1-rated-amber-x").overall, "High");
  assert.equal(row("tmp2-before-amber-x")?.overall ?? null, null, "a run recorded before the move shows its sign-off as its rating");
  for (const r of rows) assert.doesNotMatch(String(r.overall ?? ""), /^(CLEAR|CONDITIONAL|BLOCKING)$/);
});
