// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — a batch searches SEVERAL subject marks; a gold set answers some of them.
//
// R3 searches two marks. Its gold set answers one. The scorer flattened both marks' findings into one
// row list and measured all of them against that one-mark reference, so the second mark's legitimate
// hits printed in `noise` — the bucket a reader scans to ask "did the engine surface junk?". They were
// not junk. They were the correct output of a mark nobody wrote a reference for, and the inflation was
// silent, permanent, and grew with every round.
//
// WHAT THESE TESTS PIN, in order of how badly each fails silently:
//
//   1. A `covers_marks` label matching NO subject (a typo, a rename, a stale gold) must exclude NOTHING.
//      Excluding on it empties every bucket and the round reads as a clean sweep. Most dangerous arm.
//   2. An uncovered mark's finding lands in `uncovered` and in NO other bucket — not dropped on the
//      floor, which is the absence-reported-as-success shape, and the COUNT is what catches it.
//   3. The partition happens BEFORE the entry loop, so an uncovered mark's finding can never satisfy a
//      covered reference entry and manufacture a `found`.
//   4. The subject roll comes off `marks[]`, not off the finding rows, so a mark that came back with
//      nothing still gets a row.
//   5. A column a mark cannot speak to is `null` (printed `—`), never 0.
//
// MARK NAMES. CORAL FREEZE and CINDER LANTERN are both already carried by origin/main and neither is on
// the RETIRED blocklist in no-client-identifiers.test.mjs, so they are reused rather than re-minted, per
// the header rule in reference-score.test.mjs. Every fixture here is inline mkdtemp — nothing is written
// under driver/test/fixtures/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  referenceCoverage, scoreRecall, scoreByMark, validateReference, REFERENCE_SCHEMA_VERSION,
} from "../reference-score.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCORE = join(REPO, "scripts", "score.mjs");

const TIKI = "CORAL FREEZE";
const CINDER = "CINDER LANTERN";
const BOTH = [TIKI, CINDER];

// ── referenceCoverage — the four states ───────────────────────────────────────────────────────────

test("declared: the reference answers one of the two marks, and names the other as out of its scope", () => {
  const c = referenceCoverage({ coversMarks: [TIKI], subjects: BOTH });
  assert.equal(c.state, "declared");
  assert.deepEqual(c.covered, [TIKI]);
  assert.deepEqual(c.excludes, [CINDER], "the mark the reference does not answer is named, not guessed at");
  assert.deepEqual(c.undeclaredIn, []);
  assert.match(c.why, /CORAL FREEZE/);
  assert.match(c.why, /CINDER LANTERN/, "and the sentence names it too — a reader must not need the array");
});

test("a subject matches a declared label on the STEM rule, not on ==", () => {
  // The gold writes what the lawyer wrote; the run writes what the plan carried. `CORAL FREEZE` and
  // `Coral Freeze` are one mark, and the two halves of this change must never disagree about that — the
  // buckets already match on the stem, so the coverage test has to as well.
  const c = referenceCoverage({ coversMarks: [TIKI], subjects: ["Coral Freeze"] });
  assert.deepEqual(c.covered, ["Coral Freeze"]);
  assert.deepEqual(c.excludes, [], "a casing difference must not place a mark out of the reference's scope");
});

test("undeclared: an old gold set excludes NOTHING and says which marks ran", () => {
  // This is the state today's unedited R3.gold.json lands in, and the whole point of it: the scorer's
  // half alone makes the defect visible on the old shape rather than silently mis-bucketing it.
  const c = referenceCoverage({ coversMarks: null, subjects: BOTH });
  assert.equal(c.state, "undeclared");
  assert.deepEqual(c.excludes, [], "nothing is placed out of scope on a reference that declared nothing");
  assert.match(c.why, /NOT DECLARED/);
  assert.match(c.why, /covers_marks/, "it names the field that is missing");
  for (const m of BOTH) assert.ok(c.why.includes(m), `and every mark the run searched: ${m}`);
});

test("a declaration matching NO subject REFUSES to exclude — the silent clean sweep", () => {
  // A typo, a rename, or a gold set left behind by a scenario change. Under the generic arm this
  // excludes BOTH marks, every finding leaves noise, `noise` reads 0 and the round reads clean. The
  // refusal is the guard, and it has to say why rather than quietly behaving like `undeclared`.
  const c = referenceCoverage({ coversMarks: ["TIKI SLURSH"], subjects: BOTH });
  assert.equal(c.state, "declaration-matches-no-subject");
  assert.deepEqual(c.excludes, [], "not one mark is placed out of scope on a declaration nothing matches");
  assert.deepEqual(c.covered, []);
  assert.deepEqual(c.undeclaredIn, ["TIKI SLURSH"], "the label that matched nothing is named");
  assert.match(c.why, /stale or mistyped/);
});

test("a declared label no subject matched, while others did, is reported rather than dropped", () => {
  const c = referenceCoverage({ coversMarks: [TIKI, "ZORVYS"], subjects: BOTH });
  assert.equal(c.state, "declared");
  assert.deepEqual(c.covered, [TIKI]);
  assert.deepEqual(c.undeclaredIn, ["ZORVYS"], "the reference names a mark this run never searched");
  assert.match(c.why, /never searched/);
});

test("the clearance lane publishes no subject roll, and nothing changes for it", () => {
  const c = referenceCoverage({ coversMarks: [TIKI], subjects: null });
  assert.equal(c.state, "no-subject-roll");
  assert.deepEqual(c.excludes, [], "a lane with no roll can have nothing out of the reference's scope");
  assert.equal(c.subjects, null, "three-valued: null is not the same as an empty roll");
  // An EMPTY roll is a different fact from no roll at all, and must not collapse into it.
  assert.equal(referenceCoverage({ coversMarks: [TIKI], subjects: [] }).state, "declaration-matches-no-subject");
});

// ── scoreRecall — the partition ───────────────────────────────────────────────────────────────────

// The batch as knockout publishes it: the run's own findings, each carrying the SUBJECT it was searching.
const KO_FINDINGS = [
  { subject: TIKI, mark: "Coral Freezes", owner: null, band: "Medium", evidence: "common-law" },
  { subject: TIKI, mark: "TOAST CORAL FREEZIES", owner: null, band: "Low", evidence: "common-law" },
  { subject: CINDER, mark: "Cinder", owner: null, band: "Low", evidence: "common-law" },
  { subject: CINDER, mark: "Lanterne Arc Scented Porcelain Candle, Cinder", owner: null, band: "Low", evidence: "common-law" },
  { subject: CINDER, mark: "Cinder", owner: null, band: "Low", evidence: "common-law" },
];
const COVERAGE = referenceCoverage({ coversMarks: [TIKI], subjects: BOTH });
const REGISTER = [{ mark: "ZORVYS", owner: "Zorvys Holdings", classes: [32] }];

test("an uncovered mark's findings land in `uncovered` and in NO other bucket", () => {
  const b = scoreRecall({ reference: REGISTER, findings: KO_FINDINGS, registerOnly: true, coverage: COVERAGE });
  // The COUNT is what catches the absence-reported-as-success arm: dropped from every bucket, the two
  // "neither noise nor lost" asserts below still hold and the round reads better than it is.
  assert.equal(b.uncovered.length, 3, "all three of the second mark's findings are accounted for");
  assert.deepEqual(b.noise.map((r) => r.subject), [TIKI, TIKI], "and NOT ONE of them is noise");
  assert.deepEqual(b.lost.map((r) => r.mark), ["ZORVYS"], "nor lost — lost holds reference entries only");
  for (const r of b.uncovered) {
    assert.equal(r.subject, CINDER, "every uncovered row names the mark it belongs to");
    assert.match(r.why, /not among the marks this reference answers/);
    assert.match(r.why, /CORAL FREEZE/, "and says which marks it DOES answer");
  }
});

test("every finding is accounted for — nothing falls off the floor between the buckets", () => {
  // Deliberately built with no near-match in it: scoreRecall legitimately drops a refused
  // near-match from every bucket (reference-score.test.mjs asserts that), so a conservation test over a
  // fixture containing one would go red for the wrong reason and get weakened into uselessness.
  const b = scoreRecall({ reference: REGISTER, findings: KO_FINDINGS, registerOnly: true, coverage: COVERAGE });
  assert.equal(b.found.length + b.additional.length + b.noise.length + b.uncovered.length, KO_FINDINGS.length);
});

test("an uncovered mark's finding can never satisfy a covered reference entry", () => {
  // The reference answers CORAL FREEZE. `CINDER` in its register IS matched by the CINDER LANTERN finding
  // "Cinder" — but a CINDER LANTERN hit does not answer a CORAL FREEZE reference, and crediting it would
  // be the scorer inventing recall out of a mark the gold set never covered. Partitioning AFTER the
  // entry loop instead of before it is exactly what this catches.
  //
  // THE EVIDENCE CLASS HAD TO BE OPENED FOR THIS ASSERT TO MEAN ANYTHING. On `common-law` the gate
  // refuses the entry whatever the partition does, so the same assert passes under both orderings and
  // proves nothing. These findings carry no typed source, which folds to `unknown` — the preserved-run
  // shape deliberately does not block — so the ONLY thing standing between the entry and a
  // manufactured `found` is where the partition happens.
  const findings = KO_FINDINGS.map(({ evidence, ...f }) => f);
  const b = scoreRecall({
    reference: [{ mark: "CINDER", owner: "Cinder Holdings", classes: [32] }],
    findings, registerOnly: true, coverage: COVERAGE,
  });
  assert.equal(b.found.length, 0, "no find is manufactured out of an uncovered mark");
  assert.deepEqual(b.lost.map((r) => r.mark), ["CINDER"], "the entry is honestly never answered");
  assert.equal(b.uncovered.length, 3, "and its findings are still all accounted for");
  // Same fixture, coverage undeclared: the entry IS satisfied. That is what proves the assert above is
  // about the partition and not about some other refusal quietly doing the work.
  const undeclared = scoreRecall({
    reference: [{ mark: "CINDER", owner: "Cinder Holdings", classes: [32] }],
    findings, registerOnly: true,
    coverage: referenceCoverage({ coversMarks: null, subjects: BOTH }),
  });
  assert.deepEqual(undeclared.found.map((r) => r.mark), ["CINDER"]);
});

test("with no declaration, every finding is measured exactly as it was before this existed", () => {
  // THE MIGRATION, asserted as a number rather than as an intention. A test asserting only
  // `uncovered === 0` passes if the rows were excluded AND dropped; the discriminating assertion is that
  // the noise count is the same one the old code produced — every unmatched finding, both marks'.
  const undeclared = referenceCoverage({ coversMarks: null, subjects: BOTH });
  const b = scoreRecall({ reference: REGISTER, findings: KO_FINDINGS, registerOnly: true, coverage: undeclared });
  assert.equal(b.uncovered.length, 0);
  assert.equal(b.noise.length, KO_FINDINGS.length, "all five are still measured against the reference");
  // And byte-for-byte the same buckets a caller that passes no coverage at all gets.
  const bare = scoreRecall({ reference: REGISTER, findings: KO_FINDINGS, registerOnly: true });
  assert.deepEqual(bare.noise, b.noise);
});

test("the clearance lane's buckets are untouched by any of this", () => {
  // Same assertions the shipped withheld/lost split makes, with a coverage object in hand. If exclusion
  // ever ran when the roll is null, the withheld/lost split moves and this goes red.
  const reference = [
    { mark: "TIKI", owner: "Tiki Corporation", classes: [32] },
    { mark: "TIKI TWIST", classes: [32] },
    { mark: "E2E LOST PROBE", classes: [32] },
  ];
  const findings = [{ subject: null, mark: "TIKI", owner: "Tiki Corporation" }];
  const retrieved = [{ mark: "TIKI TWIST", record_id: "/mark/us/d074651d-d49a-46c1-9c95-8b6a6f0880f0" }];
  const coverage = referenceCoverage({ coversMarks: [TIKI], subjects: null });
  const b = scoreRecall({ reference, findings, retrieved, scopeClasses: ["32"], coverage });
  assert.deepEqual(b.found.map((r) => r.mark), ["TIKI"]);
  assert.deepEqual(b.withheld.map((r) => r.mark), ["TIKI TWIST"]);
  assert.deepEqual(b.lost.map((r) => r.mark), ["E2E LOST PROBE"]);
  assert.deepEqual(b.uncovered, []);
});

// ── scoreByMark — the fold ────────────────────────────────────────────────────────────────────────

test("a column a mark cannot speak to is `—`, never 0", () => {
  // An uncovered mark's findings were NEVER measured against the reference. `noise: 0` would say they
  // were and came back clean, which is a conclusion the data does not support — the same defect axis E's
  // `no-reference-entries` row and its three-valued `returned` exist to prevent.
  const buckets = scoreRecall({ reference: REGISTER, findings: KO_FINDINGS, registerOnly: true, coverage: COVERAGE });
  const m = scoreByMark({ buckets, coverage: COVERAGE, lane: "knockout" });
  const tiki = m.rows.find((r) => r.subject === TIKI);
  const cinder = m.rows.find((r) => r.subject === CINDER);

  assert.equal(cinder.coverage, "not-covered");
  assert.equal(cinder.found, null, "a mark that was never measured has no found count");
  assert.equal(cinder.additional, null);
  assert.equal(cinder.noise, null);
  assert.equal(cinder.uncovered.length, 3, "what it DOES have is its uncovered rows");

  assert.equal(tiki.coverage, "covered");
  assert.equal(tiki.noise.length, 2, "and the covered mark's own noise, separated from the other's");
  assert.equal(tiki.uncovered, null, "a covered mark cannot have uncovered rows — that column is not 0");
});

test("the fold takes its rows from the SUBJECT ROLL, not from the findings", () => {
  // A mark that was searched and came back with nothing still gets a row. Derived from the finding rows
  // instead, it vanishes — and a covered mark that came back clean then reads identically to a mark that
  // was never searched at all.
  const roll = [TIKI, CINDER, "ZORVYS"];
  const coverage = referenceCoverage({ coversMarks: [TIKI, "ZORVYS"], subjects: roll });
  const buckets = scoreRecall({ reference: REGISTER, findings: KO_FINDINGS, registerOnly: true, coverage });
  const m = scoreByMark({ buckets, coverage, lane: "knockout" });
  assert.deepEqual(m.rows.map((r) => r.subject), roll, "one row per mark searched, in the roll's order");
  const silent = m.rows.find((r) => r.subject === "ZORVYS");
  assert.equal(silent.coverage, "covered");
  assert.equal(silent.noise.length, 0, "covered and silent is a real 0 — it WAS measured");
});

test("the fold can never disagree with the buckets it folds", () => {
  const buckets = scoreRecall({ reference: REGISTER, findings: KO_FINDINGS, registerOnly: true, coverage: COVERAGE });
  const m = scoreByMark({ buckets, coverage: COVERAGE, lane: "knockout" });
  const folded = m.rows.flatMap((r) => [...(r.noise ?? []), ...(r.uncovered ?? [])]);
  assert.equal(folded.length, buckets.noise.length + buckets.uncovered.length,
    "every noise and uncovered row is attributed to exactly one mark");
});

test("no subject roll means no per-mark fold, and it says so rather than printing an empty one", () => {
  const coverage = referenceCoverage({ coversMarks: [TIKI], subjects: null });
  const m = scoreByMark({ buckets: scoreRecall({ reference: REGISTER, findings: [], coverage }), coverage, lane: "clearance" });
  assert.equal(m.rows, null, "null, not [] — an empty table would read as a batch that searched nothing");
  assert.match(m.absent, /no per-mark subject roll/);
  assert.ok(!m.notes.some((n) => /knockout/.test(n)), "and the knockout-lane sentence stays off the clearance lane");
});

test("the knockout lane's structural `found` 0 is stated, so it is not filed as a recall regression", () => {
  const m = scoreByMark({ buckets: { found: [] }, coverage: COVERAGE, lane: "knockout" });
  assert.ok(m.notes.some((n) => /common-law/.test(n) && /structurally 0/.test(n)));
  assert.ok(m.notes.some((n) => /not attributable/.test(n)), "and which buckets get no column, with the reason");
});

// ── the reference contract ────────────────────────────────────────────────────────────────────────

test("covers_marks is optional, and malformed refuses rather than reading as a clean sweep", () => {
  const base = { schema_version: 1, scenario: "R3", source: "x", register: [{ mark: "TIKI" }] };
  assert.deepEqual(validateReference(base), [], "ABSENT is valid — that is the whole migration");
  assert.deepEqual(validateReference({ ...base, covers_marks: [TIKI] }), []);
  assert.match(validateReference({ ...base, covers_marks: TIKI }).join(" "), /covers_marks/, "a bare string is refused");
  assert.match(validateReference({ ...base, covers_marks: [] }).join(" "), /covers_marks/, "an empty array is refused");
  assert.match(validateReference({ ...base, covers_marks: [TIKI, 7] }).join(" "), /covers_marks/, "a non-string entry is refused");
  assert.match(validateReference({ ...base, covers_marks: [TIKI, "  "] }).join(" "), /covers_marks/, "and a blank one");
});

test("the schema version does NOT move — a bump stops every gold set in the config store at once", () => {
  assert.equal(REFERENCE_SCHEMA_VERSION, 1,
    "covers_marks is additive and optional; bumping the version would make every existing baseline refuse to score");
});

// ── end to end through the real CLI ───────────────────────────────────────────────────────────────

// — the store carries a `counts` block by default, because the runs below are KNOCKOUT runs and
// the scorer now refuses that lane against a similar-marks sheet alone. These tests are about 's
// per-mark coverage fold, not about recall, so the block is scaffolding: it makes the pairing legitimate
// so the coverage assertions can be reached. `makeStore({ counts: undefined })` gets the old shape back,
// which is what the refusal test below uses.
function makeStore(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "score-store-"));
  mkdirSync(join(dir, "baselines"), { recursive: true });
  const doc = {
    schema_version: 1, scenario: "R3", mark: TIKI, source: "fixture — synthetic two-mark knockout batch",
    scope: { classes: [32] }, register: REGISTER, channels: [],
    counts: [{ mark: TIKI, classes: [32], identical: { min: 0, max: 50 } }],
    ...extra,
  };
  if (doc.counts === undefined) delete doc.counts;
  writeFileSync(join(dir, "baselines", "R3.gold.json"), JSON.stringify(doc, null, 2));
  return dir;
}

/** A two-mark knockout run dir, in the shape pipeline-knockout.mjs writes. */
function makeKnockoutRun() {
  const dir = mkdtempSync(join(tmpdir(), "score-ko-run-"));
  writeFileSync(join(dir, "knockout-findings.json"), JSON.stringify({
    schema_version: 1, batch: { executiveSummary: "fixture" },
    marks: [
      { name: TIKI, band: "Medium", findings: KO_FINDINGS.filter((f) => f.subject === TIKI)
        .map((f, i) => ({ ordinal: i + 1, name: f.mark, owner: "fixture", band: f.band })) },
      { name: CINDER, band: "Low", findings: KO_FINDINGS.filter((f) => f.subject === CINDER)
        .map((f, i) => ({ ordinal: i + 1, name: f.mark, owner: "fixture", band: f.band })) },
    ],
  }));
  writeFileSync(join(dir, "status.json"), JSON.stringify({ verdict: "Medium" }));
  mkdirSync(driverDir(dir));
  writeFileSync(driverDir(dir, "instructed-scope.json"), JSON.stringify({ classes: [32], jurisdictions: ["US"] }));
  return dir;
}

const cli = (args, env = {}) => {
  const r = spawnSync("node", [SCORE, ...args], { encoding: "utf8", env: { ...process.env, CLEAROTRON_E2E_DIR: "", ...env } });
  // `out` MERGES the streams because it is what every assertion message prints, and a failure with the
  // stderr withheld is a failure you cannot diagnose. But stdout ALONE is the JSON document: parsing the
  // merged text breaks on any stderr at all, and score.mjs legitimately writes to it — under a legacy
  // env spelling the alias layer emits its deprecation note, exactly as every other declared entry does
  //. That is the tool working, not a defect, and a test must not require silence to parse.
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, stdout: r.stdout ?? "" };
};

test("CLI: a declared reference separates the second mark's hits out of noise, and names them", () => {
  const store = makeStore({ covers_marks: [TIKI] });
  const run = makeKnockoutRun();
  try {
    const { code, out } = cli(["R3", "--run", run], { CLEAROTRON_E2E_DIR: store });
    assert.equal(code, 0, out);
    assert.match(out, /noise\s+2\s/, "only the covered mark's two findings are noise");
    assert.match(out, /uncovered\s+3\s/, "and the other mark's three are counted");
    // THE COUNT IS THE SILENT HALF. `uncovered` missing from the named-rows loop prints a right count
    // over rows that never appear, and the reader cannot check the attribution at all.
    assert.match(out, /UNCOVERED — the mark it belongs to is not one this reference answers/);
    for (const m of ["Cinder", "Lanterne Arc Scented Porcelain Candle, Cinder"])
      assert.ok(out.includes(m), `the uncovered row is named: ${m}`);
    // EVERY bucket row built from a finding names the mark it belongs to, NOISE included. A noise row
    // carries no `why` sentence, so its printed `subject` is the only thing on the page that answers
    // "which of the two marks surfaced this" — drop it from the row bits and the covered mark's rows go
    // back to being unattributable without opening knockout-findings.json.
    assert.match(out, /· Coral Freezes\s+·\s+CORAL FREEZE/, "a noise row prints its subject mark");
    assert.match(out, /· Cinder\s+·\s+CINDER LANTERN/, "and so does an uncovered one");
    // THE ACCEPTANCE: attribution readable without opening knockout-findings.json.
    assert.match(out, /── by mark/);
    assert.match(out, new RegExp(`${TIKI}\\s+covered\\s+0\\s+0\\s+2\\s+—`), "the covered mark's row");
    assert.match(out, new RegExp(`${CINDER}\\s+not-covered\\s+—\\s+—\\s+—\\s+3`), "and the uncovered mark's, in dashes not zeroes");
    assert.match(out, /coverage:\s+declared/);
    // The house rule the whole tool rests on, re-run over the lines this change added.
    for (const line of out.split("\n")) {
      if (/no PASS here|never a target|not a pass|not passed/i.test(line)) continue;
      assert.doesNotMatch(line, /\b(PASS|FAIL|PASSED|FAILED|grade|score:)\b/i, `verdict word reported: ${line}`);
    }
  } finally { rmSync(store, { recursive: true, force: true }); rmSync(run, { recursive: true, force: true }); }
});

test("CLI: a mark that was searched and came back with nothing still gets a row", () => {
  // THE ROLL IS `marks[]`, NOT THE FINDING ROWS, and this is the arm that proves it end to end — the
  // unit test above can only assert the fold, not where score.mjs got the roll from. `marks[].name` is
  // machine-gated against the frozen plan (validateMergedFindings), the rows are a projection of it, and
  // derived from the projection a covered mark that came back CLEAN disappears from the page entirely —
  // reading identically to a mark that was never searched.
  const store = makeStore({ covers_marks: [TIKI, "ZORVYS"] });
  const run = makeKnockoutRun();
  try {
    const ko = JSON.parse(readFileSync(join(run, "knockout-findings.json"), "utf8"));
    ko.marks.push({ name: "ZORVYS", band: "Low", findings: [] });
    writeFileSync(join(run, "knockout-findings.json"), JSON.stringify(ko));
    const { code, out } = cli(["R3", "--run", run], { CLEAROTRON_E2E_DIR: store });
    assert.equal(code, 0, out);
    assert.match(out, /ZORVYS\s+covered\s+0\s+0\s+0\s+—/,
      "searched, covered, and genuinely clean — a real 0, not an absent row");
    assert.match(out, /the reference answers 2 of the 3 marks/);
  } finally { rmSync(store, { recursive: true, force: true }); rmSync(run, { recursive: true, force: true }); }
});

test("CLI: the OLD gold shape still folds per mark, and says its coverage is not declared", () => {
  // Back-compat for 's half, over the same run dir: no `covers_marks`, which is what R3.gold.json
  // carries in the config store today. The `counts` block makes the lane pairing legitimate — see
  // makeStore — and changes nothing about what this test measures.
  const store = makeStore();
  const run = makeKnockoutRun();
  try {
    const { code, out } = cli(["R3", "--run", run], { CLEAROTRON_E2E_DIR: store });
    assert.equal(code, 0, out);
    assert.match(out, /noise\s+5\s/, "every finding is still measured — the count the old code produced");
    assert.match(out, /uncovered\s+0\s/);
    assert.match(out, /coverage:\s+undeclared — NOT DECLARED/);
    for (const m of BOTH) assert.ok(out.includes(m), `and the coverage line names the mark: ${m}`);
  } finally { rmSync(store, { recursive: true, force: true }); rmSync(run, { recursive: true, force: true }); }
});

test("#814 CLI: a knockout against a similar-marks sheet ALONE is refused, and the sheet is not scored beside a counts block", () => {
  // The half of 's back-compat guarantee that deliberately revoked. A gold set with no `counts`
  // used to score this knockout run and print `found 0` over marks the lane cannot retrieve; it now
  // refuses, names the scenario, and says what to add.
  const bare = makeStore({ counts: undefined });
  const run = makeKnockoutRun();
  try {
    const { code, out } = cli(["R3", "--run", run], { CLEAROTRON_E2E_DIR: bare });
    assert.equal(code, 2, out);
    assert.match(out, /REFUSING TO SCORE/);
    assert.match(out, /R3 ran the KNOCKOUT lane/);
    assert.match(out, /`counts` block/);
  } finally { rmSync(bare, { recursive: true, force: true }); }

  // And where a count-shaped set KEEPS its lawyer sheet — worth keeping, it is a real answer to a real
  // matter — the sheet's entries must not reappear as LOST rows beside the count. That is the same
  // structural zero one row smaller, in the table a reader scans first.
  const shaped = makeStore();
  try {
    const { code, out } = cli(["R3", "--run", run], { CLEAROTRON_E2E_DIR: shaped });
    assert.equal(code, 0, out);
    assert.match(out, /is NOT scored here/, "the omission is stated, never silent");
    assert.match(out, /lost\s+0\s/, "no reference entry is scored as a miss on a lane that cannot retrieve it");
    assert.ok(out.indexOf("── counts") < out.indexOf("── buckets"),
      "the count axis is this scenario's score and must be read before the buckets, not after them");
  } finally { rmSync(shaped, { recursive: true, force: true }); rmSync(run, { recursive: true, force: true }); }
});

test("CLI: the clearance lane says it publishes NO roll — not that it published an empty one", () => {
  // THREE-VALUED, END TO END. `subjects: null` means this lane has no per-mark roll; `[]` would mean it
  // published one and it was empty. Collapsed to `[]`, the page tells a clearance reader the run
  // "published an empty subject roll", which is a fact about the run and is false — the same
  // absence-reported-as-a-measurement shape the buckets are careful about everywhere else.
  const store = makeStore({ covers_marks: [TIKI] });
  const run = mkdtempSync(join(tmpdir(), "score-cl-run-"));
  try {
    writeFileSync(join(run, "findings.json"), JSON.stringify({
      schema_version: 5, findings: [{ ordinal: 1, mark: "ZORVYS", owner: "Zorvys Holdings", disposition: "adversarial", band: { label: "Medium" } }],
    }));
    mkdirSync(driverDir(run));
    writeFileSync(driverDir(run, "instructed-scope.json"), JSON.stringify({ classes: [32], jurisdictions: ["US"] }));
    const { code, out } = cli(["R3", "--run", run], { CLEAROTRON_E2E_DIR: store });
    assert.equal(code, 0, out);
    assert.match(out, /coverage:\s+no-subject-roll/);
    assert.match(out, /no per-mark subject roll/);
    assert.ok(!/empty subject roll/.test(out), "it must not claim the run published a roll that was empty");
    assert.match(out, /uncovered\s+0\s/, "and nothing is placed out of scope on a lane with no roll");
  } finally { rmSync(store, { recursive: true, force: true }); rmSync(run, { recursive: true, force: true }); }
});

test("CLI --json carries the coverage, the bucket and the per-mark fold", () => {
  const store = makeStore({ covers_marks: [TIKI] });
  const run = makeKnockoutRun();
  try {
    const { code, out, stdout } = cli(["R3", "--run", run, "--json"], { CLEAROTRON_E2E_DIR: store });
    assert.equal(code, 0, out);
    const j = JSON.parse(stdout);
    assert.equal(j.coverage.state, "declared");
    assert.deepEqual(j.coverage.excludes, [CINDER]);
    assert.equal(j.buckets.uncovered.length, 3);
    assert.equal(j.byMark.rows.find((r) => r.subject === CINDER).noise, null);
    // KNOCKOUT PROSE ARM — the rating word on the typed shape is `band`. Read as `impact` (the key
    // removed) every knockout row carried a null rating into the bucket a reader uses to attribute it.
    assert.deepEqual([...new Set(j.buckets.uncovered.map((r) => r.band))], ["Low"]);
    assert.equal(j.buckets.noise.find((r) => r.mark === "Coral Freezes").band, "Medium");
  } finally { rmSync(store, { recursive: true, force: true }); rmSync(run, { recursive: true, force: true }); }
});

test("CLI: an archived prose-shape knockout run still carries its rating word", () => {
  // score.mjs reads PRESERVED runs, and the archived prose row `{name, type, url, description, impact}`
  // is still republished. Reading only `band` would blank the rating on every archived run.
  const store = makeStore({ covers_marks: [TIKI] });
  const run = mkdtempSync(join(tmpdir(), "score-ko-old-"));
  try {
    writeFileSync(join(run, "knockout-findings.json"), JSON.stringify({
      schema_version: 1, batch: { executiveSummary: "fixture" },
      marks: [{ name: TIKI, findings: [{ name: "Coral Freezes", type: "Active Business", url: "https://example.invalid/a", description: "d", impact: "HIGH" }] }],
    }));
    writeFileSync(join(run, "status.json"), JSON.stringify({ verdict: "Medium" }));
    const { code, out, stdout } = cli(["R3", "--run", run, "--json"], { CLEAROTRON_E2E_DIR: store });
    assert.equal(code, 0, out);
    assert.equal(JSON.parse(stdout).buckets.noise.find((r) => r.mark === "Coral Freezes").band, "HIGH");
  } finally { rmSync(store, { recursive: true, force: true }); rmSync(run, { recursive: true, force: true }); }
});
