// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE DOUBTS A REBUILT TRACE MINTS FOLLOW IT, RECORD BY RECORD.
//
// After a delivery-check repair the record-carry trace is written again, and the doubts the audit carries for records no
// step gave a ground were minted from the trace before it. They are minted again from the new trace. Their ids are
// positional and the closure step's verdicts are applied by id, so they are matched by record: a record still without a
// ground keeps its doubt as it stands, a record newly without one gets a new doubt under an id no closure can have
// cited, and a record the new trace gives a ground loses its doubt. Every other doubt is left where it stood. Every mark
// and owner is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordCarryDoubtsAgain, mintRecordCarryDoubts } from "../record-carry.mjs";

const row = (uri, mark, owner) => ({ uri, mark, owner, reach: "retrieved", stopped_at: null, detail: "no seam recorded a verdict on this record", placement: null });
const trace = (...rows) => ({ computable: true, unreasoned: rows });
const A = row("/mark/eu/a1", "QZORVAK", "Alpha Ltd"), B = row("/mark/eu/b1", "QZORVAK", "Beta GmbH"), C = row("/mark/eu/c1", "QZORVAK", "Gamma SA");
const OTHER = { id: "doubt:placement-carry:uncarried:1", subject: { uris: ["/mark/eu/a1"] }, status: "open", ending: null };

// The pass's own ledger: the trace before the repair left A and B without a ground; the closure step settled A's.
function before() {
  const { doubts } = mintRecordCarryDoubts(trace(A, B));
  const settledA = { ...doubts[0], status: "checked-and-settled", ending: { by: "doubt-closure", verdict: "SETTLED" } };
  return [OTHER, settledA, doubts[1]];
}

test("a record still without a ground keeps its doubt as it stands, its id, status and ending included", () => {
  const prior = before();
  const r = recordCarryDoubtsAgain(prior, trace(A, B));
  assert.deepEqual(r.doubts, prior, "the ledger moved though the trace still leaves the same records without a ground");
  assert.deepEqual([r.fresh, r.dropped], [[], []]);
});

test("a record the rebuilt trace gives a ground loses its doubt, and a record it leaves without one gains a doubt", () => {
  const stitched = [];
  const r = recordCarryDoubtsAgain(before(), trace(B, C), { stitch: (ds) => { stitched.push(...ds.map((d) => d.id)); return ds; } });
  const family = r.doubts.filter((d) => d.id.startsWith("doubt:record-carry:"));
  assert.deepEqual(family.map((d) => d.subject.uris[0]), ["/mark/eu/b1", "/mark/eu/c1"]);
  assert.deepEqual(r.dropped, ["doubt:record-carry:unreasoned:1"], "the record the repair answered kept its doubt");
  assert.deepEqual(r.fresh, ["doubt:record-carry:unreasoned:3"], "the record the repair left without a ground got no doubt");
  assert.deepEqual(stitched, r.fresh, "only the new doubt is stitched");
  assert.equal(family.find((d) => d.subject.uris[0] === "/mark/eu/c1").status, "open");
  assert.deepEqual(r.doubts[0], OTHER, "a doubt of another family moved");
});

test("an id a closure cited never moves onto another record, whatever order the rebuilt trace lists them in", () => {
  // C now stands first: minted afresh it would take B's old id 1, or A's, and the closure settling id 1 would land on C.
  const prior = before();
  const r = recordCarryDoubtsAgain(prior, trace(C, B));
  const byUri = Object.fromEntries(r.doubts.filter((d) => d.id.startsWith("doubt:record-carry:")).map((d) => [d.subject.uris[0], d]));
  assert.equal(byUri["/mark/eu/b1"].id, prior[2].id, "the record kept its doubt under another id");
  assert.equal(byUri["/mark/eu/c1"].id, "doubt:record-carry:unreasoned:3", "the new record took an id the ledger had already given");
  assert.ok(!r.doubts.some((d) => d.id === "doubt:record-carry:unreasoned:1"), "the settled id was handed to another record");
});

test("a trace that cannot be computed mints nothing again, and a ledger without the family keeps every doubt", () => {
  const r = recordCarryDoubtsAgain(before(), { computable: false });
  assert.deepEqual(r.doubts, [OTHER], "doubts minted from a trace no longer held were kept");
  assert.deepEqual(recordCarryDoubtsAgain([OTHER], trace()).doubts, [OTHER]);
});

test("a record that keeps its doubt keeps it wherever the rebuilt trace lists it: the cap limits only the new doubts", () => {
  // The pass minted 25 doubts, the cap's full count. The rebuilt trace lists five new records first and those 25 after them.
  const kept = Array.from({ length: 25 }, (_, i) => row(`/mark/eu/k${i + 1}`, "QZORVAK", `Kept Owner ${i + 1}`));
  const fresh = Array.from({ length: 5 }, (_, i) => row(`/mark/eu/n${i + 1}`, "QZORVAK", `New Owner ${i + 1}`));
  const prior = mintRecordCarryDoubts(trace(...kept)).doubts;
  assert.equal(prior.length, 25, "guard: the pass minted the cap's full count");
  const r = recordCarryDoubtsAgain(prior, trace(...fresh, ...kept));
  assert.deepEqual(r.doubts.map((d) => d.id).sort(), prior.map((d) => d.id).sort(), "a kept record lost its doubt to the cap");
  assert.deepEqual([r.fresh, r.dropped, r.minted, r.omitted], [[], [], 25, 5], "the cap took a kept doubt, or the left-out records are miscounted");
});
