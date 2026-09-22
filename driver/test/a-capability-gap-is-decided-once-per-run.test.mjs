// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CAPABILITY GAP IS DECIDED ONCE PER RUN, NOT ONCE PER PLAN VERSION.
//
// A production run on 2026-09-22 accepted one refused register slice as a capability gap ("never
// retried"), then re-opened it, re-proposed it and paid the provider for it again, several times. The
// acceptance was rebuilt from the current receipt at every settle, and a supplemental fold bumps the plan
// version, so it lasted exactly one version. The envelope's re-open read only the reason the model wrote
// on the ledger row, so a gap described in the model's own words read as work a re-run could close.
//
// Held below: the settle keeps every reason-matched gap by qid for the run's life; the fan-in and the
// receipt writer keep a sticky qid out of `missing`; the envelope's split holds its ledger row through the
// coverage form's qid whatever the row's reason says. And the controls: a deferral that is not a gap
// keeps today's behaviour, and without the sticky record the same row still reads as closeable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { settleReceipt, partitionReceiptDeferrals, readStickyGaps, stickyGapsAfter } from "../envelope-settle.mjs";
import { splitDeferredByCloseability, formRowUnitKey, ledgerUnitKey, parseCoverageLedgerJson } from "../coverage-ledger.mjs";
import { renderCoverageLedgerJsonFromForm } from "../coverage-form.mjs";
import { holdStickyGapsIn } from "../pipeline.mjs";

const GAP = "provider error (after one in-tool retry): provider error on the count probe before enumeration: "
  + "capability-gap: register_refused_query: the register refused this query as malformed (a 400 inside its "
  + "HTTP 500) — 500 terms OR-joined in one field, 8254 characters, against this provider's declared width of 500 terms.";
const HARD = "provider hard error after the full recovery ladder — the slice was accepted and then failed, so it was "
  + "never searched and cannot be read as clean: HTTP 500: INTERNAL_SERVER_ERROR";
const WIDE = "supp:primary-sweep:exact:veltrin:0badc0de";
const OTHER = "primary-sweep:exact:veltrin";
const PLAN = (v) => ({ plan_version: v, entries: [
  { qid: OTHER, axis: "primary-sweep", predicate: "exact", term: "VELTRIN" },
  { qid: WIDE, axis: "primary-sweep", predicate: "exact", terms: ["VELTRI", "VELTRYN"] },
] });
const receipt = (v, deferred) => ({ plan_version: v, deferred, missing: [],
  skeleton: [{ axis: "primary-sweep", state: deferred.length ? "deferred" : "executed" }] });

function runDir() {
  const dir = mkdtempSync(join(tmpdir(), "sticky-gap-"));
  mkdirSync(driverDir(dir), { recursive: true });
  return { dir, P: { runDir: dir, envelopeDecision: driverDir(dir, "envelope-decision.json") } };
}

test("an accepted capability gap survives a plan-version bump, and the receipt forgetting it", async () => {
  const { dir, P } = runDir();
  try {
    await settleReceipt({ P, plan: PLAN(5), receipt: receipt(5, [{ qid: WIDE, reason: GAP }]) });
    assert.deepEqual([...readStickyGaps(P).keys()], [WIDE]);
    assert.equal(readStickyGaps(P).get(WIDE).since_plan_version, 5);
    // v6: the fold re-proposed it and the re-run filed it under a reason that states no gap. Before, that
    // row was `suspect` and bought one more executor attempt; the run's own record now decides it.
    const doc6 = await settleReceipt({ P, plan: PLAN(6), receipt: receipt(6, [{ qid: WIDE, reason: HARD }]) });
    assert.deepEqual(doc6.accepted.map((a) => a.qid), [WIDE], "a gap the run already accepted was re-opened as suspect");
    // v7: the receipt no longer lists it at all. The record keeps it.
    await settleReceipt({ P, plan: PLAN(7), receipt: receipt(7, []) });
    assert.deepEqual([...readStickyGaps(P).keys()], [WIDE], "the run forgot a gap when the receipt stopped listing it");
    assert.equal(readStickyGaps(P).get(WIDE).since_plan_version, 5, "the first acceptance is the one recorded");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("THE CONTROL: only a reason-matched gap is sticky; a hard error accepted with its axis is not", () => {
  // The skeleton branch accepts every deferral on an axis marked `deferred`, whatever its reason. That is
  // an axis-level acceptance of a slice a later attempt might close, so it must not become permanent.
  const { accepted } = partitionReceiptDeferrals(PLAN(5), receipt(5, [{ qid: OTHER, reason: HARD }]));
  assert.deepEqual(accepted.map((a) => a.qid), [OTHER], "the fixture no longer reaches the skeleton branch");
  assert.deepEqual(stickyGapsAfter(null, accepted, 5), [], "a hard error was made permanent");
  assert.deepEqual(stickyGapsAfter(null, [{ qid: WIDE, axis: "primary-sweep", reason: GAP }], 5).map((g) => g.qid), [WIDE]);
  // Without a sticky record, a hard error on an axis the skeleton does not mark is suspect, as today.
  const today = partitionReceiptDeferrals(PLAN(6), { ...receipt(6, [{ qid: WIDE, reason: HARD }]), skeleton: [] });
  assert.deepEqual(today.suspect.map((s) => s.qid), [WIDE]);
  const now = partitionReceiptDeferrals(PLAN(6), { ...receipt(6, [{ qid: WIDE, reason: HARD }]), skeleton: [] }, { sticky: new Set([WIDE]) });
  assert.deepEqual(now.accepted.map((s) => s.qid), [WIDE]);
});

test("a sticky gap never rides the ladder: out of missing, into deferred, with the reason it was accepted under", () => {
  const sticky = new Map([[WIDE, { qid: WIDE, reason: GAP }]]);
  const held = holdStickyGapsIn({ executed: [OTHER], missing: [WIDE], deferred: [] }, sticky);
  assert.deepEqual(held.missing, []);
  assert.deepEqual(held.deferred, [{ qid: WIDE, reason: GAP.slice(0, 300) }]);
  const untouched = { executed: [], missing: [OTHER], deferred: [] };
  assert.equal(holdStickyGapsIn(untouched, sticky), untouched, "a join with nothing sticky in it was rewritten");
});

test("the envelope holds a sticky gap's row whatever the model wrote, and only through the run's record", () => {
  // The form's driver-written row for the slice, and the ledger row the driver derives from it once the
  // seat has written its reason, in the model's own words: nothing in them names a capability gap.
  const formRow = { axis: "primary-sweep", kind: "deferred", qid: WIDE, unit: "primary-sweep / VELTRI +1 more",
    status: "deferred", reason: "the register would not take the 500-term query, so this was left open" };
  const [ledgerRow] = parseCoverageLedgerJson(renderCoverageLedgerJsonFromForm([formRow]));
  assert.equal(formRowUnitKey(formRow), ledgerUnitKey(ledgerRow.axis, ledgerRow.scope),
    "the form and the ledger name the unit differently, so no sticky row could ever be matched");
  const closeableRow = { axis: "primary-sweep", scope: "phonetic fringe", unit: "primary-sweep / phonetic fringe",
    status: "deferred", reason: "time ran out before the fringe was enumerated" };
  const rows = [ledgerRow, closeableRow];
  // THE CONTROL: today's split reads only the prose, so the gap is work to re-open.
  assert.deepEqual(splitDeferredByCloseability(rows, "primary-sweep", ["primary-sweep"]).held, []);
  const s = splitDeferredByCloseability(rows, "primary-sweep", ["primary-sweep"], { heldUnits: new Set([formRowUnitKey(formRow)]) });
  assert.deepEqual(s.held, [ledgerRow], "the sticky gap's row is still offered to the envelope as closeable");
  assert.deepEqual(s.closeable, [closeableRow], "a closeable row on the same axis stopped being closeable");
});
