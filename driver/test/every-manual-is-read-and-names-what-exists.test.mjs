// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY MANUAL UNDER driver/skills/ IS READ BY A STAGE, AND NAMES ONLY TOOLS AND FILES THAT EXIST.
//
// A stage's instructions are the files its message names, so a manual that no stage is pointed at is text
// nobody reads and everybody maintains. And a manual outlives what it describes: when a tool or a file goes,
// the sentence naming it stays, and the seat that reads it spends a turn on something that is not there.
//
// What the neighbouring checks already hold: that a declared file exists
// (every-model-stage-is-handed-the-instruction-files-it-declares), that a sibling a SKILL.md links is
// measured (a-skill-that-points-at-a-sibling). Neither asks the two questions above.
//
// fixtures/manual-identifier-backlog.json is what was already there when this check arrived. It may only
// shrink: a new finding fails here, a repaired one fails until its entry is deleted, and BACKLOG_TOTAL below
// makes any growth a visible edit to this file. Tools and `.md` paths are the families checked, because
// their lists are closed. Record fields and statuses are not checked yet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { nonEmpty } from "../../shared/vacuous-pass.mjs";
import { DRIVER } from "./model-stage-dispatches.mjs";
import { NOT_INSTRUCTION_LOAD, identifierFindings, identifierFindingsIn, knownToolNames, pointersIn, readMap,
  runArtifactNames, unreadOf } from "./instruction-read-map.mjs";

const BACKLOG = JSON.parse(readFileSync(join(DRIVER, "test/fixtures/manual-identifier-backlog.json"), "utf8"));
// Lower this in the commit that lowers the backlog. It is never raised to admit a new finding.
const BACKLOG_TOTAL = 3;
const POPULATION_FLOOR = 40;

// Null when there is no checkout to list: `trackedFiles` has already said so, and no arm below can run.
const map = readMap();
const skip = map === null ? "no checkout to read the manuals from" : false;

test("the map covers the tree, and reaches the reads no opening message spells out", { skip }, () => {
  nonEmpty(map.population, "the manuals under driver/skills");
  assert.ok(map.population.length >= POPULATION_FLOOR, `only ${map.population.length} manuals listed: this is not the tree`);
  nonEmpty(map.stages, "the stage rows");
  for (const f of [
    "skills/clearance-search/risk-framework-demo.md",       // a profile's framework
    "skills/clearance-search/worked-examples-demo.md",      // a profile's worked examples
    "skills/clearance-search/risk-framework-triage.md",     // the knockout lane's deck
    "skills/clearance-search/field-doctrine-pharma.md",     // a matter in the pharma class
    "skills/clearance-register/providers/signa.md",         // a provider deck
    "skills/whatif-memo/SKILL.md",                          // read from disk by its own dispatch
  ]) assert.ok(map.told.has(f), `${f} is read by a stage and the map does not know it`);
});

test("every file a stage is told to read is in the tree", { skip }, () => {
  const known = new Set(map.population);
  assert.deepEqual([...map.told].filter((f) => !known.has(f)).sort(), []);
});

test("every manual reaches a seat, or is listed as what was already unread when this check arrived", { skip }, () => {
  assert.deepEqual(map.unread, [...BACKLOG.unread].sort(),
    "a manual no stage is told to read and no read manual points at. Point a stage at it or move it out of "
    + "driver/skills. If it has reached a seat or moved, delete its entry from the backlog.");
});

test("a manual nothing reaches is found", () => {
  const unread = unreadOf({ population: ["skills/a.md", "skills/b.md", "skills/c.md", "skills/invented.md"],
    told: new Set(["skills/a.md"]), pointed: new Set(["skills/b.md"]), forReader: new Set(["skills/c.md"]) });
  assert.deepEqual(unread, ["skills/invented.md"]);
});

test("a file listed as written for a person exists, and no stage is told to read it", { skip }, () => {
  const known = new Set(map.population);
  for (const [f, why] of Object.entries(NOT_INSTRUCTION_LOAD)) {
    assert.ok(why.length > 20, `${f} carries no reason`);
    assert.ok(known.has(f), `${f} is listed as written for a person and is not in the tree: delete its entry`);
    assert.ok(!map.told.has(f), `${f} is listed as written for a person and a stage is told to read it`);
  }
});

test("a read manual names only tools and files that exist, beyond what was already named when this check arrived", { skip }, () => {
  assert.deepEqual(identifierFindings(map), BACKLOG.identifiers,
    "a manual names, in backticks, a tool or a .md file that does not exist. Repair the sentence, through design "
    + "if a model reads it. If an entry has been repaired, delete it from the backlog.");
});

test("a named tool or file that does not exist is found, and the ones that do exist are not", { skip }, () => {
  const lists = { tools: knownToolNames(), known: new Set(map.population), artifacts: runArtifactNames() };
  assert.ok(lists.tools.size >= 30 && lists.tools.has("record_synthesis") && lists.tools.has("register_search")
    && lists.tools.has("record_unit_note"), "the list of tools is not the tool list");
  const found = identifierFindingsIn([
    "`record_invented_tool` then `register_invented` and `gone-manual.md`.",
    "`record_synthesis`, `register_search`, `record_id`, `matter-context.md`, `signa.md`, `digest.md`, `clearance-search/report-prose.md`, `word`.",
  ].join("\n"), "skills/clearance-register/providers/signa.md", lists);
  assert.deepEqual(found, ["gone-manual.md", "record_invented_tool", "register_invented"].sort());
});

test("a pointer is read from a link and from backticks, and only when the file exists", () => {
  const known = new Set(["skills/x/one.md", "skills/x/sub/two.md", "skills/y/three.md"]);
  const text = "See [one](one.md), `sub/two.md`, [three](../y/three.md), `absent.md` and [gone](gone.md).";
  assert.deepEqual([...pointersIn(text, "skills/x/SKILL.md", known)].sort(), ["skills/x/one.md", "skills/x/sub/two.md", "skills/y/three.md"]);
});

test("the backlog only falls: its size is a number in this file", () => {
  const total = BACKLOG.unread.length + Object.values(BACKLOG.identifiers).flat().length;
  assert.equal(total, BACKLOG_TOTAL, "lower BACKLOG_TOTAL when the backlog falls; a new finding is repaired, never added here");
});
