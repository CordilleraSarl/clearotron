// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the delivered narrative is read back against the depth rules the seat was given, and a
// violation routes to one warm redo rather than shipping as a note.
//
// Instruction-only has failed twice on this engine: the cards before the acceptors, and prose write-ups
// for rung-excluded findings on a delivered run. The check is how that is known at delivery instead of
// three runs later.
//
// PARAMETERS ARE NOT IN THIS SLICE. `keptDispositions` and `narrativeWriteUpWords` land on the
// per-product row later, so on merge this is inert on every product — and permanently inert on the
// ungraded one, which is what byte-identical means. The arms supply them directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { narrativeWriteUps, writeUpViolations, wordCount, writeUpMessage } from "../narrative-write-ups.mjs";
import { narrativeWriteUpChecks } from "../predelivery-lint.mjs";

const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
const NARRATIVE = [
  "# Clearance narrative", "", "Overview prose that is not a write-up.", "",
  "## Finding 1 — VENARI", "", `**Composite:** 4`, "", words(40), "",
  "## Finding 2 — QORI", "", `**Composite:** 2`, "", words(400), "",
  "## Finding 3 — ARBOL", "", `**Composite:** 1`, "", words(30), "",
  "## Answers to your instructions", "", "- You asked: X → Y", "",
].join("\n");

// BANDS, not dispositions — owner-ruled. The manifest's own order is the rank, so a framework that
// spells its bands differently still selects correctly; a hard-coded name set would select nothing there.
const MANIFEST = { bands: [{ label: "Very High" }, { label: "High" }, { label: "Moderate" }, { label: "Manageable" }] };
const FINDINGS = { findings: [
  { ordinal: 1, mark: "VENARI", band: "Very High", disposition: "adversarial" },   // rank 1
  { ordinal: 2, mark: "QORI", band: "Moderate", disposition: "adversarial" },      // rank 3
  { ordinal: 3, mark: "ARBOL", band: "Manageable", disposition: "off-field" },     // rank 4 — excluded
] };
const RULES = { bandOrder: MANIFEST.bands, maxBandRank: 3 };

test("#1503 the fixture parses into three write-ups and leaves the other sections alone", () => {
  // Without this the arms below could hold over an empty list, which is the vacuous shape they exist to
  // catch elsewhere in this file family.
  const ws = narrativeWriteUps(NARRATIVE);
  assert.deepEqual(ws.map((w) => w.ordinal), [1, 2, 3]);
  assert.equal(ws.find((w) => w.ordinal === 2).words, 400 + 2, "the Composite line counts toward the block");
  assert.equal(wordCount("  a  b   c "), 3, "the count is whitespace tokens, stated so it is one number");
});

test("#1503 with NO parameters the check is inert — no verdict, not a passing one", () => {
  // Today, and permanently on the ungraded product. A passing row would be a claim nobody measured.
  assert.deepEqual(writeUpViolations({ narrativeMd: NARRATIVE, findings: FINDINGS }).violations, []);
  assert.deepEqual(narrativeWriteUpChecks({ narrativeMd: NARRATIVE, findings: FINDINGS, depth: {}, manifest: MANIFEST }), []);
  assert.deepEqual(narrativeWriteUpChecks({ narrativeMd: NARRATIVE, findings: FINDINGS, depth: null, manifest: MANIFEST }), []);
  // And a rank cut with NO manifest is inert too — a cut against an unknown order would select by accident.
  assert.deepEqual(writeUpViolations({ narrativeMd: NARRATIVE, findings: FINDINGS, maxBandRank: 3 }).violations, []);
});

test("#1503 MEMBERSHIP — a write-up on a disposition outside the kept set is a violation", () => {
  const r = writeUpViolations({ narrativeMd: NARRATIVE, findings: FINDINGS, ...RULES });
  assert.deepEqual(r.violations.map((v) => v.ordinal), [3]);
  assert.equal(r.violations[0].kind, "not-kept");
  assert.equal(r.violations[0].band, "Manageable");
  assert.equal(r.violations[0].rank, 4, "the rank is ordinal against the run's own manifest");
  // Rank 3 is KEPT, so the cut is a boundary rather than "only the top band" — the arm that would fail
  // if the comparison were `<` instead of `<=`.
  assert.equal(r.violations.some((v) => v.ordinal === 2), false, "a rank-3 finding was excluded by a rank-3 cut");
  assert.equal(r.examined, 3, "all three joined, so all three were judged");
  assert.equal(r.unjoined, 0);
});

test("#1503 THE CAP — a write-up over the word cap is a violation, and needs no join at all", () => {
  const r = writeUpViolations({ narrativeMd: NARRATIVE, findings: null, maxWords: 270 });
  assert.deepEqual(r.violations.map((v) => v.ordinal), [2]);
  assert.equal(r.violations[0].kind, "over-cap");
  assert.equal(r.violations[0].words, 402);
  // No findings were supplied at all and the cap still applied — that is the point of separating them.
  assert.equal(r.examined, 0);
});

test("#1503 AN UNJOINED BLOCK is counted and NOT flagged for membership — but is still capped", () => {
  // The safe direction. A block whose disposition cannot be read might be perfectly correct, and a redo
  // demand against correct prose is the expensive error. But its LENGTH is still readable.
  const md = NARRATIVE + "\n## Finding 9 — UNKNOWN\n\n**Composite:** 3\n\n" + words(400) + "\n";
  const r = writeUpViolations({ narrativeMd: md, findings: FINDINGS, ...RULES, maxWords: 270 });
  assert.equal(r.unjoined, 1, "the unjoined block was not counted");
  assert.equal(r.total, 4);
  assert.equal(r.examined, 3);
  assert.equal(r.violations.filter((v) => v.kind === "not-kept" && v.ordinal === 9).length, 0,
    "a block with no readable band was flagged for membership anyway");
  assert.equal(r.violations.filter((v) => v.kind === "over-cap" && v.ordinal === 9).length, 1,
    "the cap needs no join and must still have applied");
});

test("#1503 THE COVERAGE COUNT RIDES THE PASSING ROW TOO", () => {
  // A membership rule that examined three of eleven write-ups reads exactly like one that found nothing
  // wrong. This issue has paid three times for a check that could not state its own coverage.
  const clean = ["# N", "", "## Finding 1 — VENARI", "", "**Composite:** 4", "", words(10), ""].join("\n");
  const [row] = narrativeWriteUpChecks({ narrativeMd: clean, findings: FINDINGS, manifest: MANIFEST,
    depth: { narrativeKeptBandRank: 3, narrativeWriteUpWords: 270 } });
  assert.equal(row.pass, true);
  assert.match(row.detail, /1 write-up read/);

  const partial = clean + "\n## Finding 9 — UNKNOWN\n\n**Composite:** 3\n\n" + words(10) + "\n";
  const [prow] = narrativeWriteUpChecks({ narrativeMd: partial, findings: FINDINGS, manifest: MANIFEST,
    depth: { narrativeKeptBandRank: 3, narrativeWriteUpWords: 270 } });
  assert.equal(prow.pass, true, "nothing violated, so this must still be a PASS");
  assert.match(prow.detail, /1 of 2 write-ups joined/, "a partially-judged pass does not say so");
  assert.match(prow.detail, /1 could not be/);
});

test("#1503 a failure lands on the NARRATIVE surface, or it never reaches the redo", () => {
  const rows = narrativeWriteUpChecks({ narrativeMd: NARRATIVE, findings: FINDINGS, manifest: MANIFEST,
    depth: { narrativeKeptBandRank: 3, narrativeWriteUpWords: 270 } }).filter((c) => !c.pass);
  assert.equal(rows.length, 2, "expected the below-cut write-up and the over-cap one");
  for (const r of rows) {
    assert.equal(r.surface, "narrative");
    assert.equal(r.family, "narrative-depth");
  }
  assert.match(rows.find((r) => r.id.includes("not-kept")).detail, /typed record in findings\.json is its `?write-up/);
  assert.match(rows.find((r) => r.id.includes("over-cap")).detail, /never which findings are written about/);
});

test("#1503 THE REDO ROUTE EXISTS — a check with nowhere to route only flags", () => {
  // The call site, read out of the source. Before this, `bySurface("narrative")` had no consumer at all:
  // every narrative check could only ship as a note on a run that broke the rules.
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  assert.match(src, /bySurface\("narrative"\)/, "nothing at the lint seam reads the narrative surface");
  assert.match(src, /redo\("synthesis",\s*narrativeFixable/,
    "the narrative surface has no redo route — its failures can only be flagged, which is the run "
    + "shipping the defect with a note attached");
});

test("#1503 the rank is ORDINAL against the run's own manifest — a five-band framework selects correctly", () => {
  // The reason the key is a rank and not a list of band names. Frameworks carry different vocabularies
  // AND different lengths: one ships five bands, the house default four. A hard-coded name set would
  // select NOTHING on a framework that spells them differently — a cut that silently keeps everything,
  // which reads exactly like a cut that is working.
  const five = { bands: [{ label: "Critical" }, { label: "Severe" }, { label: "Elevated" }, { label: "Watch" }, { label: "Low" }] };
  const findings = { findings: [
    { ordinal: 1, band: "Critical" }, { ordinal: 2, band: "Elevated" }, { ordinal: 3, band: "Watch" },
  ] };
  const md = [1, 2, 3].map((n) => `## Finding ${n} — M${n}\n\n**Composite:** 3\n\nshort prose here\n`).join("\n");
  const r = writeUpViolations({ narrativeMd: md, findings, bandOrder: five.bands, maxBandRank: 3 });
  assert.deepEqual(r.violations.map((v) => v.ordinal), [3], "rank 4 of five bands should be the only violation");
  assert.equal(r.examined, 3);

  // A band the manifest does not list is excluded rather than silently kept — the same direction as no band.
  const alien = writeUpViolations({ narrativeMd: md, findings: { findings: [{ ordinal: 1, band: "Nonesuch" }] },
    bandOrder: five.bands, maxBandRank: 3 });
  assert.equal(alien.violations.length, 1);
  assert.match(writeUpMessage(alien.violations[0]), /not on this run's manifest/);
});

// ── #1503: A GRADED RUN THE CHECK COULD NOT READ IS NOT A COMPLIANT ONE ──────────────────────────────
//
// Measured over 28 preserved runs: where the check can see a narrative it works (16 runs, 1-33
// violations each). On 6 of 22 GRADED runs — 5 of 12 multi-country, 42% — the narrative carries no
// `Finding N — <mark>` headings at all, `narrativeWriteUps()` returns nothing, and the check
// short-circuited to an EMPTY ARRAY: no row, byte-identical to product 4's correct inertness.
//
// Seat variation rather than a cutover: same product, same day, same engine, opposite outcomes.

/** A graded product's depth rung. */
const GRADED = { narrativeKeptBandRank: 3, narrativeWriteUpWords: 270 };
/** Pure prose — real narrative shape, no heading this parser can key to a finding. */
const HEADLESS = "## Overview\n\nThe field is crowded but the applicant's position is defensible.\n\n"
  + "## Commentary\n\nSeveral owners hold adjacent rights; none is presently enforcing.\n";

test("#1503 a GRADED run whose narrative has no keyable write-up says so — it never returns silence", () => {
  // THE DEFECT. Both the ungraded product and the unreadable graded run reported `total: 0`, and the
  // caller could not tell them apart, so 6 of 22 graded runs shipped reading as compliant.
  const rows = narrativeWriteUpChecks({ narrativeMd: HEADLESS, findings: FINDINGS, depth: GRADED, manifest: MANIFEST });
  assert.notDeepEqual(rows, [], "a graded run the check could not read returned no row at all");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pass, false, "an unverified depth rule was reported as a passing one");
  assert.match(rows[0].id, /could-not-read/);
});

test("#1503 the row states the DENOMINATOR it expected and that it recognised nothing", () => {
  // A coverage row that says only "could not read" leaves the reader unable to tell a narrative with
  // no findings to write up from one with eleven the check never saw.
  const [row] = narrativeWriteUpChecks({ narrativeMd: HEADLESS, findings: FINDINGS, depth: GRADED, manifest: MANIFEST });
  assert.match(row.detail, new RegExp(`${FINDINGS.findings.length} finding`),
    "the row does not name how many findings the run holds, which is the denominator it expected");
  assert.match(row.detail, /NO recognisable prose write-up block/);
  assert.match(row.detail, /unenforced/, "and it must say what the consequence is, not merely what it saw");
});

test("#1503 the row is STRUCTURAL — it reports, and never sends a seat to fix an uninstructed rule", () => {
  // THE CALL AT THE MECHANISM, and it rests on reading the directive rather than on taste.
  // `proseRungDirective` tells the seat WHICH findings get a prose write-up and HOW LONG it may be. It
  // never asks for the `Finding N — <mark>` heading this check keys on. So a narrative without one
  // breaks no rule the seat was given, and a warm redo would hand it a correction no directive lets it
  // satisfy — one wasted dispatch per affected run, on 42% of multi-country runs.
  //
  // What is actually wrong is that the depth rules went UNVERIFIED, which is a coverage fact. Making
  // the heading mandatory is the cure for the underlying gap, and that is a directive change, not a
  // lint change — raised rather than taken here.
  const [row] = narrativeWriteUpChecks({ narrativeMd: HEADLESS, findings: FINDINGS, depth: GRADED, manifest: MANIFEST });
  assert.equal(row.structural, true,
    "the row is routed to the warm redo, which would ask the seat to satisfy a rule it was never given");
});

test("#1503 an UNGRADED product still returns silence — the fix must not make product 4 noisy", () => {
  // The direction this must not break. Product 4 authors every card by design; a row there would be a
  // false finding on every one-country run, which is the expensive way to be wrong about this.
  assert.deepEqual(narrativeWriteUpChecks({ narrativeMd: HEADLESS, findings: FINDINGS, depth: {}, manifest: MANIFEST }), [],
    "an ungraded product now emits a coverage row for a rule it does not have");
});

test("#1503 a graded run with NO findings passes — nothing to write up is not a coverage hole", () => {
  const rows = narrativeWriteUpChecks({ narrativeMd: HEADLESS, findings: { findings: [] }, depth: GRADED, manifest: MANIFEST });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pass, true, "a run with no findings was reported as an unreadable narrative");
});

test("#1503 `graded` distinguishes the two zeroes at the source, not by guessing downstream", () => {
  // The caller can only tell the states apart because writeUpViolations now says which it is. Asserted
  // here so the field cannot be dropped as unused: its whole job is to carry a distinction that the
  // count it rides beside destroys.
  const ungraded = writeUpViolations({ narrativeMd: HEADLESS, findings: FINDINGS });
  const graded = writeUpViolations({ narrativeMd: HEADLESS, findings: FINDINGS, ...RULES });
  assert.equal(ungraded.total, 0);
  assert.equal(graded.total, 0, "the fixture is not producing the two-zeroes case this exists for");
  assert.equal(ungraded.graded, false);
  assert.equal(graded.graded, true, "the two states are indistinguishable again");
  assert.equal(graded.findingsTotal, FINDINGS.findings.length);
});
