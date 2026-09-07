// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Arms on the knockout chunk validator that this repository did not previously carry a file for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validators } from "../verify-knockout.mjs";

// ── RF-15 v3: the register estimate is owed where the register did NOT run ─────
//
// Calibration rule 4 ordered a pending-register caveat unconditionally and this arm enforced its field
// the same way. Both moved together, and they had to: retiring the rule without this line breaks the
// lane outright — the seat stops emitting `registerEstimate` because its doctrine no longer orders it,
// and an unconditional arm then refuses every chunk.
//
// All four combinations are driven because the interesting half is what must NOT refuse. Written after
// the first probe of this arm accepted all four: the ladder is read from `_driver/framework.json`, not
// from the chunk, and without that sidecar the arm never runs at all. A control that cannot run is not
// a control, and the tell was the expected refusal simply not appearing.
test("RF-15 v3 — the register estimate is required only where the run fetched no register records", () => {
  const FW = { framework_key: "triage", bands: [{ label: "High" }, { label: "Medium" }, { label: "Low" }] };
  const mkRun = (withRecords) => {
    const d = mkdtempSync(join(tmpdir(), "ko-rf15-"));
    mkdirSync(join(d, "_driver"), { recursive: true });
    mkdirSync(join(d, "research"), { recursive: true });
    writeFileSync(join(d, "research", "frozen.md"), "# research payload for FROZEN\n\nSome findings.\n");
    writeFileSync(join(d, "_driver", "framework.json"), JSON.stringify(FW));
    if (withRecords) writeFileSync(join(d, "_driver", "register-records.json"), "{}");
    return join(d, "knockout-assess-0.json");
  };
  const mark = {
    name: "FROZEN", rating: "High", classesDriving: [9], basis: "The name is close to a known property.",
    factors: ["A first load-bearing observation.", "A second load-bearing observation."],
    counterFactors: ["What holds it at this band."], mitigation: "",
    bullets: ["One honest evidence bullet."], findings: [], purpleNotes: [],
  };
  const chunk = (extra) => JSON.stringify({
    framework: FW, batch: { productContext: "x", standardCaveats: [] },
    marks: [{ ...mark, ...extra }], chunkSummary: "A measured sentence about this chunk of marks.",
  });
  const ESTIMATE = "Register search pending — moderate volume of filings expected.";

  // The one refusal: no records on disk, so estimation is still the honest answer and it is owed.
  const owed = validators.knockoutAssessChunk(mkRun(false), chunk({}));
  assert.equal(owed.ok, false);
  assert.match(owed.reason, /registerEstimate is required above the lowest band on a run with no fetched register records/);

  // …and the three that must NOT refuse.
  assert.equal(validators.knockoutAssessChunk(mkRun(false), chunk({ registerEstimate: ESTIMATE })).ok, true,
    "an estimate on a run with no records is exactly what RF-15 still asks for");
  assert.equal(validators.knockoutAssessChunk(mkRun(true), chunk({})).ok, true,
    "THE POINT OF THE CHANGE: the run holds fetched filings, so estimation became confirmation and a "
    + "guess printed beside the filings it guesses about is no longer demanded");
  assert.equal(validators.knockoutAssessChunk(mkRun(true), chunk({ registerEstimate: ESTIMATE })).ok, true,
    "…and an estimate that arrives anyway is not forbidden, only no longer required");
});

// ── the band on a register read is optional, and closed when present (tracker issue 274) ─────────────
//
// The read half of `registerReads` shipped without a band, so a promoted register card was the only card
// on the page that could carry no rating. The band closes that, and it is validated HERE rather than
// coerced in the renderer for the reason the issue rules: the renderer inferring a band would be a rating
// nobody performed. Two properties, and the optional one is the one that protects delivery — a run whose
// rater sends no band must publish exactly as it always did.
test("274 — registerReads[].band: optional, and refused when it is not a ladder word", () => {
  const FW = { framework_key: "triage", bands: [{ label: "High" }, { label: "Medium" }, { label: "Low" }] };
  const RECORD_ID = "R-LUMENREED";
  const d = mkdtempSync(join(tmpdir(), "ko-readband-"));
  mkdirSync(join(d, "_driver"), { recursive: true });
  mkdirSync(join(d, "research"), { recursive: true });
  writeFileSync(join(d, "research", "frozen.md"), "# research payload for FROZEN\n\nSome findings.\n");
  writeFileSync(join(d, "_driver", "framework.json"), JSON.stringify(FW));
  writeFileSync(join(d, "_driver", "register-records.json"), JSON.stringify({
    marks: [{ name: "FROZEN", records: [{ recordId: RECORD_ID, mark: "FROZEN", owner: "Lumenreed GmbH" }] }],
  }));
  const file = join(d, "knockout-assess-0.json");
  const mark = {
    name: "FROZEN", rating: "High", classesDriving: [9], basis: "The name is close to a known property.",
    factors: ["A first load-bearing observation.", "A second load-bearing observation."],
    counterFactors: ["What holds it at this band."], mitigation: "",
    bullets: ["One honest evidence bullet."], findings: [], purpleNotes: [],
    registerEstimate: "Register search pending — moderate volume of filings expected.",
  };
  const chunk = (reads) => JSON.stringify({
    framework: FW, batch: { productContext: "x", standardCaveats: [] },
    marks: [{ ...mark, registerReads: reads }], chunkSummary: "A measured sentence about this chunk of marks.",
  });
  const read = "The owner's filings sit in optical goods.";

  assert.equal(validators.knockoutAssessChunk(file, chunk([{ recordId: RECORD_ID, read }])).ok, true,
    "ABSENCE IS NEVER REFUSED: a read with no band is what every run before this one sent, and it still validates");
  assert.equal(validators.knockoutAssessChunk(file, chunk([{ recordId: RECORD_ID, read, band: "Medium" }])).ok, true,
    "a ladder word is accepted");
  assert.equal(validators.knockoutAssessChunk(file, chunk([{ recordId: RECORD_ID, read, band: "medium" }])).ok, true,
    "…case-insensitively, the same tolerance the mark's own rating gets");

  const bad = validators.knockoutAssessChunk(file, chunk([{ recordId: RECORD_ID, read, band: "Catastrophic" }]));
  assert.equal(bad.ok, false, "a word outside the frozen ladder is refused rather than printed as a chip");
  assert.match(bad.reason, /knockout_band_unknown/, "tokenised for the corrective ladder, like the mark's rating");
  assert.ok(bad.reason.includes("Catastrophic"), "and the message names the word the turn sent");
});
