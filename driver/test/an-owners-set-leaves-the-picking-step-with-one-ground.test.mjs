// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN OWNER'S SET LEAVES THE PICKING STEP WITH ONE GROUND (ruled 2026-09-25). The manual says: "Judge an
// owner's records as a set. … A record you do not carry is given a ground; no record leaves without one."
// The placement form had rows only for what is placed, so every record the step passed over left with "no
// ground for this record was recorded". On the test runs of the last month that was a median of 745
// records a run, behind a median of 364 owners.
//
// A set-aside row names one record of an owner and gives the set one ground. It is not a candidate and
// renders into no placement. Every record of that owner the form does not place leaves with the step's
// ground; a record that names no owner stands for its own position, never for every ownerless record.
// Driven through the real chain: the form union, the placement record, the ledger fold, the carry trace
// and the count of reason-less exits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncPlacementForm } from "../gateway.mjs";
import { readPlacementForm } from "../placement-form-io.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { buildSelectionIndex, setAsideGrounds, renderPlacementsJson, SET_ASIDE_ROW_CONTRACT } from "../placement-form.mjs";
import { placementSeamReason } from "../pipeline.mjs";
import { seamRows, foldDiscardLedger } from "../record-discard.mjs";
import { traceRecordCarry } from "../record-carry.mjs";
import { pickingExits } from "../hand-off-exits.mjs";

// Invented owners and marks. Owner A holds three positions, owner B two, and two records name no owner.
const pos = (records, mark, owner) => ({ records, mark_text: mark, owners: owner ? [owner] : [], owner_strings: [], classes: ["9"], territories: ["US"] });
const input = { floors: [], positions: [
  pos(["/mark/us/1001"], "TALVORIN", "Owner A Holdings"),
  pos(["/mark/us/1002"], "TALVORINE", "Owner A Holdings"),
  pos(["/mark/eu/1003", "/mark/us/1004"], "TALVOR", "Owner A Holdings"),
  pos(["/mark/us/2001"], "TALVARIN", "Owner B GmbH"),
  pos(["/mark/us/2002"], "TALVARINO", "Owner B GmbH"),
  pos(["/mark/us/3001"], "TALVORINA", null),
  pos(["/mark/us/3002"], "TALVORINO", null),
] };
const band = input.positions.flatMap((p) => p.records.map((uri) => ({ record_id: uri, mark_text: p.mark_text, owner_name: p.owners[0] ?? "", classes: ["9"] })));
const GROUND_A = "Owner A's marks are all for kitchen tools, nowhere near the client's software.";

const submitted = { rows: [
  { select: "/mark/us/1001", tier: "sheet-2", reason: "Owner A's one software filing, in class 9, completes the record but does not change the advice." },
  { set_aside: "/mark/us/1002", ground: GROUND_A },
  { set_aside: "/mark/us/3001", ground: "A lapsed filing with no owner on record, for garden furniture." },
  { set_aside: "/mark/us/9999", ground: "Not in the band." },
  { set_aside: "/mark/us/2001", ground: "  " },
] };

test("a set-aside row is kept apart from the candidates, and refused by id when it cannot stand", () => {
  const u = unionPlacementForm({ rows: [], set_aside: [] }, submitted, input);
  assert.deepEqual(u.form.rows.map((r) => r.records), [["/mark/us/1001"]], "a set-aside row became a candidate row");
  assert.equal(renderPlacementsJson(u.form.rows).placements.length, 1, "a set-aside row rendered into placements.json");
  assert.deepEqual(u.form.set_aside.map((e) => e.set_aside), ["/mark/us/1002", "/mark/us/3001"]);
  assert.deepEqual(u.form.set_aside_refused.map((e) => e.set_aside), ["/mark/us/9999", "/mark/us/2001"], "a row that cannot stand was dropped in silence");
  assert.equal(u.set_aside, 2);
  assert.deepEqual(u.form.set_aside_row_contract, SET_ASIDE_ROW_CONTRACT, "the form does not carry the row's contract for the next attempt");

  // The accumulator carries the grounds; a later ground for the same owner replaces the earlier one, and a
  // retraction by the record id removes one.
  const later = "Owner A files only for kitchen tools; none of its marks reaches software.";
  const u2 = unionPlacementForm({ rows: u.form.rows, set_aside: u.form.set_aside },
    { rows: [{ set_aside: "/mark/eu/1003", ground: later }, { retract: "/mark/us/3001" }] }, input);
  assert.deepEqual(u2.form.set_aside.map((e) => [e.set_aside, e.ground]), [["/mark/eu/1003", later]]);
  assert.equal(u2.form.rows.length, 1, "the placed candidate was lost when the grounds changed");
});

test("every unplaced record of a set-aside owner leaves with the ground, and the reason-less exits fall to the rest", () => {
  const u = unionPlacementForm({ rows: [], set_aside: [] }, submitted, input);
  const placed = renderPlacementsJson(u.form.rows).placements;
  const reasonFor = placementSeamReason(setAsideGrounds(u.form.set_aside, buildSelectionIndex(input)));
  const rows = seamRows({ seam: "placement", stage: "placement-inquiry", completed: true,
    saw: band.map((r) => ({ uri: r.record_id })), carried: placed.flatMap((p) => p.records.map((uri) => ({ uri }))), reasonFor });
  const ledger = foldDiscardLedger(rows.map((r) => JSON.stringify(r)).join("\n"));
  const trace = traceRecordCarry({ bandRecords: band, placements: placed, ledger });
  const byUri = new Map(trace.rows.map((r) => [r.uri, r]));

  for (const uri of ["/mark/us/1002", "/mark/eu/1003", "/mark/us/1004"]) {
    const r = byUri.get(uri);
    assert.equal(r.reason, "placement:set-aside", `${uri}: owner A's unplaced record did not take the set's ground`);
    assert.equal(r.reason_source, "step-stated");
    assert.ok(r.detail.includes("kitchen tools"), `${uri}: the ground is not in the trace`);
  }
  assert.notEqual(byUri.get("/mark/us/1001").stopped_at, "placement", "owner A's placed record stopped at placement");
  // The ownerless set-aside stands for its own position, and nothing else.
  assert.equal(byUri.get("/mark/us/3001").reason, "placement:set-aside");
  assert.equal(byUri.get("/mark/us/3002").reason_source, "step-silent", "one ownerless ground covered another ownerless record");

  const e = pickingExits(trace);
  assert.deepEqual(e.rows.map((r) => r.uri).sort(), ["/mark/us/2001", "/mark/us/2002", "/mark/us/3002"]);
  assert.equal(e.owners, 2, "owner B is one ground owed, and the ownerless record is its own");
});

test("with no set-aside row, a passed-over record still leaves as before, with no ground recorded", () => {
  const reasonFor = placementSeamReason(setAsideGrounds([], buildSelectionIndex(input)));
  const [row] = seamRows({ seam: "placement", stage: "placement-inquiry", completed: true, saw: [{ uri: "/mark/us/2001" }], carried: [], reasonFor });
  assert.equal(row.reason, "placement:not-selected");
  assert.equal(row.reason_source, "step-silent");
  assert.match(row.detail, /no ground for this record was recorded/);
});

test("a ground the step adds to the set-aside list it is shown, rather than as a row, is kept", (t) => {
  // The driver writes the form with its grounds as a top-level list, and that is the shape the step sees
  // on its next pass. A step that adds its row there, where it sees the others, must not lose it.
  const run = mkdtempSync(join(tmpdir(), "set-aside-list-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  mkdirSync(join(run, "_driver"), { recursive: true });
  writeFileSync(join(run, "_driver", "stage-contracts.json"), JSON.stringify({ "placement-inquiry": { placementForm: 1 } }));
  writeFileSync(join(run, "_driver", "register-positions.json"), JSON.stringify({ positions: input.positions }));
  writeFileSync(join(run, "_driver", "band-shape.json"), JSON.stringify({ floors: { in_class_identical_or_near: [] } }));
  const md = join(run, "placement-recommendations.md");
  writeFileSync(md, "# Placement\n");
  // Pass 1: the step answers with rows.
  writeFileSync(join(run, "placement-form.json"), JSON.stringify(submitted));
  assert.ok(syncPlacementForm([md]), "guard: the sync ran");
  assert.deepEqual(readPlacementForm(run).set_aside.map((e) => e.set_aside), ["/mark/us/1002", "/mark/us/3001"]);
  // Pass 2: the step opens the form the driver wrote and appends to the list it sees there.
  const shown = readPlacementForm(run);
  const onDisk = { rows: shown.rows, set_aside: [...shown.set_aside, { set_aside: "/mark/us/2001", ground: "Owner B's marks are for bicycles." }] };
  writeFileSync(join(run, "placement-form.json"), JSON.stringify(onDisk));
  syncPlacementForm([md]);
  const held = readPlacementForm(run).set_aside;
  assert.deepEqual(held.map((e) => e.set_aside), ["/mark/us/1002", "/mark/us/3001", "/mark/us/2001"], "a ground added to the list was dropped");
  assert.equal(held.find((e) => e.set_aside === "/mark/us/2001").ground, "Owner B's marks are for bicycles.");
});
