// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// item 3 — the findings-surface silence tripwire.
//
// EVERY ARM IS CONSTRUCTED, and that is not laziness. The state this check exists to reward — a
// surfaced record carrying a STATED ground — does not exist on any archived run, because nothing has
// ever written one. An arm driven off a real run would exercise only the broken half and would pass
// under a check that always returned "silent", which is a check that certifies nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { reconcileSurfaceDuty, surfaceDutyNote, SURFACE_DUTY_SCHEMA_VERSION } from "../surface-duty.mjs";

const surfaced = (uri, reason_source, extra = {}) =>
  ({ uri, reach: "findings-surface", reason: "synthesis:not-delivered", reason_source, ...extra });

test("#1117-3 the defect shape: surfaced, not delivered, no ground — tripped", () => {
  const r = reconcileSurfaceDuty({ rows: [surfaced("rec-1", "step-silent", { mark: "ALPHA" })] });
  assert.equal(r.totals.surfaced, 1);
  assert.equal(r.totals.silent, 1);
  assert.equal(r.totals.answered, 0);
  assert.equal(r.tripped, true);
  assert.equal(r.silent[0].mark, "ALPHA");
});

test("#1117-3 a STATED ground is an answer — the arm no archived run can provide", () => {
  // The half that must not regress. If this ever reads as silent, the check reports the cure as the
  // disease and every run looks broken forever.
  const r = reconcileSurfaceDuty({ rows: [surfaced("rec-1", "step-stated")] });
  assert.equal(r.totals.answered, 1);
  assert.equal(r.totals.silent, 0);
  assert.equal(r.tripped, false, "a record synthesis reasoned away must not count against the duty");
  assert.equal(surfaceDutyNote(r), null, "a clean run emits no disclosure line");
});

test("#1117-3 ONE silent decline trips it — there is no threshold to tune", () => {
  const rows = [surfaced("a", "step-stated"), surfaced("b", "step-stated"), surfaced("c", "step-silent")];
  const r = reconcileSurfaceDuty({ rows });
  assert.equal(r.tripped, true, "99 answered and 1 silent is still the defect");
  assert.equal(r.totals.silent, 1);
});

test("#1117-3 a record no stage accepted is a DIFFERENT duty and is not counted here", () => {
  // `screened` is the floors check's population (item 2) and the issue's own item 2. `finding` was
  // delivered. Counting either would double-report records already answered under another name.
  const rows = [
    { uri: "p", reach: "screened", reason: "placement:not-selected", reason_source: "step-silent" },
    { uri: "r", reach: "finding", reason: null, reason_source: null },
  ];
  const r = reconcileSurfaceDuty({ rows });
  assert.equal(r.totals.surfaced, 0);
  assert.equal(r.tripped, false);
});

test("#1117-3 THE SILENCE MOVED, and the check follows it — digest:silent-drop at reach `placed`", () => {
  // THE REGRESSION ARM FOR THIS CHECK'S OWN BLIND SPOT. Keyed on `findings-surface` + `step-silent`
  // alone — the issue's literal words, written when the silence was at synthesis — this returns
  // "clean" for the run below. After d80a8388 made synthesis state its grounds, a fresh reproduction
  // found 71 records at exactly this shape with a lawyer-named mark among them. An instrument that
  // goes green when the defect moves is the defect this issue is about.
  const rows = [
    { uri: "gold", reach: "placed", reason: "digest:silent-drop", reason_source: "absent", mark: "ALPHA" },
    { uri: "ok", reach: "findings-surface", reason: "synthesis:declined:unrelated-goods", reason_source: "step-stated" },
  ];
  const r = reconcileSurfaceDuty({ rows });
  assert.equal(r.tripped, true, "the silence moved one door down and this check must still see it");
  assert.equal(r.totals.silent, 1);
  assert.equal(r.silent[0].reach, "placed", "the row must say WHERE the silence is, or a reader cannot see it moved");
  assert.equal(r.silent[0].reason_source, "absent");
});

test("#1117-3 `step-structural` is NOT silence — an upstream absence is not a judging stage's fault", () => {
  // step-structural = the stage never completed, so NOTHING judged the record. record-carry already
  // reports that under its own name, and counting it here would blame a judging stage for a defect it
  // did not commit. `absent` is the opposite case and IS counted — the stage ran and named nothing.
  const r = reconcileSurfaceDuty({ rows: [surfaced("a", "step-structural")] });
  assert.equal(r.totals.surfaced, 1);
  assert.equal(r.totals.answered, 1);
  assert.equal(r.totals.silent, 0);
  assert.equal(r.tripped, false);
});

test("#1117-3 both silence tokens count, because both leave the reader unable to tell", () => {
  const r = reconcileSurfaceDuty({ rows: [surfaced("a", "step-silent"), surfaced("b", "absent")] });
  assert.equal(r.totals.silent, 2, "step-silent and absent are two routes to the same unanswered record");
});

test("#1117-3 a surfaced row with NO record id is counted, never dropped", () => {
  // Dropping it would shrink the denominator and make a data defect read as a better ratio.
  const r = reconcileSurfaceDuty({ rows: [{ reach: "findings-surface", reason_source: "step-silent" }] });
  assert.equal(r.totals.surfaced, 1);
  assert.equal(r.totals.silent, 1);
  assert.equal(r.silent[0].uri, null, "the missing id is reported as missing, not invented");
});

test("#1117-3 the same record twice counts once, and casing is not a second record", () => {
  const rows = [surfaced("REC-1", "step-silent"), surfaced("rec-1", "step-silent")];
  const r = reconcileSurfaceDuty({ rows });
  assert.equal(r.totals.surfaced, 1, "one record id is one record however it is spelled");
  assert.equal(r.totals.silent, 1);
});

test("#1117-3 no rows is not a pass — an empty run reports zero surfaced, and says so", () => {
  const r = reconcileSurfaceDuty({});
  assert.equal(r.totals.surfaced, 0);
  assert.equal(r.tripped, false);
  assert.equal(surfaceDutyNote(r), null);
  assert.equal(r.schema_version, SURFACE_DUTY_SCHEMA_VERSION,
    "the result is versioned even when empty — a reader must be able to tell which check produced it");
});

test("#1117-3 the disclosure names what cannot be told apart, not a bare count", () => {
  const r = reconcileSurfaceDuty({ rows: [surfaced("a", "step-silent"), surfaced("b", "step-stated")] });
  const note = surfaceDutyNote(r);
  assert.match(note, /1 of 2/);
  assert.match(note, /cannot be told apart/, "the line must state the ambiguity, not just the number");
  assert.match(note, /opposite repairs/);
});
