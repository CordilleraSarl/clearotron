// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-mixed-alphabet-look-alike-is-not-sent-where-the-register-drops-its-letters.test.mjs
//
// THE DEFECT. The form band's whole-word look-alike swap turns every letter that has a Greek or Cyrillic
// twin into that twin and leaves the rest Latin, so TIMBER becomes `τιμβεr` and `тiмвеr`. A register that
// answers such a spelling as if the non-Latin letters were absent returns rows that share only the Latin
// letters. In testing (2026-09-23) these searches returned nothing but unrelated marks, and on a common
// remainder they came back as crowds that the reports then read as unread coverage.
//
// THE RULE. A register that declares `mixedScriptQuery: false` gets no mixed spelling from the form band.
// The spellings are listed as not searched, with their count and the reason, the way an ordinary word of
// a different sound is. A wholly Greek or Cyrillic swap is a different question and still goes out. A
// register that does not declare the field gets exactly the band it got before.
//
// The words are neutral dictionary words on purpose.
//
// Run:  node scripts/test-run.mjs node --test driver/test/a-mixed-alphabet-look-alike-is-not-sent-where-the-register-drops-its-letters.test.mjs
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
// The run-path arm needs this register active, and driver.config reads the register once, at load, so
// it is pinned before any product module is imported, with the pool and work roots in a scratch dir.
const ROOT = mkdtempSync(join(tmpdir(), "mixed-script-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
pinEnv(process.env, "CLEAROTRON_DATABASE", "signa");

import { test } from "node:test";
import assert from "node:assert/strict";

const { formNeighbourhood, renderFormNeighbourhoodJson, mergeVariantFloor } = await import("../form-neighbourhood.mjs");
const { mixesLatinWithGreekOrCyrillic } = await import("../../providers/_shared/script-form.mjs");
const { PROVIDER_CAPABILITIES, capabilitiesFor } = await import("../register-capabilities.mjs");
const { compileRegisterPlan } = await import("../register-plan.mjs");
const { parseVariantManifestModel } = await import("../variant-manifest-model.mjs");
const { defaultBuildEntryQuery, planPredicateParams } = await import("../../providers/_shared/execute-plan.mjs");
const { toSignaParams, buildSearchRequest } = await import("../../providers/signa/src/core.js");
const { deriveFormNeighbourhood } = await import("../pipeline.mjs");
const { paths } = await import("../stages.mjs");
const { driverDir } = await import("../../shared/driver-dir.mjs");

const SIGNA = capabilitiesFor("signa");
const mixed = (terms) => terms.filter(mixesLatinWithGreekOrCyrillic);

const modelFor = (word) => ({
  schema_version: 1, mark: word, dominant_element: word,
  elements: [{ value: word, kind: "distinctive" }],
  variants: [{ value: `${word}S`, category: "phonetic", rationale: "plural" }],
  incumbent_classes: ["9"],
});
const JOB = { jobKey: "TMP0000-neutral", classes: ["9"], jurisdictions: ["US", "EU"] };
const compileOn = (capabilities, form, model) => compileRegisterPlan({
  manifest: parseVariantManifestModel(JSON.stringify(model)), job: JOB, form, skillVersion: "test", capabilities });
const entryTerms = (e) => [e.term, ...(e.terms ?? []), ...(e.romanizedTerms ?? [])].filter((t) => typeof t === "string");

test("the predicate: Latin mixed with Greek or Cyrillic, and nothing else", () => {
  for (const t of ["τιμβεr", "тiмвеr", "τιmbεr"]) assert.ok(mixesLatinWithGreekOrCyrillic(t), `${t} mixes alphabets`);
  for (const t of ["timber", "tímber", "t1mber", "βοατ", "воат", "β2β", "", null])
    assert.ok(!mixesLatinWithGreekOrCyrillic(t), `${t} does not`);
});

test("Signa and Clarivate declare that they cannot search a mixed spelling as written", () => {
  assert.equal(SIGNA.mixedScriptQuery, false);
  assert.equal(capabilitiesFor("clarivate").mixedScriptQuery, false);
});

test("the reason recorded follows what the register's index holds", () => {
  // Signa's index holds the characters and answers the Latin remainder; Clarivate's holds non-Latin
  // filings by transliteration only and never takes the spelling. One reason would be false for one of them.
  const reasonOn = (caps) => JSON.parse(renderFormNeighbourhoodJson("", { mark: "TIMBER",
    mixedScriptQuery: caps.mixedScriptQuery, nativeScriptIndex: caps.nativeScriptIndex }))
    .variant_floor.floor_families.find((f) => f.family === "mixed-script-look-alike").dispatch;
  assert.match(reasonOn(SIGNA), /as if the non-Latin letters were absent/);
  assert.match(reasonOn(capabilitiesFor("clarivate")), /by their transliteration only, so a mixed-alphabet spelling cannot be searched as written/);
});

test("on Clarivate the mixed swaps leave the plan instead of compiling into deferrals", () => {
  const CLARIVATE = capabilitiesFor("clarivate");
  const model = modelFor("TIMBER");
  const before = compileOn(CLARIVATE, JSON.parse(renderFormNeighbourhoodJson("", { model, mark: "TIMBER" })), model);
  const after = compileOn(CLARIVATE, JSON.parse(renderFormNeighbourhoodJson("", { model, mark: "TIMBER",
    mixedScriptQuery: CLARIVATE.mixedScriptQuery, nativeScriptIndex: CLARIVATE.nativeScriptIndex })), model);
  assert.equal(mixed(before.entries.flatMap(entryTerms)).length, 2, "before, both compiled — to be deferred as non-Latin forms");
  assert.deepEqual(mixed(after.entries.flatMap(entryTerms)), []);
  const key = (e) => JSON.stringify(e);
  const gone = before.entries.filter((e) => !after.entries.some((x) => key(x) === key(e)));
  assert.equal(gone.length, 2, "exactly the two mixed spellings leave");
  assert.equal(after.entries.length, before.entries.length - 2, "and nothing else moves");
});

test("TIMBER on this register: the two mixed swaps leave the band and are listed with their count", () => {
  const before = formNeighbourhood("TIMBER");
  const after = formNeighbourhood("TIMBER", { mixedScriptQuery: SIGNA.mixedScriptQuery });
  const dropped = mixed(before.transliterations);
  assert.equal(dropped.length, 2, `the Greek and the Cyrillic swap, and nothing else: ${dropped.join(", ")}`);
  assert.deepEqual(after.mixedScriptNotSearched, dropped);
  assert.deepEqual(mixed(after.exactQueries), [], "no searched term mixes alphabets");
  assert.deepEqual(after.exactQueries, before.exactQueries.filter((q) => !dropped.includes(q)),
    "exactly those two leave, and nothing else moves");
  const row = after.ledger.axes.find((a) => a.axis === "transliteration");
  assert.equal(row.generated, before.transliterations.length);
  assert.equal(row.not_searched, 2);
  assert.equal(row.count, after.transliterations.length);
});

test("a wholly Greek or Cyrillic swap still goes out, into the band and onto the plan (BOAT)", () => {
  const band = formNeighbourhood("BOAT", { mixedScriptQuery: SIGNA.mixedScriptQuery });
  for (const t of ["βοατ", "воат"]) assert.ok(band.exactQueries.includes(t), `${t} is searched`);
  assert.deepEqual(band.mixedScriptNotSearched, []);
  const model = modelFor("BOAT");
  const plan = compileOn(SIGNA, JSON.parse(renderFormNeighbourhoodJson("", { model, mark: "BOAT", mixedScriptQuery: SIGNA.mixedScriptQuery })), model);
  const onPlan = new Set(plan.entries.flatMap(entryTerms));
  for (const t of ["βοατ", "воат"]) assert.ok(onPlan.has(t), `${t} is on the plan`);
});

test("the form document says what it left out: its own family, outside the searched floor", () => {
  const doc = JSON.parse(renderFormNeighbourhoodJson("", { mark: "TIMBER", mixedScriptQuery: SIGNA.mixedScriptQuery, nativeScriptIndex: SIGNA.nativeScriptIndex }));
  const fams = doc.variant_floor.floor_families;
  const fam = fams.find((f) => f.family === "mixed-script-look-alike");
  assert.ok(fam, "the dropped spellings are listed");
  assert.equal(fam.searched, false);
  assert.equal(fam.count, 2);
  assert.deepEqual(fam.terms, [...doc.elements[0].band.mixedScriptNotSearched].sort());
  assert.equal(fam.dispatch,
    "not searched — the register answers a mixed-alphabet spelling as if the non-Latin letters were absent (measured 2026-09-23)");
  assert.deepEqual(mixed(fams.filter((f) => f.searched !== false).flatMap((f) => f.terms)), [],
    "no searched family carries one");
  // A model that proposes one is recorded as its own addition, not as a restatement of a floor that
  // never searched it.
  const merged = mergeVariantFloor(fams, [{ value: fam.terms[0], category: "transliteration" }]);
  assert.equal(merged.model_additions.length, 1);
  assert.equal(merged.model_restatements.length, 0);
});

test("compiled on this register's contract, no plan entry and no request body mixes alphabets", () => {
  const model = modelFor("TIMBER");
  const plan = compileOn(SIGNA, JSON.parse(renderFormNeighbourhoodJson("", { model, mark: "TIMBER", mixedScriptQuery: SIGNA.mixedScriptQuery })), model);
  const formEntries = plan.entries.filter((e) => e.provenance === "floor" && e.predicate === "exact");
  assert.ok(formEntries.length > 100, `the form band compiled (${formEntries.length} entries); an empty plan would pass every arm below`);
  assert.ok(formEntries.some((e) => entryTerms(e).includes("limber")), "an edit-1 neighbour is on the plan");
  assert.deepEqual(mixed(plan.entries.flatMap(entryTerms)), []);
  // The request the executor builds for each entry, down to the body this register receives.
  const bodies = plan.entries.filter((e) => e.predicate !== "owner")
    .map((e) => buildSearchRequest(toSignaParams(defaultBuildEntryQuery(e, planPredicateParams(e), plan))));
  assert.equal(bodies.length, plan.entries.filter((e) => e.predicate !== "owner").length);
  assert.deepEqual(mixed(bodies.map((b) => String(b.query ?? ""))), []);
  // Control: the same compile from the band as it was carries both, so the arms above can fail.
  const asBefore = compileOn(SIGNA, JSON.parse(renderFormNeighbourhoodJson("", { model, mark: "TIMBER" })), model);
  assert.equal(mixed(asBefore.entries.flatMap(entryTerms)).length, 2);
});

test("a register that does not declare it gets the band, and the plan, it got before", () => {
  const others = Object.entries(PROVIDER_CAPABILITIES).filter(([, c]) => c.mixedScriptQuery !== false);
  assert.ok(others.length >= 4, "every other register is swept");
  for (const [id, caps] of others) {
    for (const word of ["TIMBER", "BOAT"]) {
      const model = modelFor(word);
      const before = renderFormNeighbourhoodJson("", { model, mark: word });
      const now = renderFormNeighbourhoodJson("", { model, mark: word, mixedScriptQuery: caps.mixedScriptQuery });
      assert.equal(now, before, `${id}/${word}: the form document is byte-identical`);
      const doc = JSON.parse(now);
      const band = doc.elements[0].band;
      assert.equal("mixedScriptNotSearched" in band, false, `${id}/${word}: no new band field`);
      assert.equal(doc.variant_floor.floor_families.some((f) => f.family === "mixed-script-look-alike"), false);
      assert.deepEqual(Object.keys(band.ledger.axes.find((a) => a.axis === "transliteration")), ["axis", "count", "mechanism"]);
      assert.equal(mixed(band.exactQueries).length, word === "TIMBER" ? 2 : 0, `${id}/${word}: the mixed swaps are still searched there`);
      assert.equal(JSON.stringify(compileOn(caps, doc, model)), JSON.stringify(compileOn(caps, JSON.parse(before), model)),
        `${id}/${word}: the plan is byte-identical`);
    }
  }
});

test("the run path: a run on this register derives a band with no mixed spelling, and logs the count", () => {
  const d = mkdtempSync(join(ROOT, "run-"));
  mkdirSync(driverDir(d), { recursive: true });
  writeFileSync(join(d, "variant-manifest.json"), JSON.stringify(modelFor("TIMBER")));
  deriveFormNeighbourhood({ paths: paths(d), job: { marks: [{ name: "TIMBER" }] } });

  const doc = JSON.parse(readFileSync(join(d, "form-neighbourhood.json"), "utf8"));
  assert.equal(doc.seeded_from, "variant-manifest.json (validated)", "the fixture reached the validated seed, not the fallback");
  assert.deepEqual(doc.elements[0].band.mixedScriptNotSearched, ["τιμβεr", "тiмвеr"],
    "the active register's declaration reached the band");
  assert.deepEqual(mixed(doc.elements.flatMap((e) => e.band.exactQueries)), []);
  const ev = readFileSync(driverDir(d, "run.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .find((e) => e.event === "form-neighbourhood-derived");
  assert.equal(ev?.mixedScriptNotSearched, 2);
});
