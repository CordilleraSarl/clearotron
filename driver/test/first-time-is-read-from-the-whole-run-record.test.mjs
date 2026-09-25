// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// "FIRST TIME" IS READ FROM THE WHOLE RUN RECORD (ruled 2026-09-25): zero failures and zero retries of any
// kind the record shows, recoveries, re-asks and repairs included, never the attempt count alone. A stage's
// attempt number stays at 1 through a form repair turn, a refunded warm rung, a rescue, a quarantined
// failure, a tool call that failed inside the turn, a refused item, a follow-up turn and a second cycle
// after a recovery. The harness lists each with its kind, stage, engine and model, names what the record
// cannot show as not recorded, and counts a code-side step as neither a pass nor a failure. Events and
// dispatch reasons are read by name; a name it has not classed keeps a run from reading "yes".
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firstTimeRows, firstTimeLines, readRunRecord, NOT_RECORDED } from "../../scripts/e2e-first-time.mjs";

const ok = (stage, attempt = 1, extra = {}) => ({ stage, row: { attempt, ok: true, engine: "engine-a", modelActual: "model-a", ...extra } });
const clean = { attempts: [ok("matter-frame"), ok("register-digest")], runLog: [], status: { state: "delivered" } };

test("a clean run reads yes, and still names what its record cannot show", () => {
  const ft = firstTimeRows(clean);
  assert.equal(ft.firstTime, true);
  assert.deepEqual(ft.rows, []);
  const [line] = firstTimeLines(ft);
  assert.match(line, /^first time: yes — /);
  for (const n of NOT_RECORDED) assert.ok(line.includes(n), `the line does not name an unrecorded kind: ${n}`);
});

test("every kind the attempt count misses is listed, with its stage, engine and model", () => {
  const t0 = Date.parse("2026-09-25T10:00:00Z");
  const iso = (s) => new Date(t0 + s * 1000).toISOString();
  const ft = firstTimeRows({
    attempts: [
      { stage: "blind-frame", row: { attempt: 1, ok: false, fail: "missing_file", engine: "engine-a", modelActual: "model-a" } },
      ok("blind-frame", 2),
      ok("placement-inquiry", 1, { rescued: "timeout" }),
      ok("synthesis", 1, { selfReportContradicted: true }),
      ok("register-digest", 1, { toolCallsRefused: 2 }),
      ok("common-law-half:a", 1), ok("common-law-half:a", 2), ok("common-law-half:a", 1),
      { stage: "register-unit:saturation-probe", row: { attempt: 1, wall: 0.002 }, code: true },
    ],
    runLog: [
      { event: "form-repair", stage: "placement-inquiry", attempt: 1 },
      { event: "warm-rung", stage: "synthesis", attempt: 2, rung_free: true, reason: "warm turn never reached the model" },
      { event: "coverage-ledger-quarantined", stage: "register-digest" },
      { event: "supplemental-fold-refused", stage: "register-unit:primary-sweep" },
      { event: "park-resumed", fromStage: "common-law-half:a" },
      { event: "repair-attempted", repair: "primary-sweep", dispatch: "dispatched" },
      { event: "attempt", stage: "common-law-half:a", attempt: 1, ts: iso(100), wall: 90 },
      { event: "stage", stage: "matter-frame" },
    ],
    status: { state: "delivered", recoveryAttempts: 1, failedStage: "common-law-half:a" },
    toolCalls: [{ ts: iso(50), event: "settled", server: "web", tool: "research", ok: false }, { ts: iso(60), event: "settled", ok: true }],
    discards: [{ seam: "placement", stage: "placement-inquiry", reason: "placement:stage-incomplete", pass: 1 }],
  });
  assert.equal(ft.firstTime, false);
  const kinds = new Set(ft.rows.map((r) => r.kind));
  for (const k of ["failed attempt", "retry", "rescue", "self-report contradicted", "refused tool call", "second cycle",
    "form repair turn", "refunded warm rung", "quarantine", "refused item", "recovery", "failed tool call", "repair", "incomplete pass"])
    assert.ok(kinds.has(k), `the reader missed a kind: ${k}`);
  assert.equal(ft.codeSteps, 1, "a code-side step was read as an engine attempt, or dropped");
  const tool = ft.rows.find((r) => r.kind === "failed tool call");
  assert.equal(tool.stage, "common-law-half:a", "a failed tool call was not placed in the attempt it fell in");
  const rescue = ft.rows.find((r) => r.kind === "rescue");
  assert.deepEqual([rescue.stage, rescue.engine, rescue.model], ["placement-inquiry", "engine-a", "model-a"]);
  const [head, ...rest] = firstTimeLines(ft);
  assert.match(head, new RegExp(`^first time: no — ${ft.rows.length} row\\(s\\): `));
  assert.ok(head.includes("1 rescue") && head.includes("1 failed tool call"), `the head line does not carry the counts by kind: ${head}`);
  assert.match(tool.cause, /settled ok:false at 2026-09-25T10:00:50/, "a failed tool call does not carry its time");
  assert.match(ft.rows.find((r) => r.kind === "second cycle").cause, /^attempt 1 again after attempt 2, with no dispatch recorded/);
  assert.equal(ft.rows.filter((r) => r.kind === "recovery").length, 1, "status.json restated a recovery the run log already named, or the resume was listed beside its park");
  assert.equal(rest.length, ft.rows.length);
});

test("a record with no engine attempt cannot tell, and never reads as yes", () => {
  const ft = firstTimeRows({ attempts: [{ stage: "register-unit:saturation-probe", row: { attempt: 1 }, code: true }] });
  assert.equal(ft.firstTime, null);
  assert.match(firstTimeLines(ft)[0], /^first time: CANNOT TELL/);
});

test("the reader takes the run record from disk: stage records, the run log, status, markers and the side ledgers", (t) => {
  const run = mkdtempSync(join(tmpdir(), "first-time-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  mkdirSync(join(run, "_driver"), { recursive: true });
  const jl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(join(run, "_driver", "matter-frame.jsonl"), jl([{ attempt: 1, ok: true, engine: "engine-a" }]));
  writeFileSync(join(run, "_driver", "register-unit:saturation-probe.jsonl"), jl([{ attempt: 1, wall: 0.002 }]));
  writeFileSync(join(run, "status.json"), JSON.stringify({ state: "delivered" }));
  writeFileSync(join(run, ".postponed"), JSON.stringify({ stage: "matter-frame", parkKind: "weather" }));
  writeFileSync(join(run, ".failed"), JSON.stringify({ stage: "matter-frame", reason: "missing_file" }));
  writeFileSync(join(run, "_driver", "run.jsonl"), jl([{ event: "form-repair", stage: "matter-frame", attempt: 1 },
    { event: "repair-attempted", repair: "primary-sweep", dispatch: "dispatched" }, { event: "failed", stage: "matter-frame", reason: "missing_file" }]));
  const ft = firstTimeRows(readRunRecord(run));
  assert.equal(ft.codeSteps, 1);
  assert.deepEqual(ft.rows.map((r) => r.kind).sort(), ["form repair turn", "recovery", "repair", "run failed"], "one failure was listed twice");
  assert.match(ft.rows.find((r) => r.kind === "run failed").cause, /also the failure marker/);
  assert.equal(ft.firstTime, false);
});

test("a re-ask no stage record shows reads no: the engine re-issuing its own meaning searches", () => {
  const reissued = firstTimeRows({ ...clean, runLog: [{ event: "connotation-reissue", half: "m", count: 2 }, { event: "connotation-reissue-result", ok: true }] });
  assert.equal(reissued.firstTime, false, "a run whose engine re-issued its own searches read as first time");
  assert.deepEqual(reissued.rows.map((r) => r.kind), ["re-ask"], "the re-issue and its result are one incident");
  const control = firstTimeRows({ ...clean, runLog: [{ event: "form-repair", stage: "matter-frame", attempt: 1 }] });
  assert.equal(control.firstTime, false);
  const failedResult = firstTimeRows({ ...clean, runLog: [{ event: "connotation-reissue-result", ok: false }] });
  assert.deepEqual(failedResult.rows.map((r) => r.kind), ["step failed"]);
});

test("a follow-up is read by the reason its dispatch records, and a stage dispatched fresh again is a second cycle", () => {
  const twoTurns = (stage) => [ok(stage), { stage, row: { attempt: 1, ok: true, followup: true, engine: "engine-a", modelActual: "model-a" } }];
  const stageEv = (stage, trigger) => ({ event: "stage", stage, ...(trigger ? { trigger } : {}) });
  // The digest folding in upstream re-runs happens whatever the first answer was.
  const flush = firstTimeRows({ attempts: twoTurns("register-digest"), runLog: [stageEv("register-digest", "fresh"), stageEv("register-digest", "settlement-flush")] });
  assert.equal(flush.firstTime, true, "a dispatch the run makes whatever the first answer was was counted");
  const recheck = firstTimeRows({ attempts: twoTurns("narrative-refutation"), runLog: [stageEv("narrative-refutation", "fresh"), stageEv("narrative-refutation", "verdict-recheck")] });
  assert.equal(recheck.firstTime, false);
  assert.deepEqual(recheck.rows.map((r) => [r.kind, r.stage, r.cause]), [["re-ask", "narrative-refutation", "dispatched again: verdict-recheck"]],
    "a follow-up was listed without its reason, or twice");
  const again = firstTimeRows({ attempts: twoTurns("matter-frame"), runLog: [stageEv("matter-frame"), stageEv("matter-frame")] });
  assert.deepEqual(again.rows.map((r) => [r.kind, r.cause]), [["second cycle", "dispatched fresh again: a recovery or resume re-ran the stage"]]);
  // A wedged lane re-runs its stage through the stage runner: the event names the second dispatch.
  const wedge = firstTimeRows({ attempts: twoTurns("placement-inquiry"),
    runLog: [stageEv("placement-inquiry"), { event: "lane-wedge-retry", stage: "placement-inquiry", cycle: 1 }, stageEv("placement-inquiry")] });
  assert.deepEqual(wedge.rows.map((r) => r.kind), ["retry"], "one wedge retry was listed twice");
  // A first dispatch cancelled mid-turn never wrote its dispatch record; that is not a second cycle.
  const cancelled = firstTimeRows({ attempts: [{ stage: "matter-frame", row: { attempt: 1, ok: false, fail: "nonzero_exit", engine: "engine-a" } }],
    runLog: [{ event: "cancelled", stage: "matter-frame" }] });
  assert.deepEqual(cancelled.rows.map((r) => r.kind).sort(), ["cancelled", "failed attempt"]);
  // A retry inside a second cycle is a retry, not a third cycle.
  const inner = firstTimeRows({ attempts: [ok("synthesis"), ok("synthesis", 2), ok("synthesis"), ok("synthesis", 2)], runLog: [] });
  assert.deepEqual(inner.rows.map((r) => r.kind).sort(), ["retry", "retry", "second cycle"]);
  // A what-if memo is asked of an archived run after it delivered: not the run's record.
  const whatif = firstTimeRows({ attempts: [ok("matter-frame"), ok("whatif-memo"), ok("whatif-memo")], runLog: [] });
  assert.equal(whatif.firstTime, true);
});

test("a name the reader has not classed is listed and keeps the run from reading yes", () => {
  const unknown = firstTimeRows({ ...clean, runLog: [{ event: "a-new-event" }, { event: "stage", stage: "matter-frame", trigger: "a-new-reason" }] });
  assert.equal(unknown.firstTime, null);
  assert.deepEqual(unknown.unclassed, ['event "a-new-event"', 'dispatch reason "a-new-reason"']);
  assert.match(firstTimeLines(unknown)[0], /^first time: CANNOT TELL — .*2 name\(s\) this reader has not classed/);
  const withRow = firstTimeRows({ ...clean, runLog: [{ event: "a-new-event" }, { event: "form-repair", stage: "matter-frame", attempt: 1 }] });
  assert.equal(withRow.firstTime, false);
  assert.match(firstTimeLines(withRow)[0], /not classed, read neither way: event "a-new-event"/);
});
