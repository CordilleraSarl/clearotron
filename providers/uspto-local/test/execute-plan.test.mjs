// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// execute-plan.test.mjs — a slice this source cannot run is DISCLOSED, not retried and not answered.
//
// The chain has four links and every one of them already existed; what is tested here is that they are
// joined. A `phonetic` entry becomes `match_mode:"phonetic"` in the built query, the store refuses with
// CAPABILITY_GAP_MARKER, the executor's `isCapabilityGap` reads that marker, and the block comes back
// `deferred: true` on top of `error: true`.
//
// THE DIFFERENCE THE MARKER MAKES, and why it is worth a test of its own:
//   * error:true alone   — a TRANSIENT fault. joinPlanToBands counts it MISSING, the repair ladder
//                          re-runs it, every rung re-derives the identical deterministic refusal, and
//                          the run grinds to a StageFailure over an answer that can never change.
//   * error + deferred   — a capability we honestly lack. It becomes a disclosed coverage row, the
//                          lawyer sees "we did not search here", and the run still delivers.
// Neither is a clean negative, which is the part that must never slip.
//
// The compiler stamps such a slice `unsupported` long before dispatch, so in the normal flow this never
// fires. It is the second lock, and the one that catches a supplemental proposal — minted at judgment
// time, after the plan was frozen — asking for something the register cannot do.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openIndex, createSchema, putRecords, rebuildFts, setMeta } from "../src/index-store.js";
import { doExecutePlan, resetHandles } from "../src/core.js";

const LEDGER = mkdtempSync(join(tmpdir(), "uspto-ledger-"));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(LEDGER, "calls.jsonl");
process.env.CLEAROTRON_REGISTER_RECORD_LOG = join(LEDGER, "records.jsonl");
test.after(() => { try { rmSync(LEDGER, { recursive: true, force: true }); } catch { /* gone */ } });

const ROWS = [
  { serial: "80000001", text: "ARBORA", status: "700", classes: ["009"], owner: "ARBORA HOLDINGS SA" },
  { serial: "80000002", text: "NOVARBORA", status: "700", classes: ["009"], owner: "NOVA SA" },
];

function scaffold(entries) {
  const dir = mkdtempSync(join(tmpdir(), "uspto-plan-"));
  const dbPath = join(dir, "us.db");
  const db = createSchema(openIndex(dbPath));
  putRecords(db, ROWS);
  rebuildFts(db);
  setMeta(db, "records", String(ROWS.length));
  setMeta(db, "newest_delta", new Date(Date.now() - 24 * 3_600_000).toISOString());
  setMeta(db, "synced_at", new Date().toISOString());
  // A complete build records that it holds the 1884- backfile as well as the dailies. Without
  // it the count refuses, because a dailies-only index cannot support a clean negative.
  setMeta(db, "backfile_through", new Date().toISOString());
  db.close();
  resetHandles();

  const planPath = join(dir, "register-plan.json");
  const outPath = join(dir, "primary-sweep-band.json");
  writeFileSync(planPath, JSON.stringify({ entries }));
  return {
    auth: { dbPath }, planPath, outPath,
    band: () => JSON.parse(readFileSync(outPath, "utf8")),
    cleanup: () => { resetHandles(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } },
  };
}

const entry = (over) => ({
  qid: "q1", axis: "primary-sweep", predicate: "exact", term: "ARBORA", nice_classes: [9], ...over,
});
const blockFor = (band, qid) => {
  const blocks = Array.isArray(band) ? band : (band?.blocks ?? Object.values(band).flat());
  return blocks.find((b) => b?.qid === qid);
};

test("a dictated slice this source CAN run executes and writes its band", async () => {
  // The control. Without it, every assertion below could be passing because nothing ran at all.
  const s = scaffold([entry({})]);
  try {
    const r = await doExecutePlan(s.auth, { plan_path: s.planPath, axis: "primary-sweep", output_path: s.outPath });
    assert.ok(!r.text.startsWith("ERROR"), r.text);
    const b = blockFor(s.band(), "q1");
    assert.equal(b.state, "enumerated");
    assert.equal(b.total_hits, 1);
    assert.ok(!b.error, "a slice that ran carries no error stamp");
    assert.ok(!b.deferred);
  } finally { s.cleanup(); }
});

test("a PHONETIC slice comes back deferred, not merely errored, and never as a zero", async () => {
  const s = scaffold([entry({ qid: "q2", predicate: "phonetic", term: "ARBORA" })]);
  try {
    const r = await doExecutePlan(s.auth, { plan_path: s.planPath, axis: "primary-sweep", output_path: s.outPath });
    assert.ok(!r.text.startsWith("ERROR"), `the AXIS must still complete — one unserveable slice is not a failed run: ${r.text}`);
    const b = blockFor(s.band(), "q2");
    assert.ok(b, "the slice still produces a block — an omitted slice is invisible, which is worse");
    assert.equal(b.error, true, "the error stamp is KEPT so nothing reads it as a sanctioned crowd");
    assert.equal(b.deferred, true,
      "and `deferred` is what stops the repair ladder re-deriving the identical refusal until the run fails");
    assert.notEqual(b.state, "enumerated", "an unserveable slice is never an enumerated band");
    assert.ok(!b.total_hits, "and it never carries a hit count that could be read as a counted zero");
  } finally { s.cleanup(); }
});

test("an INTERNAL wildcard defers on the same path", async () => {
  // Anchors are handled; a star in the middle has no expression here at all. Same class of gap, same
  // disclosure — and the same trap if it were searched literally, which finds nothing and looks clean.
  const s = scaffold([entry({ qid: "q3", predicate: "wildcard", term: "AR*RA" })]);
  try {
    await doExecutePlan(s.auth, { plan_path: s.planPath, axis: "primary-sweep", output_path: s.outPath });
    const b = blockFor(s.band(), "q3");
    assert.equal(b.error, true);
    assert.equal(b.deferred, true);
  } finally { s.cleanup(); }
});

test("one unserveable slice does not take the serveable ones with it", async () => {
  // The whole point of deferring rather than failing: the run still delivers, with the gap on its face.
  const s = scaffold([entry({}), entry({ qid: "q2", predicate: "phonetic", term: "ARBORA" })]);
  try {
    await doExecutePlan(s.auth, { plan_path: s.planPath, axis: "primary-sweep", output_path: s.outPath });
    const band = s.band();
    assert.equal(blockFor(band, "q1").state, "enumerated");
    assert.equal(blockFor(band, "q2").deferred, true);
  } finally { s.cleanup(); }
});
