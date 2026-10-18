// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REVIEW IS TOLD THE FLOORS PLACEMENT SET ASIDE.
//
// The review checks the narrative's register assertions against the band tools, and a floor row the narrative
// neither rates nor reasons away is a flagged correction. A floor placement set aside under the ruled method, by
// name on its status or its territory, or under a crowd's row, is one the narrative may rightly not rate, and the
// review could flag it as a correction. Now the review is told which validated placement decisions account for a
// floor, each with its ground and the record it covers, and checks those grounds against the evidence (ruled
// 2026-10-18). Only a decision that stands on the shape now on disk is listed; a floor with no standing decision is
// flagged as before. Every mark and owner is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paths, STAGES } from "../stages.mjs";
import { buildBandShape, deriveRegisterPositions } from "../band-shape.mjs";
import { setAsideKeysOf, renderPlacementsJson } from "../placement-form.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { writePlacementForm } from "../placement-form-io.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";
import { placementFloorDecisionLines, messageCtxFor } from "../pipeline.mjs";
import { repairFollowup } from "../repair-composers.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const rec = (id, mark, owner, extra = {}) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes: ["9"],
  status: "registered", jurisdictions: ["EU"], ...extra });
const BAND = [
  rec("a1", "QZORVAK", "Alpha Ltd"),      // a floor: placed
  rec("b1", "Qzorvak", "Beta GmbH"),      // a floor: set aside by name on its status
  rec("c1", "QZORVAK", "Gamma SA"),       // a floor: no fate
  rec("r1", "Drellux", "Delta AG"),       // the rest
];
const GOODS = { a1: "joysticks", b1: "printers", c1: "printers", r1: "printers" };

function seedRun(t, rows, { band = BAND, goodsOf = GOODS, later = [] } = {}) {
  const runDir = mkdtempSync(join(tmpdir(), "review-floors-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const positions = deriveRegisterPositions(band);
  const goods = { of: (r) => { const g = goodsOf[r.record_id.split("/").pop()]; return g ? [{ classes: ["9"], text: g }] : null; },
    hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape } = buildBandShape({ enumerated: band }, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods, keysOf: setAsideKeysOf(positions.positions) });
  const read = ["a", "b", "c", "d", "rest", "no_goods"].flatMap((g) => shape.groups[g].list.map((l) => l.key));
  const input = { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups,
    served: { lines: new Set(read), records: new Set() } };
  let u = unionPlacementForm(null, { rows }, input);
  for (const more of later) u = unionPlacementForm(u.form, { rows: more }, input);
  const P = paths(runDir);
  writeFileSync(P.registerNamedBand, JSON.stringify({ enumerated: band, crowds: [] }));
  writeFileSync(P.bandShape, JSON.stringify(shape));
  writeFileSync(P.registerPositions, JSON.stringify(positions));
  writePlacementForm(runDir, u.form);
  writeFileSync(driverDir(runDir, "reading-log.jsonl"), JSON.stringify({ ts: "2026-10-18T00:00:00Z", tool: "band_shape", args: { format: "md" },
    ok: true, part: 1, parts: 1, served_lines: read, session: "clearance-x-y-placement-inquiry" }) + "\n");
  writeFileSync(P.placementModel, JSON.stringify(renderPlacementsJson(u.form.rows)));
  return { P, shape };
}

test("only the floors whose set-aside stands are listed, each with its ground and the record it covers", (t) => {
  const { P, shape } = seedRun(t, [
    { select: "/mark/eu/a1", tier: "headline-candidate", reason: "identical, live, for the client's own goods" },
    { set_aside: "/mark/eu/b1", ground: "the registration expired in 2019", on: "status" },
    { set_aside_group: "rest", count: 1, ground: "similar to none of the mark's forms" },
  ]);
  assert.deepEqual(shape.floors.in_class_identical_or_near.map((f) => f.record_id).sort(), ["/mark/eu/a1", "/mark/eu/b1", "/mark/eu/c1"], "guard: three floors");
  assert.deepEqual(placementFloorDecisionLines(P), ["- Qzorvak — Beta GmbH (/mark/eu/b1): set aside on its status: the registration expired in 2019"],
    "a placed floor, or one with no fate, is not a set-aside decision");
});

test("with no floor set aside, the list is empty", (t) => {
  const { P } = seedRun(t, [{ select: "/mark/eu/a1", tier: "headline-candidate", reason: "identical, live" }]);
  assert.deepEqual(placementFloorDecisionLines(P), []);
});

test("a floor a later pass placed is not listed as set aside, though the form still holds the first pass's ground", (t) => {
  const { P } = seedRun(t, [
    { select: "/mark/eu/a1", tier: "headline-candidate", reason: "identical, live, for the client's own goods" },
    { set_aside: "/mark/eu/b1", ground: "the registration expired in 2019", on: "status" },
  ], { later: [[{ select: "/mark/eu/b1", tier: "sheet-2", reason: "near-identical, live in the class" }]] });
  assert.deepEqual(placementFloorDecisionLines(P), [], "the review is told a placed floor was set aside");
});

test("a floor set aside on its territory is listed with that ground", (t) => {
  const { P } = seedRun(t, [
    { select: "/mark/eu/a1", tier: "headline-candidate", reason: "identical, live, for the client's own goods" },
    { set_aside: "/mark/eu/b1", ground: "the registration covers only Japan, outside the ordered territories", on: "territory" },
  ]);
  assert.deepEqual(placementFloorDecisionLines(P), ["- Qzorvak — Beta GmbH (/mark/eu/b1): set aside on its territory: the registration covers only Japan, outside the ordered territories"]);
});

test("a floor a crowd's row covers is listed as covered by that group's row", (t) => {
  // A thousand or more identical marks for goods the client does not sell: group (b), crowded, whose row may cover
  // its floors.
  const N = 1001;
  const band = [rec("a1", "QZORVAK", "Alpha Ltd"), ...Array.from({ length: N }, (_, i) => rec(`m${i}`, "QZORVAK", `Owner ${i} Ltd`))];
  const goodsOf = { a1: "joysticks", ...Object.fromEntries(Array.from({ length: N }, (_, i) => [`m${i}`, "printers"])) };
  const { P, shape } = seedRun(t, [
    { select: "/mark/eu/a1", tier: "headline-candidate", reason: "identical, live, for the client's own goods" },
    { set_aside_group: "b", count: N, ground: "identical marks in the class for goods unrelated to the client's" },
  ], { band, goodsOf });
  assert.equal(shape.groups.b.records, N, "guard: the crowd is in (b)");
  const lines = placementFloorDecisionLines(P);
  assert.equal(lines.length, N, "every floor the row covers is listed");
  assert.equal(lines[0], "- QZORVAK — Owner 0 Ltd (/mark/eu/m0): covered by group (b)'s row: identical marks in the class for goods unrelated to the client's");
});

const SENTENCE = "Check the narrative's register assertions against them. A floor row the narrative neither rates nor reasons away is a FLAGGED CORRECTION unless a validated placement decision already accounts for it under the placement rules. Those decisions are listed below with their grounds and the records they cover. Check those grounds against the evidence; flag an unsupported decision.";
const LINES = ["- Qzorvak — Beta GmbH (/mark/eu/b1): set aside on its status: the registration expired in 2019",
  "- QZORVAK — Omega Ltd (/mark/eu/m1): covered by group (b)'s row: identical marks in the class for goods unrelated to the client's"];

test("the full review reads the sentence and the decisions under it; with none, it says so", () => {
  const P = paths("/run");
  const at = (decisions) => String(STAGES["narrative-refutation"].message({ paths: P, intakeAsks: [], job: {}, registerOnly: false, profileSelection: null,
    placementFloorDecisions: decisions }));
  const text = at(LINES);
  assert.ok(text.includes(SENTENCE));
  assert.ok(text.includes(`${SENTENCE} They are read-only and logged; you hold no live register tools (by design, never an outage).\n${LINES[0]}\n${LINES[1]}\n`),
    "the decisions follow the sentence, one per line");
  assert.ok(!text.includes("neither rates nor reasons away is a FLAGGED CORRECTION."), "the old sentence, without its exception, is gone");
  assert.ok(at([]).includes("(by design, never an outage).\n(none)\n"));
});

test("the review after a repair reads the same sentence and decisions", () => {
  const text = String(repairFollowup("narrative-refutation:post-repair-review", { findings: "/run/findings.json", changes: [], resting: [],
    renumbered: false, coverageChanged: false, evidence: {}, registerOnly: false, job: {}, skepticFlags: "/run/sf.md", frameReopenReceipt: "/run/fr.json",
    floorDecisions: LINES }));
  assert.ok(text.includes(SENTENCE));
  assert.ok(text.includes(`${LINES[0]}\n${LINES[1]}\n`));
});

test("each time the review's message is built, the list is read from the run as it stands then, never from a copy on the context", (t) => {
  const { P } = seedRun(t, [
    { select: "/mark/eu/a1", tier: "headline-candidate", reason: "identical, live, for the client's own goods" },
    { set_aside: "/mark/eu/b1", ground: "the registration expired in 2019", on: "status" },
  ]);
  const message = (ctx) => String(STAGES["narrative-refutation"].message({ intakeAsks: [], job: {}, registerOnly: false, profileSelection: null, ...ctx }));
  const stale = { paths: P, placementFloorDecisions: ["- a decision an earlier pass left on the context"] };
  const built = messageCtxFor("narrative-refutation", stale);
  assert.deepEqual(built.placementFloorDecisions, ["- Qzorvak — Beta GmbH (/mark/eu/b1): set aside on its status: the registration expired in 2019"]);
  assert.ok(message(built).includes("(/mark/eu/b1): set aside on its status"));
  assert.ok(!message(built).includes("an earlier pass left"), "the review read a stale copy");
  assert.ok(!message(messageCtxFor("narrative-refutation", { paths: P })).includes("(by design, never an outage).\n(none)\n"),
    "a context that never set the list read \"(none)\" while a decision stands");
  // A later pass places the floor: a build from that run reads the reversal, whatever the context still carries.
  const { P: placedRun } = seedRun(t, [
    { select: "/mark/eu/a1", tier: "headline-candidate", reason: "identical, live, for the client's own goods" },
    { set_aside: "/mark/eu/b1", ground: "the registration expired in 2019", on: "status" },
  ], { later: [[{ select: "/mark/eu/b1", tier: "sheet-2", reason: "near-identical, live in the class" }]] });
  assert.deepEqual(messageCtxFor("narrative-refutation", { ...stale, paths: placedRun, placementFloorDecisions: built.placementFloorDecisions }).placementFloorDecisions, [],
    "the review was told a floor placement now places was set aside");
  assert.equal(messageCtxFor("synthesis", stale), stale, "another stage composes from its context as it is");
});
