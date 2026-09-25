// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — drives one knockout's conflicts through the dictation, the chunk gate, the merged gate, the page, the data and the workbook under a framework that states a method
//
// A knockout rates each candidate under the customer's framework, and a framework that states a method —
// named inputs and a table from them to a band — reached a knockout page as its band words alone. The
// rated items on a knockout page are its findings[] records and the weighed filings the rater gave a
// band; this follows both through the path one run takes, under an invented framework with a method
// frozen into the run: the dictation the rater reads, the chunk gate that refuses what it sent, the
// merged gate that writes the record which ships, and the chip, data row and workbook cell a reader
// sees. The same path under a framework with no method must be exactly what it was.
//
// BREAK MATRIX:
//   · a finding with no inputs, an unlisted value or an off-table band is accepted            → arm 1 red
//   · a framework with no method accepts inputs, or an offline caller refuses them            → arm 1 red
//   · a banded filing without inputs, or an unbanded one with them, passes the chunk gate     → arm 2 red
//   · a run that froze no method accepts inputs on a filing                                   → arm 2 red
//   · the merged record keeps the rater's casing, or a corrupt frozen method ships            → arm 3 red
//   · the lane freezes the method after the manifest, or loads a fresh one on resume          → arm 4 red
//   · the rater is not told the inputs, or is told them under a framework with none           → arm 5 red
//   · a chip, a data row or the workbook cell drops the inputs, or shows them with no method  → arm 6 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { parseFrameworkManifest } from "../framework.mjs";
import { parseFrameworkMethod, freezeFrameworkMethod, methodDictation, inputsShape, FROZEN_METHOD_FILE } from "../framework-method.mjs";
import { validateKnockoutFinding } from "../findings-model.mjs";
import { validators, validateMergedFindings } from "../verify-knockout.mjs";
import { KO_STAGES, koPaths } from "../stages-knockout.mjs";
import { renderKnockoutHtml, knockoutReportData } from "../publish/render-knockout.mjs";
import { buildKnockoutWorkbook } from "../publish/knockout.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// An invented framework: its labels and values are nobody's.
const MANIFEST = parseFrameworkManifest({
  schema_version: 1, framework_key: "orchard-test", title: "Invented test framework", source_deck: "none",
  entity_label: "the company",
  bands: [{ label: "Severe", tone: "severe" }, { label: "Serious", tone: "high" }, { label: "Notable", tone: "medium" }, { label: "Slight", tone: "low" }],
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
    { band: "Serious", when: { "Claim Grade": ["R"], "Conflict Kind": ["Harbour"] } },
    { band: "Notable", when: { "Claim Grade": ["Q"] } },
    { band: "Slight", when: { "Claim Grade": ["P"] } },
  ],
}, MANIFEST);

const EVIDENCE = "https://example.invalid/shop/veltra-pharma";
const RECORD_ID = "R-LUMENREED";
const FINDING = {
  ordinal: 1, name: "VELTRA PHARMA", owner: "Veltra Labs GmbH", band: "Serious", type: "Active Business",
  net: "Veltra Labs' unregistered VELTRA PHARMA use is more likely than not to block the applicant in Germany.",
  evidence: [EVIDENCE],
  basis: "Continuous German retail listings since 2019 under the applicant's exact goods, with an active storefront.",
};
// The rater's own casing and order; the gates hand back the framework's.
const LOOSE = { "conflict kind": "harbour", "claim grade": "r" };
const CANONICAL = { "Claim Grade": "R", "Conflict Kind": "Harbour" };

const run = ({ method = METHOD, corrupt = false } = {}) => {
  const d = mkdtempSync(join(tmpdir(), "ko-method-"));
  mkdirSync(driverDir(d), { recursive: true });
  mkdirSync(join(d, "research"), { recursive: true });
  writeFileSync(join(d, "research", "testmark.md"), `# research payload for TESTMARK\n\nA storefront: ${EVIDENCE}\n`);
  writeFileSync(driverDir(d, "framework.json"), JSON.stringify(MANIFEST));
  writeFileSync(driverDir(d, "register-records.json"), JSON.stringify({
    marks: [{ name: "TESTMARK", records: [{ recordId: RECORD_ID, mark: "LUMENREED", owner: "Lumenreed GmbH" }] }],
  }));
  if (corrupt) writeFileSync(driverDir(d, FROZEN_METHOD_FILE), "{ not json");
  else if (method) freezeFrameworkMethod(driverDir(d, FROZEN_METHOD_FILE), method);
  return d;
};
const MARK = {
  name: "TESTMARK", rating: "Slight", classesDriving: [9], basis: "The name is close to a known property.",
  factors: ["A first load-bearing observation.", "A second load-bearing observation."],
  counterFactors: ["What holds it at this band."], mitigation: "",
  bullets: ["One honest evidence bullet."], purpleNotes: [],
};
const chunk = (findings, reads) => JSON.stringify({
  framework: MANIFEST, batch: { productContext: "x", standardCaveats: [] },
  marks: [{ ...MARK, findings, registerReads: reads }], chunkSummary: "A measured sentence about this chunk of marks.",
});
const read = "The owner's filings sit in optical goods.";

test("arm 1: a knockout finding records the framework's inputs and takes its table's band", () => {
  const f = (over, opts = { manifest: MANIFEST, method: METHOD }) => validateKnockoutFinding({ ...FINDING, ...over }, 0, new Set(), opts);

  const ok = f({ inputs: { ...LOOSE } });
  assert.deepEqual(ok.inputs, CANONICAL, "the inputs come back in the framework's casing");
  assert.deepEqual(Object.keys(ok.inputs), ["Claim Grade", "Conflict Kind"], "…and in its order");

  assert.throws(() => f({}), (e) => e.message === 'knockout_finding_inputs_missing:1 (this framework rates through Claim Grade and Conflict Kind; record both under "inputs")');
  assert.throws(() => f({ inputs: { "Claim Grade": "S", "Conflict Kind": "Harbour" } }),
    (e) => e.message === "knockout_finding_inputs_invalid:1 (Claim Grade must be one of: P / Q / R)");
  assert.throws(() => f({ inputs: { ...CANONICAL, Weight: "3" } }), /^Error: knockout_finding_inputs_unknown:1 /);
  assert.throws(() => f({ band: "Severe", inputs: { ...CANONICAL } }),
    (e) => e.message === "knockout_finding_band_off_table:1 (the band Severe is not what this framework's table gives for Claim Grade R and Conflict Kind Harbour; the table gives Serious. Change the band, or reconsider an input)");

  // A run that froze no method: a finding without inputs is what every knockout sent, and inputs are refused.
  assert.equal(f({}, { manifest: MANIFEST, method: null }).inputs, undefined);
  assert.throws(() => f({ inputs: { ...CANONICAL } }, { manifest: MANIFEST, method: null }),
    (e) => e.message === 'knockout_finding_inputs_forbidden:1 (this framework states no inputs; drop "inputs")');
  // A caller that does not say (offline): shape only, never a verdict on the table.
  assert.deepEqual(f({ inputs: { ...LOOSE } }, { manifest: MANIFEST }).inputs, LOOSE);
  assert.throws(() => f({ inputs: "R / Harbour" }, { manifest: MANIFEST }),
    (e) => e.message === `knockout_finding_inputs_invalid:1 ("inputs" is an object naming each of the framework's inputs and its value)`);
});

test("arm 2: the chunk gate holds every banded filing and every finding to the frozen method", () => {
  const d = run();
  const file = join(d, "knockout-assess-0.json");
  const gate = (findings, reads) => validators.knockoutAssessChunk(file, chunk(findings, reads));

  assert.equal(gate([{ ...FINDING, inputs: { ...LOOSE } }], [{ recordId: RECORD_ID, read, band: "notable", inputs: { "Claim Grade": "q", "Conflict Kind": "orchard" } }]).ok, true,
    "a finding and a banded filing that carry the table's inputs pass");
  assert.equal(gate([], [{ recordId: RECORD_ID, read }]).ok, true, "an unbanded filing still needs nothing");

  const refused = (findings, reads, re) => {
    const v = gate(findings, reads);
    assert.equal(v.ok, false, `accepted: ${JSON.stringify({ findings, reads })}`);
    assert.match(v.reason, re);
  };
  refused([{ ...FINDING }], [], /knockout_finding_inputs_missing:1 \(this framework rates through Claim Grade and Conflict Kind/);
  refused([], [{ recordId: RECORD_ID, read, band: "Notable" }], new RegExp(`knockout_finding_inputs_missing:${RECORD_ID} `));
  refused([], [{ recordId: RECORD_ID, read, band: "Serious", inputs: { "Claim Grade": "Q", "Conflict Kind": "Orchard" } }],
    new RegExp(`knockout_finding_band_off_table:${RECORD_ID} \\(the band Serious is not what this framework's table gives for Claim Grade Q and Conflict Kind Orchard; the table gives Notable`));
  refused([], [{ recordId: RECORD_ID, read, inputs: { ...CANONICAL } }],
    new RegExp(`knockout_finding_inputs_forbidden:${RECORD_ID} \\(only a rated conflict records the framework's inputs; drop "inputs"\\)`));

  // A run that froze no method reads as it always did, and refuses inputs it was never asked for.
  const bare = run({ method: null });
  const bareGate = (findings, reads) => validators.knockoutAssessChunk(join(bare, "knockout-assess-0.json"), chunk(findings, reads));
  assert.equal(bareGate([{ ...FINDING }], [{ recordId: RECORD_ID, read, band: "Notable" }]).ok, true);
  const v = bareGate([], [{ recordId: RECORD_ID, read, band: "Notable", inputs: { "Claim Grade": "Q", "Conflict Kind": "Orchard" } }]);
  assert.equal(v.ok, false);
  assert.match(v.reason, new RegExp(`knockout_finding_inputs_forbidden:${RECORD_ID} \\(this framework states no inputs; drop "inputs"\\)`));
});

test("arm 3: the merged gate writes the framework's own inputs into the record that ships, and refuses a method it cannot read", () => {
  const merged = () => ({
    schema_version: 1,
    batch: { executiveSummary: "A batch read.", standardCaveats: ["Triage, not clearance."] },
    marks: [{ ...MARK, findings: [{ ...FINDING, inputs: { ...LOOSE } }],
      registerReads: [{ recordId: RECORD_ID, read, band: "notable", inputs: { "conflict kind": "orchard", "claim grade": "q" } }] }],
  });
  const ofMethod = (failures) => failures.filter((x) => /inputs|table|method/.test(x));

  const doc = merged();
  const out = validateMergedFindings(run(), doc, { marks: [] });
  assert.deepEqual(ofMethod(out.failures), [], "a record whose inputs match the table is refused");
  assert.deepEqual(Object.entries(doc.marks[0].findings[0].inputs), Object.entries(CANONICAL),
    "the finding ships with the rater's casing, not the framework's");
  assert.deepEqual(Object.entries(doc.marks[0].registerReads[0].inputs), [["Claim Grade", "Q"], ["Conflict Kind", "Orchard"]],
    "the filing ships with the rater's casing, not the framework's");

  const broken = validateMergedFindings(run({ corrupt: true }), merged(), { marks: [] });
  assert.ok(broken.failures.some((x) => x.startsWith(`knockout_method_unreadable: _driver/${FROZEN_METHOD_FILE} does not parse`)),
    "a run whose frozen method cannot be read ships a record nothing checked");
});

test("arm 4: the knockout lane freezes the method before its manifest and reads it back on resume", () => {
  // Source-bound: the attach sits inside the pipeline's run setup, which cannot be driven from here.
  const src = readFileSync(join(HERE, "..", "pipeline-knockout.mjs"), "utf8");
  const body = src.slice(src.indexOf("function attachKnockoutFramework(ctx) {"));
  const resume = body.indexOf("minted: false");
  const mint = body.indexOf("minted: true");
  const write = body.indexOf("atomicWrite(sidecarPath");
  assert.ok(resume > 0 && body.indexOf("return;") > resume, "the resume branch does not read the frozen method back");
  assert.ok(mint > 0 && write > mint, "the method is frozen after the manifest: an interrupted mint resumes with no method");
});

test("arm 5: the rater is told the framework's inputs only where the framework states a method", () => {
  const d = run();
  const K = koPaths(d);
  mkdirSync(dirname(K.registerRecords), { recursive: true });
  if (!existsSync(K.registerRecords)) writeFileSync(K.registerRecords, "{}");
  const message = (frameworkMethod) => String(KO_STAGES["knockout-assess"].message({
    K, chunkNo: 0, chunkMarks: [{ name: "TESTMARK" }], chunkTotal: 1, framework: MANIFEST, probeNote: null, frameworkMethod,
  }));

  const told = message(METHOD);
  assert.ok(told.includes("{ordinal, name, owner, band, inputs, net, type,"), "the findings keys do not name inputs");
  assert.ok(told.includes(methodDictation(METHOD)), "the method is not dictated");
  assert.equal(methodDictation(METHOD), "This framework rates through its inputs, in this order: Claim Grade (P / Q / R), then Conflict Kind (Orchard / Harbour). Record both on every rated finding, in these exact words, and give the band its table yields for them.");
  assert.ok(told.includes(`- inputs: ${inputsShape(METHOD)} — the framework's own inputs for this finding, each one of the values it lists, reasoned in its order before the band. On every rated finding.`));
  assert.ok(told.includes('rows of {recordId, read, band?, inputs?}'));
  assert.ok(told.includes('A row that carries "band" also carries "inputs", the framework\'s own inputs for that filing; a row with no band carries none.'));

  const plain = message(null);
  assert.ok(plain.includes("{ordinal, name, owner, band, net, type,") && plain.includes("rows of {recordId, read, band?} for"),
    "a framework with no method reads different keys than it always did");
  assert.doesNotMatch(plain, /inputs/, "a framework with no method is told about inputs");
  assert.equal(plain, message(undefined), "an unset method and a run that froze none read the same prompt");
});

test("arm 6: the chip, the data row and the workbook cell show the inputs beside the band, and only under a method", async () => {
  const records = { marks: [{ name: "TESTMARK", classes: [9],
    records: [{ recordId: RECORD_ID, mark: "LUMENREED", owner: "Lumenreed GmbH", territory: "EU", classes: [9], status: "registered", url: "https://example.test/R-LUMENREED" }] }] };
  const findings = {
    batch: { overall: "Serious", executiveSummary: "summary" },
    marks: [{ ...MARK, rating: "Serious", classesSearched: [9], findings: [{ ...FINDING, inputs: { ...CANONICAL } }],
      registerReads: [{ recordId: RECORD_ID, read, band: "Notable", inputs: { "Claim Grade": "Q", "Conflict Kind": "Orchard" } }] }],
  };
  const html = (frameworkMethod) => renderKnockoutHtml(findings, MANIFEST, { runId: "r1", overall: "Serious", registerRecords: records, frameworkMethod });
  const chips = (h) => [...h.matchAll(/<span class="ko-findband"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);

  assert.deepEqual(chips(html(METHOD)), ["Serious · Claim Grade R · Harbour", "Notable · Claim Grade Q · Orchard"],
    "the finding card and the register card show the framework's inputs beside the band, in its order and label choice");
  assert.deepEqual(chips(html(null)), ["Serious", "Notable"], "with no method the chip is the band alone");

  const data = knockoutReportData(findings, MANIFEST, { runId: "r1", overall: "Serious", registerRecords: records });
  const rows = data.marks[0].findings;
  assert.deepEqual(rows.find((r) => r.shape === "typed").inputs, CANONICAL);
  assert.deepEqual(rows.find((r) => r.shape === "register").inputs, { "Claim Grade": "Q", "Conflict Kind": "Orchard" });
  assert.deepEqual(data.marks[0].registerReads[0].inputs, { "Claim Grade": "Q", "Conflict Kind": "Orchard" });
  const bareData = knockoutReportData({ ...findings, marks: [{ ...findings.marks[0], findings: [{ ...FINDING }], registerReads: [{ recordId: RECORD_ID, read, band: "Notable" }] }] },
    MANIFEST, { runId: "r1", overall: "Serious", registerRecords: records });
  assert.ok(!JSON.stringify(bareData).includes('"inputs"'), "a run with no inputs grows an inputs key in its data");

  const ExcelJS = (await import("exceljs")).default;
  const bandCell = async (frameworkMethod) => {
    const out = join(mkdtempSync(join(tmpdir(), "ko-method-xlsx-")), "audit.xlsx");
    await buildKnockoutWorkbook(findings, [], out, null, [], MANIFEST, records, frameworkMethod);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    const ws = wb.getWorksheet("Findings");
    const col = ws.getRow(1).values.indexOf("Band");
    return ws.getRow(2).getCell(col).value;
  };
  assert.equal(await bandCell(METHOD), "Serious · Claim Grade R · Harbour");
  assert.equal(await bandCell(null), "Serious");
});
