// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE COVERAGE FLOOR'S OWN SENTENCES STAY IN THE RUN RECORD.
//
// When the floor clamped a clearance to CONDITIONAL, three of its reasons went to the client's "conditional on" list
// as written: "the lawyer judged a material slice not fully cleared: …", "follow-ups left open this run: …" and "the
// oldest registration in a verdict-driving family could not be retrieved (policy: clamp): …". The lawyer there is the
// engine's synthesis step, and a reader takes it for a person; "slice", "this run" and "(policy: clamp)" are the
// engine's words. They now leave every client surface with nothing written in their place, as the frame comparison's
// and the screen gate's sentences already did, and stay in the run record. The register lines keep the clauses the
// owner ruled. Every value here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coverageFloorConditions } from "../steps/verdict-gate.mjs";
import { clientConditions, clientStatement, carriesEngineWords } from "../terminal-clamp.mjs";
import { riskStatement } from "../findings-model.mjs";
import { clientConditionVoiceChecks } from "../predelivery-lint.mjs";
import { registerGapConditions } from "../pipeline.mjs";

const INPUTS = {
  coverageInsufficient: true, coverageReason: "the Korean exact form was not searched",
  frameDeferrals: [{ directive: "source: the KR register, variant: TARNELO" }],
  seniorUnverified: [{ mark: "TARNELLO", applicable: true, verified: false }],
};
const sidecar = (rows) => ({ verdict: "CONDITIONAL", tier: "Medium", reasons: rows.map((r) => r.reason), clauses: rows.map((r) => r.clause) });

test("the three reasons stay in the run record, whole, and none of them reaches the client's conditions", () => {
  const rows = coverageFloorConditions(INPUTS);
  assert.deepEqual(rows.map((r) => r.reason), [
    "the lawyer judged a material slice not fully cleared: the Korean exact form was not searched",
    "follow-ups left open this run: the KR register, TARNELO",
    "the oldest registration in a verdict-driving family could not be retrieved (policy: clamp): TARNELLO",
  ], "the run record keeps each reason as it was");
  assert.deepEqual(rows.map((r) => r.clause), [null, null, null], "a clause was written for the client");
  const v = sidecar(rows);
  assert.deepEqual(clientConditions(v), [], "the report, the portal and the email read their conditions here");
  assert.equal(riskStatement(v), "Medium", "with nothing stated, the band word stands alone");
  assert.equal(clientStatement({ ...v, statement: riskStatement(v) }), "Medium", "the assistant's summary adds nothing");
  assert.ok(clientConditionVoiceChecks({ verdictDoc: v }).every((c) => c.pass), "a reason ruled to the run record is not a dropped condition");
});

test("the frame comparison and the screen gate keep their earlier rulings, and the register lines keep their clauses", () => {
  const rows = coverageFloorConditions({
    frameGap: true, frameDeferrals: INPUTS.frameDeferrals,
    screenGateUnresolved: [{ mark: "BRISQUETTE" }],
    registerRows: registerGapConditions({ deferred: [{ axis: "eu" }], taintAxes: ["eu"] }),
  });
  assert.match(rows[0].reason, /blind frame-diff/, "a frame gap outranks its deferrals, as before");
  assert.equal(rows.filter((r) => /follow-ups left open/.test(r.reason)).length, 0);
  assert.match(rows[1].reason, /^1 in-scope mark\(s\) dropped on goods could not be record_fetched \(unverified\): BRISQUETTE$/);
  assert.deepEqual([rows[0].clause, rows[1].clause], [null, null]);
  const register = rows.slice(2);
  assert.ok(register.length > 0 && register.some((r) => typeof r.clause === "string" && r.clause.length > 0),
    "the owner-ruled register clauses are passed through");
  assert.deepEqual(clientConditions(sidecar(rows)), clientConditions(sidecar(register)), "only the register lines reach the client");
});

test("an older record that stored the three sentences as clauses shows them to no client either", () => {
  const ASK = "No consent from the owner of the earlier mark appears on the record searched";
  const rows = coverageFloorConditions(INPUTS);
  const older = { verdict: "CONDITIONAL", tier: "Medium", reasons: [ASK, ...rows.map((r) => r.reason)], clauses: [ASK, ...rows.map((r) => r.reason)] };
  assert.deepEqual(clientConditions(older), [ASK], "a stored engine sentence was printed as a condition");
  for (const r of rows) assert.equal(carriesEngineWords(r.reason), true, `the engine-words test does not read: ${r.reason}`);
  // The widened test still reads a lawyer's sentence as a lawyer's.
  for (const said of [ASK, "A follow-up search of the Korean register is recommended", "The registration's policy terms were not checked"])
    assert.equal(carriesEngineWords(said), false, `a lawyer's phrase was read as the engine's: ${said}`);
});

test("a floor with nothing to say says nothing", () => {
  assert.deepEqual(coverageFloorConditions({}), []);
  assert.deepEqual(coverageFloorConditions({ coverageInsufficient: false, frameDeferrals: [], seniorUnverified: null }), []);
});
