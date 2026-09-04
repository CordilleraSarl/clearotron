// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// variant-floor.test.mjs — the deterministic floor under variant generation.
//
// The acceptance criterion reads "two runs of the same matter at identical settings produce an
// identical floor set". Two clearance runs are E2E's measurement and cost real money; what is provable
// HERE — and what these tests prove — is the half that lives in code: the floor is a pure function of
// its seed set, byte-identical for identical seeds and unmoved by the order the model lists them in,
// and the seed set no longer moves when the model promotes a different token to `dominant_element`.
// Whether two live runs then produce identical seeds is a measurement, not an assertion.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderFormNeighbourhoodJson, floorSeeds, markSeedTokens, spacingPunctuationForms,
  variantFloorFamilies, mergeVariantFloor, formNeighbourhood, MAX_SEED_LENGTH,
} from "../form-neighbourhood.mjs";
import { compileRegisterPlan, bandsFor, parseRegisterPlan, PLAN_PROVENANCE } from "../register-plan.mjs";

const MANIFEST = `# Variant manifest
Dominant element: VELTRIS
Formative root: VELTRI
`;
const MODEL = {
  schema_version: 1,
  mark: "BIO VELTRIS",
  dominant_element: "VELTRIS",
  elements: [{ value: "VELTRIS", kind: "distinctive" }, { value: "BIO", kind: "common" }],
  variants: [
    { value: "BIO VELTRIS", category: "core", rationale: "the mark" },
    { value: "VELTRIS", category: "core", rationale: "dominant" },
    { value: "VELTRYS", category: "phonetic", rationale: "sound-alike" },
    { value: "WELLTRIS", category: "phonetic", rationale: "the model's own idea" },
  ],
  incumbent_classes: [],
  watchlist_owners: [],
};
const JOB = { jobKey: "t", classes: ["9"], jurisdictions: ["CH"] };

// ── criterion 1, the half that is provable in-repo ───────────────────────────────────────────────

test("the floor is byte-identical for identical seeds — the SERIALIZED artifact, not just the arrays", () => {
  const a = renderFormNeighbourhoodJson(MANIFEST, { model: MODEL, mark: "BIO VELTRIS", markets: ["CH"] });
  const b = renderFormNeighbourhoodJson(MANIFEST, { model: MODEL, mark: "BIO VELTRIS", markets: ["CH"] });
  assert.equal(a, b, "same inputs must serialize to the same bytes — ordering is what silently breaks");
  const o = JSON.parse(a);
  assert.equal(o.schema_version, 2);
  assert.ok(o.variant_floor.counts.floor > 300, `a real floor, not a token one (got ${o.variant_floor.counts.floor})`);
});

test("model array ORDER cannot move the artifact — the churn this issue is about", () => {
  const reordered = { ...MODEL, elements: [...MODEL.elements].reverse(), variants: [...MODEL.variants].reverse() };
  assert.equal(
    JSON.parse(renderFormNeighbourhoodJson(MANIFEST, { model: MODEL, mark: "BIO VELTRIS" })).variant_floor.floor_families
      .map((f) => f.terms.join("|")).join("#"),
    JSON.parse(renderFormNeighbourhoodJson(MANIFEST, { model: reordered, mark: "BIO VELTRIS" })).variant_floor.floor_families
      .map((f) => f.terms.join("|")).join("#"),
    "permuting elements[]/variants[] must not move a single floor term",
  );
});

test("promoting a DIFFERENT distinctive element to dominant_element leaves the floor set unchanged", () => {
  // run 1 calls ZURENA dominant; run 2 calls VELTRIN dominant. Both name both as distinctive elements.
  const elements = [{ value: "ZURENA", kind: "distinctive" }, { value: "VELTRIN", kind: "distinctive" }];
  const runA = { ...MODEL, dominant_element: "ZURENA", elements };
  const runB = { ...MODEL, dominant_element: "VELTRIN", elements };
  const seedsOf = (m) => new Set(floorSeeds("", { model: m }).seeds.map((s) => s.element));
  assert.deepEqual([...seedsOf(runA)].sort(), [...seedsOf(runB)].sort(), "the seed UNION is stable under promotion");
  const floorOf = (m) => new Set(JSON.parse(renderFormNeighbourhoodJson("", { model: m, mark: "ZURENA VELTRIN" }))
    .variant_floor.floor_families.filter((f) => f.family === "edit-1").flatMap((f) => f.terms));
  const a = floorOf(runA), b = floorOf(runB);
  assert.deepEqual([...a].sort(), [...b].sort(), "and so is the generated floor");
  assert.ok(a.has("zurema") && a.has("veltrim"), "BOTH elements' neighbourhoods are enumerated, not just the promoted one");
});

// ── zero semantics: a failed model turn can never empty the floor ────────────────────────────────

test("ZERO SEMANTICS: model output absent ⇒ the floor is still emitted IN FULL, seeded from the job mark", () => {
  const json = renderFormNeighbourhoodJson("", { model: null, mark: "CORAL FREEZE" });
  const o = JSON.parse(json);
  assert.match(o.seeded_from, /^job mark \(FALLBACK/, "the fallback is NAMED in the artifact, never silent");
  assert.deepEqual(o.elements.map((e) => e.element), ["coral", "freeze"], "per TOKEN — never the concatenation");
  assert.ok(o.variant_floor.counts.floor > 300, `full floor, not a stub (got ${o.variant_floor.counts.floor})`);
  assert.equal(o.variant_floor.counts.model_added, 0);
});

test("ZERO SEMANTICS: malformed model output takes the same path — no branch reduces the floor", () => {
  const full = JSON.parse(renderFormNeighbourhoodJson("", { model: MODEL, mark: "BIO VELTRIS" })).variant_floor.counts.floor;
  for (const junk of [null, undefined, {}, { variants: null }, { variants: "nope" }, { variants: [{}, { value: "" }] },
                      { dominant_element: "   ", elements: "not an array", variants: [] }]) {
    const o = JSON.parse(renderFormNeighbourhoodJson(MANIFEST, { model: junk, mark: "BIO VELTRIS" }));
    assert.ok(o.variant_floor.counts.floor > 0, `floor emptied by ${JSON.stringify(junk)}`);
    assert.equal(o.variant_floor.counts.model_added, 0, "junk never becomes a search term");
  }
  assert.ok(full > 0);
});

test("ZERO SEMANTICS: mergeVariantFloor never shrinks the floor, whatever the model hands it", () => {
  const fams = variantFloorFamilies([{ element: "zurena", role: "dominant", band: formNeighbourhood("zurena") }], { mark: "ZURENA" });
  const floorCount = mergeVariantFloor(fams, MODEL.variants).counts.floor;
  for (const junk of [null, undefined, [], "variants", 42, [{}], [{ value: null }], [{ value: "   " }]])
    assert.equal(mergeVariantFloor(fams, junk).counts.floor, floorCount, `floor moved on ${JSON.stringify(junk)}`);
});

test("the floor is empty ONLY when there is no element AND no mark — and then it THROWS, never returns empty", () => {
  assert.throws(() => renderFormNeighbourhoodJson("## nothing here\n", { model: null, mark: "" }), /form_neighbourhood_no_element/);
  assert.throws(() => renderFormNeighbourhoodJson("", { model: { variants: [] }, mark: "  -- " }), /form_neighbourhood_no_element/);
});

// ── the partition: floor / restatement / addition, and nothing outside it ────────────────────────

test("PARTITION: every model variant lands in exactly one bucket — a term in neither is impossible", () => {
  const fams = variantFloorFamilies([{ element: "veltris", role: "dominant", band: formNeighbourhood("veltris") }], { mark: "BIO VELTRIS" });
  const m = mergeVariantFloor(fams, MODEL.variants);
  const restated = m.model_restatements.map((r) => r.value);
  const added = m.model_additions.map((r) => r.value);
  // set equality on VALUES, not counts — a count assertion passes while a term is swapped
  assert.deepEqual([...restated, ...added].sort(), MODEL.variants.map((v) => v.value).sort());
  assert.equal(restated.filter((v) => added.includes(v)).length, 0, "the buckets are disjoint");
  assert.ok(added.includes("WELLTRIS"), "an edit-2 the floor cannot reach is the MODEL's contribution, marked as such");
  assert.ok(restated.includes("VELTRYS"), "an edit-1 the floor already held is marked a restatement, not an addition");
});

test("PARTITION: the family terms sum EXACTLY to the band the plan dispatches — no parallel list", () => {
  const band = formNeighbourhood("zurena");
  const fams = variantFloorFamilies([{ element: "zurena", role: "dominant", band }], { mark: "ZURENA" });
  const exactFamilies = new Set(["edit-1", "visual-confusable", "transliteration", "other"]);
  const fromFamilies = fams.filter((f) => exactFamilies.has(f.family)).flatMap((f) => f.terms);
  assert.deepEqual(fromFamilies.slice().sort(), band.exactQueries.slice().sort(),
    "every dispatched term is claimed by exactly one family, and no family invents one");
});

test("mergeVariantFloor marks its own output — the artifact says which side is which", () => {
  const fams = variantFloorFamilies([{ element: "veltris", role: "dominant", band: formNeighbourhood("veltris") }], { mark: "BIO VELTRIS" });
  const m = mergeVariantFloor(fams, MODEL.variants);
  assert.match(m.marking, /deterministic, generated by code/);
  assert.equal(m.counts.union, m.counts.floor + m.counts.model_added);
  for (const f of m.floor_families) {
    assert.equal(typeof f.generator, "string");
    assert.match(f.enumeration, /^(EXHAUSTIVE|BOUNDED|a dispatched)/, `${f.family} must say exhaustive-or-bounded, not just "deterministic"`);
  }
});

// ── the seed guard: a prose-parse artifact never becomes a 1,736-query neighbourhood ─────────────

test("a swallowed prose clause is REJECTED as a seed and the rejection is recorded, not swallowed", () => {
  const prose = "Dominant element: HYDRA — the stem a family of marks shares\n";
  const { seeds, rejected, seededFrom } = floorSeeds(prose, { model: null, mark: "HYDRA" });
  assert.ok(!seeds.some((s) => s.element.length > MAX_SEED_LENGTH), "no seed longer than the bound survives");
  assert.ok(rejected.some((r) => /exceeds the 24-character seed bound/.test(r.reason)), "the refusal is a recorded finding");
  assert.match(seededFrom, /^job mark \(FALLBACK/, "and the run still gets a floor, from the mark");
});

test("a whitespace-carrying distinctive element is refused as a seed, and the mark still carries the run", () => {
  const model = { dominant_element: "VELTRIS", elements: [{ value: "a genuinely long swallowed sentence about the mark", kind: "distinctive" }], variants: [] };
  const { seeds, rejected } = floorSeeds("", { model, mark: "VELTRIS" });
  assert.deepEqual(seeds.map((s) => s.element), ["veltris"]);
  assert.equal(rejected.length, 1);
});

test("markSeedTokens: deduped, sorted, length-guarded, array-or-string", () => {
  assert.deepEqual(markSeedTokens("BIO VELTRIS"), ["bio", "veltris"]);
  // The second mark DELIBERATELY repeats a token of the first: three raw tokens must collapse to
  // two, or this line stops exercising the dedup in the test's own name. A rename that breaks the
  // overlap keeps the assertion green while deleting its coverage — that already happened once.
  assert.deepEqual(markSeedTokens(["Coral Freeze", "CORAL"]), ["coral", "freeze"]);
  assert.deepEqual(markSeedTokens("Café-Noir"), ["cafe", "noir"]);
  assert.deepEqual(markSeedTokens("A B"), [], "one-character tokens have no neighbourhood worth enumerating");
  assert.deepEqual(markSeedTokens(""), []);
});

// ── the `core` family, generated rather than imagined ────────────────────────────────────────────

test("spacingPunctuationForms enumerates the mark's separator forms, and none for a single token", () => {
  assert.deepEqual(spacingPunctuationForms("CORAL FREEZE"), ["coral-freeze", "coral.freeze", "coralfreeze"]);
  assert.deepEqual(spacingPunctuationForms("E-TRADE"), ["e trade", "e.trade", "etrade"]);
  assert.deepEqual(spacingPunctuationForms("VELTRIS"), [], "a floor never fabricates a form the mark cannot have");
  assert.deepEqual(spacingPunctuationForms(""), []);
  assert.deepEqual(spacingPunctuationForms("CORAL FREEZE"), spacingPunctuationForms("Coral  Freeze"), "deterministic under spacing noise");
});

// ── the plan: floor terms reach the wire, marked, and the model cannot take one off it ───────────

test("the compiled plan MARKS every entry floor / model / mark", () => {
  const form = JSON.parse(renderFormNeighbourhoodJson(MANIFEST, { model: MODEL, mark: "BIO VELTRIS" }));
  const plan = compileRegisterPlan({ manifest: MODEL, job: JOB, form });
  parseRegisterPlan(JSON.stringify(plan));   // the closed enum holds
  for (const e of plan.entries) assert.ok(PLAN_PROVENANCE.includes(e.provenance), `${e.qid} carries no provenance`);
  assert.ok(plan.entries.some((e) => e.provenance === "floor" && e.qid.endsWith("+form")));
  assert.ok(plan.entries.some((e) => e.provenance === "floor" && e.predicate === "wildcard"), "the wildcard fringe is marked too — it was not before");
  assert.ok(plan.entries.some((e) => e.provenance === "model" && e.term === "WELLTRIS"));
  assert.equal(plan.entries.filter((e) => e.provenance === "mark").length >= 2, true);
});

test("NO REMOVAL: whatever the model states, every floor term is still dispatched", () => {
  const form = JSON.parse(renderFormNeighbourhoodJson(MANIFEST, { model: MODEL, mark: "BIO VELTRIS" }));
  const floorTerms = new Set(form.variant_floor.floor_families
    .filter((f) => ["edit-1", "visual-confusable", "transliteration", "other"].includes(f.family)).flatMap((f) => f.terms));
  const dispatchedFor = (manifest) => {
    const plan = compileRegisterPlan({ manifest, job: JOB, form });
    return new Set(plan.entries.flatMap((e) => (e.terms ?? [e.term])));
  };
  const full = dispatchedFor(MODEL);
  // the model contradicting itself, saying almost nothing, or naming a different anchor entirely
  const starved = dispatchedFor({ ...MODEL, variants: [{ value: "BIO VELTRIS", category: "core", rationale: "" }] });
  const wrongAnchor = dispatchedFor({ ...MODEL, dominant_element: "SOMETHINGELSE" });
  for (const t of floorTerms) {
    assert.ok(full.has(t), `floor term ${t} missing from the full plan`);
    assert.ok(starved.has(t), `a one-variant manifest removed floor term ${t}`);
    assert.ok(wrongAnchor.has(t), `a re-anchored manifest removed floor term ${t}`);
  }
});

test("bandsFor dispatches EVERY seeded band — the formative root was generated and never searched", () => {
  const form = JSON.parse(renderFormNeighbourhoodJson(MANIFEST, { model: MODEL, mark: "BIO VELTRIS" }));
  assert.deepEqual(bandsFor(form, "VELTRIS").map((e) => e.element), ["veltris", "veltri"], "dominant first, root still compiled");
  const plan = compileRegisterPlan({ manifest: MODEL, job: JOB, form });
  const dispatched = new Set(plan.entries.flatMap((e) => e.terms ?? [e.term]));
  const rootBand = form.elements.find((e) => e.role === "formative-root").band;
  for (const t of rootBand.exactQueries.slice(0, 25)) assert.ok(dispatched.has(t), `formative-root near-form ${t} never dispatched`);
});

test("the plan is unchanged by a v1 form artifact — the variant_floor block is purely additive", () => {
  const v2 = JSON.parse(renderFormNeighbourhoodJson(MANIFEST, { model: MODEL, mark: "VELTRIS" }));
  const { variant_floor, ...v1 } = v2;
  assert.equal(JSON.stringify(compileRegisterPlan({ manifest: MODEL, job: JOB, form: v1 })),
    JSON.stringify(compileRegisterPlan({ manifest: MODEL, job: JOB, form: v2 })),
    "a v1 artifact compiles the SAME plan — the block is read by nothing on the dispatch path");
  assert.ok(compileRegisterPlan({ manifest: MODEL, job: JOB, form: v1 }).entries.some((e) => e.qid.endsWith("+form")));
});

test("the generated `core` family is enumerated and DISCLOSED as already-covered, not re-dispatched", () => {
  const form = JSON.parse(renderFormNeighbourhoodJson(MANIFEST, { model: MODEL, mark: "BIO VELTRIS" }));
  const core = form.variant_floor.floor_families.find((f) => f.family === "spacing-punctuation");
  assert.deepEqual(core.terms, ["bio-veltris", "bio.veltris", "bioveltris"]);
  assert.match(core.dispatch, /covered by the mark's own register entry/);
  // and the reason it is honest to say so: the compiler keys all four to one query.
  const dispatched = new Set(compileRegisterPlan({ manifest: MODEL, job: JOB, form }).entries.flatMap((e) => e.terms ?? [e.term]));
  assert.ok(dispatched.has("BIO VELTRIS"), "the mark IS on the wire; the spacing forms are the same key");
  assert.ok(!core.terms.some((t) => dispatched.has(t)), "so they are not sent again");
});

test("compileRegisterPlan stays DETERMINISTIC with the floor block in play", () => {
  const form = JSON.parse(renderFormNeighbourhoodJson(MANIFEST, { model: MODEL, mark: "BIO VELTRIS" }));
  const a = JSON.stringify(compileRegisterPlan({ manifest: MODEL, job: JOB, form }));
  const b = JSON.stringify(compileRegisterPlan({ manifest: MODEL, job: JOB, form }));
  assert.equal(a, b);
});

// ── · the seed set the floor is actually built from ─────────────────────────────────────────────

test("#320: job.marks is an ARRAY OF OBJECTS, and the floor is seeded from the names in it", () => {
  // THE DEFECT, executed against the shape the pipeline really passes. deriveFormNeighbourhood hands
  // markSeedTokens `ctx.job.marks`, which enqueue.mjs and ops.mjs build as {name, classes, ref} objects.
  // `String(m)` over that array is the literal "[object Object]", which tokenised to ["object"] — so the
  // floor was generated for the word OBJECT while the run logged that its seed was the job's own mark.
  // A wrong floor reporting itself as the trustworthy one, on every run that reaches the fallback, in
  // Latin script, with no model failure required. Every earlier test here passed strings, which is why.
  assert.deepEqual(markSeedTokens([{ name: "NOVAPULSE", classes: [9] }]), ["novapulse"]);
  // Overlapping second mark on purpose — the object form must dedup too (see the array case above).
  assert.deepEqual(markSeedTokens([{ name: "CORAL FREEZE" }, { name: "CORAL" }]), ["coral", "freeze"]);
  assert.ok(!markSeedTokens([{ name: "NOVAPULSE" }]).includes("object"), "never the shape's own name");
  // mixed and legacy shapes still resolve
  assert.deepEqual(markSeedTokens([{ name: "BIO" }, "VELTRIS"]), ["bio", "veltris"]);
  assert.deepEqual(markSeedTokens({ name: "NOVAPULSE" }), ["novapulse"]);

  // …and end to end: the fallback arm seeds the real mark.
  const { seeds, seededFrom } = floorSeeds("", { model: null, mark: [{ name: "NOVAPULSE", classes: [9] }] });
  assert.deepEqual(seeds.map((s) => s.element), ["novapulse"]);
  assert.match(seededFrom, /^job mark/);
});

test("#320: a non-Latin mark has no derivable floor, and the run says which mark and why", () => {
  // Both arms fail together: normalizeElement keeps only [a-z0-9], so a Han dominant_element from the
  // manifest is dropped before the guard runs AND the mark fallback tokenises to nothing. The fallback
  // cannot rescue the case it exists for.
  const model = { dominant_element: "华为", elements: [{ value: "华为", kind: "distinctive" }], variants: [] };
  const { seeds, rejected } = floorSeeds("", { model, mark: [{ name: "华为" }] });
  assert.equal(seeds.length, 0, "no seed — and NOT a romanisation, which would be a minted search term");
  assert.ok(rejected.some((r) => /no Latin-script token/.test(r.reason)), `the absence is recorded: ${JSON.stringify(rejected)}`);

  // The reason reaches the caller, which is the only place it can be seen: deriveFormNeighbourhood
  // discards `rejected` with the exception on exactly this path.
  assert.throws(() => renderFormNeighbourhoodJson("", { model, mark: [{ name: "华为" }] }),
    /form_neighbourhood_no_element:.*no Latin-script token/);
});

test("#320: a one-character mark is refused for its own reason, not silently blamed on a missing mark", () => {
  // The length-2 floor is right — an edit-1 neighbourhood of one character is the whole alphabet. What
  // was wrong is that it read as "the job states no mark", sending a reader to check the wrong thing.
  assert.throws(() => renderFormNeighbourhoodJson("", { model: null, mark: [{ name: "K" }] }),
    /every token is a single character/);
  assert.throws(() => renderFormNeighbourhoodJson("", { model: null, mark: "" }),
    /the job states no mark/, "and the genuinely mark-less case still says so");
});

test("#320: the rejected seeds ride the artifact, so an empty floor is legible after the fact", () => {
  const model = { dominant_element: "VELTRIS", elements: [{ value: "a genuinely long swallowed sentence about the mark", kind: "distinctive" }], variants: [] };
  const doc = JSON.parse(renderFormNeighbourhoodJson("", { model, mark: [{ name: "VELTRIS" }] }));
  assert.ok(doc.variant_floor.rejected_seeds?.length, "a refused seed is recorded where a reader can see what was not enumerated");
});
