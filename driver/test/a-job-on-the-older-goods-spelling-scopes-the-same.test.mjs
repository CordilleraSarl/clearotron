// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-job-on-the-older-goods-spelling-scopes-the-same.test.mjs — the intake gate and the instructed
// scope must agree about what counts as a goods description.
//
// THE DEFECT LIVED IN THE SEAM, not in either site. The gate counts a job as carrying a goods
// description under the current field OR the older spelling. The scope stamp read the current field
// alone. So a job written the older way passed intake and landed `goods: null` — the scope file
// saying the matter named no goods while the request plainly did — and everything that asks what the
// matter covers reads that file. Both sites were individually correct and nothing compared them.
//
// This arm drives the pair: a job that the gate accepts as carrying goods must scope with goods.
import { test } from "node:test";
import assert from "node:assert/strict";
import { instructedScopeOf } from "../pipeline.mjs";

const JOB = { markName: "INVENTEDMARK", classes: [9] };
const GOODS = "headphones and audio apparatus";

/** The gate's own reading of "does this job carry a goods description" (enqueue-schema.mjs). */
const gateSeesGoods = (job) => Boolean(job.goods || job.use);

test("both spellings reach the gate, and both must reach the scope", () => {
  for (const [label, job] of [
    ["the current field", { ...JOB, goods: GOODS }],
    ["the older spelling", { ...JOB, use: GOODS }],
  ]) {
    assert.ok(gateSeesGoods(job), `precondition: the gate does not accept ${label}`);
    assert.equal(instructedScopeOf(job).goods, GOODS,
      `the gate accepted ${label} and the scope landed goods ${JSON.stringify(instructedScopeOf(job).goods)}`);
  }
});

test("a job on either spelling scopes identically, field for field", () => {
  const current = instructedScopeOf({ ...JOB, goods: GOODS });
  const older = instructedScopeOf({ ...JOB, use: GOODS });
  assert.deepEqual(older, current, "the two spellings produce different instructed scopes");
});

test("the gate and the scope cannot drift apart again", () => {
  // The invariant, stated as itself rather than as two spellings: whatever the gate counts as goods,
  // the scope carries. A third spelling added to one side and not the other fails here.
  for (const job of [{ ...JOB, goods: GOODS }, { ...JOB, use: GOODS }, { ...JOB }]) {
    assert.equal(gateSeesGoods(job), instructedScopeOf(job).goods !== null,
      `the gate and the scope disagree about ${JSON.stringify(Object.keys(job))}`);
  }
});

test("the current field wins when a job carries both, and neither leaves null", () => {
  assert.equal(instructedScopeOf({ ...JOB, goods: "current", use: "older" }).goods, "current");
  assert.equal(instructedScopeOf(JOB).goods, null, "a job naming no goods must scope null, not empty");
});

test("nothing else about the scope moved", () => {
  const scope = instructedScopeOf({ marks: [{ name: "A" }, "B"], classes: [9, 28],
    jurisdictions: ["US"], customer: "someone", geography: { mode: "named", origin: "request" }, use: GOODS });
  assert.deepEqual(scope.marks, ["A", "B"], "the mark list stopped being read from either shape");
  assert.deepEqual(scope.classes, [9, 28]);
  assert.deepEqual(scope.jurisdictions, ["US"]);
  assert.deepEqual(scope.geography, { mode: "named", origin: "request" });
  // Every key is present even when absent from the job — a missing key and an explicit null are not
  // the same answer to "what did the matter name?".
  for (const k of ["marks", "classes", "jurisdictions", "goods", "customer", "geography"]) {
    assert.ok(k in instructedScopeOf({}), `${k} is missing from the scope of an empty job`);
  }
});
