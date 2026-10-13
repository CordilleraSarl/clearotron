// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT THE FORM REFUSES REACHES THE STEP IN THE PASS (ruled 2026-10-12).
//
// On the third replay every placement pass ran one attempt. The form's refusals were written when the turn's
// judgement ran, after the step had finished, and the pass was accepted, so no step ever read them: two
// selects typed with another record's suffix, set-asides refused by name, and floors left with no fate. Floors
// the step had placed were lost too, because their records name no owner and a placement had to name one, and
// the form then counted those lines as placed. Now a record that names no owner is placed as the step placed
// it; a refused select is never read as a fate; every refusal is said back with its reason in the corrective
// turn, once; and a floor with no fate, below a thousand records, refuses the pass at every judgement until it
// has one. Driven through the turn's own judgement: the form union, the render, and the stage's validator.
// Every mark and owner here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncPlacementForm } from "../gateway.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { readPlacementFormInput } from "../placement-form-io.mjs";
import { validators } from "../verify.mjs";
import { buildBandShape, deriveRegisterPositions, CROWDED_GROUP_RECORDS } from "../band-shape.mjs";
import { setAsideKeysOf, OWNER_NOT_STATED } from "../placement-form.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";

const rec = (id, mark, owner, extra = {}) => ({ record_id: id, mark_text: mark, owner_name: owner, classes: ["9"], status: "registered", jurisdictions: ["EU"], ...extra });
const BAND = [
  rec("/mark/eu/a1", "QZORVAK", "Alpha Ltd"),                            // identical, for the client's goods: (a), a floor
  rec("/mark/eu/b1", "Qzorvak", "Beta GmbH"),                            // identical, in class, other goods: (b), a floor
  rec("/mark/eu/g1", "Qzorvak", "Gamma SA"),                             // Gamma's line: one position, and
  rec("/mark/gb/g2", "QZORVAK", "Gamma SA", { jurisdictions: ["GB"] }),  //   a GB record the positions fold did not reach
  rec("/mark/eu/o1", "Qzorvak", ""),                                     // identical, in class, no owner on the register
  rec("/mark/eu/d1", "Plimbo", "Delta AG"),                              // another live mark for the goods: (d)
];
const GOODS = { "/mark/eu/a1": "joysticks", "/mark/eu/d1": "joysticks" };
const DOC = ["# Candidate grouping — TESTMARK", "", "## Band reconciliation", "",
  "Padding so the specimen clears the nonEmpty floor and the structural arm is what decides it.", "",
  "## Headline candidates", "<!-- clearotron:section=placement-tiers -->", "", "- CANDIDATE", ""].join("\n");
const STAMP = { structuredPlacements: 1, placementForm: 1, placementAccount: 1, placementSaidBack: 1 };

function run(t, { stamp = STAMP } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "said-back-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  // The positions fold is best-effort: here it did not reach Gamma's GB record, which then resolves on its own,
  // through the floors, on the same line as Gamma's position.
  const positions = deriveRegisterPositions(BAND.filter((x) => x.record_id !== "/mark/gb/g2"));
  const goods = { of: (r) => [{ classes: r.classes, text: GOODS[r.record_id] ?? "printers" }],
    hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape } = buildBandShape({ enumerated: BAND }, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods,
    goodsWordCount: 1, keysOf: setAsideKeysOf(positions.positions), markets: ["EU"] });
  writeFileSync(join(dir, "_driver", "stage-contracts.json"), JSON.stringify({ "placement-inquiry": stamp }));
  writeFileSync(join(dir, "_driver", "register-positions.json"), JSON.stringify(positions));
  writeFileSync(join(dir, "_driver", "band-shape.json"), JSON.stringify(shape));
  // The step read every line the shape lists.
  const read = ["a", "b", "c", "d", "rest", "no_goods"].flatMap((g) => shape.groups[g].list.map((l) => l.key));
  writeFileSync(join(dir, "_driver", "reading-log.jsonl"), JSON.stringify({ tool: "band_lookup", ok: true, served_lines: read }) + "\n");
  const md = join(dir, "placement-recommendations.md");
  writeFileSync(md, DOC);
  // One turn: the step leaves its form, and the turn's judgement unions it, renders, and judges the pass.
  const turn = (form) => {
    if (form) writeFileSync(join(dir, "placement-form.json"), JSON.stringify(form));
    assert.ok(syncPlacementForm([md]), "guard: the judgement's union ran");
    return validators.placement(md, DOC);
  };
  const form = () => JSON.parse(readFileSync(join(dir, "_driver", "placement-form.form.json"), "utf8"));
  const placements = () => JSON.parse(readFileSync(join(dir, "placements.json"), "utf8")).placements;
  return { shape, turn, form, placements, dir };
}
const place = (id, tier = "sheet-2") => ({ select: id, tier, reason: "identical mark in class 9, live; completes the record" });
const EVERY_FLOOR = ["/mark/eu/a1", "/mark/eu/b1", "/mark/eu/g1", "/mark/gb/g2", "/mark/eu/o1"].map((id) => place(id));

test("guard: the band holds five floors on four lines, Gamma's line held as a position and a record outside it", (t) => {
  const { shape } = run(t);
  assert.deepEqual(shape.floors.in_class_identical_or_near.map((f) => f.record_id).sort(),
    ["/mark/eu/a1", "/mark/eu/b1", "/mark/eu/g1", "/mark/eu/o1", "/mark/gb/g2"]);
  const gamma = shape.groups.b.list.find((l) => l.owner_name === "Gamma SA");
  assert.deepEqual([gamma.records, gamma.floors], [2, 2], "one line, two records");
});

test("the form written before the step answers lists no floor; the first judgement says back what is owed", (t) => {
  const r = run(t);
  // The driver writes the form before the step's first turn, from no answer at all.
  const before = unionPlacementForm({ rows: [], set_aside: [] }, null, readPlacementFormInput(r.dir));
  assert.equal(before.form.floors_without_fate, undefined, "the step's first read held every floor of the band as owed");
  assert.equal(before.floors_without_fate, 5, "guard: all five are owed, and counted");
  const v = r.turn({ rows: [] });
  assert.match(v.reason, /^placement_floors_without_fate=5: /);
});

test("a floor the step placed whose record names no owner is placed as the step placed it", (t) => {
  const r = run(t);
  const v = r.turn({ rows: EVERY_FLOOR });
  assert.equal(v.ok, true, v.reason);
  const entry = r.placements().find((e) => e.records.includes("/mark/eu/o1"));
  assert.deepEqual([entry?.owner, entry?.tier], [OWNER_NOT_STATED, "sheet-2"], "the placement was refused for the owner the register does not state");
  assert.equal(r.form().floors_without_fate, undefined, "every floor has its fate");
});

test("a select the band does not hold refuses the pass with its reason, and is said back once", (t) => {
  const r = run(t);
  const v = r.turn({ rows: [...EVERY_FLOOR, place("/mark/eu/d1-typo")] });
  assert.equal(v.ok, false, "the step was never told its select named nothing");
  assert.match(v.reason, /^placement_refused=1: select \/mark\/eu\/d1-typo \(the band holds no record with this id\)/);
  assert.match(v.reason, /every other row stands/);
  assert.deepEqual(r.form().unresolved, [{ select: "/mark/eu/d1-typo", tier: "sheet-2", why: "the band holds no record with this id" }]);
  // The corrective turn leaves the form as the driver wrote it: the refusal was said, and is not said again.
  assert.equal(r.turn(null).ok, true, "a refusal the step dropped refused the pass a second time");
});

test("a floor with no fate below a thousand records refuses the pass at every judgement until it has one", (t) => {
  const r = run(t);
  // Gamma's line placed through its position only: the GB floor's own record is not on the form.
  const v1 = r.turn({ rows: EVERY_FLOOR.filter((x) => x.select !== "/mark/gb/g2") });
  assert.equal(v1.ok, false, "a floor the floor duty counts undischarged passed the placement pass");
  assert.match(v1.reason, /^placement_floors_without_fate=1: \/mark\/gb\/g2 in \(b\) — /);
  assert.match(v1.reason, /Only these are owed; every other row stands\./);
  assert.deepEqual(r.form().floors_without_fate, [{ group: "b", line: r.shape.groups.b.list.find((l) => l.owner_name === "Gamma SA").record_id, floors: ["/mark/gb/g2"] }]);
  assert.equal(r.turn(null).ok, false, "a floor said back and not acted on is refused again");
  assert.equal(r.turn({ rows: [place("/mark/gb/g2", "watchlist-annex")] }).ok, true, "placed, the floor has its fate and the pass stands");
});

test("a floor row whose tier the form refused is not read as placed: its group's row says it back, and the pass refuses", (t) => {
  const r = run(t);
  const v = r.turn({ rows: [...EVERY_FLOOR.filter((x) => x.select !== "/mark/eu/b1"), place("/mark/eu/b1", "out-of-scope-filtered"),
    { set_aside_group: "b", count: r.shape.groups.b.records, ground: "identical in class, for unrelated goods" }] });
  const b = r.form().set_aside_groups.find((g) => g.set_aside_group === "b");
  assert.deepEqual(b?.floors_not_covered, ["/mark/eu/b1"], "the refused row's line was counted as placed, so its floor was never said back");
  assert.deepEqual(r.form().floors_without_fate?.map((e) => e.floors), [["/mark/eu/b1"]]);
  // The step judged the row and the form refused its tier: the floor is said back, with why the tier was refused.
  assert.equal(v.ok, false);
  assert.match(v.reason, /^placement_floors_without_fate=1: \/mark\/eu\/b1 in \(b\) — /, "the refused tier was read as a row left unfinished");
  assert.match(v.reason, /The form also refused, each for the reason given: the tier on \/mark\/eu\/b1 \(an identical mark live in an ordered or frame-added class is never out-of-scope-filtered/);
});

test("a floor whose tier the form refused, left alone on the turns after, is said back as a floor and never fails as an unfinished row", (t) => {
  const r = run(t);
  const v1 = r.turn({ rows: [...EVERY_FLOOR.filter((x) => x.select !== "/mark/eu/b1"), place("/mark/eu/b1", "out-of-scope-filtered")] });
  assert.match(v1.reason, /^placement_floors_without_fate=1: \/mark\/eu\/b1 in \(b\) — /);
  // Turn 2: the step leaves the form as the driver wrote it. The stored row has no tier left, and the tier refusal
  // is not rebuilt, since nothing re-sent the tier.
  const v2 = r.turn(null);
  assert.match(v2.reason, /^placement_floors_without_fate=1: \/mark\/eu\/b1 in \(b\) — /, `turn 2 read the floor's row as unfinished: ${v2.reason}`);
  const v3 = r.turn({ rows: [] });
  assert.match(v3.reason, /^placement_floors_without_fate=1: \/mark\/eu\/b1 in \(b\) — /, `turn 3 read the floor's row as unfinished: ${v3.reason}`);
});

test("a pass whose only selection is a floor with its tier refused says the floor back, and is not refused as a lost register", (t) => {
  const r = run(t);
  const v = r.turn({ rows: [place("/mark/eu/b1", "out-of-scope-filtered")] });
  assert.match(v.reason, /^placement_floors_without_fate=5: /, `a floor said back was read as a register lost to its records' facts: ${v.reason}`);
});

test("a row left unfinished is refused as before, and the refusal names the floors with no fate too", (t) => {
  const r = run(t);
  const v = r.turn({ rows: [...EVERY_FLOOR.filter((x) => x.select !== "/mark/eu/b1"), { select: "/mark/eu/d1", tier: "sheet-2" }] });
  assert.match(v.reason, /^placement_unjudged=1: /, "guard: (d)'s row has no reason, and is not a floor");
  assert.match(v.reason, /The form gives these floors no fate either: \/mark\/eu\/b1 in \(b\)\. Place each by selecting that record, sheet-2 at the least, or set its line aside by name on its status or its territory\./,
    "the step learned of the floor a turn later than of the row");
});

test("a floor in a crowd of (a) is said back: only a crowd whose row may cover its floors stands on its count", () => {
  const n = CROWDED_GROUP_RECORDS;
  const band = Array.from({ length: n }, (_, i) => rec(`/mark/eu/a${i}`, "QZORVAK", `Owner ${String(i).padStart(4, "0")} Ltd`));
  const positions = deriveRegisterPositions(band);
  const goods = { of: () => [{ classes: ["9"], text: "joysticks" }], hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape } = buildBandShape({ enumerated: band }, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods, goodsWordCount: 1,
    keysOf: setAsideKeysOf(positions.positions), markets: ["EU"] });
  assert.equal(shape.groups.a.records, n, "guard: (a) is a crowd");
  const input = { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups };
  const u = unionPlacementForm(null, { rows: band.slice(1).map((x) => place(x.record_id)) }, input);
  assert.deepEqual(u.form.floors_without_fate?.map((e) => [e.group, e.floors]), [["a", ["/mark/eu/a0"]]], "a floor in a crowded (a) was never said back");
});

test("a set-aside the form refuses is said back in the pass with its reason", (t) => {
  const r = run(t);
  const v = r.turn({ rows: [...EVERY_FLOOR, { set_aside: "/mark/eu/d1", ground: "  " }] });
  assert.equal(v.ok, false);
  assert.match(v.reason, /^placement_refused=1: the row setting aside \/mark\/eu\/d1 \(no ground\)/);
});

test("an archived run without the stamp key replays to the verdict it was minted under", (t) => {
  const r = run(t, { stamp: { structuredPlacements: 1, placementForm: 1, placementAccount: 1 } });
  assert.equal(r.turn({ rows: [place("/mark/eu/a1"), place("/mark/eu/d1-typo")] }).ok, true, "no archived verdict moves");
});
