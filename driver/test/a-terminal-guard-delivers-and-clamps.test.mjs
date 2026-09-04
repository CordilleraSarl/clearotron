// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A TERMINAL GUARD DELIVERS AND CLAMPS; IT DOES NOT WITHHOLD.
//
// Owner ruling, 2026-08-27, verbatim intent: **reports always ship**. When a terminal guard finds the
// report incomplete at delivery, the engine sends it with the gap patched conservatively and the defect
// named in the run record. It never withholds.
//
// ── THE COST, MEASURED RATHER THAN ARGUED ───────────────────────────────────────────────────────────
//
// A live clearance run died at delivery after 5.55 hours because the floor duty found ONE undischarged
// record. The guard was right and worked exactly as built — its first real catch. The client received
// nothing, instead of a report naming one gap. A guard that stops a report marks where a fix is
// missing; it is not itself the fix.
//
// ── WHY THE DECISION IS DRIVEN AND NOT READ ─────────────────────────────────────────────────────────
//
// `floor-duty.mjs` states this rule about its own predicate: a check that lives inline "could only be
// pinned by source text, and a source-text pin cannot tell an armed check from one somebody disarmed
// while leaving its words in place." The same is true of the DECISION, so it lives in
// `terminal-clamp.mjs` and these arms call it. The one source-level arm below is honest about being
// exactly that — a regression catch, not the proof.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { terminalClampDecision, recordNamesDefect, ENGINE_TOKEN_RE, orderClausesForLede } from "../terminal-clamp.mjs";
import { reconcileDeclinationDuty } from "../declination-duty.mjs";
import { reconcileFloorDuty, floorDutyBlock } from "../floor-duty.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");

test("a defect found at delivery DELIVERS — at every verdict, with no exception", () => {
  for (const verdict of ["CLEAR", "CONDITIONAL", "BLOCKING"]) {
    const d = terminalClampDecision({
      verdict, defect: "floor_duty_undischarged:1",
      reason: "one floor row came back neither placed nor named with a ground.",
      clause: "one live registration near-identical to the mark is not individually addressed in this report.",
    });
    assert.equal(d.deliver, true,
      `a terminal guard withheld at verdict ${verdict} — the ruling is that reports always ship, and it is not conditional on the verdict`);
  }
});

test("the clamp is CONSERVATIVE: it adds caution and never removes it", () => {
  const at = (verdict) => terminalClampDecision({ verdict, defect: "d:1", reason: "r", clause: "one point remains open." }).verdict;
  assert.equal(at("CLEAR"), "CONDITIONAL", "a CLEAR verdict with a terminal defect must clamp to CONDITIONAL");
  assert.equal(at("CONDITIONAL"), "CONDITIONAL", "CONDITIONAL must not move");
  assert.equal(at("BLOCKING"), "BLOCKING",
    "BLOCKING was RELAXED — a clamp may move toward caution and never away from it; relaxing here would "
    + "turn a guard that found a defect into one that improved the verdict");
});

test("the defect is NAMED in the run record — and the record's absence reds this arm", () => {
  const d = terminalClampDecision({
    verdict: "CLEAR", defect: "synthesis_unaccounted_delivered:2",
    reason: "two records reached the findings surface unaccounted.",
    clause: "two of the records this search surfaced are neither addressed nor expressly set aside.",
    detail: { unaccounted: 2, owed: 19 },
  });

  assert.ok(recordNamesDefect(d.record),
    "the run record does not name the defect — delivering WITHOUT naming it is the withholding it replaced, "
    + "one step quieter: the client gets a report and nobody can tell it was incomplete");
  assert.equal(d.record.defect, "synthesis_unaccounted_delivered:2");
  assert.equal(d.record.delivered, true);
  assert.equal(d.record.unaccounted, 2, "the counts the scorer reads must survive into the record");
  assert.equal(d.record.owed, 19);
  assert.deepEqual([d.record.from, d.record.to], ["CLEAR", "CONDITIONAL"], "the clamp itself must be visible in the record");

  // ANTI-VACUITY, in the direction that matters: a record with no defect is not a pass.
  assert.equal(recordNamesDefect({ delivered: true }), false, "a record with no defect token read as naming one");
  assert.equal(recordNamesDefect({ defect: "x" }), false, "a record that does not say it delivered read as naming a delivery");
  assert.equal(recordNamesDefect(null), false);
});

test("an unnamed defect is refused outright rather than delivered quietly", () => {
  // The one thing this module will not do. Delivering with an empty defect token would satisfy every
  // arm above while producing exactly the silent incompleteness the ruling is about.
  assert.throws(() => terminalClampDecision({ verdict: "CLEAR", defect: "", reason: "r", clause: "c" }), /defect token/);
  assert.throws(() => terminalClampDecision({ verdict: "CLEAR", defect: "d:1", reason: "  ", clause: "c" }), /run-record reason/);
});

test("the two real guards produce defects this decision can carry — driven, not invented", () => {
  // FLOOR DUTY. A row placed at no tier and named with no ground is undischarged.
  const floors = [{ record_id: "/mark/us/88888888", mark: "VELTRI DIAGNOSTICS" }];
  const artifact = reconcileFloorDuty({ floors, placements: [] });
  const block = floorDutyBlock(artifact, { armed: true });
  assert.ok(block, "the floor-duty predicate found nothing to block on — this arm would carry an invented defect");
  const floorDecision = terminalClampDecision({
    verdict: "CLEAR", defect: `floor_duty_undischarged:${block.undischarged}`,
    reason: `floor_duty_undischarged:${block.undischarged} of ${block.floors} floor row(s) came back neither placed nor named.`,
    clause: `${block.undischarged} of the ${block.floors} live registrations identical or near-identical to the mark are not individually addressed in this report.`,
    detail: { undischarged: block.undischarged, floors: block.floors },
  });
  assert.equal(floorDecision.deliver, true);
  assert.match(floorDecision.record.defect, /^floor_duty_undischarged:\d+$/);

  // SYNTHESIS DUTY. A record owed, neither delivered nor declined.
  const duty = reconcileDeclinationDuty({
    owed: [{ uri: "/mark/us/88888888" }, { uri: "/mark/us/99999999", mark: "VELTRYN" }],
    deliveredUris: ["/mark/us/88888888"], declinedUris: [],
  });
  assert.equal(duty.computable, true, "the declination reconcile is not computable — this arm is measuring its own fixture");
  assert.equal(duty.unaccounted.length, 1, "the fixture produced no unaccounted record, so the decision below would be about nothing");
  const synthDecision = terminalClampDecision({
    verdict: "CONDITIONAL", defect: `synthesis_unaccounted_delivered:${duty.unaccounted.length}`,
    reason: `synthesis_unaccounted_delivered:${duty.unaccounted.length} of ${duty.totals.owed} record(s) reached the surface unaccounted.`,
    clause: `${duty.unaccounted.length} of the ${duty.totals.owed} records this search surfaced are neither addressed nor expressly set aside in this report.`,
  });
  assert.equal(synthDecision.deliver, true);
  assert.equal(synthDecision.verdict, "CONDITIONAL", "a CONDITIONAL run must not be clamped further by a terminal defect");
});

test("an ARCHIVED run is never accused: the declination spec IS the synthesis era stamp", () => {
  // The issue asked the synthesis backstop to "gain the era stamp it currently lacks". MEASURED, and
  // the answer is that it already has one under another name: `owed` is null when no declination spec
  // exists, and a spec is written only by a driver carrying the code that ORDERS the seat to decline.
  // So an archived run is not computable, is never named as a defect, and needs no second stamp.
  //
  // Adding one anyway would be a second way to say the same thing — and `synthesis-record.mjs` warns
  // about exactly that shape: "a flag is a second way to say the same thing and the two can disagree."
  const archived = reconcileDeclinationDuty({ owed: null, deliveredUris: ["/mark/us/88888888"], declinedUris: [] });
  assert.equal(archived.computable, false, "an archived run (no declination spec) became computable — it would now be accused of a defect it was never ordered to avoid");
  assert.match(archived.reason, /no declination spec/);

  // THE CONTROL, and this arm is worthless without it: the same reconcile MUST be able to reach
  // computable:true, or "false" above says nothing about eras and everything about the fixture.
  const live = reconcileDeclinationDuty({ owed: [{ uri: "/mark/us/88888888" }], deliveredUris: [], declinedUris: [] });
  assert.equal(live.computable, true, "the reconcile could not reach computable:true at all — the archived result above proves nothing");
});

test("neither terminal site throws any more — a regression catch, and it is only that", () => {
  // A SOURCE PIN, and named as one. It cannot tell an armed check from a disarmed one; the arms above
  // do that. What it catches is the specific regression of someone re-adding a throw beside these two
  // tokens, which is the shape this issue exists to remove.
  const src = readFileSync(join(DRIVER, "pipeline.mjs"), "utf8");
  for (const token of ["floor_duty_undischarged", "synthesis_unaccounted_delivered"]) {
    const at = src.indexOf(token);
    assert.notEqual(at, -1, `${token} is gone from pipeline.mjs — the defect is no longer named at all, which is worse than blocking on it`);
    const window = src.slice(Math.max(0, at - 700), at + 700);
    assert.ok(!/throw new StageFailure/.test(window),
      `a StageFailure is thrown within 700 characters of ${token} — the terminal guard is withholding again`);
    assert.ok(/deliverAndClamp\(/.test(window),
      `${token} is not routed through deliverAndClamp — it may be delivering, but not through the decision these arms pin`);
  }
});

// ── — TWO TEXTS, NEVER ONE ────────────────────────────────────────────────────────────

test("2096 a fused clause is refused BY SHAPE — the old behavior planted, and shown to fail", () => {
  // THE PLANT IS THE OLD CODE'S EXACT BEHAVIOR: clause == the run-record reason. Two delivered
  // reports led their Verdict row with this string's shape; the seam now refuses it.
  const fused = "floor_duty_undischarged:22 of 22 floor row(s) — every floor is a LIVE in-class record.";
  assert.throws(() => terminalClampDecision({ verdict: "CLEAR", defect: "floor_duty_undischarged:22", reason: fused, clause: fused }),
    /engine identifier/,
    "the decision accepted the run-record sentence as the reader's clause — the tracker-2096 defect re-shipped");
  // A BARE TOOL NAME is the same shape without the count.
  assert.throws(() => terminalClampDecision({ verdict: "CLEAR", defect: "d:1", reason: "r", clause: "perplexity_research returned nothing" }),
    /engine identifier/);
  // And a missing clause is refused outright, not defaulted to the reason.
  assert.throws(() => terminalClampDecision({ verdict: "CLEAR", defect: "d:1", reason: "r" }), /reader-facing clause/);
});

test("2096 the decision carries BOTH texts, and the record keeps the token the scorer reads", () => {
  const d = terminalClampDecision({
    verdict: "CLEAR", defect: "floor_duty_undischarged:3",
    reason: "floor_duty_undischarged:3 of 9 floor row(s) came back neither placed nor named: /mark/us/1; /mark/us/2; /mark/us/3",
    clause: "3 of the 9 live registrations identical or near-identical to the mark are not individually addressed in this report.",
  });
  assert.equal(d.record.defect, "floor_duty_undischarged:3", "the run record must keep the machine token unchanged");
  assert.match(d.reason, /floor_duty_undischarged/, "the ops/run-record sentence keeps the token");
  assert.ok(!ENGINE_TOKEN_RE.test(d.clause), "the clause the Verdict row renders carries no engine identifier");
});

test("2096 the ENGINE TOKEN SHAPE matches what escaped and passes lawyer prose — both directions", () => {
  // What escaped, verbatim shapes:
  for (const bad of ["Floor_duty_undischarged:22 of 22 floor row(s)", "synthesis_unaccounted_delivered:2 of 19", "perplexity_research - no result"])
    assert.ok(ENGINE_TOKEN_RE.test(bad), `the shape guard missed the escaped string: ${bad}`);
  // What a lawyer writes — none of it may trip the refusal, or the guard is noise and gets deleted:
  for (const good of [
    "No consent or coexistence agreement with the owner of the Swiss VELTRIN registration.",
    "3 of the 9 live registrations identical or near-identical to the mark are not individually addressed in this report.",
    "A prior-confirmed live conflict was neither carried nor justified this run.",
  ]) assert.ok(!ENGINE_TOKEN_RE.test(good), `lawyer prose tripped the engine-token shape: ${good}`);
});

test("2096 the lede is the opinion's: guard clauses sort after condition clauses, reasons in step", () => {
  const clauses = ["GUARD: records not individually addressed remain open points.", "No consent with the owner of the Swiss registration."];
  const reasons = ["floor_duty_undischarged:3 …", "no-consent ask text"];
  const guards = new Set([clauses[0]]);
  const o = orderClausesForLede(clauses, reasons, guards);
  assert.deepEqual(o.clauses, [clauses[1], clauses[0]],
    "the guard's disclosure outranked the opinion's own condition for the lede — the push-order accident is back");
  assert.deepEqual(o.reasons, [reasons[1], reasons[0]], "reasons must reorder in step or the sidecar pair desyncs");
  // No guards fired → untouched, and a guard-only list still renders (the disclosure must reach the reader).
  assert.deepEqual(orderClausesForLede(clauses, reasons, new Set()).clauses, clauses);
  assert.deepEqual(orderClausesForLede([clauses[0]], [reasons[0]], guards).clauses, [clauses[0]]);
});
