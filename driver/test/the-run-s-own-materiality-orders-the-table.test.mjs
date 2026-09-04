// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real knockout renderer and the real recording-tool schema
//
// — THE FILING THE RUN CALLS MATERIAL IS MISSING FROM "MOST MATERIAL FIRST".
//
// MEASURED on a delivered knockout. The rater named a franchise owner's registration in the client's
// own territory, in the classes being cleared, as supporting the material conflict. The client-facing
// report contained neither the record id, nor its territory, nor the owner string. The reader was shown
// that conflict as REPUTATION ONLY, while the paper right sat below the fold of a table whose caption
// says "most material first" — and the lawyer's whole rating rested on the registered right.
//
// TWO CAUSES, AND NEITHER IS THE RATER MISJUDGING. The run's assessment was right.
//
//   1. The rater is told two contradictory things. `registerReads` is instructed in the dispatch,
//      allowed by the recorder, validated against the run's own store, rendered on the card — and was
//      never declared in the tool schema, whose mark object is `additionalProperties: false`. A seat
//      that trusts the prose sends it and it lands (measured: a 2026-09-01 run's accepted call carries
//      one). A seat that trusts the schema omits it and its read falls into `purpleNotes`, which is
//      stripped on export. Same code, two runs, two answers.
//
//   2. The ranking cannot see materiality. It sorted on live-before-dead, in-class-before-out, and
//      name-before-close-variation — three mechanical keys, none of which can see which filing THIS RUN
//      weighed and concluded bears on the rating.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { renderKnockoutHtml, rankByMateriality } from "../publish/render-knockout.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// THE FRAMEWORK IS INLINE, not read from `fixtures/`. `cut-ships` refuses a test file that constructs a
// path into the withheld fixtures: on the exported tree that path does not exist, the file throws before
// a single case registers, and its tests VANISH from the count rather than fail. This arm is about what
// a CLIENT sees in a delivered report, so it is exactly the one that must survive the cut — naming it in
// EXCLUDE would satisfy the guard by removing the coverage.
const FRAMEWORK = {
  "schema_version": 1,
  "framework_key": "aurora",
  "title": "Aurora Interactive ACP risk framework",
  "source_deck": "ACP Risk Assessment Framework \u2014 Outside Counsel (September 2022). Interim encoding: the firm's CELA transposition, re-voiced to band words; tighten against the ACP deck of record as follow-up.",
  "entity_label": "Aurora Interactive",
  "bands": [
    {
      "label": "Very High",
      "tone": "severe"
    },
    {
      "label": "High",
      "tone": "high"
    },
    {
      "label": "Medium",
      "tone": "medium"
    },
    {
      "label": "Manageable",
      "tone": "low"
    },
    {
      "label": "Low",
      "tone": "minimal"
    }
  ],
  "structure": {
    "kind": "matrix",
    "axes": [
      "Legal Risk Level (A\u2013E)",
      "Dispute Type"
    ],
    "display_note": "The band is read off this framework's Level \u00d7 Dispute Type matrix; the matrix ceilings are stated in the deck and honoured as written."
  }
};

const MARK = "IRONWHISK";
const APPENDIX_CAP = 8;

const rec = (owner, { status = "Valid", classes = [9], basis = "identical" } = {}) => ({
  recordId: `R-${owner}`, mark: MARK, owner, status, classes, territory: "US",
  matchedForm: MARK, matchedBasis: basis, url: null, provider: "fixture",
});

// THE WEIGHED FILING IS THE WORST POSSIBLE ROW ON EVERY MECHANICAL KEY — dead, out of the searched
// classes, and found as a close variation. That is deliberate: if it still reaches the shown rows, it
// got there on the rater's judgement and on nothing else. A weighed row that also happened to be live
// and in-class would rank top under the OLD code too, and would prove nothing.
const WEIGHED = rec("THE-WEIGHED-ONE", { status: "Expired", classes: [3], basis: "close" });
// Nine live, in-class, exact-name rows — each of which outranks the weighed one on every key.
const NOISE = Array.from({ length: 9 }, (_, i) => rec(`noise-${i}`));
const RECORDS = [...NOISE, WEIGHED];

const sidecar = (records) => ({
  provider: "fixture", providerLabel: "the fixture register",
  marks: [{ name: MARK, classes: [9, 41], records, available: records.length }],
});

const markWith = (extra) => ({
  schema_version: 1,
  batch: { executiveSummary: "A summary.", standardCaveats: [] },
  marks: [{ name: MARK, rating: "High", classesSearched: [9, 41], classesDriving: [9],
    findings: [], bullets: ["b"], ...extra }],
});

const render = (records, extra = {}) => renderKnockoutHtml(markWith(extra), FRAMEWORK, {
  runId: "tmp2121-fixture", overall: "High", registerRecords: sidecar(records),
});

const appendixOwners = (html) => {
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
  return [...body.matchAll(/<tr>[\s\S]*?<\/tr>/g)]
    .map((row) => [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].trim()))
    .map((cells) => cells[1] ?? "");
};

// ── half 2: the run's own weighing reaches the order ─────────────────────────────────────────────────

test("2121 THE DEFECT: a filing the rater WEIGHED leads the table, though it loses every mechanical key", () => {
  const html = render(RECORDS, { registerReads: [{ recordId: "R-THE-WEIGHED-ONE", read: "It bears on the rating." }] });
  const owners = appendixOwners(html);
  assert.equal(owners.length, APPENDIX_CAP, `the cap should still bite: ${owners.join(", ")}`);
  assert.equal(owners[0], "THE-WEIGHED-ONE",
    `the filing this run weighed must lead a table captioned "most material first", got: ${owners.join(", ")}`);
});

test("2121 a finding's weighedFilings promotes too — a reader does not care which field carried it", () => {
  const html = render(RECORDS, {
    findings: [{ ordinal: 1, name: "SOMEONE", weighedFilings: ["R-THE-WEIGHED-ONE"] }],
  });
  assert.equal(appendixOwners(html)[0], "THE-WEIGHED-ONE",
    "a filing a FINDING's reasoning rests on is weighed just as much as one carrying a standalone read");
});

test("2121 THE CONTROL: with nothing weighed, the mechanical order is exactly what it was", () => {
  // The arm that says this fix did not scramble every existing report. Without a weighing, the worst
  // row on every key must still sort last, as it always did.
  const owners = appendixOwners(render(RECORDS));
  assert.equal(owners[0], "noise-0", `unweighed, arrival order among equals still governs: ${owners.join(", ")}`);
  assert.ok(!owners.includes("THE-WEIGHED-ONE"),
    "dead, out-of-class and a close variation — with no weighing it belongs below the fold, and did");
});

test("2121 PROMOTED, NEVER FILTERED — the count the table evidences is unchanged", () => {
  // settled that this appendix ranks and does not filter: it is the evidence behind a count, and
  // a reader must be able to reconcile the two. A fix that dropped rows would break the rule it rides on.
  const ranked = rankByMateriality(RECORDS, { classes: [9, 41] },
    { classesSearched: [9, 41], registerReads: [{ recordId: "R-THE-WEIGHED-ONE", read: "x" }] });
  assert.equal(ranked.length, RECORDS.length, "every record survives the ranking");
  assert.deepEqual([...ranked].map((r) => r.recordId).sort(), RECORDS.map((r) => r.recordId).sort(),
    "the same set, reordered — nothing added, nothing dropped");
});

test("2121 THE CAPTION STATES THE SORT THAT ACTUALLY RAN", () => {
  // The defect one layer up: a caption describing a different order from the one the code performs is
  // how a reader concludes the missing filing was judged immaterial rather than never ranked for it.
  const html = render(RECORDS, { registerReads: [{ recordId: "R-THE-WEIGHED-ONE", read: "x" }] });
  assert.match(html, /most material first — the filings this assessment weighed before the rest/,
    "the caption must name the leading key, or it promises an order the code does not run");
  assert.match(html, /then live filings before dead/,
    "and it must still name the mechanical keys, which decide every row the assessment did not weigh");
});

test("2121 a weighed id the run does not hold changes nothing, and never throws", () => {
  // The ids are joined against the run's own store elsewhere; this arm is about THIS function not
  // trusting them. An unknown id must be inert, not a crash in the middle of publishing a report.
  const owners = appendixOwners(render(RECORDS, {
    registerReads: [{ recordId: "/mark/us/not-in-this-run", read: "x" }],
  }));
  assert.equal(owners[0], "noise-0", "an id naming no record here promotes nothing");
  assert.doesNotThrow(() => rankByMateriality(RECORDS, { classes: [9] }, { registerReads: [{}], findings: [{}] }),
    "malformed rows must not take the report down");
  assert.doesNotThrow(() => rankByMateriality(RECORDS, { classes: [9] }, null), "a null mark is not a throw");
});

// ── half 1: the field the rater is told to send must exist in the schema it is given ────────────────

test("2121 registerReads and weighedFilings are DECLARED in the tool schema", async () => {
  // A field described in prose and absent from the schema is folklore, and this repo already says so in
  // as many words (a-cancel-marker-names-its-actor.test.mjs). The mark object is
  // `additionalProperties: false`, so the seat was being told to send a key its own schema forbids.
  const src = readFileSync(join(HERE, "..", "engine", "mcp", "recording-server.mjs"), "utf8");
  const tool = src.slice(src.indexOf('name: "record_knockout_assess"'));
  assert.ok(/registerReads:\s*\{/.test(tool),
    "registerReads left the tool schema — the rater is instructed to send a key the schema forbids");
  assert.ok(/weighedFilings:\s*\{/.test(tool),
    "weighedFilings left the tool schema — the finding's source labelling derives from it");
});

test("2121 the schema and the recorder's allowlist agree about these two keys", () => {
  // Two closed sets over one payload. They disagreed: DECLARED has carried both fields since tracker
  // issue 2058 while the schema forbade them, and only the recorder's set was enforced — which is
  // exactly why sending them WORKED for a seat that ignored the schema.
  const rec8 = readFileSync(join(HERE, "..", "knockout-assess-record.mjs"), "utf8");
  assert.match(rec8, /"registerReads"/, "the recorder must still allow the key the schema now offers");
  assert.match(rec8, /"weighedFilings"/);
});

test("2121 the findings key count in the schema's own description matches its properties", () => {
  // The description says "CLOSED KEYS, all N, no others". It said EIGHT while the recorder enforced
  // nine, so the sentence a reader trusts was a closed set that was not the closed set in force.
  const src = readFileSync(join(HERE, "..", "engine", "mcp", "recording-server.mjs"), "utf8");
  const tool = src.slice(src.indexOf('name: "record_knockout_assess"'));
  const block = tool.slice(tool.indexOf("findings: {"));
  const said = /CLOSED KEYS, all (\w+), no others/.exec(block)?.[1];
  assert.ok(said, "the findings description stopped stating its own closed-key count");
  const props = block.slice(block.indexOf("properties: {"));
  const names = new Set([...props.slice(0, props.indexOf("\n                },")).matchAll(/^\s{20}(\w+):/gm)].map((m) => m[1]));
  const WORDS = { seven: 7, eight: 8, nine: 9, ten: 10 };
  assert.equal(WORDS[said], names.size,
    `the description claims ${said} keys and the object declares ${names.size}: ${[...names].join(", ")}`);
});
