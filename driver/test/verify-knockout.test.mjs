// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Arms on the knockout chunk validator that this repository did not previously carry a file for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
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
    writeFileSync(join(d, "research", "testmark.md"), "# research payload for TESTMARK\n\nSome findings.\n");
    writeFileSync(join(d, "_driver", "framework.json"), JSON.stringify(FW));
    if (withRecords) writeFileSync(join(d, "_driver", "register-records.json"), "{}");
    return join(d, "knockout-assess-0.json");
  };
  const mark = {
    name: "TESTMARK", rating: "High", classesDriving: [9], basis: "The name is close to a known property.",
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

// ── the band on a register read is optional, and closed when present ─────────────────────────────────
//
// The read half of `registerReads` shipped without a band, so a promoted register card was the only card
// on the page that could carry no rating. The band closes that, and it is validated HERE rather than
// coerced in the renderer for the reason the issue rules: the renderer inferring a band would be a rating
// nobody performed. Two properties, and the optional one is the one that protects delivery — a run whose
// rater sends no band must publish exactly as it always did.
test("registerReads[].band: optional, and refused when it is not a ladder word", () => {
  const FW = { framework_key: "triage", bands: [{ label: "High" }, { label: "Medium" }, { label: "Low" }] };
  const RECORD_ID = "R-LUMENREED";
  const d = mkdtempSync(join(tmpdir(), "ko-readband-"));
  mkdirSync(join(d, "_driver"), { recursive: true });
  mkdirSync(join(d, "research"), { recursive: true });
  writeFileSync(join(d, "research", "testmark.md"), "# research payload for TESTMARK\n\nSome findings.\n");
  writeFileSync(join(d, "_driver", "framework.json"), JSON.stringify(FW));
  writeFileSync(join(d, "_driver", "register-records.json"), JSON.stringify({
    marks: [{ name: "TESTMARK", records: [{ recordId: RECORD_ID, mark: "TESTMARK", owner: "Lumenreed GmbH" }] }],
  }));
  const file = join(d, "knockout-assess-0.json");
  const mark = {
    name: "TESTMARK", rating: "High", classesDriving: [9], basis: "The name is close to a known property.",
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

// ── what the search returned and the rating did not carry, each with its ground ──────────────────────
//
// Ruled 2026-09-26: nothing found leaves the knockout's record without a reason. Before it, a result the
// rater judged irrelevant and a result it never opened were indistinguishable afterwards — the accepted
// record had no field either could land in. `setAside` is that field, and it is shaped like
// `registerReads` above deliberately: OPTIONAL, because a required one turns a rater's omission into a
// refusal and a repair turn, and the rating is written before this record is.
//
// The two properties that matter are opposite: absence must never refuse, and a row that says nothing
// must. A set-aside with no ground is not a decision, so an empty one is refused by name rather than
// stored as though a reason had been given.
test("setAside: optional, and a row without a ground or a url is refused by name", () => {
  const FW = { framework_key: "triage", bands: [{ label: "High" }, { label: "Medium" }, { label: "Low" }] };
  const d = mkdtempSync(join(tmpdir(), "ko-setaside-"));
  mkdirSync(join(d, "_driver"), { recursive: true });
  mkdirSync(join(d, "research"), { recursive: true });
  writeFileSync(join(d, "research", "testmark.md"), "# research payload for TESTMARK\n\nSome findings.\n");
  writeFileSync(join(d, "_driver", "framework.json"), JSON.stringify(FW));
  writeFileSync(join(d, "_driver", "register-records.json"), "{}");
  const file = join(d, "knockout-assess-0.json");
  const mark = {
    name: "TESTMARK", rating: "High", classesDriving: [9], basis: "The name is close to a known property.",
    factors: ["A first load-bearing observation.", "A second load-bearing observation."],
    counterFactors: ["What holds it at this band."], mitigation: "",
    bullets: ["One honest evidence bullet."], findings: [], purpleNotes: [],
  };
  const chunk = (setAside) => JSON.stringify({
    framework: FW, batch: { productContext: "x", standardCaveats: [] },
    marks: [{ ...mark, ...(setAside === undefined ? {} : { setAside }) }],
    chunkSummary: "A measured sentence about this chunk of marks.",
  });
  const GROUND = "A fan page for an unrelated board game; no trade use of the name.";
  const URL = "https://example.test/a-page";

  // ABSENCE IS NEVER REFUSED, in all three of its forms: the field omitted, explicitly null, or empty.
  // A run whose rater sends none publishes exactly as every run before this one did.
  for (const none of [undefined, null, []])
    assert.equal(validators.knockoutAssessChunk(file, chunk(none)).ok, true, JSON.stringify(none));
  assert.equal(validators.knockoutAssessChunk(file, chunk([{ url: URL, ground: GROUND }])).ok, true, "a row with both is accepted");
  assert.equal(validators.knockoutAssessChunk(file, chunk([{ url: URL, ground: GROUND }, { url: "https://example.test/b", ground: "The same store listing under another path." }])).ok, true,
    "many rows are accepted: the rater decides how much it read and put down");

  const noGround = validators.knockoutAssessChunk(file, chunk([{ url: URL, ground: "  " }]));
  assert.equal(noGround.ok, false, "a set-aside with no ground is not a decision");
  // THE WHOLE SENTENCE, not a substring of it. The rater reads this string and repairs from it, so the
  // arm pins what it says as well as which row it names. It was written as `.includes(URL)` first, which
  // the security scan reads — rightly, as a pattern — as a URL checked by substring; an exact sentence
  // asserts more and cannot be mistaken for a host test.
  assert.equal(noGround.reason,
    `mark "TESTMARK": setAside row "${URL}" has an empty ground. Omit the row rather than sending an empty one: a set-aside with no reason is not a decision`);

  const noUrl = validators.knockoutAssessChunk(file, chunk([{ ground: GROUND }]));
  assert.equal(noUrl.ok, false);
  assert.match(noUrl.reason, /a setAside row has no url/);

  const notAnArray = validators.knockoutAssessChunk(file, chunk("a sentence about what I put down"));
  assert.equal(notAnArray.ok, false, "prose in place of rows would read as a record and hold nothing joinable");
  assert.match(notAnArray.reason, /setAside must be an ARRAY of \{ url, ground \} rows, or omitted entirely/);
});

test("the rater's transport declares setAside, so the field the manual asks for is not folklore", async () => {
  const { refuseUndeclared } = await import("../knockout-assess-record.mjs");
  const mark = { name: "TESTMARK", setAside: [{ url: "https://example.test/a", ground: "A fan page, no trade use." }] };
  assert.equal(refuseUndeclared({ marks: [mark] }), null, "setAside is declared on the mark");
  // AND ITS ROW IS CLOSED, so a third key cannot arrive and be silently dropped on the way to the report.
  assert.match(String(refuseUndeclared({ marks: [{ name: "TESTMARK", setAside: [{ url: "https://example.test/a", ground: "x", band: "High" }] }] })),
    /band/, "a key the set-aside row does not declare is refused by name");
});

// ── AND IT REACHES DISK, which the two arms above do not prove between them ──────────────────────────
//
// The arms above check the validator and the allowlist; the workbook is checked where it is built. None
// of that proves the field SURVIVES the transport, and this repository has the scar: on 2026-09-20 a
// compiler arm and a connector arm were both green and nothing reached the wire. So this drives the
// recording transport for real and reads the field back off the file the merge step later concatenates.
test("a set-aside survives the recording transport and is on disk in the chunk the merge reads", async () => {
  const { recordKnockoutAssess } = await import("../knockout-assess-record.mjs");
  const FW = { framework_key: "triage", bands: [{ label: "High" }, { label: "Medium" }, { label: "Low" }] };
  const run = mkdtempSync(join(tmpdir(), "ko-setaside-wire-"));
  mkdirSync(join(run, "_driver"), { recursive: true });
  mkdirSync(join(run, "research"), { recursive: true });
  writeFileSync(join(run, "research", "nearfield.md"), "# research payload for NEARFIELD\n\nSome findings.\n");
  writeFileSync(join(run, "_driver", "framework.json"), JSON.stringify(FW));

  const GROUND = "A fan page for an unrelated board game; no trade use of the name.";
  const call = {
    schema_version: 1,
    framework: { source: "risk-framework-triage.md", ladder: ["High", "Medium", "Low"] },
    batch: { productContext: "A one-name knockout batch.", standardCaveats: "Triage only; not a clearance opinion." },
    chunkSummary: "NEARFIELD screens at Medium on this sweep. A full search is still owed before use.",
    marks: [{
      ref: "m1", name: "NEARFIELD", classesSearched: [9], contextFraming: "a game character",
      rating: "Medium", ratingQualifier: null, classesDriving: [9],
      bullets: ["One app-store listing uses a near spelling."],
      basis: "A near spelling is in use on one store in the instructed class.",
      factors: ["A near spelling is live", "The store is in the client's own channel"],
      counterFactors: ["The use is small and unregistered"],
      mitigation: "",
      findings: [], negatives: [],
      setAside: [{ url: "https://example.test/fan-page", ground: GROUND }],
    }],
  };
  const written = recordKnockoutAssess(run, call, { boundOrdinal: 0 });
  assert.equal(written.refused, null, `the transport refused the call: ${written.refused}`);
  assert.ok(written.written, "nothing was written");

  const onDisk = JSON.parse(readFileSync(written.written, "utf8"));
  assert.deepEqual(onDisk.marks[0].setAside, [{ url: "https://example.test/fan-page", ground: GROUND }],
    "the set-aside is not in the chunk file the merge step concatenates, so nothing would reach the workbook");

  // AND A SECOND CALL THAT OMITS IT KEEPS IT. This transport merges by mark name onto what it already
  // accepted, so silence about a key must be silence and not an instruction to clear it — the property
  // `registerReads` and `negatives` are already held to, checked here against the same shape.
  //
  // THE KEY IS DELETED RATHER THAN SET TO `undefined`, and the difference is the whole arm: a spread
  // carrying `setAside: undefined` PRESENTS the key, which is a turn saying something about it, and the
  // merge rightly takes it. Written the other way first, this arm reported the field deleted and the
  // transport sound — a defect found in the instrument, not the product.
  const repaired = { ...call.marks[0] };
  delete repaired.setAside;
  const again = recordKnockoutAssess(run, { chunkSummary: call.chunkSummary, marks: [repaired] }, { boundOrdinal: 0 });
  assert.equal(again.refused, null, `the repair turn was refused: ${again.refused}`);
  assert.deepEqual(JSON.parse(readFileSync(again.written, "utf8")).marks[0].setAside,
    [{ url: "https://example.test/fan-page", ground: GROUND }], "a repair turn that omitted the field deleted it");
});
