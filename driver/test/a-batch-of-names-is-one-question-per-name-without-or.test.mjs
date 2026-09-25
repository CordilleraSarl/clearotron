// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ON A REGISTER WITHOUT OR, A BATCH OF NAMES IS ONE QUESTION PER NAME.
//
// The reading turn asked for batches of names — 80, 53 and 7 on one delivered run — and a register that
// takes one name per request ran each batch as windows of one name under a single question. The
// enumerate kernel stopped the whole batch at the first name that crowded or failed, so 116 names were
// never sent, among them every one-letter variant the turn had asked for. Ruled: split. Each name is its
// own question with its own count, crowd decision and receipt row, and the batch still spends one slot of
// the mint's caps, as it did.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mintSupplementalEntries, supplementalSlots } from "../engine/mcp/supplemental.mjs";
import { compileRegisterPlan, joinPlanToBands, foldSupplementalEntries, awaitsReadingTurn } from "../register-plan.mjs";
import { PROVIDER_CAPABILITIES } from "../register-capabilities.mjs";
import { CAPABILITIES as SIGNA } from "../../providers/signa/src/capabilities.js";
import { CAPABILITIES as CLARIVATE } from "../../providers/clarivate/src/capabilities.js";

const batch = (names, extra = {}) => ({ predicate: "exact", terms: names, nice_classes: ["9"], rationale: "the close forms, read as a list", ...extra });
const NAMES = ["VELTRINA", "VELTRINE", "VELTRINO"];

test("a batch becomes one single-name question per name, each with its own qid", () => {
  assert.equal(SIGNA.maxOrWidth, 1, "the fixture register has OR after all — this arm asserts nothing");
  const { minted, rejected } = mintSupplementalEntries("primary-sweep", [batch(NAMES)], { capabilities: SIGNA });
  assert.deepEqual(rejected, []);
  assert.deepEqual(minted.map((e) => e.term), NAMES);
  assert.ok(minted.every((e) => e.terms === undefined), "a child still carries the batch");
  assert.equal(new Set(minted.map((e) => e.qid)).size, NAMES.length);
  assert.equal(new Set(minted.map((e) => e.split_of)).size, 1, "the names do not name their batch");
  // Each name is its own receipt row.
  const plan = { plan_version: 1, regions: ["US"], entries: minted };
  const join = joinPlanToBands(plan, { "primary-sweep": [
    { qid: minted[0].qid, state: "enumerated", records: [{}, {}], total_hits: 2 },
    { qid: minted[1].qid, state: "incomplete", total_hits: 1756, reason: "a crowd" },
    { qid: minted[2].qid, state: "enumerated", records: [], total_hits: 0 },
  ] });
  assert.deepEqual(join.executed.map((x) => [x.qid, x.state]), minted.map((e, k) => [e.qid, ["enumerated", "incomplete", "enumerated"][k]]),
    "a crowded name took the names after it down with it");
});

test("THE CONTROL: where the register takes OR, the batch stays one question", () => {
  const { minted } = mintSupplementalEntries("primary-sweep", [batch(NAMES)], { capabilities: CLARIVATE });
  assert.equal(minted.length, 1);
  assert.deepEqual(minted[0].terms, NAMES);
  assert.equal(minted[0].split_of, undefined);
});

test("the names of a batch spend one slot of each cap between them, in this call and the next", () => {
  // Twelve batches of three are twelve slots: all 36 names mint, and a thirteenth batch is past the call's cap.
  const proposals = Array.from({ length: 13 }, (_, b) => batch(NAMES.map((n) => `${n}${String.fromCharCode(65 + b)}`)));
  // The tool sets no cap (ruled 2026-09-25); a caller that sets one still meets it per slot, not per name.
  const { minted, rejected } = mintSupplementalEntries("primary-sweep", proposals, { capabilities: SIGNA, perCall: 12, axisMax: 24 });
  assert.equal(minted.length, 36);
  assert.equal(rejected.length, 3);
  assert.ok(rejected.every((r) => /per-call cap 12/.test(r.issue)));
  // On file, the same twelve batches count as twelve toward the axis's cap, not thirty-six.
  assert.equal(supplementalSlots(minted), 12);
  assert.equal(supplementalSlots([...minted, { qid: "single", term: "X" }]), 13);
  // An 80-name batch mints whole where the axis has room for one more question.
  const eighty = Array.from({ length: 80 }, (_, k) => `VELTRIN${String.fromCharCode(65 + (k % 26))}${Math.floor(k / 26)}`);
  const late = mintSupplementalEntries("primary-sweep", [batch(eighty)], { capabilities: SIGNA, perCall: 12, axisMax: 24, existingCount: 23 });
  assert.equal(late.minted.length, 80, "the batch was cut by a cap it did not spend");
  assert.deepEqual(late.rejected, []);
});

test("a waiting family the reading turn asked inside a batch is recorded as asked", () => {
  const manifest = {
    schema_version: 1, mark: "VELTRIS", dominant_element: "VELTRIS", elements: [{ value: "VELTRIS", kind: "distinctive" }],
    variants: [{ value: "VELTRIS", category: "core" }, { value: "VELTRISS", category: "spelling" },
      { value: "WELTRIS", category: "sound-alike" }, { value: "VELTRIS PRO", category: "compound" }],
    incumbent_classes: ["9"], goods_words: ["software"],
  };
  const plan = compileRegisterPlan({ manifest, job: { jobKey: "t", classes: ["9", "42"], jurisdictions: ["US", "EU"] },
    capabilities: PROVIDER_CAPABILITIES.signa });
  const families = plan.entries.filter((e) => awaitsReadingTurn(e.when) && e.axis === "primary-sweep" && typeof e.term === "string"
    && !e.goods_text && !e.owner);
  assert.ok(families.length >= 2, `only ${families.length} single-name waiting families compiled — this arm asserts over too few`);
  const [a, b] = families;
  assert.equal(a.predicate, b.predicate, "the fixture's two families differ in predicate");
  // The turn asks both in ONE batch, as it did on the delivered run, inheriting the plan's regions.
  const ask = batch([a.term, b.term], { predicate: a.predicate, nice_classes: a.nice_classes });
  const { minted } = mintSupplementalEntries("primary-sweep", [ask], { capabilities: PROVIDER_CAPABILITIES.signa });
  const folded = foldSupplementalEntries(plan, minted);
  const join = joinPlanToBands(folded.plan, {});
  assert.deepEqual(join.asked.map((x) => x.qid).filter((q) => q === a.qid || q === b.qid).sort(), [a.qid, b.qid].sort(),
    "a family asked inside a batch still reads as never asked");
});
