// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// #1117 — the FLOOR DUTY reconciler.
//
// The floors are the one uncapped obligation in placement-inquiry's doctrine and nothing checked them.
// Measured on two delivered runs (2026-08-20): 45 of 207 floor rows on one and 99 of 225 on the
// next never reached the placement form, every one a LIVE filing, one of them normalized-equal
// to the target and pending in the EU across six classes.
//
// WHAT THIS FILE IS MOSTLY DEFENDING. The obligation used to read "placed or explicitly reasoned away",
// and the second half is prose. On those runs 39 of the 45 missing marks ARE discussed in the
// recommendations and 0 of the 45 record ids are named — so a prose matcher cannot tell "discussed" from
// "reasoned away", and two of my own prose matchers on this exact data were wrong before I caught them
// (a line-wrap split "Unity\nTechnologies"; a prefix list omitted `phonetic`). The owner ruling of
// 2026-08-20 narrowed the duty to a ROW ON A FORM, which is why nothing here reads prose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileFloorDuty, floorDutyEvent, FLOOR_DUTY_SCHEMA_VERSION, armFloorDuty, floorDutyArmed, FLOOR_DUTY_STAMP, floorDutyBlock, floorDutyBlocksSkip, FLOOR_DUTY_STAGE } from "../floor-duty.mjs";
import { readFileSync, mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { driverDir } from "../../shared/driver-dir.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const floor = (id, over = {}) => ({
  record_id: id, mark_text: "CHROME", owner_name: "Someone Ltd", registry: "CN",
  basis: "normalized-equal", status: "REGISTERED", live: true, ...over,
});
const placed = (uris, over = {}) => ({
  mark: "CHROME", owner: "Someone Ltd", jurisdiction: "CN", records: uris,
  tier: "sheet-2", reason: "same field, real overlap", ...over,
});

test("#1117 a floor named on the form with a ground is ACCOUNTED", () => {
  const a = reconcileFloorDuty({ floors: [floor("/mark/cn/A")], placements: [placed(["/mark/cn/A"])] });
  assert.equal(a.totals.floors, 1);
  assert.equal(a.totals.accounted, 1);
  assert.equal(a.totals.unanswered, 0);
  assert.equal(a.rows[0].disposition, "accounted");
  assert.equal(a.rows[0].tier, "sheet-2");
});

test("#1117 a floor no placement names is UNANSWERED — the defect this exists to see", () => {
  const a = reconcileFloorDuty({ floors: [floor("/mark/cn/A")], placements: [placed(["/mark/cn/OTHER"])] });
  assert.equal(a.totals.unanswered, 1);
  assert.equal(a.totals.accounted, 0);
  assert.equal(a.rows[0].disposition, "unanswered");
  assert.equal(a.rows[0].tier, null, "an unanswered floor has no tier to report");
  assert.equal(a.rows[0].mark, "CHROME", "…and the row still carries what a reader needs to chase it");
  assert.equal(a.rows[0].live, true);
});

// THE RULING'S OWN CASE: ruling a floor OUT discharges the duty exactly as placing it does. If this ever
// fails, the check is demanding placement rather than an answer, which is not what was ruled.
test("#1117 out-of-scope-filtered with a ground DISCHARGES the duty, exactly like any other tier", () => {
  const a = reconcileFloorDuty({
    floors: [floor("/mark/cn/A")],
    placements: [placed(["/mark/cn/A"], { tier: "out-of-scope-filtered", reason: "toys; no overlap with class 9" })],
  });
  assert.equal(a.totals.accounted, 1);
  assert.equal(a.totals.unanswered, 0);
  assert.equal(a.by_tier["out-of-scope-filtered"], 1);
});

// The tier is NOT the test. A tier this build has never heard of still discharges the duty — the seat
// answered for the row. Pinned so nobody "tightens" it into a tier allowlist, which would couple this
// module to a vocabulary it deliberately does not import.
test("#1117 an UNKNOWN tier still discharges the duty — the answer is the test, not the label", () => {
  const a = reconcileFloorDuty({
    floors: [floor("/mark/cn/A")],
    placements: [placed(["/mark/cn/A"], { tier: "some-tier-from-2027" })],
  });
  assert.equal(a.totals.accounted, 1);
  assert.equal(a.by_tier["some-tier-from-2027"], 1);
});

test("#1117 a floor named with NO ground is its own disposition, never accounted", () => {
  for (const reason of ["", "   ", null, undefined]) {
    const a = reconcileFloorDuty({ floors: [floor("/mark/cn/A")], placements: [placed(["/mark/cn/A"], { reason })] });
    assert.equal(a.totals.named_without_ground, 1, `reason ${JSON.stringify(reason)} is not a ground`);
    assert.equal(a.totals.accounted, 0);
    assert.equal(a.rows[0].disposition, "named-without-ground");
  }
});

// A floor the BAND could not identify is not a floor the SEAT failed to answer. Counted as undischarged
// either way — the duty is not met — but distinguished on the row so nobody chases the seat for a row it
// was never given.
test("#1117 a floor row with no record id is UNANSWERABLE and says so", () => {
  const a = reconcileFloorDuty({ floors: [floor("")], placements: [] });
  assert.equal(a.rows[0].disposition, "no-record-id");
  assert.equal(a.totals.unanswered, 1, "still undischarged — it is not quietly forgiven");
});

test("#1117 record ids match case-insensitively, the way placement uris are normalised", () => {
  const a = reconcileFloorDuty({
    floors: [floor("/MARK/CN/AbC")], placements: [placed(["/mark/cn/abc"])],
  });
  assert.equal(a.totals.accounted, 1,
    "a case difference between the band and the form is not a missing answer — entryUris lowercases, "
    + "so this side must too or every comparison is a false miss");
});

test("#1117 one uri named by two placements is one duty, discharged once", () => {
  const a = reconcileFloorDuty({
    floors: [floor("/mark/cn/A")],
    placements: [placed(["/mark/cn/A"]), placed(["/mark/cn/A"], { tier: "headline-candidate" })],
  });
  assert.equal(a.totals.floors, 1);
  assert.equal(a.totals.accounted, 1);
  assert.equal(a.reconciles, true);
});

// EMPTY IS AN ANSWER, ABSENT IS NOT — and only the first reaches this function. A band that held no live
// in-class identical record reconciles at 0/0 and is a clean pass. The ABSENT case never gets here: it is
// the caller's `computable:false`, and because `deriveFloorDuty` is internal to pipeline.mjs the guards
// are pinned by shape at the bottom of this file rather than by calling it.
test("#1117 an EMPTY floors slice reconciles at zero and is a real answer", () => {
  const a = reconcileFloorDuty({ floors: [], placements: [placed(["/mark/cn/X"])] });
  // `unanswerable` joined this shape when the duty became a delivery floor (tracker issue 1955). The
  // assertion stays a whole-object deepEqual rather than relaxing to a subset: this pin is what says a
  // reader knows every field, and a subset match would let the next field arrive unnoticed.
  assert.deepEqual(a.totals, { floors: 0, accounted: 0, named_without_ground: 0, unanswered: 0, unanswerable: 0 });
  assert.equal(a.reconciles, true);
  assert.equal(a.undischarged_by_seat, 0, "and an empty floor owes the seat nothing");
  assert.equal(a.computable, true, "nothing was missing — the band answered, and its answer was none");
});

test("#1117 every floor lands in exactly one disposition and the counts reconcile", () => {
  const a = reconcileFloorDuty({
    floors: [floor("/mark/cn/A"), floor("/mark/cn/B"), floor("/mark/cn/C"), floor("")],
    placements: [placed(["/mark/cn/A"]), placed(["/mark/cn/B"], { reason: "  " })],
  });
  assert.equal(a.totals.floors, 4);
  assert.equal(a.totals.accounted, 1);
  assert.equal(a.totals.named_without_ground, 1);
  assert.equal(a.totals.unanswered, 2, "one never named, one with no record id");
  assert.equal(a.reconciles, true);
  assert.equal(a.rows.length, 4, "one row per floor, always — the artifact is a census, not a filter");
});

// The event is what a run-log reader sees. A `computable:false` row carrying zeros would read as "every
// floor accounted for", which is the exact inversion an absence must never be allowed to make.
test("#1117 the run-log row for a NON-computable derivation carries no counts", () => {
  const e = floorDutyEvent({ trigger: "t", reason: "no band-shape.json" });
  assert.equal(e.computable, false);
  assert.equal(e.reason, "no band-shape.json");
  for (const k of ["floors", "accounted", "unanswered", "named_without_ground"])
    assert.equal(e[k], undefined, `${k} must be ABSENT, not 0 — a zero here reads as a clean floor`);
});

test("#1117 the run-log row for a computed derivation carries the counts and the reconciliation", () => {
  const a = reconcileFloorDuty({ floors: [floor("/mark/cn/A")], placements: [] });
  const e = floorDutyEvent({ trigger: "t", artifact: a });
  assert.equal(e.computable, true);
  assert.equal(e.floors, 1);
  assert.equal(e.unanswered, 1);
  assert.equal(e.reconciles, true);
});

test("#1117 the schema version is stated on the artifact", () => {
  assert.equal(reconcileFloorDuty({ floors: [], placements: [] }).schema_version, FLOOR_DUTY_SCHEMA_VERSION);
});

// Defensive: this reads two artifacts written by other code, and a malformed one must not throw inside a
// disclosure-only derivation.
test("#1117 malformed inputs do not throw", () => {
  for (const args of [{}, { floors: null, placements: null }, { floors: [null], placements: [null] },
                      { floors: [{}], placements: [{ records: null }] }]) {
    const a = reconcileFloorDuty(args);
    assert.equal(typeof a.totals.floors, "number");
    assert.equal(a.reconciles, true);
  }
});

// ── the caller's three-state, pinned by shape ─────────────────────────────────────────────────────────
//
// `deriveFloorDuty` is internal to pipeline.mjs, so this cannot call it. What must not silently rot is
// that a MISSING input routes to `notComputable` rather than to a reconcile over `[]` — which would
// write "0 floors, 0 unanswered" and read as a clean floor. That inversion is the whole risk, so the
// guards are asserted to exist, WITH a control that fails if this test is looking at the wrong text.
const PIPELINE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline.mjs"), "utf8");
const DERIVE = PIPELINE.slice(PIPELINE.indexOf("function deriveFloorDuty"),
  PIPELINE.indexOf("function derivePlacementCarry"));

test("#1117 the derivation is READ and it is the right function — the control for the arms below", () => {
  assert.ok(DERIVE.length > 400 && DERIVE.length < 6000,
    `deriveFloorDuty not isolated from pipeline.mjs (got ${DERIVE.length} chars) — every arm below would `
    + "pass or fail on the wrong text");
  assert.match(DERIVE, /reconcileFloorDuty\(/, "and it is the function that calls the reconciler");
});

test("#1117 a MISSING input routes to notComputable, never to a reconcile over nothing", () => {
  for (const [what, guard] of [["band-shape.json", /!existsSync\(P\.bandShape\)[\s\S]{0,120}?notComputable/],
                               ["placements.json", /!existsSync\(P\.placementModel\)[\s\S]{0,140}?notComputable/]]) {
    assert.match(DERIVE, guard,
      `an absent ${what} must be recorded as "could not compute". Reconciling over an empty list instead `
      + "writes 0 unanswered, and a reader cannot tell that from a floor that was fully answered.");
  }
  // The floors slice specifically: present-but-not-an-array is the half-read case, and it is NOT the
  // same as an empty array. Both reach this function; only one of them is an answer.
  assert.match(DERIVE, /Array\.isArray\(slice\)[\s\S]{0,140}?notComputable/,
    "a band-shape.json with no floors array is unanswerable, not zero floors");
  // NEGATIVE CONTROL: the empty-but-present case must NOT be sent to notComputable, or a band that
  // genuinely held no floors would be reported as unreadable forever.
  assert.doesNotMatch(DERIVE, /slice\.length\s*===?\s*0[\s\S]{0,80}?notComputable/,
    "an EMPTY floors slice is a real answer and must reconcile at 0/0, not refuse");
});

test("#1117 the derivation is disclosure-only — it cannot gate, re-tier or send a followup", () => {
  for (const forbidden of [/\bmust\(/, /repairFollowup\(/, /\bthrow\b/]) {
    assert.doesNotMatch(DERIVE, forbidden,
      `deriveFloorDuty must not ${forbidden.source} — it annotates and never re-decides, the same posture `
      + "as placement-carry beside it");
  }
});

// ── #1955 — THE DUTY BECAME A DELIVERY FLOOR, AND THESE ARE THE ARMS THAT LET IT BE ONE ─────────────
//
// The posture arm above still stands and is still correct: `deriveFloorDuty` cannot gate, re-tier or
// send a followup. That was NOT loosened. Enforcement lives at the pre-verdict floor, where a throw
// costs no artifact — a derivation that throws loses the very account the floor reads.

test("#1955 the era stamp is written, read back, and says nothing about counts", () => {
  const runDir = mkdtempSync(join(tmpdir(), "prelim-floorstamp-"));
  assert.equal(floorDutyArmed(runDir), false, "an unstamped run is NOT armed — the archived and knockout case");
  assert.equal(armFloorDuty(runDir), true);
  assert.equal(floorDutyArmed(runDir), true);
  const stamp = JSON.parse(readFileSync(driverDir(runDir, FLOOR_DUTY_STAMP), "utf8"));
  assert.match(stamp._provenance, /placement pass on this run ran/);
  // NO COUNT IN THE STAMP. A number here would be a second copy of the artifact's own arithmetic, and
  // the two would eventually disagree about the same run.
  for (const k of ["floors", "unanswered", "undischarged", "count"]) {
    assert.equal(stamp[k], undefined, `the stamp must carry no \`${k}\` — the artifact owns the counts`);
  }
  rmSync(runDir, { recursive: true, force: true });
});

test("#1955 UNANSWERABLE rows are counted apart and excluded from the seat's share", () => {
  // The distinction a disclosure could keep on the row and a floor cannot. A floor row with no record id
  // is undischarged and unanswerable: blocking a run on it fails the seat for a band defect, and the
  // repair it implies can be performed by nobody.
  const a = reconcileFloorDuty({
    floors: [{ record_id: "/mark/eu/1", mark_text: "A" }, { mark_text: "NO ID" }],
    placements: [],
  });
  assert.equal(a.totals.floors, 2);
  assert.equal(a.totals.unanswered, 2, "both are undischarged, and that reading is unchanged");
  assert.equal(a.totals.unanswerable, 1, "…but only one of them was ever the seat's to answer");
  assert.equal(a.undischarged_by_seat, 1, "and the floor counts that one");
  assert.equal(a.reconciles, true, "the four-way sum still reconciles — the new field is additive");
});

test("#1955 named-without-ground IS the seat's share — the half no real run has ever exercised", () => {
  // DRIVEN SYNTHETICALLY ON PURPOSE. Across every run directory measured, `named_without_ground` is 0 on
  // all of them: every undischarged floor in the wild is `unanswered`. So this arm of the refusal ships
  // with no real data behind it, and without this it would ship unproven in both directions.
  const named = reconcileFloorDuty({
    floors: [{ record_id: "/mark/eu/1", mark_text: "A" }],
    placements: [{ records: ["/mark/eu/1"], reason: "   ", tier: "sheet-2" }],   // named, whitespace ground
  });
  assert.equal(named.totals.named_without_ground, 1);
  assert.equal(named.totals.unanswered, 0, "it was NAMED — this is not the unanswered shape");
  assert.equal(named.undischarged_by_seat, 1, "and it counts against the seat, which is the point");
  // the control: the SAME row with a real ground discharges, so the arm above is not passing on the
  // reconciler simply refusing everything.
  const ok = reconcileFloorDuty({
    floors: [{ record_id: "/mark/eu/1", mark_text: "A" }],
    placements: [{ records: ["/mark/eu/1"], reason: "Ruled out on goods: class 5 pharma vs our class 9.", tier: "sheet-2" }],
  });
  assert.equal(ok.undischarged_by_seat, 0);
  assert.equal(ok.totals.accounted, 1);
});

test("#1955 a fully discharged floor leaves the seat's share at zero", () => {
  const r = reconcileFloorDuty({
    floors: [{ record_id: "/mark/eu/1" }, { record_id: "/mark/eu/2" }],
    placements: [{ records: ["/mark/eu/1", "/mark/eu/2"], reason: "Both weighed and placed on the form.", tier: "sheet-2" }],
  });
  assert.equal(r.undischarged_by_seat, 0, "nothing for the floor to block on");
});

// ── the FLOOR's predicate, DRIVEN ───────────────────────────────────────────────────────────────────
//
// These pass states in and read the answer, so disarming the check goes red. The first cut asserted the
// pipeline's SOURCE TEXT instead — and `if (false && floorDutyArmed(…))` leaves every asserted string in
// place, so all three arms stayed green over a floor that could no longer block. That is the defect this
// whole issue is about, committed inside its own test file; the predicate was extracted so it could not
// be repeated.
const DIRTY = () => reconcileFloorDuty({
  floors: [{ record_id: "/mark/eu/1", mark_text: "ALPHA" }, { record_id: "/mark/eu/2", mark_text: "BETA" }],
  placements: [{ records: ["/mark/eu/1"], reason: "Weighed and placed.", tier: "sheet-2" }],
});

test("#1955 an ARMED run with an undischarged floor blocks, and names the rows", () => {
  const b = floorDutyBlock(DIRTY(), { armed: true });
  assert.ok(b, "this is the state the floor exists for");
  assert.equal(b.undischarged, 1);
  assert.equal(b.floors, 2);
  assert.match(b.sample, /BETA \(\/mark\/eu\/2\)/, "the message names the row, not just a count");
});

test("#1955 an UNARMED run never blocks, whatever its floor says", () => {
  // 19 of 24 run directories on the box compute nothing, and absence there means a knockout run more
  // often than an old one — so absence can be read as neither clean nor dirty.
  assert.equal(floorDutyBlock(DIRTY(), { armed: false }), null);
  assert.equal(floorDutyBlock(DIRTY(), {}), null, "and the default is NOT armed");
});

test("#1955 a could-not-look never blocks — it is not a clean floor and not a dirty one", () => {
  assert.equal(floorDutyBlock({ computable: false, reason: "no band-shape.json" }, { armed: true }), null);
  assert.equal(floorDutyBlock(null, { armed: true }), null);
  assert.equal(floorDutyBlock(undefined, { armed: true }), null);
});

test("#1955 a floor undischarged ONLY by unanswerable rows does not block", () => {
  // The band gave the seat nothing to name, so no seat behaviour could have closed it and the repair it
  // implies can be performed by nobody. It is disclosed in the message and excluded from the count.
  const a = reconcileFloorDuty({ floors: [{ mark_text: "NO ID" }], placements: [] });
  assert.equal(a.totals.unanswered, 1, "still undischarged, and still reported as such");
  assert.equal(floorDutyBlock(a, { armed: true }), null, "…and still not the seat's to answer");
});

test("#1955 a clean floor on an armed run does not block", () => {
  const clean = reconcileFloorDuty({
    floors: [{ record_id: "/mark/eu/1" }],
    placements: [{ records: ["/mark/eu/1"], reason: "Weighed and placed.", tier: "sheet-2" }],
  });
  assert.equal(floorDutyBlock(clean, { armed: true }), null);
});

test("tracker 1988 the floor DELIVERS AND CLAMPS at the site, and no longer throws", () => {
  // THIS ARM USED TO PIN THE OPPOSITE, and the replacement is deliberate rather than a re-stamp. It
  // read `failClass: "deterministic"` off the throw, on the reasoning that a missed classification buys
  // a futile pipeline resume. There is no throw now: the owner ruled that a terminal guard delivers
  // with the defect named rather than withholding, after a live run died at delivery on ONE
  // undischarged row. A failure class is the right thing to pin about a failure and the wrong thing to
  // keep pinning once the failure is gone.
  //
  // Read off the source because the routing is the CALLER's, and carried with the control that the
  // right block was isolated.
  //
  // ANCHORED ON THE PROSE, NOT ON THE ISSUE NUMBER. The heading carried a bare issue reference and the
  // public cut strips those from comments, so the old anchor stopped existing and `indexOf` returned -1
  // — and `slice(-1, …)` is not an error, it is a window measured from the END of the file. The length
  // control below is the only reason this arm went red rather than asserting confidently about unrelated
  // text. Both markers now refuse by name first, so the reason is legible without reading a char count.
  const FLOOR_AT = PIPELINE.indexOf("THE FLOOR DUTY, DISCLOSED AND CLAMPED AT DELIVERY");
  assert.notEqual(FLOOR_AT, -1,
    "the floor block's heading is gone from pipeline.mjs — a missing anchor is a refusal here, never a "
    + "window from the end of the file that the arms below would then read as the floor");
  // A UNIQUE end marker, and the first attempt was not one: the bare "// PR-3 (report voice)" occurs
  // again further down the file, so indexOf found THAT one, the slice ran backwards and returned 0
  // characters. A source scan whose markers are not unique reads the wrong text and asserts confidently
  // about it.
  const FLOOR_END = PIPELINE.indexOf("// PR-3 (report voice) — the factual open-state clause per reason");
  assert.notEqual(FLOOR_END, -1, "the floor block's end marker is gone, so the block has no bound");
  const FLOOR = PIPELINE.slice(FLOOR_AT, FLOOR_END);
  assert.ok(FLOOR.length > 800 && FLOOR.length < 9000,
    `the floor block was not isolated (got ${FLOOR.length} chars) — the arms below would read the wrong text`);
  assert.match(FLOOR, /floor_duty_undischarged:/, "and it is the block that names the floor's defect token");
  assert.match(FLOOR, /floorDutyBlock\(/, "…and it calls the predicate rather than re-deriving one");
  assert.match(FLOOR, /deliverAndClamp\(/, "…and it routes the defect through the deliver-and-clamp decision");
  assert.ok(!/throw new StageFailure/.test(FLOOR),
    "the floor block throws again — a terminal guard that withholds is the defect tracker 1988 removed, and it "
    + "cost a client a whole report on a one-record gap");
});
// ── tracker issue 2004 — AN UNDISCHARGED DUTY MAKES THE OUTPUT UNFIT TO SKIP ────────────────────────
//
// Two parts of the engine disagreed about "valid" for one placement pass. On resume the stage skipped —
// output present, own validator satisfied — while the delivery floor called that same pass's duty
// undischarged. The seat was never dispatched again, so the duty became permanently undischargeable and
// the run travelled every remaining stage toward a failure it was doomed to on resume. One measured run
// spent 5.55 hours reaching a verdict it could not deliver.
//
// The predicate must BLOCK the skip in exactly that state, and fail OPEN in every other — it may cost a
// re-run of one stage and must never be the reason a resume cannot proceed.
const dutyRun = (artifact, { arm = true } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "floor-duty-skip-"));
  // `_driver/` unconditionally: armFloorDuty creates it, and the UNARMED case must still be able to place
  // an artifact beside it — otherwise the fixture cannot build the very state it is testing.
  mkdirSync(driverDir(dir, "."), { recursive: true });
  if (arm) armFloorDuty(dir);
  if (artifact) writeFileSync(driverDir(dir, "floor-duty.json"), JSON.stringify(artifact, null, 2) + "\n");
  return dir;
};
const UNDISCHARGED = { computable: true, undischarged_by_seat: 1,
  totals: { floors: 45, named_without_ground: 0, unanswerable: 0 },
  rows: [{ disposition: "unanswered", mark: "PROBEMARK", record_id: "/mark/em/PROBE" }] };
const DISCHARGED = { computable: true, undischarged_by_seat: 0, totals: { floors: 45 }, rows: [] };

test("2004: an armed run with an undischarged duty must NOT skip its placement pass", () => {
  const dir = dutyRun(UNDISCHARGED);
  assert.equal(floorDutyBlocksSkip(dir, FLOOR_DUTY_STAGE), true,
    "the pass whose duty is undischarged was reusable as 'present and valid' — that is the gap a parked "
    + "run falls into, and the seat never gets dispatched again to discharge it");
  rmSync(dir, { recursive: true, force: true });
});

test("2004: it fails OPEN on every unknown — unarmed, absent, unreadable, not-computable, discharged", () => {
  // The safety argument, driven rather than asserted. This may only ever COST a stage re-run; a resume
  // that cannot proceed because a duty artifact was unreadable would be a worse defect than the one
  // being fixed.
  const cases = [
    ["duty discharged", dutyRun(DISCHARGED)],
    ["not computable", dutyRun({ computable: false, reason: "no band-shape.json" })],
    ["artifact absent", dutyRun(null)],
    ["armed but artifact unreadable", (() => { const d = dutyRun(null); writeFileSync(driverDir(d, "floor-duty.json"), "{ not json"); return d; })()],
    ["NOT armed, duty undischarged", dutyRun(UNDISCHARGED, { arm: false })],
  ];
  for (const [why, dir] of cases) {
    assert.equal(floorDutyBlocksSkip(dir, FLOOR_DUTY_STAGE), false, `blocked the skip when ${why} — must fail open`);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("2004: it speaks for ONE stage — the duty is placement's, and no other stage is re-run by it", () => {
  // Without this the predicate could block every stage on a run with an outstanding floor, turning a
  // one-stage re-run into a whole-pipeline one.
  const dir = dutyRun(UNDISCHARGED);
  for (const other of ["register-digest", "synthesis", "case-law", "narrative-refutation"])
    assert.equal(floorDutyBlocksSkip(dir, other), false, `${other} was re-run by a duty that is not its own`);
  assert.equal(floorDutyBlocksSkip(dir, FLOOR_DUTY_STAGE), true, "…while the stage that owns it still blocks");
  rmSync(dir, { recursive: true, force: true });
});

test("2004: the SKIP CONDITION ITSELF consults the duty — calling the predicate is not enough", () => {
  // ✕ THIS ARM WAS WEAKER AND A PLANT CAUGHT IT. It asserted only that pipeline.mjs CALLS
  // `floorDutyBlocksSkip`. Deleting the term from the skip condition while leaving the call in place —
  // the exact defect, restored — left all four arms green: the predicate was computed, logged, and then
  // ignored by the branch it exists to govern.
  //
  // That is the shape this whole issue is about, reproduced inside its own fix: a thing that is measured
  // and a thing that decides, drifting apart. So the assertion is on the CONDITION, not on the call.
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  assert.match(src, /floorDutyBlocksSkip\(/, "pipeline.mjs no longer calls the shared predicate");

  // ✕ TWO LINES MATCH `if (!forced &&` — the generic stage skip and register-unit's own code-side one.
  // A `.find` on that alone took the FIRST, which is register-unit's, and the arm then reported the
  // absence of a term that was never supposed to be on that line. Keyed on `!freshness.stale`, which is
  // the generic skip's alone. (First-match-in-order, in an arm written the same afternoon as the scorer
  // fix for first-match-in-order.)
  const skipLines = src.split("\n").filter((l) => /if \(!forced &&/.test(l) && /!freshness\.stale/.test(l));
  assert.equal(skipLines.length, 1,
    `expected exactly one generic stage-skip condition, found ${skipLines.length} — re-derive this arm's `
    + "selector before trusting what it says about any of them");
  const skipLine = skipLines[0];
  assert.match(skipLine, /!dutyBlocksSkip/,
    "the skip condition does not consult the floor duty. The predicate may still be called and logged "
    + "above it, which reads exactly like a fix and is not one: the pass whose duty is undischarged is "
    + "skipped anyway, and the duty stays permanently undischargeable");

  assert.ok(!/undischarged_by_seat/.test(src),
    "pipeline.mjs reads the duty artifact's internals directly — that is a second judgement about the "
    + "same pass, which is the defect this fixes");
});
