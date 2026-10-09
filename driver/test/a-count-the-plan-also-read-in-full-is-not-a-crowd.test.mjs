// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A COUNT THE PLAN ALSO READ IN FULL IS NOT A CROWD.
//
// The saturation probe sizes a question and reads none of its records, so its axis came back `incomplete`.
// On a delivered report the same question — same name, same match, same classes, same territories — had
// been listed in full on the primary sweep: fifteen counted, fifteen read. The reading seat still saw a
// crowd, wrote that the set "was not enumerated record by record", and the verdict went to the client
// conditional on reviewing records that had been reviewed. A count is now discharged only by an identical
// question listed in full at the same total; anything short of that is still a crowd.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveCoverageSkeleton } from "../register-plan.mjs";
import { coverageFormRows } from "../coverage-form.mjs";

const PROBE = { qid: "saturation-probe:default:lanternwick", axis: "saturation-probe", predicate: "default",
  term: "LANTERNWICK", nice_classes: ["9"], regions: ["EM", "GB", "WO"], expected_kind: "count" };
const SWEEP = { qid: "primary-sweep:default:lanternwick", axis: "primary-sweep", predicate: "default",
  term: "LANTERNWICK", nice_classes: ["9"], regions: ["EM", "GB", "WO"], expected_kind: "enumerate" };
const skeleton = ({ sweep = SWEEP, probe = PROBE, read = 15, total = 15 } = {}) => deriveCoverageSkeleton(
  { entries: [sweep, probe] },
  { missing: [], skipped: [], deferred: [], executed: [
    { qid: sweep.qid, state: "enumerated", records: read, total_hits: total },
    { qid: probe.qid, state: "incomplete", records: null, total_hits: 15 }] });
const axis = (sk, name) => sk.find((a) => a.axis === name);

test("a count whose identical question was listed in full leaves its axis executed, and says why", () => {
  const sk = skeleton();
  assert.equal(axis(sk, "saturation-probe").state, "executed", "the probe still reads as a crowd");
  assert.equal(axis(sk, "saturation-probe").crowds, 0);
  assert.equal(axis(sk, "saturation-probe").read_elsewhere, 1, "the axis does not say its count was read elsewhere");
  const row = coverageFormRows({ skeleton: sk, plan: { entries: [SWEEP, PROBE] } }).rows
    .find((r) => r.kind === "axis" && r.axis === "saturation-probe");
  assert.equal(row.skeleton_state, "executed", "the reading seat is still told the probe's set is unread");
});

test("anything short of the identical question, read in full at the same total, is still a crowd", () => {
  const crowd = (over, why) => assert.equal(axis(skeleton(over), "saturation-probe").state, "incomplete", why);
  crowd({ read: 12 }, "a question listed in part discharged the count");
  crowd({ read: 14, total: 14 }, "a different total discharged the count");
  crowd({ sweep: { ...SWEEP, regions: ["EM", "WO"] } }, "a question over fewer territories discharged the count");
  crowd({ sweep: { ...SWEEP, nice_classes: ["9", "42"] } }, "a question over other classes discharged the count");
  crowd({ sweep: { ...SWEEP, predicate: "exact" } }, "a narrower match discharged the count");
  crowd({ sweep: { ...SWEEP, term: "LANTERNWICKS" } }, "another name discharged the count");
  crowd({ probe: { ...PROBE, expected_kind: "enumerate" } }, "a listing that crowded was discharged — only a count is");
});
