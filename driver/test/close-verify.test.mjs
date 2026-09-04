// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// close-verify.mjs — Fix 2: the shared close-the-loop primitive + the register-directive verifier.
// The blind spot these tests exist to close: the mocks only ever produced the RIGHT search, so a
// byte-diff always looked like a genuine close. Here we simulate the WRONG search.
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyGapClosure, blockSearchedClasses, verifyRegisterDirectiveClose } from "../close-verify.mjs";

test("verifyGapClosure: a gap present before and gone after is closed; one still present is stillOpen", () => {
  const before = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const after = [{ id: "b" }];   // only b survived the re-run of the detector
  const { closed, stillOpen } = verifyGapClosure(before, after, (g) => g.id);
  assert.deepEqual(closed.map((g) => g.id), ["a", "c"]);
  assert.deepEqual(stillOpen.map((g) => g.id), ["b"]);
  // nothing before → nothing to verify; nothing after → everything closed
  assert.deepEqual(verifyGapClosure([], after, (g) => g.id), { closed: [], stillOpen: [] });
  assert.deepEqual(verifyGapClosure(before, [], (g) => g.id).closed.map((g) => g.id), ["a", "b", "c"]);
});

test("blockSearchedClasses: reads the [cl …] tag describePlanEntry writes; indeterminate → empty", () => {
  assert.deepEqual(blockSearchedClasses({ query: "exact HALCYON [cl 35,38]" }), ["35", "38"]);
  assert.deepEqual(blockSearchedClasses({ query: "default HALCYON [cl 9, 28, 41, 42]" }), ["9", "28", "41", "42"]);
  assert.deepEqual(blockSearchedClasses({ query: "no class tag here" }), []);
  assert.deepEqual(blockSearchedClasses({}), []);
});

test("verifyRegisterDirectiveClose: a genuine close (executed, records, right classes) IS closed", () => {
  const r = verifyRegisterDirectiveClose({
    qids: ["supp:primary-sweep:exact:halcyon:abcd1234"],
    intendedClasses: ["35", "38"],
    executedQids: new Set(["supp:primary-sweep:exact:halcyon:abcd1234"]),
    blocksByQid: new Map([["supp:primary-sweep:exact:halcyon:abcd1234",
      { qid: "supp:primary-sweep:exact:halcyon:abcd1234", state: "enumerated", query: "exact HALCYON [cl 35,38]", total_hits: 2, records: [{ id: 1 }, { id: 2 }] }]]),
  });
  assert.deepEqual(r, { closed: true, reason: null });
});

test("verifyRegisterDirectiveClose: an enumerated 0/0 block ON THE WRONG CLASSES is NOT closed (the RUN1 shape)", () => {
  // the mint dispatched HALCYON but the executor searched the matter's OWN classes (9/28/41/42), not the
  // intended Cl.35/38 → 0/0 → byte-changed the band but searched the wrong scope. This must NOT be swept.
  const qid = "supp:primary-sweep:exact:halcyon:wrong0000";
  const r = verifyRegisterDirectiveClose({
    qids: [qid], intendedClasses: ["35", "38"],
    executedQids: new Set([qid]),
    blocksByQid: new Map([[qid, { qid, state: "enumerated", query: "exact HALCYON [cl 9,28,41,42]", total_hits: 0, records: [] }]]),
  });
  assert.equal(r.closed, false);
  assert.match(r.reason, /wrong-scope/);
});

test("verifyRegisterDirectiveClose: a qid that never landed (error/missing) is NOT closed", () => {
  const qid = "supp:primary-sweep:exact:halcyon:notland0";
  const r = verifyRegisterDirectiveClose({
    qids: [qid], intendedClasses: ["35", "38"],
    executedQids: new Set(),   // joinPlanToBands counts an error:true block as MISSING → not executed
    blocksByQid: new Map(),
  });
  assert.equal(r.closed, false);
  assert.match(r.reason, /slice-not-landed/);
});

test("verifyRegisterDirectiveClose: a COLLAPSED slice (claimed hits, zero records) is NOT closed", () => {
  const qid = "supp:primary-sweep:exact:halcyon:collapse";
  const r = verifyRegisterDirectiveClose({
    qids: [qid], intendedClasses: ["35", "38"],
    executedQids: new Set([qid]),
    blocksByQid: new Map([[qid, { qid, state: "enumerated", query: "exact HALCYON [cl 35,38]", total_hits: 17, records: [] }]]),
  });
  assert.equal(r.closed, false);
  assert.match(r.reason, /collapsed-slice/);
});

test("verifyRegisterDirectiveClose: an indeterminate class tag falls through to qid-landed + non-collapse (no false defer)", () => {
  // a block with no [cl …] tag but genuinely executed with records is CLOSED — the class check only
  // fires on POSITIVE evidence of a wrong scope, never manufactures a defer.
  const qid = "supp:primary-sweep:exact:kurena:notag000";
  const r = verifyRegisterDirectiveClose({
    qids: [qid], intendedClasses: ["9", "28"],
    executedQids: new Set([qid]),
    blocksByQid: new Map([[qid, { qid, state: "enumerated", query: "exact KURENA", total_hits: 3, records: [{ id: 1 }] }]]),
  });
  assert.deepEqual(r, { closed: true, reason: null });
});

test("verifyRegisterDirectiveClose: no minted slice at all → not closed (nothing was dispatched)", () => {
  assert.deepEqual(
    verifyRegisterDirectiveClose({ qids: [], intendedClasses: ["35"], executedQids: new Set(), blocksByQid: new Map() }),
    { closed: false, reason: "no-slice-dispatched" });
});

test("verifyRegisterDirectiveClose: a legitimate 0-hit clean on the RIGHT classes IS closed (a true negative)", () => {
  // 0 hits with 0 records on the INTENDED classes is a genuine clean — never confuse it with the wrong-
  // scope 0/0. (findCollapsedBands is floor-safe: total_hits 0 never collapses.)
  const qid = "supp:primary-sweep:exact:halcyon:clean000";
  const r = verifyRegisterDirectiveClose({
    qids: [qid], intendedClasses: ["35", "38"],
    executedQids: new Set([qid]),
    blocksByQid: new Map([[qid, { qid, state: "enumerated", query: "exact HALCYON [cl 35,38]", total_hits: 0, records: [] }]]),
  });
  assert.deepEqual(r, { closed: true, reason: null });
});
