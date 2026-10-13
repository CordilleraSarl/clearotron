// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the synthesis transport reading a correction, on invented records
//
// A CORRECTION PATCHES WHAT IT CARRIES.
//
// A corrective pass sends what it changed. It has been seen to send the registers it corrected inside a
// `findings` object that carries no findings list, beside its finding rows, and main read every such object
// as a whole record: "findings must be an array", or, where the run owed records, a refusal naming records
// the stored record already held. Each refusal cost a regenerated save. A `findings` object with no list is
// now a patch on the registers it carries, merged onto the stored record and judged whole, so nothing the
// call did not name can move.
//
// WHAT MAIN STILL DECIDES. A shape this change does not newly accept gets main's refusal, byte for byte: a
// nested row that conflicts with a top-level one, two nested rows for one ordinal, a key off the record's
// ladder, an envelope that would re-version the record, and a first save that has no stored record to patch.
// Those arms below are characterisation: green before and after.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { recordSynthesis, mergeSynthesisPatch, FINDINGS_FILE, NARRATIVE_FILE } from "../synthesis-record.mjs";
import { foldFindingsFile, UNFOLDED_FILE } from "../record-fold.mjs";
import { parseFrameworkManifest } from "../framework.mjs";
import { parseFrameworkMethod, freezeFrameworkMethod, FROZEN_METHOD_FILE } from "../framework-method.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const NARRATIVE = {
  spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first. "
    + "The conflicting registration covers the same distinctive element in the filed class, and the goods overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The instructed registers were enumerated to completeness on the named band." },
};
const THREE = [["Halvorne Works", "TESSARIN"], ["Quillmere Ltd", "ODRAVEL"], ["Pennick Supply", "MARVETTE"]];
// The second finding is a second filing of the first, so the delivery seam folds the two together.
const FOLDING = [["Qorvalen Holdings", "VELTRIN"], ["Qorvalen Holdings", "VELTRIN"], ["Brannick Tooling", "ORVANTE"]];

/** A record whose findings are `[owner, mark]` pairs, each on its own registration. */
function record(rows = THREE) {
  const doc = JSON.parse(synthesisFindings(null));
  const base = doc.findings[0];
  return { ...doc, findings: rows.map(([owner, mark], i) => {
    const f = structuredClone(base);
    f.ordinal = i + 1;
    f.mark = mark;
    f.owner.name = owner;
    f.owner.registrations[0].uri = `/mark/us/9300000${i + 1}`;
    if (f.meters?.mark_similarity) f.meters.mark_similarity.source = f.owner.registrations[0].uri;
    return f;
  }) };
}

// An invented framework that states a method, so a band is held to its inputs.
const MANIFEST = parseFrameworkManifest({
  schema_version: 1, framework_key: "orchard-test", title: "Invented test framework", source_deck: "none",
  entity_label: "the company",
  bands: [{ label: "Severe", tone: "severe" }, { label: "High", tone: "high" }, { label: "Medium", tone: "medium" }, { label: "Low", tone: "low" }],
  structure: { kind: "matrix", axes: ["Claim Grade", "Conflict Kind"] },
});
const METHOD = parseFrameworkMethod({
  schema_version: 1, framework_key: "orchard-test",
  inputs: [{ label: "Claim Grade", values: ["P", "Q", "R"], ordered: true }, { label: "Conflict Kind", values: ["Orchard", "Harbour"], show_label: false }],
  table: [
    { band: "Severe", when: { "Claim Grade": ["R"], "Conflict Kind": ["Orchard"] } },
    { band: "High", when: { "Claim Grade": ["R"], "Conflict Kind": ["Harbour"] } },
    { band: "Medium", when: { "Claim Grade": ["Q"] } },
    { band: "Low", when: { "Claim Grade": ["P"] } },
  ],
}, MANIFEST);
const rated = () => {
  const doc = record();
  doc.rated_under_framework = "orchard-test";
  doc.findings = doc.findings.map((f) => ({ ...f, band: "High", inputs: { "Claim Grade": "R", "Conflict Kind": "Harbour" } }));
  return doc;
};

const dirs = [];
function runDir({ owed = false, method = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "patch-carries-"));
  dirs.push(dir);
  mkdirSync(driverDir(dir), { recursive: true });
  if (owed) writeFileSync(driverDir(dir, "declination-spec.json"), JSON.stringify({ rows: THREE.map((_, i) => ({ uri: `/mark/us/9300000${i + 1}` })) }));
  if (method) {
    writeFileSync(driverDir(dir, "framework.json"), JSON.stringify(MANIFEST, null, 2));
    freezeFrameworkMethod(driverDir(dir, FROZEN_METHOD_FILE), METHOD);
  }
  return dir;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const read = (at) => (existsSync(at) ? readFileSync(at, "utf8") : null);
const files = (dir) => ({ findings: read(join(dir, FINDINGS_FILE)), narrative: read(join(dir, NARRATIVE_FILE)),
  accepted: read(driverDir(dir, "synthesis-calls", "accepted.json")) });
const onDisk = (dir) => JSON.parse(read(join(dir, FINDINGS_FILE)));
const base = (dir) => JSON.parse(read(driverDir(dir, "synthesis-calls", "accepted.json"))).params;
const canon = (v) => (v === null || typeof v !== "object") ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canon).join(",")}]`
  : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;

/** A run holding one accepted whole save. */
function saved(opts = {}, doc = opts.method ? rated() : record()) {
  const dir = runDir(opts);
  const r = recordSynthesis(dir, { narrative: NARRATIVE, findings: doc });
  assert.equal(r.refused, null, `the first save was refused: ${r.refused}`);
  return dir;
}
const accepts = (r, what) => assert.equal(r.refused, null, `${what} was refused: ${r.refused}`);
/** Refused with this leading text, and nothing the run holds was written. */
function refusesUnchanged(dir, call, re, what) {
  const before = files(dir);
  const r = recordSynthesis(dir, call);
  assert.match(String(r.refused), re, `${what}: refused with another text, or accepted`);
  assert.deepEqual(files(dir), before, `${what}: a refused call changed what the run holds`);
}

const ROW2 = () => ({ ...record().findings[1], legal_position: "The corrected legal position for the second invented finding." });
const COVERAGE = [{ area: "the invented register", state: "not-searched", note: "The reworded note for the one slice." }];
const MARKER = { applied: true, note: "ODRAVEL: corrected" };

// ── WHAT THIS CHANGE NEWLY ACCEPTS ───────────────────────────────────────────────────────────────────

test("a narrative and a findings object with no list, beside the rows it corrects, patches exactly what it names", () => {
  const dir = saved();
  const before = onDisk(dir);
  const r = recordSynthesis(dir, { narrative: { spine: NARRATIVE.spine, verdict: `${NARRATIVE.verdict} The correction changed this.` },
    findings: { coverage: COVERAGE, corrections: MARKER }, findings_patch: [ROW2()] });
  accepts(r, "a correction carrying its registers in a list-less findings object");
  const after = onDisk(dir);
  assert.equal(JSON.stringify(after.findings[0]), JSON.stringify(before.findings[0]), "the first finding moved");
  assert.equal(JSON.stringify(after.findings[2]), JSON.stringify(before.findings[2]), "the third finding moved");
  assert.equal(after.findings[1].legal_position, ROW2().legal_position, "the corrected row did not land");
  assert.equal(canon(after.coverage), canon(COVERAGE), "the corrected coverage did not land");
  assert.deepEqual(after.corrections, MARKER, "the marker did not land as an object");
  for (const k of Object.keys(before).filter((k) => !["findings", "coverage", "corrections"].includes(k)))
    assert.equal(canon(after[k]), canon(before[k]), `the register "${k}" moved though the call did not name it`);
  const md = read(join(dir, NARRATIVE_FILE));
  assert.ok(md.includes("The correction changed this."), "the corrected verdict did not land");
  assert.ok(md.includes(NARRATIVE.spine.slice(0, 60)), "the spine was lost");
  assert.ok(md.includes(NARRATIVE.coverage.read), "the coverage read the call did not name was lost");
});

test("the same correction is accepted where the run owes its records, because the merged record still carries them", () => {
  const dir = saved({ owed: true });
  accepts(recordSynthesis(dir, { narrative: { spine: NARRATIVE.spine, verdict: `${NARRATIVE.verdict} Changed.` },
    findings: { coverage: COVERAGE, corrections: MARKER }, findings_patch: [ROW2()] }), "a correction on a run that owes its records");
  assert.equal(onDisk(dir).findings.length, 3);
});

test("a findings object carrying one register and nothing else replaces that register and moves nothing else", () => {
  const dir = saved();
  const before = onDisk(dir);
  const narrativeBefore = base(dir).narrative;
  accepts(recordSynthesis(dir, { findings: { coverage: COVERAGE } }), "a coverage-only correction");
  const after = onDisk(dir);
  assert.equal(JSON.stringify(after.findings), JSON.stringify(before.findings), "a finding moved");
  assert.equal(canon(after.coverage), canon(COVERAGE));
  // narrative.md renders its coverage list from the record's rows, so that file changes; the sections do not
  assert.deepEqual(base(dir).narrative, narrativeBefore, "a narrative section moved");
});

test("rows sent inside the findings object are lifted and applied as rows", () => {
  const dir = saved();
  const before = onDisk(dir);
  accepts(recordSynthesis(dir, { findings: { findings_patch: [ROW2()] } }), "rows nested in the findings object");
  const after = onDisk(dir);
  assert.equal(after.findings[1].legal_position, ROW2().legal_position, "the nested row was not applied");
  assert.equal(JSON.stringify(after.findings[0]), JSON.stringify(before.findings[0]));
  assert.equal(JSON.stringify(after.findings[2]), JSON.stringify(before.findings[2]));
  assert.equal(Object.hasOwn(after, "findings_patch"), false, "the rows reached the record as a key");
});

test("a nested row that repeats a top-level row is applied once", () => {
  const dir = saved();
  accepts(recordSynthesis(dir, { findings: { findings_patch: [ROW2()] }, findings_patch: [ROW2()] }), "a row sent in both places");
  assert.equal(onDisk(dir).findings[1].legal_position, ROW2().legal_position);
});

test("an envelope equal to the stored one is accepted beside the registers it travels with", () => {
  const dir = saved();
  const sv = onDisk(dir).schema_version;
  accepts(recordSynthesis(dir, { findings: { schema_version: sv, coverage: COVERAGE } }), "a correction restating the stored version");
  assert.equal(onDisk(dir).schema_version, sv);
  assert.equal(canon(onDisk(dir).coverage), canon(COVERAGE));
});

test("under a framework that states a method, a register patch leaves every rated finding as it was", () => {
  const dir = saved({ method: true });
  const before = onDisk(dir);
  accepts(recordSynthesis(dir, { findings: { coverage: COVERAGE } }), "a register patch under a method");
  const after = onDisk(dir);
  for (let i = 0; i < 3; i++) {
    for (const k of ["inputs", "band", "meters", "use_check", "owner"])
      assert.equal(canon(after.findings[i][k]), canon(before.findings[i][k]), `finding ${i + 1}'s ${k} moved`);
  }
});

test("under a framework that states a method, a lifted row that moves its band without its inputs meets the shipped band check", () => {
  const dir = saved({ method: true });
  const moved = { ...rated().findings[1], band: "Severe" };
  refusesUnchanged(dir, { findings: { findings_patch: [moved] } }, /^synthesis_findings_invalid: finding_band_off_table:2\b/,
    "a lifted row whose band its inputs do not give");
});

test("after the delivery seam a register patch is saved onto the model's record and the file is folded again", () => {
  const dir = saved({}, record(FOLDING));
  foldFindingsFile(dir, join(dir, FINDINGS_FILE), null, { seam: true });
  assert.equal(onDisk(dir).findings.length, 2, "premise: the seam folds the second filing in");
  accepts(recordSynthesis(dir, { findings: { coverage: COVERAGE } }), "a register patch after the seam");
  assert.equal(onDisk(dir).findings.length, 2, "the saved record was not folded again");
  assert.equal(JSON.parse(read(driverDir(dir, UNFOLDED_FILE))).findings.length, 3, "the model's record is not kept beside the folded one");
  assert.equal(base(dir).findings.findings.length, 3, "the base is not the model's record");
  assert.equal(canon(onDisk(dir).coverage), canon(COVERAGE));
});

test("the merge reads a findings object with no list as registers onto the stored record", () => {
  const stored = { narrative: { ...NARRATIVE }, findings: record() };
  const m = mergeSynthesisPatch(stored, { findings: { coverage: COVERAGE } });
  assert.equal(m.ok, true, m.reason);
  assert.equal(m.merged.findings.findings?.length, 3, "the stored findings were replaced by a record with none");
  assert.equal(canon(m.merged.findings.coverage), canon(COVERAGE));
});

// ── WHAT MAIN STILL DECIDES: characterisation, green before and after ──────────────────────────────────

test("a nested row that conflicts with a top-level row for the same ordinal keeps main's refusal", () => {
  const dir = saved();
  const other = { ...ROW2(), legal_position: "A different correction for the same ordinal." };
  refusesUnchanged(dir, { findings: { findings_patch: [other] }, findings_patch: [ROW2()] },
    /^synthesis_patch_ordinal_unknown:2 — this run holds no finding with that ordinal/, "a conflicting nested row");
});

test("two nested rows for one ordinal with different content keep main's refusal", () => {
  const dir = saved();
  const other = { ...ROW2(), legal_position: "A different correction for the same ordinal." };
  refusesUnchanged(dir, { findings: { findings_patch: [ROW2(), other] } },
    /^synthesis_findings_invalid: findings_key_unknown:findings_patch \(keys are EXACTLY: /, "two differing nested rows");
});

test("a key off the record's ladder inside the findings object keeps main's refusal", () => {
  const dir = saved();
  refusesUnchanged(dir, { findings: { coverage: COVERAGE, made_up_register: 1 }, findings_patch: [ROW2()] },
    /^synthesis_patch_ordinal_unknown:2 — /, "an unknown key beside a top-level row");
  refusesUnchanged(dir, { findings: { coverage: COVERAGE, made_up_register: 1 } },
    /^synthesis_findings_invalid: findings_key_unknown:made_up_register \(keys are EXACTLY: /, "an unknown key alone");
});

test("a list-less findings object that would re-version the record keeps main's refusal", () => {
  const dir = saved();
  refusesUnchanged(dir, { findings: { schema_version: 6 } }, /^synthesis_findings_invalid: findings_rated_under_missing/,
    "a re-versioning envelope");
});

test("a first save whose findings object carries no list keeps main's refusals", () => {
  refusesUnchanged(runDir(), { narrative: NARRATIVE, findings: { coverage: COVERAGE } },
    /^synthesis_findings_invalid: findings_unparseable: /, "a first list-less save");
  refusesUnchanged(runDir({ owed: true }), { narrative: NARRATIVE, findings: { coverage: COVERAGE } },
    /^synthesis_unaccounted_records:3 of 3\b/, "a first list-less save on a run that owes its records");
  refusesUnchanged(runDir(), { findings: { coverage: COVERAGE } }, /^synthesis_patch_without_base: /, "a first list-less save with no narrative");
});

test("a call carrying a list and no narrative still replaces the record and keeps the narrative", () => {
  const dir = saved();
  const doc = record();
  doc.findings = [doc.findings[0], ROW2(), doc.findings[2]];
  const narrativeBefore = base(dir).narrative;
  accepts(recordSynthesis(dir, { findings: doc }), "a whole record with no narrative");
  assert.equal(onDisk(dir).findings[1].legal_position, ROW2().legal_position);
  assert.deepEqual(base(dir).narrative, narrativeBefore);
});

test("a plain patch, a patch with no base, an unknown ordinal and a narrative patch behave as they always did", () => {
  const dir = saved();
  accepts(recordSynthesis(dir, { findings_patch: [ROW2()] }), "a plain patch");
  assert.equal(onDisk(dir).findings[1].legal_position, ROW2().legal_position);
  refusesUnchanged(dir, { findings_patch: [{ ...ROW2(), ordinal: 99 }] }, /^synthesis_patch_ordinal_unknown:99 — /, "an unknown ordinal");
  refusesUnchanged(runDir(), { findings_patch: [ROW2()] }, /^synthesis_patch_without_base: /, "a patch with no base");
  accepts(recordSynthesis(dir, { narrative: { coverage: { read: "The instructed registers were enumerated on the named band, and nothing else." } } }),
    "a narrative patch carrying only the coverage read");
});

test("a first whole save missing its spine or its verdict is refused by name", () => {
  refusesUnchanged(runDir(), { narrative: { verdict: NARRATIVE.verdict }, findings: record() }, /^synthesis_spine_missing: /, "no spine");
  refusesUnchanged(runDir(), { narrative: { spine: NARRATIVE.spine }, findings: record() }, /^synthesis_verdict_missing: /, "no verdict");
});
