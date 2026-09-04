// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE END-TO-END LINK THIS WHOLE ISSUE IS ABOUT: a capability EUIPO genuinely lacks must land
// as a band block carrying `deferred: true` ALONGSIDE `error: true`, and never as a weaker query, a
// clean negative, or a plain error.
//
// WHY THE UNIT TESTS NEXT DOOR ARE NOT ENOUGH. They prove `buildRsql` throws with the marker and that
// `doSearch` returns it as an ERROR string instead of throwing. Neither says anything about the BLOCK
// the executor writes, and the block is the whole product:
//
//   error:true ALONE          → joinPlanToBands counts the slice MISSING → the repair ladder retries a
//                               DETERMINISTIC refusal → an honest-fail StageFailure. A run-killer.
//   error:true + deferred:true → the deferred bucket → the axis gets a `deferred` coverage state →
//                               disclosed on the face of the report, run delivered.
//
// The gap between those two is one boolean, produced several layers away from where the refusal is
// raised, and nothing in between would fail if the link broke.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "euipo-defer-"));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(DIR, "calls.jsonl");
process.env.CLEAROTRON_REGISTER_RECORD_LOG = join(DIR, "records.jsonl");
process.env.EUIPO_CLIENT_ID = "test-client-id";
process.env.EUIPO_CLIENT_SECRET = "test-client-secret";
process.env.EUIPO_ENVIRONMENT = "sandbox";

const { doExecutePlan } = await import("../src/core.js");
const { CAPABILITY_GAP_MARKER } = await import("../../_shared/execute-plan.mjs");

const AUTH = { clientId: "test-client-id", clientSecret: "test-client-secret", environment: "sandbox" };
const TCTX = { kind: "test", agentId: "t", sessionKey: null, sessionId: null };

/** Write a frozen plan carrying exactly these entries on one axis, run it, return the written band. */
async function runPlan(entries, { planRegions = ["EU"] } = {}) {
  const planPath = join(DIR, `plan-${Math.abs(entries.length * 7 + entries[0].qid.length)}.json`);
  const outPath = join(DIR, `band-${entries[0].qid}.json`);
  writeFileSync(planPath, JSON.stringify({
    regions: planRegions,
    entries: entries.map((e) => ({ axis: "primary-sweep", nice_classes: [9], ...e })),
  }, null, 2));
  const r = await doExecutePlan(AUTH, { plan_path: planPath, axis: "primary-sweep", output_path: outPath }, TCTX);
  const summary = r?.text ?? "";
  let band = [];
  try { band = JSON.parse(readFileSync(outPath, "utf8")); } catch { /* the executor may have refused wholesale */ }
  return { band, summary, byQid: Object.fromEntries(band.map((b) => [b.qid, b])) };
}

// Nothing here reaches the network: every entry below is refused CLIENT-SIDE, before a request is
// built. `fetch` is left deliberately un-stubbed so that a slice which DID dial would fail loudly
// rather than quietly passing against a mock.
const NO_NETWORK = () => { throw new Error("a refused slice reached the wire — it must never be sent"); };

test("a PHONETIC slice lands as error + DEFERRED, and is never dispatched", async () => {
  globalThis.fetch = NO_NETWORK;
  const { byQid } = await runPlan([{ qid: "q-phonetic", predicate: "phonetic", term: "ALPHA" }]);
  const b = byQid["q-phonetic"];
  assert.ok(b, "the slice produced no block at all — it would be counted MISSING with no reason");
  assert.equal(b.error, true, "a capability gap must still stamp error:true — no consumer may read it as a crowd");
  assert.equal(b.deferred, true,
    "error WITHOUT deferred is the run-killer: MISSING → repair ladder → StageFailure over a refusal that can never change");
  assert.equal(b.state, "incomplete");
  assert.equal(b.total_hits, 0);
  assert.deepEqual(b.sample, [], "a deferred slice carries no records — it was never executed");
  assert.match(b.reason, /phonetic/i);
});

test("a slice for a territory EUIPO does not hold lands as error + DEFERRED", async () => {
  globalThis.fetch = NO_NETWORK;
  const { byQid } = await runPlan([{ qid: "q-us", predicate: "default", term: "ALPHA", regions: ["US"] }]);
  const b = byQid["q-us"];
  assert.ok(b, "no block for an out-of-coverage territory — the gap would be invisible");
  assert.equal(b.error, true);
  assert.equal(b.deferred, true, "an uncovered jurisdiction is a DISCLOSED gap, never a silent EU search");
  assert.equal(b.total_hits, 0, "an uncovered territory must never report a counted zero");
});

test("the refusal reason carries the capability-gap marker — the token that classifies it deterministic", async () => {
  // repairs.mjs DETERMINISTIC_RE keys on this. Without it the park ladder grinds against an answer
  // that cannot change, burning the retry budget on a refusal we raised ourselves.
  globalThis.fetch = NO_NETWORK;
  const { byQid } = await runPlan([
    { qid: "q-ph", predicate: "phonetic", term: "ALPHA" },
    { qid: "q-us2", predicate: "default", term: "ALPHA", regions: ["US"] },
  ]);
  for (const qid of ["q-ph", "q-us2"]) {
    assert.match(byQid[qid].reason, new RegExp(CAPABILITY_GAP_MARKER),
      `${qid}: the reason must carry "${CAPABILITY_GAP_MARKER}" so the repair ladder classifies it deterministic`);
  }
});

test("a slice the COMPILER stamped unsupported is deferred without being built", async () => {
  globalThis.fetch = NO_NETWORK;
  const { byQid } = await runPlan([{
    qid: "q-unsup", predicate: "phonetic", term: "ALPHA",
    unsupported: true, unsupported_reason: "the active register provider does not support phonetic search",
  }]);
  const b = byQid["q-unsup"];
  assert.equal(b.error, true);
  assert.equal(b.deferred, true);
  assert.match(b.reason, /phonetic/i);
});

test("a DEFERRED slice and a PLAN-DEFECT slice are stamped differently", async () => {
  // Both are error:true and neither is dispatched, but only ONE is deferred. A plan defect is a bug in
  // the plan — it must NOT be excused as a provider limitation, or a malformed plan ships as disclosed
  // coverage. `deferred` is reserved for capabilities the provider honestly lacks.
  globalThis.fetch = NO_NETWORK;
  const { byQid } = await runPlan([
    { qid: "q-gap", predicate: "phonetic", term: "ALPHA" },
    // an anchored `*` under `exact` — the plan-defect shape term-shape.mjs catches
    { qid: "q-defect", predicate: "exact", term: "*ALPHA*" },
  ]);
  assert.equal(byQid["q-gap"].deferred, true, "a genuine capability gap IS deferred");
  assert.equal(byQid["q-defect"].error, true, "a plan defect is still an error");
  assert.notEqual(byQid["q-defect"].deferred, true,
    "a PLAN DEFECT must not be excused as a provider capability gap — that would ship a malformed plan as disclosed coverage");
  assert.match(byQid["q-defect"].reason, /plan-defect/);
});

test("a deferred slice does not take the rest of the axis down with it", async () => {
  // The failure this guards: one unanswerable slice aborting execute_plan would leave every OTHER
  // dictated entry on the axis with no block — turning one disclosed gap into a whole missing axis.
  let dialled = 0;
  globalThis.fetch = async (url) => {
    dialled += 1;
    if (String(url).includes("accessToken")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 7200 }), { status: 200 });
    }
    return new Response(JSON.stringify({
      trademarks: [{
        applicationNumber: "000000001", wordMarkSpecification: { verbalElement: "ALPHA" },
        niceClasses: [9], status: "REGISTERED", registrationDate: "2020-06-01",
        applicants: [{ office: "EM", identifier: "1", name: "ACME GmbH" }],
      }],
      totalElements: 1, totalPages: 1, size: 10, page: 0,
    }), { status: 200 });
  };
  const { byQid } = await runPlan([
    { qid: "q-ok", predicate: "exact", term: "ALPHA" },
    { qid: "q-gap2", predicate: "phonetic", term: "ALPHA" },
  ]);
  assert.equal(byQid["q-gap2"].deferred, true);
  assert.ok(byQid["q-ok"], "the answerable slice lost its block because a sibling deferred");
  assert.equal(byQid["q-ok"].error, undefined, `the answerable slice errored: ${byQid["q-ok"].reason ?? ""}`);
  assert.equal(byQid["q-ok"].state, "enumerated");
  assert.ok(dialled > 0, "the answerable slice never reached the wire");
});

test.after(() => rmSync(DIR, { recursive: true, force: true }));
