// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A JUDGE MAY CITE A WEB PAGE THE RUN SAVED, AND THE CHECK KNOWS EVERY ONE OF THEM.
//
// Each judge's answer is checked against facts the driver writes before the judges run: every record id
// the pile holds and every web address the run saved. The facts builder read each web cell's pages under
// the grid's own name for them, `candidates`, but the pile hands its cells over with those pages under
// `results`. So the run's saved web addresses always came to none, and every web page a judge cited was
// refused as not held — on a test clearance, fourteen pages of the run's own grid, on every attempt, and
// the step failed with no report delivered. The arms that existed handed the check its facts directly, so
// none of them went through the builder. These do: the invented pile on disk, the real builder, the real
// file check. Every name here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPile } from "../pile.mjs";
import { writeJudgmentFacts, readJudgmentFacts, checkJudgmentFile, JUDGMENT_FACTS_FILE } from "../owner-judgment.mjs";
import { parseFrameworkManifest } from "../framework.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const PILE = join(import.meta.dirname, "fixtures", "owner-pile");
const SCALE = parseFrameworkManifest({
  schema_version: 1, framework_key: "orchard-test", title: "Invented test framework", source_deck: "none",
  entity_label: "the company", bands: [{ label: "High", tone: "high" }, { label: "Low", tone: "low" }],
  structure: { kind: "bands" },
});
// The one page the invented grid saved, read from the fixture rather than typed, so the arm follows it.
const SAVED = JSON.parse(readFileSync(join(PILE, "common-law-grid.json"), "utf8")).cells.flatMap((c) => c.candidates.map((r) => r.url));

function run() {
  const dir = mkdtempSync(join(tmpdir(), "judge-web-cite-"));
  cpSync(PILE, dir, { recursive: true });
  const pile = loadPile(dir);
  writeJudgmentFacts(driverDir(dir, JUDGMENT_FACTS_FILE), { pile, framework: SCALE });
  return { dir, pile };
}

const answer = (records) => JSON.stringify({
  considered: [{ owners: ["A Web Seller"], decision: "carry", records, rating: "High",
    marks_alike: "same", goods_close: "overlapping", reason: "The same mark, sold online in the order's goods." }],
  overall_rating: "High", advice: "Invented advice.", questions_wished_for: [],
});

test("the facts hold every web address the run saved", () => {
  const { dir } = run();
  try {
    assert.ok(SAVED.length >= 1, "premise: the invented grid saved a page");
    const facts = readJudgmentFacts(driverDir(dir, JUDGMENT_FACTS_FILE));
    assert.deepEqual([...facts.webUrls].sort(), [...SAVED].sort(),
      "the facts hold none of the run's saved web pages, so every web page a judge cites is refused");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a judge citing a saved page passes the check, and one citing a page the run never saved does not", () => {
  const { dir, pile } = run();
  try {
    const at = driverDir(dir, "owner-judgment-1.json");
    const record = pile.records[0].id;
    assert.deepEqual(checkJudgmentFile(at, answer([record, SAVED[0]])), { ok: true, failures: [] },
      "a page of the run's own grid was refused as not held");
    // THE CONTROL: the check still refuses what the run does not hold, so the pass above is not a check
    // that has stopped looking.
    const v = checkJudgmentFile(at, answer(["https://example.invalid/never-saved"]));
    assert.equal(v.ok, false);
    assert.match(v.failures.join(" "), /^judgment_record_not_held:1:https:\/\/example\.invalid\/never-saved/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
