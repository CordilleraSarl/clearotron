// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A GOODS SLICE AND AN ADDED CLASS READ AS THEMSELVES IN THE RUN'S RECORD.
//
// Two misreadings on one delivered run, both from what the driver wrote rather than from what ran:
//   · A goods-narrowed question shares predicate, term and classes with the identical one, and nothing
//     the digest was shown carried the goods words, so its refused slice was written into the ledger as
//     the core exact search failing. The words now reach the digest's brief and the executor's query
//     description; the unit label is also the client's coverage table, so it is left exactly as it was.
//   · The skeptic's coverage block names what was refused and what is open, and nothing that ran, so a
//     class the frame added beyond the instructed ones was asked and answered and still reported as never
//     swept.
// Held on the entries the shared mint and the compiler build, and on a receipt the join builds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coverageFormRows, buildCoverageForm, parseCoverageForm, coverageFormBrief, formLedgerRows } from "../coverage-form.mjs";
import { blockSearchedClasses } from "../close-verify.mjs";
import { describePlanEntry } from "../../providers/_shared/execute-plan.mjs";
import { mintSupplementalEntries } from "../engine/mcp/supplemental.mjs";
import { compileRegisterPlan, joinPlanToBands } from "../register-plan.mjs";
import { skepticDeferralExtra } from "../pipeline.mjs";
import { PROVIDER_CAPABILITIES } from "../register-capabilities.mjs";

const MARK = "VELTRIN";
const CORE = { qid: "primary-sweep:exact:veltrin", axis: "primary-sweep", predicate: "exact", term: MARK, nice_classes: ["41"] };
const narrowed = () => {
  const { minted, rejected } = mintSupplementalEntries("primary-sweep",
    [{ predicate: "exact", term: MARK, nice_classes: ["41"], goods_words: ["entertainment"], narrows: CORE.qid, rationale: "the identical question crowded" }],
    { capabilities: PROVIDER_CAPABILITIES.signa });
  assert.deepEqual(rejected, []);
  assert.equal(minted.length, 1);
  return minted[0];
};

test("the digest's brief names a goods slice's words; the unit label, which the client reads, is unchanged", () => {
  const goods = narrowed();
  const input = {
    skeleton: [{ axis: "primary-sweep", state: "deferred", deferred: [goods.qid, CORE.qid] }],
    plan: { entries: [CORE, goods] },
    deferredReasons: { [goods.qid]: "refused", [CORE.qid]: "refused" },
  };
  const { rows } = coverageFormRows(input);
  const row = (qid) => rows.find((r) => r.kind === "deferred" && r.qid === qid);
  // The label is today's, byte for byte, on both rows: it is printed in the client's coverage table.
  assert.equal(row(goods.qid).unit, "primary-sweep / exact: VELTRIN [cl 41]");
  assert.equal(row(CORE.qid).unit, "primary-sweep / exact: VELTRIN [cl 41]");
  assert.deepEqual(row(goods.qid).goods_words, ["entertainment"]);
  assert.equal(row(CORE.qid).goods_words, undefined);
  // Through the form as written to disk and read back, into what the digest is shown.
  const parsed = parseCoverageForm(JSON.stringify(buildCoverageForm(input)));
  assert.equal(parsed.error ?? null, null);
  const brief = coverageFormBrief(parsed);
  const line = (qid) => brief.split("\n").find((l) => l.includes(row(qid).row_id)) ?? "";
  assert.ok(line(goods.qid).includes("narrowed to goods words: entertainment"), `the digest is not told which slice this is:\n${line(goods.qid)}`);
  assert.ok(!line(CORE.qid).includes("goods words"), "the core question was described as narrowed");
  // The ledger rows the client's report is built from carry no new field.
  const settled = parsed.rows.map((r) => ({ ...r, status: "deferred", reason: "r" }));
  for (const r of formLedgerRows(settled)) assert.deepEqual(Object.keys(r).sort(), ["axis", "reason", "status", "unit"]);
});

test("the executor's query names the goods words after the class tag, and close-verify still reads the classes", () => {
  const goods = narrowed();
  const q = describePlanEntry(goods);
  assert.equal(q, "exact VELTRIN [cl 41] goods:entertainment");
  assert.deepEqual(blockSearchedClasses({ query: q }), ["41"], "the goods words broke the class read-back");
  assert.equal(describePlanEntry(CORE), "exact VELTRIN [cl 41]", "a question with no goods words changed");
});

// The added class's question as the compiler builds it, and the receipt as the join builds it.
const MANIFEST = { schema_version: 1, mark: MARK, dominant_element: MARK, elements: [{ value: MARK, kind: "distinctive" }],
  variants: [{ value: MARK, category: "core" }], incumbent_classes: ["9"], goods_words: ["games"] };
const JOB = { jobKey: "t", classes: ["9", "41"], jurisdictions: ["US"] };
const planWith = (addedClasses) => compileRegisterPlan({ manifest: MANIFEST, job: JOB, addedClasses,
  capabilities: PROVIDER_CAPABILITIES.signa });
const receiptFor = (plan, answerOf) => {
  const bands = {};
  for (const e of plan.entries) {
    const b = answerOf(e);
    if (b) (bands[e.axis] ??= []).push({ qid: e.qid, ...b });
  }
  return joinPlanToBands(plan, bands);
};
const skepticBlock = (plan, receipt) => {
  const dir = mkdtempSync(join(tmpdir(), "skeptic-added-class-"));
  try {
    return skepticDeferralExtra({ registerPlan: plan, planExecution: receipt,
      paths: { runDir: dir, planExecution: join(dir, "plan-execution.json"), registerCoverageLedger: join(dir, "ledger.md"),
        envelopeDecision: join(dir, "envelope-decision.json") } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
};
const HEADER = "Classes the frame added beyond the instructed ones — each question, and what it returned:";
const ENUMERATED = { state: "enumerated", records: Array.from({ length: 7 }, (_, i) => ({ mark_text: `R${i}` })), total_hits: 7 };

test("the skeptic reads each added class's question and what it returned", () => {
  const plan = planWith([{ class: "28", reason: "video game accessories sold with the client's software" }]);
  const added = plan.entries.find((e) => e.added_class_reason);
  assert.ok(added, "the compiler minted no question for the added class");
  const receipt = receiptFor(plan, (e) => (e.when ? null : ENUMERATED));
  const block = skepticBlock(plan, receipt);
  assert.ok(block.includes(HEADER), "the skeptic is told nothing about the class the frame added");
  assert.ok(block.includes(`- ${added.qid} (class 28) — enumerated, 7 records`), `the added class's answer is not stated:\n${block.slice(-600)}`);
});

test("an added class the register refused is named as refused, never as answered", () => {
  const plan = planWith([{ class: "28", reason: "video game accessories sold with the client's software" }]);
  const added = plan.entries.find((e) => e.added_class_reason);
  const receipt = receiptFor(plan, (e) => (e.when ? null : e.qid === added.qid ? null : ENUMERATED));
  receipt.missing = receipt.missing.filter((q) => q !== added.qid);
  receipt.deferred = [...(receipt.deferred ?? []), { qid: added.qid, reason: "capability-gap: the register refused this query" }];
  assert.ok(skepticBlock(plan, receipt).includes(`- ${added.qid} (class 28) — refused (listed above)`));
});

test("THE CONTROL: with no class added, the skeptic's block carries no added-class lines", () => {
  const plan = planWith([]);
  assert.equal(plan.entries.filter((e) => e.added_class_reason).length, 0);
  const block = skepticBlock(plan, receiptFor(plan, (e) => (e.when ? null : ENUMERATED)));
  assert.ok(block.length > 0, "the block was not built at all, so this control proves nothing");
  assert.ok(!block.includes(HEADER));
});
