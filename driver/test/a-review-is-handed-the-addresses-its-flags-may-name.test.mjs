// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REVIEW IS HANDED THE ADDRESSES ITS FLAGS MAY NAME.
//
// A flag names the findings it is about by ordinal, and nothing checked the ordinal named a finding the review was
// handed; the report's other parts had no address, so a correction bound a flag to them by matching its prose. The
// address list names every finding by ordinal, across the records before and after a correction, and every coverage
// line, action, mark assessment read and narrative section by the key a correction already uses. A key two rows of
// one record share is never offered. What a flag declares resolves against the list, or the first thing that does not
// is returned, with the listed address it differs from only in spacing or case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDeclared, reviewAddresses } from "../review-addresses.mjs";

const BEFORE = {
  findings: [{ ordinal: 1 }, { ordinal: 2 }, { ordinal: 3 }],
  coverage: [{ area: "European Union", note: "searched" }, { area: "United Kingdom", note: "" }],
  actions: [{ id: "watch", text: "Watch the register." }],
  mark_assessment: { distinctiveness: "Inherently distinctive.", connotation: "" },
};
const AFTER = { findings: [{ ordinal: 1 }, { ordinal: 3 }, { ordinal: 4 }], coverage: BEFORE.coverage, actions: BEFORE.actions,
  markAssessment: BEFORE.mark_assessment };
const NARRATIVE = { verdict: "Proceed with care.", coverage: { read: "" }, spine: "The spine.", calibration: "", ask_answers: [] };

test("findings are addressed by ordinal across the record before and after a correction", () => {
  const list = reviewAddresses({ records: [BEFORE, AFTER] });
  assert.deepEqual(list.ordinals, [1, 2, 3, 4], "a finding the correction removed, or added, must stay nameable");
  assert.equal(list.schema, 1);
});

test("each other part is addressed by the key a correction already gives it, and only parts with content", () => {
  const list = reviewAddresses({ records: [BEFORE, AFTER], narratives: [NARRATIVE] });
  assert.deepEqual(list.lines, [
    { address: "coverage:european union", label: 'the coverage line for "European Union"' },
    { address: "coverage:united kingdom", label: 'the coverage line for "United Kingdom"' },
    { address: "action:watch", label: 'the action "watch"' },
    { address: "mark-assessment:distinctiveness", label: "the mark assessment's distinctiveness" },
    { address: "section:verdict", label: "the narrative's verdict section" },
    { address: "section:spine", label: "the narrative's spine section" },
  ], "an empty mark assessment read or narrative section has nothing for a flag to be about");
});

test("a key two rows of one record share is not offered, and a row with no area or id is not addressed", () => {
  const doc = { findings: [], coverage: [{ area: "Japan" }, { area: "japan." }, { area: "" }], actions: [{ text: "No id." }] };
  const list = reviewAddresses({ records: [doc] });
  assert.deepEqual(list.lines, [], "two rows that one address would name, and rows with no identity, are left out");
  const sameRowTwice = reviewAddresses({ records: [{ coverage: [{ area: "Japan" }] }, { coverage: [{ area: "Japan" }] }] });
  assert.deepEqual(sameRowTwice.lines.map((l) => l.address), ["coverage:japan"], "the same row before and after is one part");
});

test("what a flag declares resolves against the list, or the first thing that does not is named", () => {
  const list = reviewAddresses({ records: [BEFORE, AFTER], narratives: [NARRATIVE] });
  assert.deepEqual(resolveDeclared(list, { on: [2, 4], lines: ["coverage:european union", "section:verdict"] }), { ok: true });
  assert.deepEqual(resolveDeclared(list, {}), { ok: true }, "a flag about the document as a whole declares nothing");
  assert.deepEqual(resolveDeclared(list, { on: [1, 9] }), { ok: false, kind: "ordinal", value: 9 });
  assert.deepEqual(resolveDeclared(list, { lines: "coverage:european union" }), { ok: false, kind: "lines-shape" });
  assert.deepEqual(resolveDeclared(list, { lines: [7] }), { ok: false, kind: "lines-shape" });
  assert.deepEqual(resolveDeclared(list, { lines: ["Coverage:European  Union"] }),
    { ok: false, kind: "line", value: "Coverage:European  Union", near: "coverage:european union" });
  assert.deepEqual(resolveDeclared(list, { lines: ["section:calibration"] }),
    { ok: false, kind: "line", value: "section:calibration", near: null }, "an empty section was not handed to the review");
});

// ── what the review's recording tool does with them ──────────────────────────────────────────────────
const { acceptRefutation, recordRefutation, listedAddresses } = await import("../narrative-refutation-record.mjs");
const { parseCorrections } = await import("../verify.mjs");
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { driverDir } = await import("../../shared/driver-dir.mjs");

const LIST = reviewAddresses({ records: [BEFORE, AFTER], narratives: [NARRATIVE] });
const flag = (extra) => ({ kind: "fact", text: "The coverage line for the European Union overstates what was searched.", ...extra });
const accept = (flags, addresses = LIST) => acceptRefutation({ verdict: "CONDITIONAL", flags }, { addresses });

test("a flag's declared parts render on its line and read back off it, without the token in its text", () => {
  const r = accept([flag({ on: [2], lines: ["coverage:european union", "section:verdict"] })]);
  assert.equal(r.ok, true, r.reason);
  assert.match(r.content, /^1\. \[kind: fact\] \[on: 2\] \[lines: coverage:european union, section:verdict\] The coverage line/m);
  const [row] = parseCorrections(r.content);
  assert.deepEqual(row.lines, ["coverage:european union", "section:verdict"]);
  assert.deepEqual(row.ordinals, [2]);
  assert.doesNotMatch(row.text, /\[lines:/, "the token is the channel, not the instruction");
  assert.deepEqual(accept([flag({})]).ok, true, "a flag that declares nothing is unchanged");
  assert.doesNotMatch(accept([flag({})]).content, /\[lines:/);
});

test("an ordinal or address the review was not handed is refused in its turn, with the near address when there is one", () => {
  assert.match(accept([flag({ on: [9] })]).reason, /^refutation_flag_on_unknown:0:9 — finding 9 is not among the findings this review was handed/);
  assert.match(accept([flag({ lines: "coverage:european union" })]).reason, /^refutation_flag_lines_invalid:0 /);
  assert.match(accept([flag({ lines: [] })]).reason, /^refutation_flag_lines_invalid:0 /);
  assert.match(accept([flag({ lines: ["Coverage:European Union"] })]).reason,
    /^refutation_flag_line_unlisted:0:Coverage:European Union — .*; the list gives "coverage:european union"$/);
  assert.doesNotMatch(accept([flag({ lines: ["section:calibration"] })]).reason, /the list gives/);
});

test("with no address list written, `on` is checked as before and no address can resolve", () => {
  assert.equal(accept([flag({ on: [9] })], null).ok, true, "a dispatch that wrote no list keeps today's check");
  assert.match(accept([flag({ lines: ["section:verdict"] })], null).reason, /^refutation_flag_line_unlisted:0:section:verdict/);
});

test("the recording tool reads the list the dispatch wrote into the run", () => {
  const runDir = mkdtempSync(join(tmpdir(), "review-addresses-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  assert.equal(listedAddresses(runDir), null);
  writeFileSync(driverDir(runDir, "review-addresses.json"), JSON.stringify(LIST));
  assert.deepEqual(listedAddresses(runDir).ordinals, [1, 2, 3, 4]);
  const refused = recordRefutation(runDir, { verdict: "CONDITIONAL", flags: [flag({ on: [7] })] });
  assert.match(refused.refused ?? "", /^refutation_flag_on_unknown:0:7/);
  const written = recordRefutation(runDir, { verdict: "CONDITIONAL", flags: [flag({ lines: ["action:watch"] })] });
  assert.equal(written.refused, null);
  assert.match(readFileSync(written.written, "utf8"), /\[lines: action:watch\]/);
});
