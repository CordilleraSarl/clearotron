// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Stage 1 — a territory is a stack of rights, and a search that reached one of them must say so.
//
// THE STATE THESE TESTS EXIST TO MAKE IMPOSSIBLE is not a missing search. It is a missing SENTENCE: a
// France order that searched the French national register alone, recorded every ordered territory as
// reached, and therefore produced no disclosure row at all. The run completed, the report rendered, and
// the only untrue thing about it was what it implied.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bindingLayersFor, territoryLayerReport, layerCoverageFor, unsearchedLayerReason, LAYERS }
  from "../binding-layers.mjs";
import { coverageFormRows } from "../coverage-form.mjs";
import { capabilitiesFor } from "../register-capabilities.mjs";
import { compileRegisterPlan } from "../register-plan.mjs";
import { parseVariantManifestModel } from "../variant-manifest-model.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";   //

// The smallest manifest compileRegisterPlan accepts — this file is about layers, not about manifests.
const MINIMAL_MANIFEST = JSON.stringify({
  mark: "VELTRIN", dominant_element: "VELTRIN",
  elements: [{ value: "VELTRIN", kind: "distinctive" }],
  variants: [{ value: "VELTRI", category: "phonetic", rationale: "drop the trailing N" }],
  incumbent_classes: ["9"],
});

test("an EU member is bound by three layers, not one", () => {
  const fr = bindingLayersFor("FR");
  assert.deepEqual(fr.map((l) => l.layer), ["national", "regional", "international"]);
  assert.deepEqual(fr.map((l) => l.office), ["FR", "EM", "WO"]);
  // Every layer says WHY it binds, because that sentence is what a lawyer reads when it is unsearched.
  for (const l of fr) assert.ok(l.why && l.why.length > 20, `${l.layer} states why it binds`);
});

test("a non-EU territory is bound by two — and the regional layer is absent, not unsearched", () => {
  const us = bindingLayersFor("US");
  assert.deepEqual(us.map((l) => l.layer), ["national", "international"]);
  // THE DISTINCTION THAT KEEPS THE DISCLOSURE READABLE. There is no regional register binding the US,
  // so there is nothing to disclose. A table that emitted one would print a limitation about a register
  // that does not exist, on every US matter, and teach its reader to skim the ones that do.
  assert.ok(!us.some((l) => l.layer === "regional"));
});

test("Benelux is the NATIONAL register for its members, never an extra regional layer", () => {
  for (const t of ["NL", "BE", "LU"]) {
    const layers = bindingLayersFor(t);
    const national = layers.find((l) => l.layer === "national");
    assert.equal(national.office, "BX", `${t}: BX stands in place of a national register`);
    // …and it is still an EU member, so the EU layer is present too and is NOT the same row.
    assert.ok(layers.some((l) => l.layer === "regional" && l.office === "EM"), `${t}: EU rights still bind`);
    assert.equal(layers.filter((l) => l.office === "BX").length, 1, `${t}: BX appears once, as national`);
  }
});

test("the EU ordered AS a territory has no national layer to miss", () => {
  const eu = bindingLayersFor("EU");
  assert.deepEqual(eu.map((l) => l.layer), ["regional", "international"]);
  assert.deepEqual(bindingLayersFor("EM").map((l) => l.layer), ["regional", "international"]);
});

test("an empty territory throws rather than binding nothing", () => {
  // An empty covered set reads as "covers nothing" and must never be produced by failure — the rule
  // register-availability.mjs states, applied here. Returning [] would mean "no layers bind this
  // territory", which is the same shape as a complete clearance.
  assert.throws(() => bindingLayersFor(""), /a territory is required/);
  assert.throws(() => bindingLayersFor(null), /a territory is required/);
});

test("an unrecorded layer datum is `unestablished`, never coverage", () => {
  const clarivate = capabilitiesFor("clarivate");
  // Established, written down.
  assert.equal(layerCoverageFor(clarivate, "US", "national"), "returns");
  // NOT established — clarivate declares US and WO as separate codes and nothing here settles whether
  // a US-scoped search returns IR designations. Silence must not read as coverage.
  assert.equal(layerCoverageFor(clarivate, "US", "international"), "unestablished");
  // A contract with no table at all establishes nothing at all.
  assert.equal(layerCoverageFor({ offices: { layers: {} } }, "FR", "national"), "unestablished");
  // And a missing contract entirely is unestablished rather than a crash or a pass.
  assert.equal(layerCoverageFor(null, "FR", "national"), "unestablished");
  assert.equal(layerCoverageFor({}, "FR", "regional"), "unestablished");
});

test("`*` answers for the codes a provider cannot enumerate — and never overrides a named one", () => {
  // corsearch takes ANY ISO code as a region filter, so there is no list of national offices to write
  // down and every one of them would otherwise stay `unestablished` forever — a caveat on a register
  // the plan did search. `"*"` is the only form the datum can take there.
  const cor = capabilitiesFor("corsearch");
  assert.equal(layerCoverageFor(cor, "FR", "national"), "returns");
  assert.equal(layerCoverageFor(cor, "ZA", "national"), "returns", "…for a code nobody wrote down");
  assert.equal(layerCoverageFor(cor, "EU", "regional"), "returns");
  assert.equal(layerCoverageFor(cor, "WO", "international"), "returns");

  // Clarivate has the same problem for the same reason — 186 covered codes, eight written down — and
  // the entry it gains says only that a registration-office code returns its own register.
  const cla = capabilitiesFor("clarivate");
  assert.equal(layerCoverageFor(cla, "CH", "national"), "returns");
  assert.equal(layerCoverageFor(cla, "JP", "national"), "returns");
  // …and the open question it was NOT allowed to answer stays open, because US has an entry of its own.
  assert.equal(layerCoverageFor(cla, "US", "international"), "unestablished",
    "whether a national code reaches Madrid designations is still unestablished — `*` must not settle it");
  assert.equal(layerCoverageFor(cla, "US", "regional"), "excludes", "…nor soften a known exclusion");
  // It is a FALLBACK, consulted only where the code has no entry of its own — it can never soften a
  // specific declaration into a general one, which is how a provider's known `excludes` would be lost.
  const caps = { offices: { layers: {
    "*": { national: "returns", regional: "returns" },
    US: { national: "returns", regional: "excludes" },
  } } };
  assert.equal(layerCoverageFor(caps, "US", "regional"), "excludes", "the named entry wins outright");
  assert.equal(layerCoverageFor(caps, "US", "international"), "unestablished",
    "and it wins WHOLE — an entry of its own is not topped up from `*`");
  assert.equal(layerCoverageFor(caps, "FR", "regional"), "returns");
});

test("THE DEFECT: a France search on the national register alone is incomplete, and says so", () => {
  // This is the exact production shape the issue describes. Under the old one-to-one resolution the
  // plan recorded FR as reached and the form had nothing to render.
  const r = territoryLayerReport("FR", ["FR"], capabilitiesFor("clarivate"));
  assert.equal(r.complete, false, "a France clearance on FR alone is NOT complete");
  assert.deepEqual(r.searched.map((l) => l.layer), ["national"]);
  assert.deepEqual(r.unsearched.map((l) => l.layer), ["regional", "international"]);

  const said = unsearchedLayerReason(r);
  assert.match(said, /Not a complete clearance for FR/);
  assert.match(said, /EU-wide rights/);
  assert.match(said, /international registrations/);
  assert.match(said, /cannot be read as a clean negative/);
  // The reason is printed on the client's report, so it must carry no engine vocabulary — the coverage
  // gate refuses a row whose reason does.
  for (const banned of ["primary-sweep", "saturation-probe", "incumbent-class", "transliteration-numeric"]) {
    assert.ok(!said.includes(banned), `the lawyer's sentence must not contain "${banned}"`);
  }
});

test("ordering the EU alongside France closes the regional layer but not the international one", () => {
  const r = territoryLayerReport("FR", ["FR", "EM"], capabilitiesFor("clarivate"));
  assert.deepEqual(r.searched.map((l) => l.layer), ["national", "regional"]);
  assert.deepEqual(r.unsearched.map((l) => l.layer), ["international"],
    "WO is still unestablished for clarivate — one layer closing must not close the others");
  assert.equal(r.complete, false);
});

test("a fully searched territory produces no row — the disclosure must not become noise", () => {
  const r = territoryLayerReport("FR", ["FR", "EM", "WO"], capabilitiesFor("clarivate"));
  assert.equal(r.complete, true);
  assert.deepEqual(r.unsearched, []);
});

test("an EUIPO-only install reports the national register as an ESTABLISHED exclusion", () => {
  // The difference from `unestablished` matters to whoever reads the receipt: this deployment can never
  // reach the German register, which is a procurement fact, not an unanswered question.
  const r = territoryLayerReport("DE", ["EU"], capabilitiesFor("euipo"));
  assert.equal(r.complete, false);
  assert.deepEqual(r.searched.map((l) => l.layer), ["regional", "international"]);
  assert.deepEqual(r.unsearched.map((l) => l.layer), ["national"]);
  assert.equal(r.unsearched[0].state, "excludes", "an established exclusion, not an open question");
});

test("free-tier composes its members' layer tables by union, and inherits no gap", () => {
  const ft = capabilitiesFor("free-tier");
  assert.equal(layerCoverageFor(ft, "EU", "regional"), "returns", "from euipo");
  assert.equal(layerCoverageFor(ft, "US", "national"), "returns", "from uspto-local");
  // The one that must NOT compose: neither member established it, so the composite has not either.
  assert.equal(layerCoverageFor(ft, "US", "international"), "unestablished",
    "a composite must never inherit coverage neither member established");
});

test("the form carries a DRIVER-WRITTEN row for a territory missing a binding layer", () => {
  const { rows } = coverageFormRows({
    skeleton: [{ axis: "primary-sweep", state: "clean" }],
    plan: { entries: [{ qid: "q1", regions: ["FR"] }] },
    orderedTerritories: ["FR"],
    capabilities: capabilitiesFor("clarivate"),
  });
  const layerRow = rows.find((r) => String(r.unit).startsWith("FR — binding registers"));
  assert.ok(layerRow, `no layer row was written — rows: ${JSON.stringify(rows.map((r) => r.unit))}`);
  assert.equal(layerRow.open, true, "it is OPEN — it cannot be read as a clean negative");
  assert.equal(layerRow.status, null, "and undecided, so the seat must settle it explicitly");
  assert.equal(layerRow.qid, null, "there is no query to point at; that is the whole fact");
  assert.match(layerRow.open_because, /Not a complete clearance for FR/);
  // The receipt line is for an engineer and MAY name the states; the reason is for a lawyer and may not.
  assert.match(layerRow.receipt_reason, /regional \(EM\): unestablished/);
});

test("no layer row when every binding register was searched", () => {
  const { rows } = coverageFormRows({
    skeleton: [{ axis: "primary-sweep", state: "clean" }],
    plan: { entries: [{ qid: "q1", regions: ["FR", "EM", "WO"] }] },
    orderedTerritories: ["FR"],
    capabilities: capabilitiesFor("clarivate"),
  });
  assert.ok(!rows.some((r) => String(r.unit).includes("binding registers")),
    "a complete territory must produce no row — over-disclosure trains a reader to skim");
});

test("no ordered territories ⇒ no layer rows, and the rest of the form is untouched", () => {
  // PROD-NEUTRALITY. Every existing caller passes neither `orderedTerritories` nor `capabilities`, and
  // must get byte-identical output. Asserted rather than assumed, because a default that silently
  // started emitting rows would put a limitation on every report in production.
  const args = { skeleton: [{ axis: "primary-sweep", state: "clean" }], plan: { entries: [{ qid: "q1", regions: ["FR"] }] } };
  const before = coverageFormRows(args);
  assert.ok(!before.rows.some((r) => String(r.unit).includes("binding registers")));
  assert.deepEqual(coverageFormRows({ ...args, orderedTerritories: [] }).rows, before.rows);
});

test("the layer vocabulary is closed", () => {
  assert.deepEqual([...LAYERS], ["national", "regional", "international"]);
  for (const t of ["FR", "US", "NL", "EU", "JP", "GB"]) {
    for (const l of bindingLayersFor(t)) {
      assert.ok(LAYERS.includes(l.layer), `${t}: ${l.layer} is in the closed vocabulary`);
    }
  }
});

// ── the wiring, which is what makes any of the above reach a report ────────────────────────────────
//
// Stage 1 landed the row builder and nothing passed it the two arguments it needs, so the disclosure
// fired for a test and never for a run. A guard that guards nothing is the failure mode this whole
// track is about, and it is worth its own assertion rather than a second reading of the same code.

test("#1028 the frozen plan records the territories the matter ORDERED, not just the offices", () => {
  const plan = compileRegisterPlan({
    manifest: parseVariantManifestModel(MINIMAL_MANIFEST),
    job: { classes: ["9"], jurisdictions: ["France"] },
    capabilities: capabilitiesFor("clarivate"),
  });
  assert.deepEqual(plan.ordered_jurisdictions, ["France"],
    "the ORDER is recorded — regions alone cannot say which territory was asked for");
  assert.ok(Array.isArray(plan.regions), "and the translated offices are still there, unchanged");
});

test("#1028 coverageFormInput hands the row builder what it needs, off the FROZEN plan", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { coverageFormInput } = await import("../coverage-form-io.mjs");

  const runDir = mkdtempSync(join(tmpdir(), "cfi-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(driverDir(runDir, "plan-execution.json"),
    JSON.stringify({ skeleton: [{ axis: "primary-sweep", state: "clean" }], deferred: [] }));
  writeFileSync(driverDir(runDir, "register-plan.json"), JSON.stringify({
    entries: [{ qid: "q1", regions: ["FR"] }],
    ordered_jurisdictions: ["FR"],
    provider: "clarivate",
  }));

  const { input } = coverageFormInput(runDir);
  assert.deepEqual(input.orderedTerritories, ["FR"]);
  assert.equal(input.capabilities?.id, "clarivate", "read from the plan's provider, not the live env");

  // …and end to end: the row a lawyer reads actually appears from a real run's artifacts.
  const { rows } = coverageFormRows(input);
  const layerRow = rows.find((r) => String(r.unit).startsWith("FR — binding registers"));
  assert.ok(layerRow, `the disclosure did not reach the form — rows: ${JSON.stringify(rows.map((r) => r.unit))}`);
  assert.match(layerRow.open_because, /Not a complete clearance for FR/);
});

test("#1028 a plan frozen BEFORE this change degrades to no rows, never to wrong ones", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { coverageFormInput } = await import("../coverage-form-io.mjs");

  const runDir = mkdtempSync(join(tmpdir(), "cfi-old-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(driverDir(runDir, "plan-execution.json"),
    JSON.stringify({ skeleton: [{ axis: "primary-sweep", state: "clean" }], deferred: [] }));
  // No `ordered_jurisdictions`, no `provider` — a resumed run whose plan was frozen last week.
  writeFileSync(driverDir(runDir, "register-plan.json"),
    JSON.stringify({ entries: [{ qid: "q1", regions: ["FR"] }] }));

  const { input } = coverageFormInput(runDir);
  assert.deepEqual(input.orderedTerritories, [], "an absent field is an empty order, not a guess");
  assert.equal(input.capabilities, null);
  assert.ok(!coverageFormRows(input).rows.some((r) => String(r.unit).includes("binding registers")),
    "a pre-#1028 plan must not acquire a disclosure derived from data it never carried");
});
