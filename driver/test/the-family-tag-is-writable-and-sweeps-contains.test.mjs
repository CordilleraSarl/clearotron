// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — the doctrine's four universal tags are WRITABLE, and the family lane's
// contains-not-exact mandate finally binds to something the plan can see.
//
// The measured defect: the doctrine dictated `formative-family` (and three sibling tags), the enum
// refused all four, so a manifest that obeyed the doctrine literally failed the stage. Seats
// substituted (`other` on the 2026-08-28 R2, `composite` in the fixture corpus, `formative-family` in
// the same fixture's rendered md — three vocabularies for one doctrine), and three root-shaped strings
// were dispatched EXACT: a root swept exact matches the root and nothing that incorporates it.
//
// The assertions here read the COMPILED PLAN, never the source: the acceptance is "an arm that fails
// on a manifest whose family rows are dispatched exact-only", and only the artifact can answer that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVariantManifestModel, VARIANT_CATEGORIES } from "../variant-manifest-model.mjs";
import { compileRegisterPlan, parseRegisterPlan } from "../register-plan.mjs";

const MODEL = {
  schema_version: 1,
  mark: "VELTRI DIAGNOSTICS",
  dominant_element: "VELTRI",
  elements: [
    { value: "VELTRI", kind: "distinctive" },
    { value: "DIAGNOSTICS", kind: "common" },
  ],
  variants: [
    { value: "VELTRI DIAGNOSTICS", category: "exact-phrase", rationale: "the full mark as a phrase" },
    { value: "DIAGNOSTICS", category: "exact-element", rationale: "element solo" },
    { value: "DIAGNOST", category: "plural-root", rationale: "morphological root of the plural element" },
    { value: "VELTRI", category: "formative-family", rationale: "the distinctive root as a family" },
    { value: "VELTR", category: "formative-family", rationale: "a SECOND family member — the every-family-row claim needs more than the member the code was written against" },
    { value: "VELTRY", category: "phonetic", rationale: "control — the 2047 strip rule, unchanged" },
  ],
  incumbent_classes: ["9", "42"],
};
const JOB = { jobKey: "TMP9999-veltri", classes: ["9", "42"], jurisdictions: ["US", "EU"] };

const entriesByTerm = () => {
  const plan = parseRegisterPlan(JSON.stringify(compileRegisterPlan({
    manifest: parseVariantManifestModel(JSON.stringify(MODEL)), job: JOB, form: null, skillVersion: "prelim-register@spec48",
  })));
  // NO provenance filter: a variant whose value equals the mark folds into the mark's own entry
  // (measured — the exact-phrase row compiles with provenance "mark"), and the question is what the
  // TERM is dispatched as, whoever contributed it.
  const map = new Map();
  for (const e of plan.entries) map.set(`${e.term}|${e.axis}`, e);
  return { plan, map };
};

test("2043 all four universal tags PARSE — the doctrine is literally obeyable", () => {
  for (const tag of ["exact-phrase", "exact-element", "plural-root", "formative-family"])
    assert.ok(VARIANT_CATEGORIES.includes(tag), `the doctrine dictates "${tag}" and the schema still refuses it`);
  const m = parseVariantManifestModel(JSON.stringify(MODEL));
  assert.equal(m.variants.length, 6, "a manifest tagged exactly as the doctrine dictates must parse whole");
});

test("2043 EVERY family row compiles to a contains sweep — read off the plan, not the source", () => {
  const { map } = entriesByTerm();
  for (const [term, why] of [
    ["DIAGNOSTICS", "exact-element (the doctrine's own table says default)"],
    ["DIAGNOST", "plural-root (a root's purpose is the contains match)"],
    ["VELTRI", "formative-family (the mandate this issue exists for: never exact-only)"],
    ["VELTR", "formative-family, second member (a uniform fix must hold for the member it was not written against)"],
  ]) {
    const e = map.get(`${term}|primary-sweep`);
    assert.ok(e, `${term} never reached the primary sweep — the tag routed it somewhere the mandate cannot see`);
    assert.equal(e.predicate, "default",
      `${term} dispatched "${e.predicate}" — ${why}. A family row swept exact-only is the measured defect (4/2/4 records, the family retrieved zero times)`);
  }
});

test("2043 exact-phrase stays EXACT, and the 2047 strip rule is untouched — the widening has edges", () => {
  const { map } = entriesByTerm();
  assert.equal(map.get("VELTRI DIAGNOSTICS|primary-sweep")?.predicate, "exact",
    "the doctrine sends exact-phrase exact; widening it too would make every row contains and the tag meaningless");
  assert.equal(map.get("VELTRY|primary-sweep")?.predicate, "default",
    "the phonetic strip rule (tracker 2047) regressed — it is a different mechanism and must not move");
});

test("2043 an anchored-wildcard family value still takes the wildcard lane — decided before the category", () => {
  const m = { ...MODEL, variants: [...MODEL.variants, { value: "VELTRI*", category: "formative-family", rationale: "prefix family" }] };
  const plan = parseRegisterPlan(JSON.stringify(compileRegisterPlan({
    manifest: parseVariantManifestModel(JSON.stringify(m)), job: JOB, form: null, skillVersion: "prelim-register@spec48",
  })));
  const e = plan.entries.find((x) => x.term === "VELTRI*");
  assert.ok(e, "the wildcard family value compiled to no entry");
  assert.equal(e.predicate, "wildcard", "an anchored star is the wildcard lane's business, category notwithstanding");
});
