// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — drives one clearance's findings through the prompt, the recorder, the stage gate and the card under a framework that states a method
//
// A framework that states a method — named inputs and a table from them to a band — used to reach a report
// as its band words alone: the finding record had nowhere for the inputs, and nothing held the band to the
// table. This follows the path one run's findings take, under an invented framework with a method frozen
// into the run: the dictation the writer reads, the record_synthesis refusals it corrects from, the
// stage's own gate on the file it wrote, and the card a reader sees. The same path under a framework
// with no method must be exactly what it was.
//
// BREAK MATRIX:
//   · the writer is not told the inputs, or is told them under a framework with none      → arm 1 red
//   · a rated finding with no inputs, or an off-table band, is recorded                   → arm 2 red
//   · the stage gate passes a findings file whose band has drifted from its inputs        → arm 2 red
//   · the card drops the inputs, or shows them in another order or form                   → arm 2 red
//   · a framework with no method accepts inputs, or refuses a finding without them        → arm 3 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { parseFrameworkManifest } from "../framework.mjs";
import { parseFrameworkMethod, freezeFrameworkMethod, methodDictation, FROZEN_METHOD_FILE } from "../framework-method.mjs";
import { STAGES, paths } from "../stages.mjs";
import { recordSynthesis } from "../synthesis-record.mjs";
import { validators } from "../verify.mjs";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const MANIFEST = parseFrameworkManifest({
  schema_version: 1, framework_key: "orchard-test", title: "Invented test framework", source_deck: "none",
  entity_label: "the company",
  bands: [{ label: "Severe", tone: "severe" }, { label: "High", tone: "high" }, { label: "Medium", tone: "medium" }, { label: "Low", tone: "low" }],
  structure: { kind: "matrix", axes: ["Claim Grade", "Conflict Kind"] },
});
const METHOD = parseFrameworkMethod({
  schema_version: 1, framework_key: "orchard-test",
  inputs: [
    { label: "Claim Grade", values: ["P", "Q", "R"], ordered: true },
    { label: "Conflict Kind", values: ["Orchard", "Harbour"], show_label: false },
  ],
  table: [
    { band: "Severe", when: { "Claim Grade": ["R"], "Conflict Kind": ["Orchard"] } },
    { band: "High", when: { "Claim Grade": ["R"], "Conflict Kind": ["Harbour"] } },
    { band: "Medium", when: { "Claim Grade": ["Q"] } },
    { band: "Low", when: { "Claim Grade": ["P"] } },
  ],
}, MANIFEST);

// the writer's sections: long enough for the narrative floor, and nothing this test is about
const NARRATIVE = {
  spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first. "
    + "The conflicting registration covers the same distinctive element in the filed class, and the goods overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The instructed registers were enumerated to completeness on the named band." },
};

function runDir({ method }) {
  const dir = mkdtempSync(join(tmpdir(), "fw-inputs-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "framework.json"), JSON.stringify(MANIFEST, null, 2));
  if (method) freezeFrameworkMethod(driverDir(dir, FROZEN_METHOD_FILE), method);
  return dir;
}
const findingsDoc = (dir, over = {}) => {
  const doc = JSON.parse(synthesisFindings(dir));
  Object.assign(doc.findings[0], over);
  return doc;
};
const card = (findings, frameworkMethod) => {
  const dir = mkdtempSync(join(tmpdir(), "fw-inputs-card-"));
  const md = join(dir, "f.report.md");
  writeFileSync(md, ["---", "type: clearance-clearance", "matter: fw-inputs", "title: ORCHARD", "run: 2026-09-24", "---", "", "# Marks", ""].join("\n"));
  try { return renderHtml(parseReport(md), findings, [], { runId: "fw-inputs", framework: MANIFEST, frameworkMethod }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
};

test("the writer is told the framework's inputs, in its order and words, only where the framework states them", () => {
  const P = paths("/r");
  const withMethod = STAGES.synthesis.message({ paths: P, job: {}, profile: null, framework: MANIFEST, frameworkMethod: METHOD });
  assert.ok(withMethod.includes(methodDictation(METHOD)), "the dictation names the inputs");
  assert.ok(withMethod.includes("This framework rates through its inputs, in this order: Claim Grade (P / Q / R), then Conflict Kind (Orchard / Harbour)."));
  assert.ok(withMethod.includes('- inputs: {"Claim Grade": "<value>", "Conflict Kind": "<value>"}'), "the inputs key is dictated in the framework's labels");
  assert.ok(withMethod.includes("the band is what its stated method produces from the inputs you recorded"));

  const without = STAGES.synthesis.message({ paths: P, job: {}, profile: null, framework: MANIFEST });
  for (const s of ["rates through its inputs", '"inputs" (rated findings only)', "- inputs:", "from the inputs you recorded"])
    assert.ok(!without.includes(s), `a framework with no method reads no "${s}"`);
});

test("under a framework with a method, a rated finding is recorded only with its inputs and the band the table gives", () => {
  const dir = runDir({ method: METHOD });
  // the writer leaves the inputs out: refused, with the labels it must record
  let r = recordSynthesis(dir, { findings: findingsDoc(dir), narrative: NARRATIVE });
  assert.equal(r.written, null);
  assert.match(r.refused, /finding_inputs_missing:1 \(this framework rates through Claim Grade and Conflict Kind; record both under "inputs"\)/);
  // inputs whose table band is not the band it gave: refused, naming the band the table gives
  r = recordSynthesis(dir, { findings: findingsDoc(dir, { inputs: { "Claim Grade": "R", "Conflict Kind": "Orchard" } }), narrative: NARRATIVE });
  assert.match(r.refused, /finding_band_off_table:1 \(the band High is not what this framework's table gives for Claim Grade R and Conflict Kind Orchard; the table gives Severe\./);
  // the old scale's keys point at the framework's own inputs
  r = recordSynthesis(dir, { findings: findingsDoc(dir, { level: "D" }), narrative: NARRATIVE });
  assert.match(r.refused, /finding_legacy_scale_forbidden:level .*record this framework's own inputs under "inputs" instead/);
  // right: recorded, in the framework's own casing and order
  r = recordSynthesis(dir, { findings: findingsDoc(dir, { inputs: { "conflict kind": "harbour", "claim grade": "r" } }), narrative: NARRATIVE });
  assert.ok(r.written, `recorded: ${r.refused ?? ""}`);
  const written = JSON.parse(readFileSync(join(dir, "findings.json"), "utf8"));
  assert.deepEqual(written.findings[0].inputs, { "Claim Grade": "R", "Conflict Kind": "Harbour" });
  assert.deepEqual(Object.keys(written.findings[0].inputs), ["Claim Grade", "Conflict Kind"], "in the framework's order");

  // the stage's own gate reads the same file against the same frozen method
  const narrativePath = join(dir, "narrative.md");
  assert.equal(validators.findings(narrativePath, readFileSync(narrativePath, "utf8")).ok, true);
  const drifted = { ...written, findings: [{ ...written.findings[0], band: "Severe" }] };
  writeFileSync(join(dir, "findings.json"), JSON.stringify(drifted));
  const gate = validators.findings(narrativePath, readFileSync(narrativePath, "utf8"));
  assert.equal(gate.ok, false, "a band that drifted from its inputs fails the stage");
  assert.match(gate.reason, /finding_band_off_table:1/);

  // the card shows the inputs beside the band, in the framework's order and form
  const html = card(written.findings, METHOD);
  assert.ok(html.includes("High · Claim Grade R · Harbour"), "the chip reads band · inputs");
  assert.ok(!card(written.findings, null).includes("Claim Grade"), "a page given no method shows no inputs");
});

test("under a framework with no method, a finding is recorded exactly as before, and inputs are refused", () => {
  const dir = runDir({ method: null });
  let r = recordSynthesis(dir, { findings: findingsDoc(dir, { inputs: { "Claim Grade": "R", "Conflict Kind": "Harbour" } }), narrative: NARRATIVE });
  assert.match(r.refused, /finding_inputs_forbidden:1 \(this framework states no inputs; drop "inputs"\)/);
  r = recordSynthesis(dir, { findings: findingsDoc(dir), narrative: NARRATIVE });
  assert.ok(r.written, `recorded: ${r.refused ?? ""}`);
  assert.equal(JSON.parse(readFileSync(join(dir, "findings.json"), "utf8")).findings[0].inputs, undefined);
  r = recordSynthesis(dir, { findings: findingsDoc(dir, { level: "D" }), narrative: NARRATIVE });
  assert.match(r.refused, /finding_legacy_scale_forbidden:level .*put the reasoning in the narrative/, "the old refusal, unchanged");
});
