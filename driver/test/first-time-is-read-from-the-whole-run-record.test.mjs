// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// "FIRST TIME" IS READ FROM THE WHOLE RUN RECORD (ruled 2026-09-25): zero failures and zero retries of any
// kind the record shows, recoveries, re-asks and repairs included, never the attempt count alone. A stage's
// attempt number stays at 1 through a form repair turn, a refunded warm rung, a rescue, a quarantined
// failure, a tool call that failed inside the turn, a refused item and a second cycle after a recovery.
// The harness lists each with its kind, stage, engine and model, names what the record cannot show as not
// recorded, and counts a code-side step as neither a pass nor a failure.
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
      { event: "attempt", stage: "common-law-half:a", attempt: 1, ts: iso(100), wall: 90 },
      { event: "stage", stage: "matter-frame" },
    ],
    status: { state: "delivered", recoveryAttempts: 1, failedStage: "common-law-half:a" },
    toolCalls: [{ ts: iso(50), event: "settled", server: "web", tool: "research", ok: false }, { ts: iso(60), event: "settled", ok: true }],
    repairs: [{ axis: "primary-sweep", reason: "a band re-run" }],
    discards: [{ seam: "placement", stage: "placement-inquiry", reason: "placement:stage-incomplete", pass: 1 }],
  });
  assert.equal(ft.firstTime, false);
  const kinds = new Set(ft.rows.map((r) => r.kind));
  for (const k of ["failed attempt", "retry", "rescue", "self-report contradicted", "refused tool call", "second cycle",
    "form repair turn", "refunded warm rung", "quarantine", "refused item", "recovery", "failed tool call", "register repair", "incomplete pass"])
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
  assert.match(ft.rows.find((r) => r.kind === "second cycle").cause, /^attempt 1 of a second cycle/);
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
  writeFileSync(join(run, "_driver", "run.jsonl"), jl([{ event: "form-repair", stage: "matter-frame", attempt: 1 }]));
  writeFileSync(join(run, "_driver", "register-repair.jsonl"), jl([{ axis: "primary-sweep", reason: "re-run" }]));
  writeFileSync(join(run, "status.json"), JSON.stringify({ state: "delivered" }));
  writeFileSync(join(run, ".postponed"), JSON.stringify({ stage: "matter-frame", parkKind: "weather" }));
  writeFileSync(join(run, ".failed"), JSON.stringify({ stage: "matter-frame", reason: "missing_file" }));
  writeFileSync(join(run, "_driver", "run.jsonl"), jl([{ event: "form-repair", stage: "matter-frame", attempt: 1 }, { event: "failed", stage: "matter-frame", reason: "missing_file" }]));
  const ft = firstTimeRows(readRunRecord(run));
  assert.equal(ft.codeSteps, 1);
  assert.deepEqual(ft.rows.map((r) => r.kind).sort(), ["form repair turn", "recovery", "register repair", "run failed"], "one failure was listed twice");
  assert.match(ft.rows.find((r) => r.kind === "run failed").cause, /also the failure marker/);
  assert.equal(ft.firstTime, false);
});
