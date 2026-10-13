// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE FRAME COMPARISON'S SENTENCE STAYS IN THE RUN RECORD (ruled 2026-10-13).
//
// When the blind frame comparison flagged an omission the reopen pass did not close, the clamp stored the
// engine's own sentence about those steps as the client's clause, and the report printed it as a condition on
// the clearance. The test for engine words looked only for underscore tokens, so this sentence passed. Now the
// clamp stores no clause for it, nothing is written in its place, a clause stored by an older run is withheld
// from every client surface, and the reason stays where the operator reads it: the run record, and the audit
// workbook. Every condition here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { clientConditions, unrenderableConditions, carriesEngineWords, clauseForDefect, terminalClampDecision } from "../terminal-clamp.mjs";
import { riskStatement, statedConditions } from "../findings-model.mjs";
import { clientConditionVoiceChecks, statementCoherenceChecks } from "../predelivery-lint.mjs";
import { degradedParts, PART_NAMES } from "../degraded-parts.mjs";
import { registerGapConditions } from "../pipeline.mjs";

const FRAME = "the blind frame-diff flagged a dominant-element omission the reopen pass did not close";
const ASK = "No consent from the owner of the earlier mark appears on the record searched";

test("an older record's stored clause in the engine's words reaches no client condition, and the others are unchanged", () => {
  const older = { verdict: "CONDITIONAL", tier: "Medium", reasons: [ASK, FRAME], clauses: [ASK, FRAME] };
  assert.deepEqual(clientConditions(older), [ASK], "the engine's sentence was printed as a condition on the clearance");
  assert.deepEqual(unrenderableConditions(older), [FRAME], "the withheld reason left the workbook's gaps sheet too");
  assert.deepEqual(statedConditions(older), { conds: [ASK], cls: [ASK] }, "the statement still counts the withheld clause");
  assert.equal(riskStatement(older), `Medium — conditional on: ${ASK}.`, "the statement led with, or counted, what the list withholds");
});

test("a new run's frame reason is the run record's alone: no clause, no statement line, and the delivery lint stays quiet", () => {
  const fresh = { verdict: "CONDITIONAL", tier: "Medium", stance: "conditional", reasons: [FRAME], clauses: [null] };
  assert.deepEqual(clientConditions(fresh), []);
  assert.equal(riskStatement(fresh), "Medium", "with nothing stated, the band word stands alone");
  assert.ok(statementCoherenceChecks({ verdictDoc: { ...fresh, statement: riskStatement(fresh) } }).every((c) => c.pass));
  assert.ok(clientConditionVoiceChecks({ verdictDoc: fresh }).every((c) => c.pass), "a reason ruled to the run record is not a dropped condition");
});

test("the delivery lint flags an older record's stored sentence as dropped, and the report still ships", () => {
  const older = { verdict: "CONDITIONAL", tier: "Medium", reasons: [ASK, FRAME], clauses: [ASK, FRAME] };
  const all = clientConditionVoiceChecks({ verdictDoc: older });
  assert.ok(all.some((c) => !c.pass && /reach no client surface/.test(c.detail ?? c.message ?? "")), `the drop was not flagged: ${JSON.stringify(all)}`);
  assert.ok(all.every((c) => !c.structural), "a flag, never a withholding");
});

test("the test of engine words reads the frame sentence, and no shipped clause or lawyer's phrase", () => {
  assert.equal(carriesEngineWords(FRAME), true);
  assert.equal(carriesEngineWords("floor_duty_undischarged:3 of 9 floor rows"), true, "guard: the token shape still reads");
  const shipped = [clauseForDefect("floor_duty_undischarged", 3, 9), clauseForDefect("synthesis_unaccounted_delivered", 2, 7),
    ...registerGapConditions({ deferred: [{ axis: "eu" }], taintAxes: ["eu"] }).map((c) => c.clause).filter(Boolean)];
  assert.ok(shipped.length >= 3, "guard: the shipped clauses were read");
  for (const c of shipped) assert.equal(carriesEngineWords(c), false, `a shipped clause would be withheld: ${c}`);
  assert.equal(carriesEngineWords("Consent is needed from the owner of the mark sharing the dominant element, in class 9"), false, "a lawyer's phrase was read as the engine's");
  assert.throws(() => terminalClampDecision({ verdict: "CLEAR", defect: "frame_gap:1", reason: `frame_gap:1 ${FRAME}`, clause: FRAME }), /engine identifier \((?:blind frame|frame-diff)\)/,
    "a guard could still store the sentence as a reader's clause");
});

test("the audit workbook records the register part the reopen left unfinished, and nothing once it closed", (t) => {
  const run = (receipt) => {
    const dir = mkdtempSync(join(tmpdir(), "frame-part-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(driverDir(dir), { recursive: true });
    writeFileSync(join(dir, "audit.md"), "# What was searched\n\nA search.\n");
    writeFileSync(driverDir(dir, "run.jsonl"), "");
    writeFileSync(driverDir(dir, "frame-reopen.json"), JSON.stringify(receipt));
    return degradedParts(dir).filter((p) => p.name === PART_NAMES.register);
  };
  const open = run({ dominant_element_gap: true, domClosed: false });
  assert.equal(open.length, 1, "the unfinished part reached no audit row");
  assert.match(open[0].cause, /the dominant-element crowd: the omission the blind frame comparison flagged was not closed by the reopen pass/, "the cause stays on the record");
  assert.deepEqual(run({ dominant_element_gap: true, domClosed: true }), [], "a closed omission is no part left unfinished");
});
