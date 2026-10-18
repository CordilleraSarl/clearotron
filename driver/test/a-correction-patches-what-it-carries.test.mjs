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
// WHAT MAIN STILL DECIDES. A shape this change does not newly accept gets main's refusal, byte for byte: two
// different rows for one ordinal, whether both are the call's own, both nested or one of each, a register sent inside
// the findings object and again beside it with another value, a nested row that is
// not a finding object with a positive whole-number ordinal, a top-level row that does not name a finding the record
// holds, a marker the decode does not read, a narrative that is not an object of the sections the tool describes,
// a key off the record's ladder, an envelope that would re-version the record, and a first save that has no stored
// record to patch. Those arms below are characterisation:
// green before and after.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { recordSynthesis, mergeSynthesisPatch, registerPatchOf, FINDINGS_FILE, NARRATIVE_FILE } from "../synthesis-record.mjs";
import { foldFindingsFile, UNFOLDED_FILE } from "../record-fold.mjs";
import { parseFrameworkManifest } from "../framework.mjs";
import { parseFrameworkMethod, freezeFrameworkMethod, FROZEN_METHOD_FILE } from "../framework-method.mjs";
import { REPAIR_COMPOSERS } from "../repair-composers.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const NARRATIVE = {
  spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first. "
    + "The conflicting registration covers the same distinctive element in the filed class, and the goods overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The instructed registers were enumerated to completeness on the named band." },
};
const THREE = [["Halvorne Works", "TESSARIN"], ["Quillmere Ltd", "ODRAVEL"], ["Pennick Supply", "MARVETTE"]];
// The second finding is a second filing of the first, so the delivery seam folds the two together.
const FOLDING = [["Qorvalen Holdings", "PRUNDELIQ"], ["Qorvalen Holdings", "PRUNDELIQ"], ["Brannick Tooling", "ORVANTE"]];

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
  // restated beside the object rather than inside it, the envelope changes nothing either
  const framework = onDisk(dir).rated_under_framework;
  assert.equal(typeof framework, "string", "premise: the stored record names the framework it was rated under");
  accepts(recordSynthesis(dir, { findings: { coverage: COVERAGE }, schema_version: sv, rated_under_framework: framework }),
    "a correction restating the stored envelope beside its registers");
  assert.deepEqual([onDisk(dir).schema_version, onDisk(dir).rated_under_framework], [sv, framework]);
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

// ── THE CORRECTIONS MARKER SENT AS A JSON STRING ─────────────────────────────────────────────────────
//
// A correction has been seen to send its `corrections` marker as a JSON string of the object, and main refused
// every one (`findings_corrections_invalid`), costing a regenerated save over content that was right. On a call
// that carries no findings list the string is decoded and then validated as an object; the capture keeps what
// arrived. A string that does not decode to an object is refused as it always was, and a call carrying a list is
// read exactly as main reads it.

const captures = (dir) => readdirSync(driverDir(dir, "synthesis-calls")).filter((n) => /^call-\d+\.json$/.test(n)).sort()
  .map((n) => JSON.parse(read(driverDir(dir, "synthesis-calls", n))).params);

test("a marker sent as a JSON string at the top level of a patch is decoded, and the capture keeps the string", () => {
  const dir = saved();
  accepts(recordSynthesis(dir, { findings_patch: [ROW2()], corrections: JSON.stringify(MARKER) }), "a patch with a string marker");
  assert.deepEqual(onDisk(dir).corrections, MARKER, "the marker did not land as the object it encodes");
  assert.equal(typeof captures(dir).at(-1).corrections, "string", "the capture no longer records what arrived");
  assert.deepEqual(base(dir).findings.corrections, MARKER, "the base holds the string rather than the call as read");
});

test("a marker sent as a JSON string inside a list-less findings object is decoded", () => {
  const dir = saved();
  accepts(recordSynthesis(dir, { findings: { corrections: JSON.stringify(MARKER) }, findings_patch: [ROW2()] }), "a nested string marker");
  assert.deepEqual(onDisk(dir).corrections, MARKER);
});

test("a marker string that is not a JSON object is refused as it always was, and nothing is written", () => {
  const dir = saved();
  for (const bad of ["{not json", "[1,2]", "\"applied\""]) {
    refusesUnchanged(dir, { findings_patch: [ROW2()], corrections: bad },
      /^synthesis_findings_invalid: findings_corrections_invalid \(corrections must be an object \{ applied, note \}\)/, `the marker ${bad}`);
  }
});

test("a marker string on a call that carries a findings list is read exactly as main reads it", () => {
  const dir = saved();
  // a whole call: main reads only its narrative and its findings, so a top-level string is ignored as it stands
  const whole = { narrative: NARRATIVE, findings: record(), corrections: JSON.stringify(MARKER) };
  accepts(recordSynthesis(dir, structuredClone(whole)), "a whole call with a top-level string marker");
  assert.deepEqual(base(dir), whole, "the stored call is not the call as it arrived");
  assert.deepEqual(onDisk(dir).corrections, record().corrections, "the top-level marker of a whole call reached the record");
  // inside a whole record, or a record re-sent with no narrative, the string reaches the parser as it came
  refusesUnchanged(dir, { narrative: NARRATIVE, findings: { ...record(), corrections: JSON.stringify(MARKER) } },
    /^synthesis_findings_invalid: findings_corrections_invalid /, "a whole call with a nested string marker");
  refusesUnchanged(dir, { findings: { ...record(), corrections: JSON.stringify(MARKER) } },
    /^synthesis_findings_invalid: findings_corrections_invalid /, "a record with no narrative and a nested string marker");
  refusesUnchanged(dir, { findings: record(), corrections: JSON.stringify(MARKER) },
    /^synthesis_findings_invalid: findings_corrections_invalid /, "a record with no narrative and a top-level string marker");
});

// ── WHAT THE TRANSPORT READ IS ON THE RUN'S RECORD ────────────────────────────────────────────────────
//
// Each decode and lift is written to the run log as `synthesis-call-normalised`, and so are the keys and rows a
// whole call carries beside its record, which main ignores and still ignores: counted, never named. Never in the
// answer the model reads. A call whose reading changed nothing writes no row.

const readings = (dir) => (read(driverDir(dir, "run.jsonl")) ?? "").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  .filter((e) => e.event === "synthesis-call-normalised");
const reading = (dir) => {
  const rows = readings(dir);
  assert.equal(rows.length, 1, `expected one reading on the run log, found ${rows.length}`);
  const { ts: _ts, event: _event, stage, seq, ...rest } = rows[0];
  assert.equal(stage, "synthesis");
  assert.ok(Number.isInteger(seq), "the reading does not name the call it belongs to");
  return rest;
};
const NOTHING = { decoded: [], lifted: 0, keysIgnored: 0, rowsIgnored: 0, rowsDiffering: 0 };

test("a lift and a decode are each on the run log, and the answer the model reads is unchanged", () => {
  const lifted = saved();
  const r = recordSynthesis(lifted, { findings: { findings_patch: [ROW2()] } });
  accepts(r, "rows nested in the findings object");
  assert.deepEqual(reading(lifted), { ...NOTHING, accepted: true, lifted: 1 });
  assert.deepEqual(Object.keys(r).sort(), ["captured", "capture_failed", "coverage_limits_checked", "coverage_rows", "findings", "refused", "written"].sort(),
    "the answer the model reads gained a field");

  const decoded = saved();
  accepts(recordSynthesis(decoded, { findings_patch: [ROW2()], corrections: JSON.stringify(MARKER) }), "a string marker");
  assert.deepEqual(reading(decoded), { ...NOTHING, accepted: true, decoded: ["corrections"] });
  const nested = saved();
  accepts(recordSynthesis(nested, { findings: { corrections: JSON.stringify(MARKER) }, findings_patch: [ROW2()] }), "a nested string marker");
  assert.deepEqual(reading(nested), { ...NOTHING, accepted: true, decoded: ["findings.corrections"] });

  // a register sent inside the object and beside it with another value is read as main reads it: refused, no reading
  const twice = saved();
  const top = [{ area: "the invented register", state: "coverage-limited", note: "The top-level copy." }];
  refusesUnchanged(twice, { findings: { coverage: COVERAGE }, coverage: top }, UNPARSEABLE, "a register sent twice with two values");
  assert.deepEqual(readings(twice), [], "a register sent twice with two values left a reading on the run log");
});

test("a refused call's reading says it was refused, and a reading that changed nothing writes no row", () => {
  const dir = saved({ method: true });
  refusesUnchanged(dir, { findings: { findings_patch: [{ ...rated().findings[1], band: "Severe" }] } },
    /^synthesis_findings_invalid: finding_band_off_table:2\b/, "a lifted row whose band its inputs do not give");
  assert.deepEqual(reading(dir), { ...NOTHING, accepted: false, lifted: 1 });

  const twin = saved();
  accepts(recordSynthesis(twin, { findings: { findings_patch: [ROW2()] }, findings_patch: [ROW2()] }), "a row sent in both places");
  assert.deepEqual(readings(twin), [], "a nested row that repeated a top-level row was counted as lifted");
  const plain = saved();
  accepts(recordSynthesis(plain, { findings_patch: [ROW2()] }), "a plain patch");
  accepts(recordSynthesis(plain, { findings: { coverage: COVERAGE } }), "a register patch");
  assert.deepEqual(readings(plain), [], "a call whose reading changed nothing wrote a row");
});

test("a lift the merge refuses is on the run log as one the acceptance refuses is", () => {
  // a nested row naming an ordinal the record does not hold: lifted, then refused by the merge
  const nested = saved();
  refusesUnchanged(nested, { findings: { findings_patch: [{ ...ROW2(), ordinal: 99 }] } }, /^synthesis_patch_ordinal_unknown:99 — /,
    "a nested row on an ordinal the record does not hold");
  assert.deepEqual(reading(nested), { ...NOTHING, accepted: false, lifted: 1 }, "a lift the merge refused left no reading");
  // the same nested row beside a top-level row the record holds
  const beside = saved();
  refusesUnchanged(beside, { findings: { findings_patch: [{ ...record().findings[2], ordinal: 99, legal_position: "The third, corrected." }] },
    findings_patch: [ROW2()] }, /^synthesis_patch_ordinal_unknown:99 — /, "a nested row on an ordinal the record does not hold, beside a row it holds");
  assert.deepEqual(reading(beside), { ...NOTHING, accepted: false, lifted: 1 }, "a lift the merge refused left no reading");
});

test("a whole call is read exactly as main reads it: what it carries beside its record is ignored, and counted", () => {
  const list = record().findings;
  const cases = [
    ["a top-level coverage beside a nested one", { coverage: COVERAGE }, { keysIgnored: 1 }],
    ["a top-level coverage where the record has none", { coverage: COVERAGE }, { keysIgnored: 1 }, (d) => { delete d.coverage; }],
    ["a top-level corrections object", { corrections: MARKER }, { keysIgnored: 1 }],
    ["a top-level schema_version", { schema_version: 6 }, { keysIgnored: 1 }],
    ["a key off the ladder", { made_up_secret_key: 1 }, { keysIgnored: 1 }],
    ["a top-level row that differs from the list", { findings_patch: [ROW2()] }, { rowsIgnored: 1, rowsDiffering: 1 }],
    ["a top-level row identical to the list", { findings_patch: [list[1]] }, { rowsIgnored: 1, rowsDiffering: 0 }],
  ];
  for (const [what, extra, counted, trim] of cases) {
    const dir = saved();
    const doc = record();
    if (trim) trim(doc);
    const call = { narrative: NARRATIVE, findings: doc, ...extra };
    accepts(recordSynthesis(dir, structuredClone(call)), what);
    assert.deepEqual(base(dir), call, `${what}: the stored call is not the call as it arrived`);
    assert.equal(canon(onDisk(dir).findings), canon(doc.findings), `${what}: the record's findings are not the ones it carried`);
    for (const k of Object.keys(extra).filter((k) => k !== "findings_patch"))
      assert.equal(canon(onDisk(dir)[k]), canon(doc[k]), `${what}: the top-level "${k}" reached the record`);
    assert.deepEqual(reading(dir), { ...NOTHING, accepted: true, ...counted }, `${what}: miscounted`);
    assert.ok(!read(driverDir(dir, "run.jsonl")).includes("made_up_secret_key"), `${what}: an unknown key was named on the run log`);
  }
});

test("a whole call whose top-level copies are malformed or stale is accepted as main accepts it, first saves included", () => {
  const clean = [{ area: "the invented register", state: "confirmed-clean", note: "A stale copy that says everything was clean." }];
  const limited = [{ area: "the invented register", state: "coverage-limited", note: "The slice the run could not clear." }];
  const ledgerLimit = (dir) => writeFileSync(join(dir, "register-coverage-ledger.json"),
    JSON.stringify([{ axis: "primary-sweep", scope: "the invented register", status: "coverage-limited", reason: "invented" }]));
  const cases = [
    ["a first save with a top-level marker that is not JSON", runDir(), { corrections: "{not json" }],
    ["a first save with a top-level marker in prose", runDir(), { corrections: "applied: yes" }],
    ["a top-level mark assessment that is a string", saved(), { mark_assessment: "a string, not the object" }],
    ["a top-level coverage sent as a JSON string", saved(), { coverage: JSON.stringify(COVERAGE) }],
    ["a top-level marker that decodes to an invalid object", saved(), { corrections: JSON.stringify({ applied: "maybe" }) }],
  ];
  for (const [what, dir, extra] of cases) {
    const call = { narrative: NARRATIVE, findings: record(), ...extra };
    accepts(recordSynthesis(dir, structuredClone(call)), what);
    assert.deepEqual(base(dir), call, `${what}: the stored call is not the call as it arrived`);
  }
  // a stale all-clean top-level coverage beside a nested one that carries the run's limit
  for (const first of [true, false]) {
    const dir = first ? runDir() : saved();
    ledgerLimit(dir);
    const doc = { ...record(), coverage: limited };
    accepts(recordSynthesis(dir, { narrative: NARRATIVE, findings: doc, coverage: clean }), `a stale top-level coverage${first ? " on a first save" : ""}`);
    assert.equal(canon(onDisk(dir).coverage), canon(limited), "the stale top-level copy replaced the record's own coverage");
  }
  // the same marker nested and at the top level
  const dir = saved();
  const call = { narrative: NARRATIVE, findings: { ...record(), corrections: MARKER }, corrections: MARKER };
  accepts(recordSynthesis(dir, structuredClone(call)), "the same marker in both places");
  assert.deepEqual(base(dir), call);
});

test("the delivery check's redo orders this tool a patch, and a whole call it still gets is read as main reads it", () => {
  const lint = REPAIR_COMPOSERS.find((c) => c.key === "*:lint-repair");
  const text = lint.compose({ label: "synthesis", file: "narrative.md", toolWritten: { tool: "record_synthesis" }, failures: [{ id: "x", detail: "a check" }] });
  assert.ok(text.includes("Apply the fix in ONE `record_synthesis` PATCH call, sending only the change:"), "the redo orders the writer's record a patch");
  assert.ok(!text.includes("the COMPLETE payload, not a patch"), "and no longer the whole record again");
  const dir = saved();
  const call = { narrative: NARRATIVE, findings: record(), coverage: COVERAGE };
  accepts(recordSynthesis(dir, structuredClone(call)), "the redo's whole call with a top-level coverage");
  assert.equal(canon(onDisk(dir).coverage), canon(record().coverage), "the top-level coverage of a whole call reached the record");
  assert.deepEqual(reading(dir), { ...NOTHING, accepted: true, keysIgnored: 1 });
});

// ── A STORED RECORD OF AN EARLIER VERSION KEEPS ITS OWN LADDER ────────────────────────────────────────
//
// A list-less object reads as registers only where every key it carries is on the STORED record's own ladder,
// the one its schema_version gives. On a version-4 record, `four_answers` and `ask_answers` are not registers;
// read as a patch, the merged record was refused naming that record's ladder, where main reads the object as a
// whole document and refuses it naming the base ladder, or refuses the narrative before reaching it.
const v4 = () => {
  const doc = record();
  doc.schema_version = 4;
  for (const k of ["four_answers", "ask_answers"]) delete doc[k];
  doc.findings = doc.findings.map(({ net: _net, ...f }) => f);
  return doc;
};

test("on a stored record of an earlier version, a key its own ladder does not allow keeps main's refusal", () => {
  const dir = saved({}, v4());
  refusesUnchanged(dir, { findings: { four_answers: { q1: "an invented answer" } } },
    /^synthesis_findings_invalid: findings_key_unknown:four_answers \(keys are EXACTLY: schema_version, findings, coverage, context_notes, coverage_judgment, corrections, mark_assessment, actions\)$/,
    "a key the stored record's version does not allow");
  refusesUnchanged(dir, { narrative: { verdict: `${NARRATIVE.verdict} Changed.` }, findings: { ask_answers: [] } },
    /^synthesis_spine_missing: /, "a key the stored record's version does not allow, with a narrative");
  accepts(recordSynthesis(dir, { findings: { coverage: COVERAGE } }), "a register the stored record's version allows");
  assert.equal(canon(onDisk(dir).coverage), canon(COVERAGE));
});

// ── A KEY BESIDE THE FINDINGS OBJECT IS HELD TO THE SAME LADDER ──────────────────────────────────────
//
// A patch's top-level keys, beside its narrative, its findings object and its rows, are copied into the merged
// record. So a list-less object reads as registers only where those keys, too, are on the stored record's own
// ladder. A call carrying one that is not is read as main reads it, and meets main's refusal byte for byte:
// the object as sent is refused against the base ladder, the narrative is refused for its missing spine, the
// list-less record is refused as unparseable, or a row is refused for an ordinal that record does not hold.
const BASE_LADDER = "schema_version, findings, coverage, context_notes, coverage_judgment, corrections, mark_assessment, actions";
const offLadder = (key) => new RegExp(`^synthesis_findings_invalid: findings_key_unknown:${key} \\(keys are EXACTLY: ${BASE_LADDER}\\)$`);
const VERDICT_ONLY = { verdict: `${NARRATIVE.verdict} Changed.` };

for (const [what, run, call, re] of [
  ["beside a register", () => saved(), { findings: { coverage: COVERAGE }, made_up_register: 1 }, offLadder("made_up_register")],
  ["beside a register and a row", () => saved(), { findings: { coverage: COVERAGE }, made_up_register: 1, findings_patch: [ROW2()] },
    /^synthesis_patch_ordinal_unknown:2 — this run holds no finding with that ordinal/],
  ["beside a whole narrative and a register", () => saved(), { narrative: NARRATIVE, findings: { coverage: COVERAGE }, made_up_register: 1 },
    /^synthesis_findings_invalid: findings_unparseable: "findings" must be a JSON ARRAY of finding objects$/],
  ["beside a corrected verdict and a register", () => saved(), { narrative: VERDICT_ONLY, findings: { coverage: COVERAGE }, made_up_register: 1 },
    /^synthesis_spine_missing: /],
  ["beside a corrected verdict and a register, on a run that owes its records", () => saved({ owed: true }),
    { narrative: VERDICT_ONLY, findings: { coverage: COVERAGE }, made_up_register: 1 }, /^synthesis_spine_missing: /],
  ["on a version-4 record, a key that version does not allow, beside a register", () => saved({}, v4()),
    { findings: { coverage: COVERAGE }, four_answers: { q1: "an invented answer" } }, offLadder("four_answers")],
]) {
  test(`a top-level key off the stored record's ladder keeps main's refusal: ${what}`, () => {
    refusesUnchanged(run(), call, re, `a top-level key off the ladder ${what}`);
  });
}

// ── AN ENVELOPE BESIDE THE FINDINGS OBJECT IS HELD TO THE STORED ONE ─────────────────────────────────
//
// The merge copies a patch's top-level keys into the record last, so a schema_version or rated_under_framework
// beside a list-less object would re-version the stored list without the list ever being sent, which an
// envelope inside the object may not do either. A call whose top-level envelope differs from the stored one is
// read as main reads it: it meets main's refusal, and the stored record keeps its version and its framework.
// One that restates the stored envelope changes nothing and is accepted (above).
const UNPARSEABLE = /^synthesis_findings_invalid: findings_unparseable: "findings" must be a JSON ARRAY of finding objects$/;

for (const [what, call, re] of [
  ["the stored version inside the object and another beside it",
    { findings: { schema_version: record().schema_version, coverage: COVERAGE }, schema_version: 6 },
    /^synthesis_findings_invalid: findings_rated_under_missing: schema_version 4 requires rated_under_framework — the framework_key of the framework this rating reasoned with$/],
  ["a narrative and a register, with version 6 beside them", { narrative: NARRATIVE, findings: { coverage: COVERAGE }, schema_version: 6 }, UNPARSEABLE],
  ["a narrative and a register, with version 5 beside them", { narrative: NARRATIVE, findings: { coverage: COVERAGE }, schema_version: 5 }, UNPARSEABLE],
  ["a register, with another framework beside it", { findings: { coverage: COVERAGE }, rated_under_framework: "another-invented-framework" },
    offLadder("rated_under_framework")],
]) {
  test(`a top-level envelope that differs from the stored one keeps main's refusal: ${what}`, () => {
    const dir = saved();
    const { schema_version: version, rated_under_framework: framework } = onDisk(dir);
    refusesUnchanged(dir, call, re, `a top-level envelope that differs from the stored one: ${what}`);
    assert.deepEqual([onDisk(dir).schema_version, onDisk(dir).rated_under_framework], [version, framework], `${what}: the record was re-versioned`);
  });
}

// ── A NESTED ROW IS LIFTED ONLY WHEN IT IS A FINDING OBJECT WITH A POSITIVE WHOLE-NUMBER ORDINAL ─────
//
// A finding row names the finding it replaces by its ordinal, a positive whole number. Rows sent inside a list-less
// findings object are lifted beside the call's own only where every one of them is an object carrying such an
// ordinal. A nested row that is not (a string, null, an array, a row with no ordinal, or one whose ordinal is
// text, a fraction, zero or below zero) is no row to lift: the object is read as main reads it, and the call meets main's refusal
// byte for byte, with or without a narrative or a top-level row beside it.
const UNKNOWN_ORDINAL_2 = /^synthesis_patch_ordinal_unknown:2 — this run holds no finding with that ordinal, so this patch is aimed at a finding that does not exist\. Send the ordinal as it appears in the record you emitted$/;
const NO_ORDINAL = () => { const { ordinal: _ordinal, ...row } = ROW2(); return row; };

for (const [what, call, re] of [
  ["a row with no ordinal", () => ({ findings: { findings_patch: [NO_ORDINAL()] } }), offLadder("findings_patch")],
  ["a row that is a string", () => ({ findings: { findings_patch: ["a row that is text"] } }), offLadder("findings_patch")],
  ["a row that is null", () => ({ findings: { findings_patch: [null] } }), offLadder("findings_patch")],
  ["a row that is an array", () => ({ findings: { findings_patch: [[ROW2()]] } }), offLadder("findings_patch")],
  ["a row whose ordinal is text", () => ({ findings: { findings_patch: [{ ...ROW2(), ordinal: "2" }] } }), offLadder("findings_patch")],
  ["a row whose ordinal is not a whole number", () => ({ findings: { findings_patch: [{ ...ROW2(), ordinal: 2.5 }] } }), offLadder("findings_patch")],
  ["a row whose ordinal is zero", () => ({ findings: { findings_patch: [{ ...ROW2(), ordinal: 0 }] } }), offLadder("findings_patch")],
  ["a row whose ordinal is below zero", () => ({ findings: { findings_patch: [{ ...ROW2(), ordinal: -1 }] } }), offLadder("findings_patch")],
  ["a row whose ordinal is zero, with a whole narrative, beside a top-level row",
    () => ({ narrative: NARRATIVE, findings: { findings_patch: [{ ...ROW2(), ordinal: 0 }] }, findings_patch: [ROW2()] }), offLadder("findings_patch")],
  ["a good row beside a row with no ordinal", () => ({ findings: { findings_patch: [ROW2(), NO_ORDINAL()] } }), offLadder("findings_patch")],
  ["a row with no ordinal, with a whole narrative", () => ({ narrative: NARRATIVE, findings: { findings_patch: [NO_ORDINAL()] } }), offLadder("findings_patch")],
  ["a row with no ordinal, beside a top-level row", () => ({ findings: { findings_patch: [NO_ORDINAL()] }, findings_patch: [ROW2()] }), UNKNOWN_ORDINAL_2],
  ["a row that is null, beside a register and a top-level row", () => ({ findings: { coverage: COVERAGE, findings_patch: [null] }, findings_patch: [ROW2()] }), UNKNOWN_ORDINAL_2],
]) {
  test(`a nested row that is not a finding object with a positive whole-number ordinal keeps main's refusal: ${what}`, () => {
    refusesUnchanged(saved(), call(), re, `a nested row that is not a finding object with a positive whole-number ordinal: ${what}`);
  });
}

// ── A NARRATIVE THAT IS NOT AN OBJECT IS READ AS MAIN READS IT ───────────────────────────────────────
//
// A narrative is an object of sections. Sent beside a list-less findings object as text, a list or null, it is no
// section patch: read as registers, its characters became numbered keys in the held base, its prose reached no file,
// and the tool answered that the call was accepted. Such a call is read as main reads it and meets main's refusal
// byte for byte, which names the narrative's shape so the sections can be sent again.
const NARRATIVE_MISSING = /^synthesis_narrative_missing: `narrative` must be an object of typed sections — the driver renders the document, so it needs the sections rather than the prose of a whole file$/;

for (const [what, narrative] of [
  ["as text", "The cross-finding read, sent as prose rather than as sections."],
  ["as a list", ["The cross-finding read, sent as a list."]],
  ["as null", null],
]) {
  test(`a narrative sent ${what} beside a list-less findings object keeps main's refusal`, () => {
    refusesUnchanged(saved(), { narrative, findings: { coverage: COVERAGE } }, NARRATIVE_MISSING, `a narrative sent ${what}`);
    refusesUnchanged(saved({ owed: true }), { narrative, findings: { coverage: COVERAGE } }, NARRATIVE_MISSING, `a narrative sent ${what}, records owed`);
    refusesUnchanged(saved(), { narrative, findings: { coverage: COVERAGE }, findings_patch: [ROW2()] }, NARRATIVE_MISSING, `a narrative sent ${what}, beside a row`);
  });
}

// ── THE CALL'S OWN ROWS EACH NAME A FINDING THE RECORD HOLDS ─────────────────────────────────────────
//
// A register patch carries its own rows beside the findings object, and the merge replaces each finding a row names.
// So a list-less object reads as registers only where every one of those rows is a finding object whose ordinal, a
// positive whole number, names a finding the stored record holds. A row list that is not a list, or null, a row that
// is not such an object, or a row aimed at a finding the record does not hold, is read as main reads it, and the call
// meets main's refusal byte for byte: the list-less record is refused as unparseable, the narrative for its missing
// spine, or a row for an ordinal the object, read as the whole record, does not hold.
const SPINE_MISSING = /^synthesis_spine_missing: `narrative\.spine` is the dominant-element spine — the cross-finding read no other artifact on this run holds\. It is the core of the product and there is no clean answer that omits it$/;
const WITH_ROWS = (rows) => ({ narrative: NARRATIVE, findings: { coverage: COVERAGE }, findings_patch: rows });

for (const [what, run, call, re] of [
  ["a row list that is text", () => saved(), () => WITH_ROWS("a row list sent as text"), UNPARSEABLE],
  ["a row list that is an object", () => saved(), () => WITH_ROWS({ ordinal: 2 }), UNPARSEABLE],
  ["a row list that is null", () => saved(), () => WITH_ROWS(null), UNPARSEABLE],
  ["a row list that is null, with no narrative", () => saved(), () => ({ findings: { coverage: COVERAGE }, findings_patch: null }), UNPARSEABLE],
  ["a row that is null", () => saved(), () => WITH_ROWS([null]), UNPARSEABLE],
  ["a row that is text", () => saved(), () => WITH_ROWS(["a row that is text"]), UNPARSEABLE],
  ["a row with no ordinal", () => saved(), () => WITH_ROWS([NO_ORDINAL()]), UNPARSEABLE],
  ["a row whose ordinal is zero", () => saved(), () => WITH_ROWS([{ ...ROW2(), ordinal: 0 }]), UNPARSEABLE],
  ["a row whose ordinal is not a whole number", () => saved(), () => WITH_ROWS([{ ...ROW2(), ordinal: 2.5 }]), UNPARSEABLE],
  ["a row whose ordinal is text", () => saved(), () => WITH_ROWS([{ ...ROW2(), ordinal: "2" }]), UNPARSEABLE],
  ["a row on an ordinal the record does not hold", () => saved(), () => WITH_ROWS([{ ...ROW2(), ordinal: 99 }]), UNPARSEABLE],
  ["a row on an ordinal the record does not hold, beside a corrected verdict", () => saved(),
    () => ({ narrative: VERDICT_ONLY, findings: { coverage: COVERAGE }, findings_patch: [{ ...ROW2(), ordinal: 99 }] }), SPINE_MISSING],
  ["the same, on a run that owes its records", () => saved({ owed: true }),
    () => ({ narrative: VERDICT_ONLY, findings: { coverage: COVERAGE }, findings_patch: [{ ...ROW2(), ordinal: 99 }] }), SPINE_MISSING],
]) {
  test(`a top-level row list that does not name findings the record holds keeps main's refusal: ${what}`, () => {
    refusesUnchanged(run(), call(), re, `a top-level row list that does not name findings the record holds: ${what}`);
  });
}

test("rows on an ordinal the record does not hold, beside a nested row, keep main's refusal and leave no reading", () => {
  const dir = saved();
  refusesUnchanged(dir, { findings: { findings_patch: [{ ...record().findings[2], legal_position: "The third, corrected." }] },
    findings_patch: [ROW2(), { ...ROW2(), ordinal: 99 }] }, UNKNOWN_ORDINAL_2, "a nested row beside a top-level row the record does not hold");
  assert.deepEqual(readings(dir), [], "a call read as main reads it left a reading");
});

// ── ONE ORDINAL, ONE ROW ──────────────────────────────────────────────────────────────────────────────
//
// A row replaces the finding its ordinal names. A call carrying two different rows for one ordinal, both its own,
// both nested in the findings object, or one of each, does not say which of them is the correction: read as
// registers, the last was applied and the other dropped without a word, and which one was kept turned on the order
// the rows were sent in. Such a call is read as main reads it, and meets main's refusal byte for byte, in whichever
// order its rows come. A row sent again with the same content is one row (below), and a plain patch with no findings
// object is main's own reading, which keeps the last row as it always did.
const ROW2B = () => ({ ...ROW2(), legal_position: "A different correction for the same ordinal." });
const ROW3 = () => ({ ...record().findings[2], legal_position: "The corrected legal position for the third invented finding." });
const TWO_ROWS = (rows, findings = { coverage: COVERAGE }) => ({ findings, findings_patch: rows });

for (const [what, run, call, re] of [
  ["a whole narrative and a register, beside them", () => saved(), () => WITH_ROWS([ROW2(), ROW2B()]), UNPARSEABLE],
  ["a whole narrative and a register, beside them in the other order", () => saved(), () => WITH_ROWS([ROW2B(), ROW2()]), UNPARSEABLE],
  ["a whole narrative and a register, beside them with another finding's row between", () => saved(),
    () => WITH_ROWS([ROW2(), ROW3(), ROW2B()]), UNPARSEABLE],
  ["a whole narrative and a register, beside them with the first sent again last", () => saved(),
    () => WITH_ROWS([ROW2(), ROW2B(), ROW2()]), UNPARSEABLE],
  ["a whole narrative and a register, beside them, on a run that owes its records", () => saved({ owed: true }),
    () => WITH_ROWS([ROW2(), ROW2B()]), /^synthesis_unaccounted_records:3 of 3\b/],
  ["a corrected verdict and a register, beside them", () => saved(),
    () => ({ narrative: VERDICT_ONLY, ...TWO_ROWS([ROW2(), ROW2B()]) }), SPINE_MISSING],
  ["a register, beside them", () => saved(), () => TWO_ROWS([ROW2(), ROW2B()]), UNKNOWN_ORDINAL_2],
  ["a register, beside them in the other order", () => saved(), () => TWO_ROWS([ROW2B(), ROW2()]), UNKNOWN_ORDINAL_2],
  ["a register and a nested row repeating the second, beside them", () => saved(),
    () => TWO_ROWS([ROW2(), ROW2B()], { coverage: COVERAGE, findings_patch: [ROW2B()] }), UNKNOWN_ORDINAL_2],
  ["a register and a nested row repeating the first, beside them", () => saved(),
    () => TWO_ROWS([ROW2(), ROW2B()], { coverage: COVERAGE, findings_patch: [ROW2()] }), UNKNOWN_ORDINAL_2],
  ["a nested row repeating the second, beside them", () => saved(),
    () => TWO_ROWS([ROW2(), ROW2B()], { findings_patch: [ROW2B()] }), UNKNOWN_ORDINAL_2],
  ["a nested row repeating the first, beside them", () => saved(),
    () => TWO_ROWS([ROW2(), ROW2B()], { findings_patch: [ROW2()] }), UNKNOWN_ORDINAL_2],
  ["a nested row repeating the second, beside them in the other order", () => saved(),
    () => TWO_ROWS([ROW2B(), ROW2()], { findings_patch: [ROW2()] }), UNKNOWN_ORDINAL_2],
  ["a nested row repeating the first, beside them in the other order", () => saved(),
    () => TWO_ROWS([ROW2B(), ROW2()], { findings_patch: [ROW2B()] }), UNKNOWN_ORDINAL_2],
  ["a nested row and a top-level row, the nested one the original", () => saved(),
    () => TWO_ROWS([ROW2B()], { findings_patch: [ROW2()] }), UNKNOWN_ORDINAL_2],
  ["a nested row and a top-level row, the top-level one sent first", () => saved(),
    () => ({ findings_patch: [ROW2()], findings: { findings_patch: [ROW2B()] } }), UNKNOWN_ORDINAL_2],
  ["two nested rows, one of them repeating the top-level row", () => saved(),
    () => TWO_ROWS([ROW2()], { findings_patch: [ROW2(), ROW2B()] }), UNKNOWN_ORDINAL_2],
  ["two nested rows in the other order, one of them repeating the top-level row", () => saved(),
    () => TWO_ROWS([ROW2()], { findings_patch: [ROW2B(), ROW2()] }), UNKNOWN_ORDINAL_2],
  ["a nested row beside a top-level row sent twice", () => saved(),
    () => TWO_ROWS([ROW2(), ROW2()], { findings_patch: [ROW2B()] }), UNKNOWN_ORDINAL_2],
]) {
  test(`a call carrying two different rows for one ordinal keeps main's refusal: ${what}`, () => {
    refusesUnchanged(run(), call(), re, `two different rows for one ordinal: ${what}`);
  });
}

test("a plain patch carrying two different rows for one ordinal is read as main reads it: the last row is applied", () => {
  for (const [what, rows] of [["in one order", [ROW2(), ROW2B()]], ["in the other", [ROW2B(), ROW2()]]]) {
    const dir = saved();
    accepts(recordSynthesis(dir, { findings_patch: rows }), `a plain patch with two rows for one ordinal, ${what}`);
    assert.equal(onDisk(dir).findings[1].legal_position, rows[1].legal_position, `${what}: the last row was not the one applied`);
  }
});

test("a row sent again with the same content is one row, and the call is still read as registers", () => {
  const reordered = Object.fromEntries(Object.entries(ROW2()).reverse());
  for (const [what, call] of [
    ["a register, beside one row sent twice", TWO_ROWS([ROW2(), ROW2()])],
    ["a register, beside one row sent twice with its keys in another order", TWO_ROWS([ROW2(), reordered])],
    ["a whole narrative and a register, beside one row sent twice", WITH_ROWS([ROW2(), ROW2()])],
    ["a nested row repeating one top-level row sent twice", TWO_ROWS([ROW2(), ROW2()], { findings_patch: [ROW2()] })],
  ]) {
    const dir = saved();
    const before = onDisk(dir);
    accepts(recordSynthesis(dir, structuredClone(call)), what);
    const after = onDisk(dir);
    assert.equal(after.findings[1].legal_position, ROW2().legal_position, `${what}: the row was not applied`);
    assert.equal(JSON.stringify([after.findings[0], after.findings[2]]), JSON.stringify([before.findings[0], before.findings[2]]),
      `${what}: a finding the call does not name moved`);
  }
});

// ── A CORRECTIONS MARKER SENT WITH A REGISTER PATCH IS ONE THE DECODE READS ──────────────────────────
//
// A marker sent as a JSON string is decoded where the call carries no list, and a string that does not decode to an
// object is refused as it always was. On a list-less object, "as it always was" is main's reading of the object as a
// whole record. So the object reads as registers only where every marker it carries, inside the object or beside it,
// is null, an object, or a string that decodes to one. Any other marker, a string that is not JSON or decodes to
// something else, a number or a list, is read as main reads it, and the call meets main's refusal byte for byte.
for (const [what, call, re] of [
  ["a nested marker string that is not JSON, beside a register", { findings: { coverage: COVERAGE, corrections: "{not json" } }, UNPARSEABLE],
  ["a nested marker string that is not JSON, beside a top-level row", { findings: { corrections: "{not json" }, findings_patch: [ROW2()] }, UNKNOWN_ORDINAL_2],
  ["a nested marker string that decodes to a list", { findings: { corrections: "[1]" } }, UNPARSEABLE],
  ["a nested marker string that decodes to null", { findings: { corrections: "null" } }, UNPARSEABLE],
  ["a nested marker string that decodes to text", { findings: { corrections: "\"a marker\"" } }, UNPARSEABLE],
  ["a nested marker that is a number", { findings: { corrections: 5 } }, UNPARSEABLE],
  ["a nested marker that is a list", { findings: { corrections: [MARKER] } }, UNPARSEABLE],
  ["a top-level marker string that is not JSON, beside a register", { findings: { coverage: COVERAGE }, corrections: "not json" }, UNPARSEABLE],
  ["a top-level marker string that is not JSON, beside a nested marker object", { findings: { corrections: MARKER }, corrections: "not json" }, UNPARSEABLE],
  ["a top-level marker string that decodes to a list", { findings: { coverage: COVERAGE }, corrections: "[1]" }, UNPARSEABLE],
  ["a top-level marker that is a number", { findings: { coverage: COVERAGE }, corrections: 5 }, UNPARSEABLE],
]) {
  test(`a marker the decode does not read keeps main's refusal on a list-less findings object: ${what}`, () => {
    refusesUnchanged(saved(), structuredClone(call), re, `a marker the decode does not read: ${what}`);
  });
}

// ── A NARRATIVE SENT BESIDE A REGISTER PATCH CARRIES THE SECTIONS THE TOOL DESCRIBES ─────────────────
//
// The tool describes the narrative's sections: the spine and the verdict as text, the coverage read as text inside
// `coverage`, and the calibration challenges as a list of {challenge, answer} pairs. A narrative patch beside a
// list-less object reads as registers only where every section it sends is one of those, or another section sent as
// text. A section that is not, a spine or verdict that is not text, a coverage that is not an object carrying only its
// read as text, calibration that is not such a list, or `ask_answers`, which belongs to the record, is read as main
// reads it: the call meets main's refusal for its missing spine, byte for byte. Read as registers, several of these
// were accepted while the section they carried reached no file.
for (const [what, narrative] of [
  ["a verdict that is a number", { verdict: 5 }],
  ["a verdict that is blank", { verdict: "  " }],
  ["a coverage that is text", { coverage: "The coverage read, sent as text." }],
  ["a coverage that is null", { coverage: null }],
  ["a coverage that is a list", { coverage: ["The coverage read."] }],
  ["a coverage read that is a number", { coverage: { read: 5 } }],
  ["a coverage read that is empty", { coverage: { read: "" } }],
  ["a coverage carrying rows", { coverage: { read: "The coverage read.", rows: [] } }],
  ["calibration that is text", { calibration: "A challenge and its answer, as text." }],
  ["calibration that is a list of text", { calibration: ["A challenge and its answer."] }],
  ["ask_answers on the narrative", { ask_answers: [] }],
  ["another section that is not text", { made_up_section: 5 }],
]) {
  test(`a narrative section the tool does not describe keeps main's refusal beside a list-less findings object: ${what}`, () => {
    refusesUnchanged(saved(), { narrative, findings: { coverage: COVERAGE } }, SPINE_MISSING, `a narrative section the tool does not describe: ${what}`);
  });
}

// ── ONE REGISTER, ONE VALUE ───────────────────────────────────────────────────────────────────────────
//
// A register sent inside a list-less findings object and again beside it, with another value, does not say which of
// the two is the correction. Read as registers, the copy beside the object was kept and the other dropped, and
// nothing in the answer told the model that part of what it sent was ignored. Such a call is read as main reads it,
// and meets main's refusal byte for byte, as two different rows for one ordinal do. The two copies are compared as
// read: the order of their keys does not count, and a marker sent as a JSON string is compared as the object it
// encodes. Two copies with the same content are one register, applied once.
const UNACCOUNTED = /^synthesis_unaccounted_records:3 of 3\b/;
const TOP_COVERAGE = [{ area: "the invented register", state: "coverage-limited", note: "The copy sent beside the object." }];
const MARKER_B = { applied: true, note: "MARVETTE: corrected" };
const ASSESSMENT_B = () => ({ ...record().mark_assessment, connotation: "An invented connotation read, the copy sent beside the object." });

// Beside a narrative the call is a whole call as main reads it, whose top-level copy main ignores: the run log counts
// that key, as it counts one on any whole call, and the answer stays main's.
const WHOLE_CALL_IGNORED = { decoded: [], lifted: 0, keysIgnored: 1, rowsIgnored: 0, rowsDiffering: 0, accepted: false };
for (const [what, run, call, re, reads = []] of [
  ["coverage inside the object and different coverage beside it", () => saved(),
    () => ({ findings: { coverage: COVERAGE }, coverage: TOP_COVERAGE }), UNPARSEABLE],
  ["the same, beside a whole narrative", () => saved(),
    () => ({ narrative: NARRATIVE, findings: { coverage: COVERAGE }, coverage: TOP_COVERAGE }), UNPARSEABLE, [WHOLE_CALL_IGNORED]],
  ["the same, beside a corrected verdict", () => saved(),
    () => ({ narrative: VERDICT_ONLY, findings: { coverage: COVERAGE }, coverage: TOP_COVERAGE }), SPINE_MISSING, [WHOLE_CALL_IGNORED]],
  ["the same, beside a row the record holds", () => saved(),
    () => ({ findings: { coverage: COVERAGE }, coverage: TOP_COVERAGE, findings_patch: [ROW2()] }), UNKNOWN_ORDINAL_2],
  ["the same, on a run that owes its records", () => saved({ owed: true }),
    () => ({ findings: { coverage: COVERAGE }, coverage: TOP_COVERAGE }), UNACCOUNTED],
  ["the mark assessment inside the object and a different one beside it", () => saved(),
    () => ({ findings: { mark_assessment: record().mark_assessment }, mark_assessment: ASSESSMENT_B() }), UNPARSEABLE],
  ["marker strings inside the object and beside it that decode to different markers", () => saved(),
    () => ({ findings: { corrections: JSON.stringify(MARKER) }, corrections: JSON.stringify(MARKER_B) }), UNPARSEABLE],
  ["a marker string inside the object and a different marker object beside it", () => saved(),
    () => ({ findings: { corrections: JSON.stringify(MARKER) }, corrections: MARKER_B }), UNPARSEABLE],
  ["a marker object inside the object and null beside it", () => saved(),
    () => ({ findings: { corrections: MARKER }, corrections: null }), UNPARSEABLE],
  ["null inside the object and a marker string beside it", () => saved(),
    () => ({ findings: { corrections: null }, corrections: JSON.stringify(MARKER) }), UNPARSEABLE],
]) {
  test(`a register sent inside the findings object and beside it with another value keeps main's refusal: ${what}`, () => {
    const dir = run();
    refusesUnchanged(dir, call(), re, `a register sent twice with two values: ${what}`);
    const strip = ({ ts: _ts, event: _event, stage: _stage, seq: _seq, ...rest }) => rest;
    assert.deepEqual(readings(dir).map(strip), reads, `${what}: the run log does not carry the reading main's reading of the call gives`);
  });
}

test("a register sent inside the findings object and beside it with the same content is one register, applied once", () => {
  const reordered = COVERAGE.map((r) => Object.fromEntries(Object.entries(r).reverse()));
  for (const [what, call, register, value] of [
    ["the same coverage in both places", { findings: { coverage: COVERAGE }, coverage: structuredClone(COVERAGE) }, "coverage", COVERAGE],
    ["the same coverage, its keys in another order beside the object", { findings: { coverage: COVERAGE }, coverage: reordered }, "coverage", COVERAGE],
    ["the same marker in both places", { findings: { corrections: MARKER }, corrections: { ...MARKER } }, "corrections", MARKER],
    ["a marker string inside and the marker it encodes beside", { findings: { corrections: JSON.stringify(MARKER) }, corrections: MARKER }, "corrections", MARKER],
    ["a marker inside and a string encoding it beside", { findings: { corrections: MARKER }, corrections: JSON.stringify(MARKER) }, "corrections", MARKER],
    ["the same marker string in both places", { findings: { corrections: JSON.stringify(MARKER) }, corrections: JSON.stringify(MARKER) }, "corrections", MARKER],
    ["the same coverage in both places, beside a row the record holds", { findings: { coverage: COVERAGE }, coverage: COVERAGE, findings_patch: [ROW2()] }, "coverage", COVERAGE],
  ]) {
    const dir = saved();
    const before = onDisk(dir);
    accepts(recordSynthesis(dir, structuredClone(call)), what);
    const after = onDisk(dir);
    assert.equal(canon(after[register]), canon(value), `${what}: the register is not the one value both copies carry`);
    if (!call.findings_patch) assert.equal(JSON.stringify(after.findings), JSON.stringify(before.findings), `${what}: a finding moved`);
    else assert.equal(after.findings[1].legal_position, ROW2().legal_position, `${what}: the row was not applied`);
  }
});

test("whether a call reads as registers is the same on the call as it arrives and on the call as it is read", () => {
  const stored = { narrative: { ...NARRATIVE }, findings: record() };
  for (const [what, arrives, asRead, registers] of [
    ["a marker string inside and the marker it encodes beside",
      { findings: { corrections: JSON.stringify(MARKER) }, corrections: MARKER }, { findings: { corrections: MARKER }, corrections: MARKER }, true],
    ["marker strings in both places that encode one marker",
      { findings: { corrections: JSON.stringify(MARKER) }, corrections: JSON.stringify(MARKER) }, { findings: { corrections: MARKER }, corrections: MARKER }, true],
    ["marker strings that decode to different markers",
      { findings: { corrections: JSON.stringify(MARKER) }, corrections: JSON.stringify(MARKER_B) }, { findings: { corrections: MARKER }, corrections: MARKER_B }, false],
    ["coverage inside and different coverage beside",
      { findings: { coverage: COVERAGE }, coverage: TOP_COVERAGE }, { findings: { coverage: COVERAGE }, coverage: TOP_COVERAGE }, false],
  ]) {
    assert.equal(registerPatchOf(stored, arrives) !== null, registers, `${what}: as it arrives`);
    assert.equal(registerPatchOf(stored, asRead) !== null, registers, `${what}: as it is read`);
  }
});

test("after a register sent twice with two values is refused, the correction sent once is accepted, and so is a whole re-send", () => {
  const twice = { findings: { coverage: COVERAGE }, coverage: TOP_COVERAGE };
  for (const [what, once] of [
    ["the coverage sent once, inside the findings object", { findings: { coverage: TOP_COVERAGE } }],
    ["the coverage sent once, as main's own plain patch", { coverage: TOP_COVERAGE }],
    ["a whole re-send carrying the coverage", { narrative: NARRATIVE, findings: { ...record(), coverage: TOP_COVERAGE } }],
  ]) {
    const dir = saved();
    refusesUnchanged(dir, structuredClone(twice), UNPARSEABLE, `${what}: the register sent twice`);
    accepts(recordSynthesis(dir, structuredClone(once)), what);
    assert.equal(canon(onDisk(dir).coverage), canon(TOP_COVERAGE), `${what}: the coverage did not land`);
    assert.equal(onDisk(dir).findings.length, 3, `${what}: the record lost a finding`);
  }
});

// ── WHERE THESE GUARDS STOP ───────────────────────────────────────────────────────────────────────────
//
// Each guard above returns a call to main's reading only for the shapes it names. These are still read as registers
// and accepted: a narrative of the sections the tool describes, or of another section sent as text; an empty row
// list; a null marker, which the parser reads as no marker; and a marker string that decodes to an object.
test("a narrative of described sections, an empty row list, a null marker and a decoded marker string are still read as registers", () => {
  for (const [what, call, marker] of [
    ["an empty narrative", { narrative: {}, findings: { coverage: COVERAGE } }],
    ["a narrative carrying another section as text", { narrative: { made_up_section: "A section the tool does not render." }, findings: { coverage: COVERAGE } }],
    ["a narrative carrying a coverage read", { narrative: { coverage: { read: "A changed coverage read." } }, findings: { coverage: COVERAGE } }],
    ["a narrative carrying calibration pairs", { narrative: { calibration: [{ challenge: "An invented challenge?", answer: "An invented answer." }] }, findings: { coverage: COVERAGE } }],
    ["a whole narrative and an empty row list", { narrative: NARRATIVE, findings: { coverage: COVERAGE }, findings_patch: [] }],
    ["a null marker inside the object", { findings: { corrections: null } }, null],
    ["a null marker beside the object", { findings: { coverage: COVERAGE }, corrections: null }, null],
    ["a marker string beside the object that decodes to a marker", { findings: { coverage: COVERAGE }, corrections: JSON.stringify(MARKER) }, MARKER],
  ]) {
    const dir = saved();
    accepts(recordSynthesis(dir, structuredClone(call)), what);
    if (call.findings.coverage) assert.equal(canon(onDisk(dir).coverage), canon(COVERAGE), `${what}: the coverage register is not as sent`);
    if (marker !== undefined) assert.deepEqual(onDisk(dir).corrections ?? null, marker, `${what}: the marker is not as read`);
  }
});

// ── A NEWLY READ SHAPE MEETS THE SHIPPED CHECK ON WHAT IT CARRIES ────────────────────────────────────
//
// A call this change reads as a patch can still carry something a shipped check refuses. It then meets that check's
// own text, which names what is wrong in what it sent, where main named the shape. No text here is new. (A nested
// row on an ordinal the record does not hold is pinned above, with its reading.)
const W0 = (row) => ({ narrative: NARRATIVE, findings: { coverage: COVERAGE }, findings_patch: [row] });
for (const [what, call, re] of [
  ["a whole narrative beside a nested row on an ordinal the record does not hold",
    () => ({ narrative: NARRATIVE, findings: { findings_patch: [{ ...ROW2(), ordinal: 99 }] } }), /^synthesis_patch_ordinal_unknown:99 — /],
  ["a patch whose marker string decodes to a marker with an `applied` that is not a boolean",
    () => ({ findings_patch: [ROW2()], corrections: JSON.stringify({ applied: "maybe" }) }),
    /^synthesis_findings_invalid: findings_corrections_invalid \(corrections\.applied must be a boolean\)$/],
  ["a patch whose marker string decodes to a marker with a key it does not have",
    () => ({ findings_patch: [ROW2()], corrections: JSON.stringify({ applied: true, note: "x", extra: 1 }) }),
    /^synthesis_findings_invalid: findings_corrections_key_unknown:extra \(keys are EXACTLY: applied, note, entries\)$/],
  ["registers with a marker string that decodes to a marker with an `applied` that is not a boolean",
    () => ({ findings: { corrections: JSON.stringify({ applied: "maybe" }) } }),
    /^synthesis_findings_invalid: findings_corrections_invalid \(corrections\.applied must be a boolean\)$/],
  ["registers carrying coverage as a JSON string",
    () => ({ findings: { coverage: JSON.stringify(COVERAGE) } }),
    /^synthesis_findings_invalid: findings_coverage_invalid: "coverage" must be a JSON ARRAY of coverage-area objects$/],
  ["registers carrying the mark assessment as a string",
    () => ({ findings: { mark_assessment: "a string, not the object" } }),
    /^synthesis_findings_invalid: findings_mark_assessment_invalid \(mark_assessment must be an object \{ distinctiveness, connotation \}\)$/],
  ["a narrative and registers beside a row carrying a key a finding does not have",
    () => W0({ ...ROW2(), made_up_field: 1 }), /^synthesis_findings_invalid: finding_key_unknown:made_up_field \(keys are EXACTLY: /],
  ["a narrative and registers beside a row carrying an unknown meter",
    () => W0({ ...ROW2(), meters: { ...ROW2().meters, made_up_meter: { token: "low", basis: "inferred-from-signal" } } }),
    /^synthesis_findings_invalid: finding_meter_unknown:made_up_meter \(keys are EXACTLY: mark_similarity, goods_proximity, use, enforcer\)$/],
  ["a narrative and registers beside a row whose meter token is not one of its tokens",
    () => W0({ ...ROW2(), meters: { ...ROW2().meters, goods_proximity: { token: "unclear", basis: "inferred-from-signal" } } }),
    /^synthesis_findings_invalid: finding_meter_token_invalid:goods_proximity:unclear \(must be one of: high, medium, low\. /],
  ["a narrative and registers beside a row whose finding sentence is a chain",
    () => W0({ ...ROW2(), net: "A live prior right on the same element; the goods overlap in the searched class." }),
    /^synthesis_findings_invalid: findings_net_chained:2 \(the finding sentence is a CONCLUSION, not a chain/],
]) {
  test(`a newly read shape meets the shipped check on what it carries: ${what}`, () => {
    refusesUnchanged(saved(), call(), re, `a newly read shape: ${what}`);
  });
}

// ── AN EMPTY CORRECTION INSIDE A FINDINGS OBJECT IS ACCEPTED, AND CHANGES NOTHING ───────────────────
//
// Main accepts an empty patch as a no-op: no call fields, no rows, or no sections. The same empty patch sent inside a
// findings object, as no registers, no nested rows or the stored envelope, is accepted the same way, and both files
// keep their bytes.
test("an empty correction inside a findings object is accepted and changes nothing, as main's own empty patch does", () => {
  for (const [what, call] of [
    ["an empty call (main's own)", {}],
    ["an empty row list (main's own)", { findings_patch: [] }],
    ["an empty narrative (main's own)", { narrative: {} }],
    ["an empty findings object", { findings: {} }],
    ["an empty findings object beside the stored narrative", { narrative: NARRATIVE, findings: {} }],
    ["a findings object carrying an empty row list", { findings: { findings_patch: [] } }],
    ["a findings object carrying an empty row list beside the stored narrative", { narrative: NARRATIVE, findings: { findings_patch: [] } }],
    ["a findings object carrying only the stored schema_version", { findings: { schema_version: record().schema_version } }],
  ]) {
    const dir = saved();
    const before = files(dir);
    accepts(recordSynthesis(dir, structuredClone(call)), what);
    const after = files(dir);
    assert.equal(after.findings, before.findings, `${what}: findings.json moved`);
    assert.equal(after.narrative, before.narrative, `${what}: narrative.md moved`);
  }
});
