// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// an-exact-spelling-band-stacks-at-the-register-s-exact-width.test.mjs — the plan side of the list form.
//
// Signa takes one term per request in general (`maxOrWidth: 1`) and up to 100 exact spellings as one
// ranked list (`exactOrWidth: 100`). The exact spelling band now compiles in stacks of the exact width,
// so a band of 250 spellings is three entries, not 250. A provider that declares no exact width stacks at
// its general width exactly as before, and the general width still reads 1 for everything that asks
// whether Signa has an OR at all.
//
// The spellings are invented.
import test from "node:test";
import assert from "node:assert/strict";
import { compileRegisterPlan, planExactOrWidth, planMaxOrWidth, validatePlanFeasibility } from "../register-plan.mjs";
import { PROVIDER_CAPABILITIES } from "../register-capabilities.mjs";

const MARK = "ZYTHERMO";
const SPELLINGS = Array.from({ length: 250 }, (_, i) => `ZYTHERM${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`);
const manifest = { schema_version: 1, mark: MARK, dominant_element: MARK,
  elements: [{ value: MARK, kind: "distinctive" }], variants: [{ value: MARK, category: "core" }],
  incumbent_classes: [], goods_words: [] };
const form = { elements: [{ element: MARK, band: { element: MARK, exactQueries: SPELLINGS, wildcardPatterns: [] } }] };
const compile = (capabilities) => compileRegisterPlan({ manifest, job: { jobKey: "t", classes: ["9"], jurisdictions: [] }, form, capabilities });
const formEntries = (plan) => plan.entries.filter((e) => e.predicate === "exact" && e.provenance === "floor" && Array.isArray(e.terms));

test("Signa's exact spelling band compiles in stacks of 100, and every spelling is in one of them", () => {
  const entries = formEntries(compile(PROVIDER_CAPABILITIES.signa));
  assert.deepEqual(entries.map((e) => e.terms.length), [100, 100, 50]);
  assert.deepEqual(entries.flatMap((e) => e.terms).sort(), [...SPELLINGS].sort());
});

test("CONTROL: Signa's general width is still 1, and a provider with no exact width stacks as before", () => {
  assert.equal(planMaxOrWidth(PROVIDER_CAPABILITIES.signa), 1);
  assert.equal(planExactOrWidth(PROVIDER_CAPABILITIES.signa), 100);
  assert.equal(planExactOrWidth(PROVIDER_CAPABILITIES.clarivate), planMaxOrWidth(PROVIDER_CAPABILITIES.clarivate));
});

test("the feasibility check reads an exact stack against the exact width, and other stacks against the general one", () => {
  const plan = compile(PROVIDER_CAPABILITIES.signa);
  const issues = validatePlanFeasibility(plan, { capabilities: PROVIDER_CAPABILITIES.signa });
  assert.equal(issues.filter((i) => /OR-stack/.test(i.issue)).length, 0, "a 100-spelling exact stack was flagged as over the bound");
  const phonetic = { entries: [{ qid: "p", predicate: "phonetic", terms: ["ZYTHERMO", "ZYTHERMA"], nice_classes: [9] }] };
  assert.equal(validatePlanFeasibility(phonetic, { capabilities: PROVIDER_CAPABILITIES.signa }).filter((i) => /OR-stack/.test(i.issue)).length, 1);
});
