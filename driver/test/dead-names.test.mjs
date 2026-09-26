// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A DEAD NAME STAYS DEAD, AND THE GUARD THAT KEEPS IT SO IS SEEN TO LOOK.
//
// The guard shipped with no test of its own, so nothing ran it. The ordinary-word list landed later
// carrying `lore`, the guard went red on it, and nobody heard: a guard nothing runs reports to no one.
// So the mechanism is driven here with an invented per-person identity, the published arms are held
// against the innocent words that made them hard to write, every exemption must still be earning its
// place, and the tracked tree itself is scanned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { skipReason } from "../../shared/tracked-files.mjs";
import { DEAD_NAME_RE, EXEMPTIONS, GUARD, deadNameHits, corpusOf } from "../../scripts/dead-names.mjs";

const NO_CORPUS = skipReason(GUARD);
let tree;
const corpus = () => (tree === undefined ? (tree = corpusOf()) : tree);

test("the mechanism fires on an invented per-person identity handed to it, naming file and line", () => {
  const invented = /mailagent-(example)/i;
  const planted = [
    { file: "ops/roster.md", text: "the agents on this box\nqueue watched: mailagent-example\n" },
    { file: "ops/clean.md", text: "nothing to see\n" },
  ];
  assert.deepEqual(deadNameHits(planted, invented).map(({ file, line }) => [file, line]), [["ops/roster.md", 2]]);
  assert.deepEqual(deadNameHits(planted), [], "the invented identity is not a published arm");
});

test("the retired product names fire in each shape a deployment used", () => {
  for (const s of ["lorestar", "LORE_POOL", "lore_url", "clearance_lore", "lorectl", "trademark-lore",
    "the lore service", "AUGHRA_HOME", "aughra.timer"]) {
    assert.ok(DEAD_NAME_RE.test(s), `${s} must fire`);
  }
});

test("the words that made the loose arm hard to write stay innocent", () => {
  for (const s of ["explore", "Flores", "lorem", "folklore", "Florence", "unexplored", "recolored", "WarframeLore"]) {
    assert.ok(!DEAD_NAME_RE.test(s), `${s} must not fire`);
  }
});

test("every exemption still earns its place: its file is tracked and still carries a true match", (ctx) => {
  if (!corpus()) return ctx.skip(NO_CORPUS);
  for (const e of EXEMPTIONS) {
    const f = corpus().find((c) => c.file === e.file);
    assert.ok(f, `${e.file} is exempt but no longer tracked — delete the exemption`);
    assert.ok(f.text.split("\n").some((l) => DEAD_NAME_RE.test(l)),
      `${e.file} no longer carries a dead name — delete the exemption before something real hides under it`);
  }
});

test("the tracked tree carries no dead name", (ctx) => {
  if (!corpus()) return ctx.skip(NO_CORPUS);
  assert.ok(corpus().length > 1000, `the sweep read ${corpus().length} file(s), too few to have looked`);
  assert.deepEqual(deadNameHits(corpus()).map((h) => `${h.file}:${h.line}  ${h.text}`), []);
});
