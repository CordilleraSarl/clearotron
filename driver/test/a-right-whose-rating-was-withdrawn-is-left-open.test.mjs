// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RIGHT WHOSE RATING WAS WITHDRAWN IS LEFT OPEN, NOT LOST. The review withdrew a finding whose right still stood,
// because its goods wording could not be used, and `withdrawn` took that right off the page with the findings the
// review rejected. `rating_withdrawn_ground` now tells the two apart, and each right that stands unrated becomes one
// Left open row. Every name below is invented, and so is the sentence the arms plant: the approved one is the owner's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";

const { parseFindingsJson, RATING_WITHDRAWN_GROUNDS } = await import("../findings-model.mjs");
const { withdrawnRatingRows, injectWithdrawnRatingCoverage, WITHDRAWN_RATING_NOTES } = await import("../withdrawn-rating.mjs");

const GROUND = "goods-wording-unavailable";
const PLANTED = { [GROUND]: "A planted sentence for this test." };
const meters = {
  mark_similarity: { token: "high", basis: "verified-from-record", source: "/mark/xx/1" },
  goods_proximity: { token: "medium", basis: "inferred-from-signal", source: "" },
  use: { token: "unknown", basis: "inferred-from-signal", source: "" },
  enforcer: { token: "unknown", basis: "inferred-from-signal", source: "" },
};
const finding = (over) => ({ ordinal: 7, mark: "VELMORA", owner: { name: "Quillstone Ltd", registrations: [{ uri: "/mark/eu/1", jurisdiction: "EU" }, { uri: "/mark/gb/2", jurisdiction: "GB" }] },
  net: "An open goods question.", disposition: "withdrawn", withdrawn_reason: "the goods wording could not be used",
  meters, source: { source_type: "register-vendor", resolved_link: "" }, quadrant: { x: 0.5, y: 1 }, ...over });
// A rated finding, so the arm that refuses the ground on it reaches that check.
const LIVE = { disposition: "adversarial", withdrawn_reason: undefined, band: "Medium", legal_position: "A legal read.", practical_position: "A practical read." };
const doc = (findings, v = 7) => ({ schema_version: v, rated_under_framework: "generic", findings, coverage: [] });
const parse = (d) => parseFindingsJson(JSON.stringify(d));

test("the ground is one closed value, valid only on a withdrawn finding of the current record", () => {
  assert.deepEqual(RATING_WITHDRAWN_GROUNDS, [GROUND]);
  assert.equal(parse(doc([finding({ rating_withdrawn_ground: GROUND })])).findings.length, 1);
  assert.equal(parse(doc([finding({})])).findings.length, 1, "a rejected finding, with no ground, parses as before");
  assert.throws(() => parse(doc([finding({ rating_withdrawn_ground: "some-other-reason" })])), /^Error: finding_rating_withdrawn_ground_invalid:/);
  assert.throws(() => parse(doc([finding({ ...LIVE, rating_withdrawn_ground: GROUND })])),
    /finding_rating_withdrawn_ground_orphan:7/);
  // A stored record of an earlier version never carries the field, and is not read as though it could.
  assert.throws(() => parse(doc([finding({ rating_withdrawn_ground: GROUND })], 6)), /finding_key_unknown:rating_withdrawn_ground/);
});

test("each right that stands unrated owes one Left open row naming it; a rejected finding and a live one owe none", () => {
  const d = doc([
    finding({ ordinal: 9, mark: "ORVANE", owner: { name: "Brightfold GmbH" }, rating_withdrawn_ground: GROUND }),
    finding({ ordinal: 7, rating_withdrawn_ground: GROUND }),
    finding({ ordinal: 8, mark: "TESSALINE" }),
    finding({ ordinal: 10, mark: "KORVID", ...LIVE }),
  ]);
  assert.deepEqual(withdrawnRatingRows(d, PLANTED), [
    { area: "VELMORA — Quillstone Ltd (EU, GB)", state: "open", note: PLANTED[GROUND] },
    { area: "ORVANE — Brightfold GmbH", state: "open", note: PLANTED[GROUND] },
  ]);
});

test("the row carries the owner's sentence word for word, and every ground has one", () => {
  // Approved 2026-11-19: printed under "Left open", after the right's identifying detail.
  assert.equal(WITHDRAWN_RATING_NOTES[GROUND], "We could not rate this earlier right because we could not verify which goods its record covers.");
  for (const g of RATING_WITHDRAWN_GROUNDS) assert.equal(typeof WITHDRAWN_RATING_NOTES[g], "string", `the ground ${g} has no sentence`);
  assert.deepEqual(withdrawnRatingRows(doc([finding({ rating_withdrawn_ground: GROUND }), finding({ ordinal: 8, mark: "TESSALINE" })])),
    [{ area: "VELMORA — Quillstone Ltd (EU, GB)", state: "open", note: WITHDRAWN_RATING_NOTES[GROUND] }],
    "with the approved sentence, the marked right gets its row and the rejected finding none");
});

test("the run writes the row into its findings record once, and the finding stays withdrawn", () => {
  const dir = mkdtempSync(join(tmpdir(), "withdrawn-rating-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    const P = { findings: join(dir, "findings.json") };
    writeFileSync(P.findings, JSON.stringify(doc([finding({ rating_withdrawn_ground: GROUND })]), null, 2));
    const notes = [];
    injectWithdrawnRatingCoverage(P, dir, (n) => notes.push(n), { notes: PLANTED });
    injectWithdrawnRatingCoverage(P, dir, (n) => notes.push(n), { notes: PLANTED });   // a second pass, as after a rewrite
    const after = parse(JSON.parse(readFileSync(P.findings, "utf8")));
    assert.deepEqual(after.coverage.map((c) => [c.area, c.state]), [["VELMORA — Quillstone Ltd (EU, GB)", "open"]]);
    assert.equal(after.findings[0].disposition, "withdrawn", "the row does not bring the finding back to a card or a total");
    assert.equal(notes.length, 1, "the second pass found the row and wrote nothing");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a findings record that will not read is recorded for the audit, and the run goes on", () => {
  const dir = mkdtempSync(join(tmpdir(), "withdrawn-rating-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    const P = { findings: join(dir, "findings.json") };
    writeFileSync(P.findings, "{ torn");
    assert.doesNotThrow(() => injectWithdrawnRatingCoverage(P, dir, () => {}, { notes: PLANTED }));
    const rows = readFileSync(driverDir(dir, "run.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(rows.some((r) => r.event === "coverage-row-not-added" && r.adder === "withdrawn-rating"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
