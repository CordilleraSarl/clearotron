// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileRegisterPlan, joinPlanToBands, deriveCoverageSkeleton, findUnexecutedCleanClaims,
  awaitsReadingTurn, guardParentQid } from "../register-plan.mjs";
import { PROVIDER_CAPABILITIES } from "../register-capabilities.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── ON EVERY MATTER (2026-09-21): THE FAMILIES WAIT FOR THE ASK, NOT FOR A RESULT ────────────────────────────────
//
// Decision 12 used to release the wider families when the identical question came back as a list. So a
// matter whose mark was NOT crowded opened scripts, neighbours, compounds and guessed owners in the
// same breath as the identical question, before a single record had been read. The production run of
// 21 September is the evidence: the identical question answered with a list of 100, every wider family
// then ran, 1,921 records were read, and the reading stages took the hours.
//
// The rule now holds on every matter, crowded or not. The ungated set is exactly three kinds — the
// identical-mark entries, the saturation probe, and the always-on goods-narrowed contains entry — and
// everything else waits for the reading turn to ask for it under step 6.
//
// ASSERTED AS A PROPERTY OVER COMPILED PLANS, not over a recorded one. The four plans the acceptance
// names (16 September, beta.14, beta.15, and the 21 September production plan) are private run
// artifacts and a production plan is never quoted anywhere, so recompiling those is an e2e task on the
// private side. What belongs here is the rule itself, driven over the shapes a plan actually takes.

const MARK = "VELTRIS";
const manifestFor = (over = {}) => ({
  schema_version: 1, mark: MARK, dominant_element: MARK,
  elements: [{ value: MARK, kind: "distinctive" }],
  variants: [{ value: MARK, category: "core" }, { value: "VELTRISS", category: "spelling" },
    { value: "WELTRIS", category: "sound-alike" }, { value: "ヴェルトリス", category: "transliteration" },
    { value: "VELTRIS PRO", category: "compound" }],
  incumbent_classes: ["9"], goods_words: ["software", "platform"], ...over,
});
const JOB = { jobKey: "t", classes: ["9", "42"], jurisdictions: ["US", "EU"] };

const isIdentical = (e) => e.provenance === "mark"
  && !(Array.isArray(e.goods_text) && e.goods_text.length)
  && String(e.predicate) !== "default";
const isGoodsNarrowed = (e) => Array.isArray(e.goods_text) && e.goods_text.length > 0;
const isSaturation = (e) => e.axis === "saturation-probe";

const PLANS = () => {
  const out = [];
  for (const [provider, caps] of Object.entries(PROVIDER_CAPABILITIES)) {
    for (const [label, manifest] of [
      ["ordinary", manifestFor()],
      ["no goods words", manifestFor({ goods_words: [] })],
      ["latin only", manifestFor({ variants: [{ value: MARK, category: "core" },
        { value: "VELTRISS", category: "spelling" }] })],
    ]) {
      try { out.push({ provider, label, plan: compileRegisterPlan({ manifest, job: JOB, capabilities: caps }) }); }
      catch { /* a provider that cannot compile this shape contributes no plan */ }
    }
  }
  return out;
};

test("the population this walks is real, so an empty result would mean something", () => {
  // THE PREMISE. Every assertion below is a filter over compiled plans, and all of them pass
  // vacuously against an empty list. Measured 2026-09-21: six providers, three manifests.
  const plans = PLANS();
  assert.ok(plans.length >= 6, `only ${plans.length} plans compiled — the arms below are asserting over nothing`);
  assert.ok(plans.every((p) => p.plan.entries.length > 0), "a compiled plan carried no entries at all");
});

test("only the three ungated kinds run without an ask, on every matter", () => {
  for (const { provider, label, plan } of PLANS()) {
    for (const e of plan.entries) {
      if (e.when) continue;
      const why = `${provider}/${label}: ungated entry ${e.qid} (${e.axis}/${e.predicate}/${JSON.stringify(e.term ?? e.terms)})`;
      // An unsupported entry is a DISCLOSURE, not a search — it costs no reading and answers nothing,
      // so it is not gated and is not one of the three kinds either.
      if (e.unsupported === true) continue;
      assert.ok(isIdentical(e) || isSaturation(e) || isGoodsNarrowed(e),
        `${why} is none of the three kinds decision 10 leaves open`);
    }
  }
});

test("every wider family waits, and waits for the ASK rather than for a result", () => {
  for (const { provider, label, plan } of PLANS()) {
    const families = plan.entries.filter((e) =>
      !isIdentical(e) && !isSaturation(e) && !isGoodsNarrowed(e) && e.unsupported !== true);
    for (const e of families) {
      assert.ok(e.when, `${provider}/${label}: family ${e.qid} (${e.axis}) runs with no ask`);
      // THE AMENDMENT ITSELF. A family still gated on the identical question would be released the
      // moment that question came back as a list — which is decision 12, the thing the 2026-09-21 ruling
      // reverses. A guard naming any parent qid at all is the old shape.
      assert.equal(guardParentQid(e.when), null,
        `${provider}/${label}: family ${e.qid} waits on a RESULT (${guardParentQid(e.when)}), not on the reading turn`);
      assert.ok(awaitsReadingTurn(e.when), `${provider}/${label}: family ${e.qid} carries an unrecognised guard`);
    }
    assert.ok(families.length > 0, `${provider}/${label}: no family waited — nothing was gated at all`);
  }
});

test("an enumerated identical question releases nothing", () => {
  // DRIVEN THROUGH THE JOIN, against the exact condition decision 12 used to release on. This is the
  // arm that would have gone green under the old rule, so it is the one that says the rule changed.
  const { plan } = PLANS()[0];
  const identical = plan.entries.find(isIdentical);
  const bands = { "primary-sweep": plan.entries.filter((e) => !e.when).map((e) => ({
    qid: e.qid, state: "enumerated", records: [], total_hits: 0 })) };
  const join = joinPlanToBands(plan, bands);
  assert.ok(identical, "the fixture carries no identical question");
  assert.equal(join.executed.some((x) => x.qid === identical.qid), true,
    "the identical question did not execute, so this proves nothing about what it releases");
  const families = plan.entries.filter((e) => awaitsReadingTurn(e.when)).map((e) => e.qid);
  assert.ok(families.length > 0, "nothing was waiting — the arm has no subject");
  for (const qid of families) {
    assert.equal(join.executed.some((x) => x.qid === qid), false, `${qid} ran on an enumerated identical question`);
    assert.equal(join.awaiting.some((x) => x.qid === qid), true, `${qid} is not recorded as awaiting the ask`);
  }
});

test("a family awaiting the ask is not filed as a crowd-gated skip", () => {
  // THE DISCLOSURE, and the half that would reach a reader wrong. `skipped` says a parent question
  // proved intractable and its crowd stands as dilution context. A family awaiting the reading turn
  // has no such parent and no such crowd — on a matter where the identical mark may have answered
  // perfectly. Folding them together would file "not asked, by judgment" under "held back by a crowd".
  const { plan } = PLANS()[0];
  const join = joinPlanToBands(plan, { "primary-sweep": plan.entries.filter((e) => !e.when)
    .map((e) => ({ qid: e.qid, state: "enumerated", records: [], total_hits: 0 })) });
  assert.ok(join.awaiting.length > 0, "nothing awaited — the arm has no subject");
  const awaitingQids = new Set(join.awaiting.map((x) => x.qid));
  for (const s of join.skipped) assert.equal(awaitingQids.has(s.qid), false,
    `${s.qid} was filed as a crowd-gated skip as well as awaiting the ask`);
  for (const a of join.awaiting) assert.equal(join.missing.includes(a.qid), false,
    `${a.qid} reads as never-ran rather than as not-yet-asked`);
});

test("no clean may rest on an axis whose families were never asked for", () => {
  // Held to the same standard as `skipped` and `deferred`: nothing on the axis ran. The TOKEN is its
  // own, because `skipped` would send the reader looking for a crowd that never happened.
  const { plan } = PLANS()[0];
  const join = joinPlanToBands(plan, { "primary-sweep": plan.entries.filter((e) => !e.when)
    .map((e) => ({ qid: e.qid, state: "enumerated", records: [], total_hits: 0 })) });
  const skeleton = deriveCoverageSkeleton(plan, join);
  const awaitingAxes = skeleton.filter((s) => s.state === "awaiting-judgment");
  assert.ok(awaitingAxes.length > 0, "no axis came back awaiting judgment — the arm has no subject");
  const claims = awaitingAxes.map((s) => ({ axis: s.axis, status: "confirmed-clean" }));
  const violations = findUnexecutedCleanClaims(claims, skeleton);
  assert.equal(violations.length, awaitingAxes.length, "a clean claim stood over an axis nobody asked about");
  for (const v of violations) assert.match(v.token, /^coverage_clean_awaiting_judgment:/,
    `the violation is reported as "${v.token}", which names the wrong reason`);
});

test("the shipped manual carries the words the model reads, not only the config copy", () => {
  // THE INERT-FEATURE TRAP, and it has already cost this build once: the instruction went to the
  // config repo's skills and not to the manual the engine ships, so the model never saw it. These are
  // the owner's ruled sentences; they are asserted as SHIPPED, in the tree the product carries.
  for (const f of ["SKILL.md", "unit.md"]) {
    const src = readFileSync(join(HERE, "..", "skills", "clearance-register", f), "utf8");
    assert.match(src, /At every step: look at what you have before you work on it/,
      `${f} does not carry the rule that applies at every moment`);
    assert.match(src, /On every matter the identical mark, in the instructed classes, is the first thing you read/,
      `${f} does not say the identical mark is read first on EVERY matter`);
    assert.match(src, /to the placements, to the off-register sweep and to the write-up alike/,
      `${f} does not name the five moments the rule applies at`);
    // Steps 5 and 6 carry no crowd precondition: they are what the reading turn does with the list it
    // has, whatever the count was.
    assert.match(src, /5\. When the readable list already holds conflicts in the client's field, stop widening/, f);
    assert.match(src, /6\. When the readable list is thin, widen one step at a time/, f);
  }
});
