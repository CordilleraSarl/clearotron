// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The knockout's rating step reads none of the hand-off lines. They were added to it and taken out again
// by the owner's ruling, after the one knockout run that carried them rated three of four marks a band
// lower: the lines stay in the clearance, where sentence 6 closes the picking step's promotion question,
// and leave the knockout's manual, its instructions and its record tool. Nothing counts the knockout's
// pages either, and its workbook has no set-aside row: a ground is owed only for a candidate the web notes
// marked, never for a page read.
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

test("sentence 6 stays in the clearance's picking step and is not in the knockout manual", () => {
  const md = readFileSync(join(DRIVER, "skills", "knockout-assess", "SKILL.md"), "utf8");
  assert.ok(md.includes("## Per mark — the mandatory sequence"), "guard: the knockout manual was read");
  assert.equal(md.includes(SENTENCE_6), false, "sentence 6 is out of the knockout manual");
  assert.doesNotMatch(md, /setAside/);
  assert.ok(md.includes("**Both are optional, and omitting them is always safe.**"), "the filing lines read as before");
  const placement = readFileSync(join(DRIVER, "skills", "placement-inquiry", "SKILL.md"), "utf8");
  assert.equal(placement.split(SENTENCE_6).length - 1, 1, "and it stays, once, in the clearance's picking step");
});

test("the knockout's record tool and its allowlist offer no set-aside list", () => {
  const server = readFileSync(join(DRIVER, "engine", "mcp", "recording-server.mjs"), "utf8");
  assert.ok(server.includes("registerReads: {"), "guard: the knockout record schema was read");
  assert.doesNotMatch(server, /setAside: \{/);
  const record = readFileSync(join(DRIVER, "knockout-assess-record.mjs"), "utf8");
  assert.match(record, /"marks\.registerReads": \[/, "guard: the allowlist was read");
  assert.doesNotMatch(record, /setAside/);
});

test("the knockout's workbook prints no set-aside row, and the knockout keeps no page trace", () => {
  const book = readFileSync(join(DRIVER, "publish", "knockout.mjs"), "utf8");
  assert.ok(book.includes("'Working Notes'"), "guard: the knockout workbook builder was read");
  assert.doesNotMatch(book, /Set aside|setAside/);
  const paths = readFileSync(join(DRIVER, "stages-knockout.mjs"), "utf8");
  assert.doesNotMatch(paths, /knockout-carry\.json/);
});
