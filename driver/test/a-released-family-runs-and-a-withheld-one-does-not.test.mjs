// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RELEASED FAMILY RUNS, A WITHHELD ONE DOES NOT, AND A FAMILY NOBODY DECIDED HOLDS UP DELIVERY.
//
// The wider families wait in the plan for the reading turn, and the turn decides every one: it releases
// each family it asks, with why looking wider would change what the client is told, and records each one
// it does not ask as withheld, with why. This drives that path whole: the turn's two records, the shared
// executor reading the release beside the frozen plan, the join, and the coverage form's family rows. The
// provider is replaced by a recorder of what reached it, so "ran" means a question left the executor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { compileRegisterPlan, joinPlanToBands, deriveCoverageSkeleton, awaitsReadingTurn } from "../register-plan.mjs";
import { PROVIDER_CAPABILITIES } from "../register-capabilities.mjs";
import { recordReleasedFamilies, recordWithheldFamilies, readWithheldFamilies, releasedFamilyQids,
  releasedFamiliesPath, splitWaitingFamilies } from "../withheld-families.mjs";
import { coverageFormRows, findCoverageFormViolations } from "../coverage-form.mjs";
import { makeExecutePlan } from "../../providers/_shared/execute-plan.mjs";

const MARK = "VELTRIS";
const manifest = {
  schema_version: 1, mark: MARK, dominant_element: MARK, elements: [{ value: MARK, kind: "distinctive" }],
  variants: [{ value: MARK, category: "core" }, { value: "VELTRISS", category: "spelling" },
    { value: "WELTRIS", category: "sound-alike" }, { value: "VELTRIS PRO", category: "compound" }],
  incumbent_classes: ["9"], goods_words: ["software"],
};
const plan = compileRegisterPlan({ manifest, job: { jobKey: "t", classes: ["9", "42"], jurisdictions: ["US", "EU"] },
  capabilities: PROVIDER_CAPABILITIES.signa });
const AXIS = "primary-sweep";
const waiting = plan.entries.filter((e) => e.axis === AXIS && awaitsReadingTurn(e.when)).map((e) => e.qid);
const RELEASE = "The identical mark's list shows a live owner in the client's goods; its wider spellings would change the advice.";
const WITHHOLD = "The identical mark and its close spellings were read in full; these wider spellings add nothing the client's goods make likely.";

function runDir() {
  const dir = mkdtempSync(join(tmpdir(), "released-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "register-plan.json"), JSON.stringify(plan));
  return dir;
}

/** One call of the shared executor on AXIS, as register_execute_plan makes it. The band and what reached the wire. */
async function execute(dir, qids) {
  const wire = [];
  const answer = (p) => { wire.push(p); };
  const executePlan = makeExecutePlan({
    search: async (_a, p) => { answer(p); return { type: "text", text: JSON.stringify({ total_hits: 0, results: [] }) }; },
    enumerate: async (_a, p) => { answer(p); return { type: "text", text: JSON.stringify({ state: "enumerated", total_hits: 0, count: 0, records: [] }) }; },
  });
  const outPath = join(dir, "register-units", `${AXIS}-band.json`);
  const res = await executePlan("auth", { plan_path: driverDir(dir, "register-plan.json"), axis: AXIS, output_path: outPath, ...(qids ? { qids } : {}) }, {});
  assert.ok(!String(res.text).startsWith("ERROR"), res.text);
  return { out: JSON.parse(res.text), band: JSON.parse(readFileSync(outPath, "utf8")), wire };
}

/** Every other axis answered, as the existing waiting-family tests stand it up; AXIS is the executor's band. */
function bandsWith(band) {
  const bands = { [AXIS]: band };
  for (const e of plan.entries) {
    if (e.axis === AXIS || awaitsReadingTurn(e.when) || e.unsupported) continue;
    (bands[e.axis] ??= []).push({ qid: e.qid, state: "enumerated", records: [], total_hits: 0 });
  }
  return bands;
}

/** The turn's decision on AXIS: release the first two waiting families and withhold every other one. */
function decideAll(dir) {
  const released = waiting.slice(0, 2), withheld = waiting.slice(2);
  const r = recordReleasedFamilies(dir, { axis: AXIS, families: [{ qids: released, reason: RELEASE }] });
  assert.deepEqual(r.recorded, released);
  const w = recordWithheldFamilies(dir, { axis: AXIS, families: [{ qids: withheld, reason: WITHHOLD }] });
  assert.deepEqual(w.recorded, withheld);
  assert.deepEqual(w.still_to_judge, [], "a family was left undecided after the turn decided every one");
  return { released, withheld };
}

test("the executor runs the families the turn released, and no other waiting family", async () => {
  assert.ok(waiting.length >= 4, `only ${waiting.length} waiting families compiled on ${AXIS}: this test asserts over too few`);
  const dir = runDir();
  try {
    // THE CONTROL: with no release on record, the plan call runs no waiting family.
    const before = await execute(dir);
    const ranBefore = new Set(before.band.map((b) => b.qid));
    assert.deepEqual(waiting.filter((q) => ranBefore.has(q)), [], "a waiting family ran with nothing released");
    assert.deepEqual(before.out.skipped.filter((q) => waiting.includes(q)).sort(), [...waiting].sort());

    const { released, withheld } = decideAll(dir);
    // The call the manual names: register_execute_plan again, with the qids released.
    const after = await execute(dir, released);
    assert.deepEqual(after.out.executed, released.length, "the call ran more or fewer entries than were released");
    assert.equal(after.wire.length >= released.length, true, "a released family reached no provider");
    const ran = new Set(after.band.map((b) => b.qid));
    for (const q of released) assert.ok(ran.has(q), `released family ${q} has no band block`);
    for (const q of withheld) assert.ok(!ran.has(q), `withheld family ${q} ran`);
    // The first call's blocks survive the second: a released run never drops what already ran.
    for (const q of ranBefore) assert.ok(ran.has(q), `the release call dropped ${q}'s block`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a released family joins as run, a withheld one as withheld, and none is left awaiting", async () => {
  const dir = runDir();
  try {
    await execute(dir);
    const { released, withheld } = decideAll(dir);
    const { band } = await execute(dir, released);
    const receipt = joinPlanToBands(plan, bandsWith(band), { released: releasedFamilyQids(dir) });
    const onAxis = receipt.awaiting.filter((f) => f.axis === AXIS);
    assert.deepEqual(onAxis.map((f) => f.qid).sort(), [...withheld].sort(), "the families left waiting are not the withheld ones");
    for (const q of released) assert.ok(receipt.executed.some((x) => x.qid === q), `released family ${q} is not counted as run`);
    const split = splitWaitingFamilies(onAxis, { recorded: readWithheldFamilies(dir) });
    assert.equal(split.awaiting.length, 0, "a decided family still reads as awaiting");
    assert.equal(split.withheld.length, withheld.length);
    // The coverage form: one row per waiting family, every one settled, so nothing holds up delivery.
    const skeleton = deriveCoverageSkeleton(plan, receipt);
    const family = coverageFormRows({ skeleton, plan, awaiting: onAxis, withheld: readWithheldFamilies(dir) }).rows.filter((r) => r.kind === "family");
    assert.equal(family.length, withheld.length, "a released family was given a waiting family's row");
    assert.deepEqual(findCoverageFormViolations(family), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a family nobody decided holds up delivery", async () => {
  const dir = runDir();
  try {
    const released = waiting.slice(0, 1), undecided = waiting[1], withheld = waiting.slice(2);
    recordReleasedFamilies(dir, { axis: AXIS, families: [{ qids: released, reason: RELEASE }] });
    const w = recordWithheldFamilies(dir, { axis: AXIS, families: [{ qids: withheld, reason: WITHHOLD }] });
    assert.deepEqual(w.still_to_judge, [undecided], "the turn was not told which family it left undecided");
    const { band } = await execute(dir, released);
    const receipt = joinPlanToBands(plan, bandsWith(band), { released: releasedFamilyQids(dir) });
    const onAxis = receipt.awaiting.filter((f) => f.axis === AXIS);
    const family = coverageFormRows({ skeleton: deriveCoverageSkeleton(plan, receipt), plan, awaiting: onAxis, withheld: readWithheldFamilies(dir) })
      .rows.filter((r) => r.kind === "family");
    const owed = findCoverageFormViolations(family);
    assert.deepEqual(owed.map((v) => v.reason), ["no_status"], "the undecided family did not hold up delivery, or a decided one did");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a release with no reason, or of a family that is not waiting, is refused and runs nothing", async () => {
  const dir = runDir();
  try {
    const noReason = recordReleasedFamilies(dir, { axis: AXIS, families: [{ qids: [waiting[0]], reason: "  " }] });
    assert.deepEqual(noReason.recorded, []);
    assert.match(noReason.rejected[0]?.issue ?? "", /no reason/);
    const dictated = plan.entries.find((e) => e.axis === AXIS && !awaitsReadingTurn(e.when)).qid;
    const notWaiting = recordReleasedFamilies(dir, { axis: AXIS, families: [{ qids: [dictated], reason: RELEASE }] });
    assert.deepEqual(notWaiting.recorded, []);
    assert.match(notWaiting.rejected[0]?.issue ?? "", /not a waiting family/);
    assert.equal(existsSync(releasedFamiliesPath(dir, AXIS)), false, "a refused release was written");
    const { band } = await execute(dir);
    assert.ok(!band.some((b) => b.qid === waiting[0]), "a family whose release was refused ran");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the turn's latest decision on a family stands: a release replaces a withholding, and back", async () => {
  const dir = runDir();
  try {
    const q = waiting[0];
    recordWithheldFamilies(dir, { axis: AXIS, families: [{ qids: [q], reason: WITHHOLD }] });
    recordReleasedFamilies(dir, { axis: AXIS, families: [{ qids: [q], reason: RELEASE }] });
    assert.ok(releasedFamilyQids(dir).has(q) && !readWithheldFamilies(dir)[q], "the release did not replace the withholding");
    assert.ok((await execute(dir, [q])).band.some((b) => b.qid === q), "the released family did not run");
    recordWithheldFamilies(dir, { axis: AXIS, families: [{ qids: [q], reason: WITHHOLD }] });
    assert.ok(!releasedFamilyQids(dir).has(q) && readWithheldFamilies(dir)[q], "the withholding did not replace the release");
    const again = await execute(dir, [q]);
    assert.deepEqual(again.wire, [], "a family withheld after its release still reached the provider");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
