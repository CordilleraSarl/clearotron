// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The knockout's rating step reads none of the hand-off LINES, and it now keeps a set-aside RECORD. Two
// rulings a day apart, and the difference between them is the whole subject of this file.
//
// OUT, and it stays out (2026-09-25). The hand-off lines were added to the rating step and taken out
// again after the one knockout run that carried them rated three of four marks a band LOWER on identical
// evidence. So sentence 6 stays in the clearance, where it closes the picking step's promotion question,
// and the rating step's own dispatch names no page list and no cite-or-set-aside rule. Nothing counts the
// knockout's pages: a ground is owed for a candidate the web notes marked, never for a page read.
//
// IN (2026-09-26). Nothing the search FOUND leaves the record without a reason, so the rater records a
// set-aside with its ground for a returned result it does not carry as a finding — the same set-aside the
// clearance has. It is a record of what was read and put down, written after the rating is written, and
// it changes no band. That is why the first arm below still holds while the others inverted: the
// instructions the rater is dispatched with are unchanged, and what moved is the record it may fill in.
//
// A reader who knows only one of the two rulings will read this file as reversing the other. It does not.
// The line is between an instruction that decides a band and a record of a decision already made.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDriverDir } from "../../shared/driver-dir.mjs";
import { KO_STAGES, koPaths } from "../stages-knockout.mjs";
import { kebab } from "../search-policy.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const SENTENCE_6 = "Judge an owner's records as a set. Write the position from the record in the client's market and class, quoting its goods. A record you do not carry is given a ground; no record leaves without one.";
const PAYLOAD = "## Findings\n- **Near** — https://apps.example.org/app/7 — a game.\n## Sources\n- https://dict.example/word/near\n";

function runWithResearch() {
  const runDir = mkdtempSync(join(tmpdir(), "ko-rating-step-"));
  const K = koPaths(runDir);
  mkdirSync(K.researchDir, { recursive: true });
  writeFileSync(K.research(kebab("NEARFIELD")), PAYLOAD);
  ensureDriverDir(runDir);
  writeFileSync(K.registerRecords, JSON.stringify({ marks: [{ name: "NEARFIELD", records: [
    { recordId: "R-1", mark: "NEARFIELD", owner: "Paper Goods KK" },
  ] }] }));
  return { runDir, K };
}

test("the knockout's rating instructions carry no page list and no set-aside rule, and the filing lines read as before", () => {
  const { runDir, K } = runWithResearch();
  try {
    const text = String(KO_STAGES["knockout-assess"].message({
      K, chunkNo: 0, chunkMarks: [{ name: "NEARFIELD" }], chunkTotal: 1, probeNote: "",
      framework: { bands: [{ label: "High" }, { label: "Manageable" }] }, frameworkPath: null,
    }));
    assert.ok(text.includes("WHEN YOU WEIGH ONE OF THOSE FILINGS"), "guard: the filings block rendered, so the absences below are real");
    assert.doesNotMatch(text, /EACH MARK'S PAGES/, "the page list is out of the rating step");
    assert.doesNotMatch(text, /setAside/, "the set-aside rule is out of the rating step");
    assert.doesNotMatch(text, /https:\/\/apps\.example\.org\/app\/7/, "no research page is listed to the rater");
    assert.ok(text.includes(`Both are optional and both are joined against the filings you were given, so an id we do not hold is refused by name. A filing you did not weigh simply gets no row: do not invent a read to fill one, and never write "not weighed" as a read.`),
      "the filing lines read as they did before the hand-off lines");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("sentence 6 stays in the clearance's picking step; the knockout manual records a set-aside without it", () => {
  const md = readFileSync(join(DRIVER, "skills", "knockout-assess", "SKILL.md"), "utf8");
  assert.ok(md.includes("## Per mark — the mandatory sequence"), "guard: the knockout manual was read");
  assert.equal(md.includes(SENTENCE_6), false, "sentence 6 is out of the knockout manual");
  // AND THE PAGE LIST, on this surface too. The rater is handed this manual in its dispatch —
  // `stages-knockout.mjs` names it in the `reads([...])` line of the rating step's own message — so the
  // manual and the dispatch are one instruction set as far as the rater is concerned, and forbidding the
  // page list in the dispatch alone (the first arm above) leaves the surface where it can actually go
  // wrong unguarded. THE ABSENCE ASSERTIONS ARE THE LOAD-BEARING HALF HERE: every other check on `md`
  // below is a positive `includes`, and a positive cannot be broken by ADDING text, so a per-page
  // accounting paragraph could be added beside the section and pass all of them.
  assert.doesNotMatch(md, /EACH MARK'S PAGES/, "the page list stays out of the manual too, not only out of the dispatch");
  assert.ok(md.includes("**Both are optional, and omitting them is always safe.**"), "the filing lines read as before");
  const placement = readFileSync(join(DRIVER, "skills", "placement-inquiry", "SKILL.md"), "utf8");
  assert.equal(placement.split(SENTENCE_6).length - 1, 1, "and it stays, once, in the clearance's picking step");

  // AND THE SET-ASIDE THE LATER RULING ADDED, with the two sentences that keep it a record rather than a
  // rating rule. Asserted by their text, not by the field's name: a section that dropped either sentence
  // would still mention `setAside` and would be the instruction the 2026-09-25 ruling took out.
  assert.ok(md.includes("## Saying what you put down (`setAside`)"), "the set-aside section is in the manual");
  assert.ok(md.includes("**Written after your rating is written, and it changes no band.**"),
    "the section must say, first, that it comes after the rating and moves no band — the band drop of 2026-09-25 is what that sentence exists to prevent");
  // READ WITH ITS LINE BREAKS FOLDED. The manual is hard-wrapped prose, so a sentence long enough to
  // matter spans two lines and an exact-string read of it fails on the newline rather than on the text.
  const folded = md.replace(/\s+/g, " ");
  assert.ok(folded.includes("the rating you have already reached stands exactly as it is, and nothing in this section asks you to raise or lower it"),
    "…and say it again in its own words, because a rater reads the paragraph and not the heading");
  // The grouped form, not a row per page: the 79-grounds audit the owner refused is what this forbids.
  assert.ok(md.includes("**Where many results share one ground, write it once**"),
    "a row each for every returned result is the page-by-page audit the owner refused");
});

test("the knockout's record tool and its allowlist carry the set-aside list, closed to url and ground", async () => {
  const server = readFileSync(join(DRIVER, "engine", "mcp", "recording-server.mjs"), "utf8");
  assert.ok(server.includes("registerReads: {"), "guard: the knockout record schema was read");
  assert.match(server, /setAside: \{/, "the field the manual asks for is declared, or a seat that trusts the schema omits it");
  const record = readFileSync(join(DRIVER, "knockout-assess-record.mjs"), "utf8");
  assert.match(record, /"marks\.registerReads": \[/, "guard: the allowlist was read");
  assert.match(record, /"marks\.setAside": \["url", "ground"\]/, "and the allowlist the driver actually validates against agrees with it");
  // THE ROW IS CLOSED, so nothing else can ride in beside the ground — a band on a set-aside row would be
  // the rating step rating what it set aside, which is the thing that stays out.
  const { refuseUndeclared } = await import("../knockout-assess-record.mjs");
  assert.equal(refuseUndeclared({ marks: [{ name: "NEARFIELD", setAside: [{ url: "https://example.test/a", ground: "A fan page." }] }] }), null);
  assert.match(String(refuseUndeclared({ marks: [{ name: "NEARFIELD", setAside: [{ url: "https://example.test/a", ground: "x", band: "High" }] }] })), /band/);
});

test("the knockout's workbook prints the set-aside row, and the knockout still keeps no page trace", () => {
  const book = readFileSync(join(DRIVER, "publish", "knockout.mjs"), "utf8");
  assert.ok(book.includes("'Working Notes'"), "guard: the knockout workbook builder was read");
  // The label is the clearance's own, so no new sentence reaches a reader; the ground is the rater's words.
  assert.match(book, /'Search Term': `Set aside: \$\{url\}`/, "set-aside reasons live in the audit workbook, under the label a clearance already ships");
  // AND NO PAGE TRACE, which is the half that did not change: a ground is owed for a candidate the notes
  // marked, never for every page read, so nothing here counts or files the knockout's pages.
  const paths = readFileSync(join(DRIVER, "stages-knockout.mjs"), "utf8");
  assert.doesNotMatch(paths, /knockout-carry\.json/);
});
