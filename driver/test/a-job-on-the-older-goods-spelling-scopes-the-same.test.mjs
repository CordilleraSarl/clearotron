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
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { instructedScopeOf } from "../pipeline.mjs";
import { goodsOf, withFoldedGoods, GOODS_FIELDS } from "../queue-markers.mjs";

const JOB = { markName: "INVENTEDMARK", classes: [9] };
const GOODS = "headphones and audio apparatus";

// THE GATE'S OWN READING, IMPORTED. It was hand-copied here, which is the same mistake one layer up:
// a third spelling added to the real gate and not to the copy left this file green while the two sites
// disagreed about what a job carries. There is one reading now and both sides call it.
const gateSeesGoods = (job) => goodsOf(job) !== null;

const REPO = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const read = (...p) => readFileSync(join(REPO, ...p), "utf8");

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

// ── AND THE SCOPE FILE IS NOT THE ONLY READER ─────────────────────────────────────────────────────
//
// Fixing the scope stamp alone moved the seam instead of closing it: the clearance and knockout
// prompts, the pharmaceutical test, the product-context derivation, the portal's row and the plan
// preview all ask for the current field. A job on the older spelling would have recorded goods in the
// scope file that the prompts never saw — and the validator comparing frame to scope would report the
// disagreement as a fault in the frame, which is worse than the defect it replaced.

test("the fold puts the description on the field every reader asks for", () => {
  const job = { markName: "INVENTEDMARK", classes: [9], use: GOODS };
  assert.equal(withFoldedGoods(job).goods, GOODS,
    "a job on the older spelling still reaches the prompts with no goods");
  assert.equal(job.goods, undefined, "the fold mutated the job it was given");
});

test("a job already on the current field is handed back untouched, not rebuilt", () => {
  // Identity, deliberately: every run passes through this, and a caller must never have to ask whether
  // it got a copy. It is also what keeps a job with no goods at all byte-identical.
  const current = { markName: "INVENTEDMARK", goods: GOODS };
  assert.equal(withFoldedGoods(current), current);
  const none = { markName: "INVENTEDMARK" };
  assert.equal(withFoldedGoods(none), none);
  assert.equal(withFoldedGoods({ goods: "current", use: "older" }).goods, "current",
    "the older spelling overwrote the current field");
});

test("no dead knob: the assembly that builds a run's job actually folds", () => {
  // THE HALF THAT SILENTLY REVERTS. A correct fold nobody calls leaves every consumer exactly as it
  // was, and every arm above stays green. Read from the source because driving it needs a claimed
  // queue file, and the property is whether the call is there at all.
  const runner = read("driver", "runner.mjs");
  assert.match(runner, /return withFoldedGoods\(job\);/,
    "the job assembly no longer folds the goods spelling, so only the scope file sees it");
  assert.match(runner, /withFoldedGoods.*from "\.\/queue-markers\.mjs"/,
    "the fold is not imported from the module that owns the spellings — a second copy will drift");
});

test("the older spelling is read at the door and nowhere else in the product", () => {
  // THE ARM THAT WOULD HAVE CAUGHT THIS. Every other reader asking for the current field is the whole
  // point of folding once; a new site reading the older spelling directly is a second opinion about
  // what a job carries, and it is how the gate and the scope drifted apart to begin with.
  const older = GOODS_FIELDS[GOODS_FIELDS.length - 1];
  const DECLARED = ["queue-markers.mjs"];   // where the spellings are named, and the only place they may be
  const offenders = [];
  // THE CORPUS, ASSERTED BEFORE IT IS WALKED. A directory that reads as empty — a moved tree, a wrong
  // root, a filter that stops matching — walks nothing and reports no offender, which is exactly what
  // a clean product looks like. The number is a floor rather than a count, so ordinary growth and
  // ordinary deletion both leave it alone.
  const modules = readdirSync(join(REPO, "driver")).filter((n) => n.endsWith(".mjs"));
  assert.ok(modules.length > 50,
    `only ${modules.length} module(s) found to search — this walked the wrong tree and would report a `
    + "clean product whatever the product said");
  for (const f of modules) {
    if (DECLARED.includes(f)) continue;
    for (const [i, line] of read("driver", f).split("\n").entries()) {
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
      if (new RegExp(`\\bjob\\??\\.${older}\\b`).test(line)) offenders.push(`driver/${f}:${i + 1}  ${line.trim().slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, [],
    `the older goods spelling is read outside the module that declares it:\n  ${offenders.join("\n  ")}\n\n`
    + "Every reader in a run gets the current field from the fold at assembly. A direct read here is a "
    + "second reading of what a job carries, which is the seam this issue closed.");
});

test("the intake documentation says which field name is read", () => {
  // A CONDITION ON THE RELEASE, not a nicety: the ruling that placed this fix attached it, and an
  // integrator choosing a field name has no other way to learn which one the run reads. Documentation
  // that nothing checks goes stale at the first rename.
  const doc = read("docs", "INTAKE.md");
  assert.match(doc, /Which field name is read/, "the intake documentation does not state which name is read");
  for (const f of GOODS_FIELDS) assert.ok(doc.includes(`\`${f}\``), `the documentation does not name \`${f}\``);
  assert.match(doc, /folded onto `goods`/, "the documentation does not say the older spelling is folded, only that it is accepted");
});
